import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReviewServer } from "../../src/mcp/claudeReview.js";
import { testConfig } from "../fixtures/config.js";

vi.mock("@anthropic-ai/claude-agent-sdk", async (original) => ({ ...await original<object>(), query: vi.fn() }));

let cwd: string;
let commit: string;
let client: Client;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeEach(async () => {
  cwd = mkdtempSync(join(tmpdir(), "ccodex-review-"));
  git("init", "-q");
  writeFileSync(join(cwd, "app.txt"), "original\n");
  git("add", "app.txt");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "base");
  writeFileSync(join(cwd, "app.txt"), "committed change\n");
  git("add", "app.txt");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "change");
  commit = git("rev-parse", "HEAD");
  writeFileSync(join(cwd, "app.txt"), "dirty change\n");
  writeFileSync(join(cwd, ".gitattributes"), "app.txt -diff\n");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createReviewServer(testConfig(), "1.0.0");
  client = new Client({ name: "test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  rmSync(cwd, { recursive: true, force: true });
  vi.resetAllMocks();
});

describe("Claude review MCP", () => {
  it("reviews a pinned commit in an ephemeral, read-only Claude session", async () => {
    const close = vi.fn();
    vi.mocked(query).mockImplementation(({ prompt, options }) => {
      expect(prompt).toContain("+committed change");
      expect(prompt).not.toContain("dirty change");
      expect(options).toMatchObject({
        model: "claude-opus-5-5", effort: "high", persistSession: false,
        pathToClaudeCodeExecutable: "/usr/bin/claude", settingSources: [],
        tools: [], strictMcpConfig: true, allowedTools: ["mcp__snapshot__read_file"],
      });
      const snapshot = options!.mcpServers!.snapshot!;
      if (snapshot.type !== "sdk") throw new Error("Expected in-process snapshot server");
      return {
        close,
        async *[Symbol.asyncIterator]() {
          const [fileClientTransport, fileServerTransport] = InMemoryTransport.createLinkedPair();
          const fileClient = new Client({ name: "reader", version: "1.0.0" });
          await snapshot.instance.connect(fileServerTransport);
          await fileClient.connect(fileClientTransport);
          expect((await fileClient.listTools()).tools.map(({ name }) => name)).toEqual(["read_file"]);
          expect(await fileClient.callTool({ name: "read_file", arguments: { path: "app.txt" } }))
            .toMatchObject({ content: [{ text: "committed change\n" }] });
          expect(await fileClient.callTool({ name: "read_file", arguments: { path: "../app.txt" } }))
            .toMatchObject({ isError: true });
          await fileClient.close();
          yield { type: "result", subtype: "success", is_error: false, result: "app.txt:1 — finding" };
        },
      } as unknown as ReturnType<typeof query>;
    });
    expect((await client.listTools()).tools).toMatchObject([{ name: "review_commit", annotations: { readOnlyHint: true } }]);
    expect(await client.callTool({ name: "review_commit", arguments: { cwd, commit: commit.slice(0, 10), model: "claude-opus-5-5" } }))
      .toMatchObject({ content: [{ text: "app.txt:1 — finding" }], structuredContent: { commit } });
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects invalid or missing commits before starting Claude", async () => {
    for (const ref of ["--help", "0000000000000000000000000000000000000000"]) {
      expect(await client.callTool({ name: "review_commit", arguments: { cwd, commit: ref } }))
        .toMatchObject({ isError: true });
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("reports missing history when the reviewed commit is at a shallow boundary", async () => {
    const shallow = join(cwd, "shallow");
    git("clone", "-q", "--depth=1", "--no-local", cwd, shallow);
    expect(await client.callTool({ name: "review_commit", arguments: { cwd: shallow, commit } }))
      .toMatchObject({ isError: true, content: [{ text: expect.stringContaining("first parent") }] });
    expect(query).not.toHaveBeenCalled();
  });

  it("aborts the Claude query when Codex cancels the review", async () => {
    const close = vi.fn();
    vi.mocked(query).mockImplementation(({ options }) => ({
      close,
      async *[Symbol.asyncIterator]() {
        const signal = options!.abortController!.signal;
        if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        signal.throwIfAborted();
      },
    }) as unknown as ReturnType<typeof query>);
    const abort = new AbortController();
    const response = client.callTool({ name: "review_commit", arguments: { cwd, commit } }, undefined, { signal: abort.signal });
    const cancelled = expect(response).rejects.toThrow();
    await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
    abort.abort();
    await cancelled;
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(vi.mocked(query).mock.calls[0]![0].options!.abortController!.signal.aborted).toBe(true);
  });
});
