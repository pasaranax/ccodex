import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { packageVersion, setup } from "../../src/management/commands.js";

// Setup's files are real; launchctl must never change the user's active Desktop.
vi.mock("../../src/desktop/launchAgent.js", () => ({
  installCliPathAgent: () => undefined,
  uninstallCliPathAgent: () => undefined,
}));

const executable = (path: string, script: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return path;
};

describe("the Node recorded by setup", () => {
  const running = process.execPath;
  // What Desktop may start a launcher with: nothing beside any Node.
  const minimalPath = "/usr/bin:/bin";
  let root: string;
  let product: string;
  let target: string;
  let desktopNode: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ccodex-setup-node-"));
    const home = join(root, "owner's home");
    const app = join(home, "Applications", "ChatGPT.app");
    product = join(home, ".ccodex");
    target = join(product, "versions", packageVersion(), "node_modules", "@pasaranax", "ccodex");
    desktopNode = executable(join(app, "Contents", "Resources", "cua_node", "bin", "node"),
      'if [ "$1" = "-p" ]; then echo "22.13.0"; else echo "desktop-node"; fi');
    const bin = join(root, "bin");
    executable(join(bin, "codex"), 'echo "codex-cli 0.164.0"');
    executable(join(target, "scripts", "install-claude-stack.sh"), "exit 0");
    vi.stubEnv("HOME", home);
    vi.stubEnv("CCODEX_HOME", product);
    vi.stubEnv("CLAUDE_CONFIG_DIR", join(home, ".claude"));
    vi.stubEnv("CODEX_INSTALL_DIR", join(home, ".local", "bin"));
    vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH ?? ""}`);

  });
  afterEach(() => {
    process.execPath = running;
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const manifest = () => JSON.parse(readFileSync(join(product, "install.json"), "utf8"));
  const launch = (name: string, path = process.env.PATH) => {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: path };
    delete env.CCODEX_SHIM_ACTIVE;
    return execFileSync(join(product, "bin", name), ["--version"], { env, encoding: "utf8" }).trim();
  };
  it("migrates the legacy external Node before the App disappears", async () => {
    const outside = executable(join(root, "owner's node", "bin", "node"), 'echo "outside-node"');
    writeFileSync(join(product, "install.json"), JSON.stringify({ nodeExecutable: desktopNode, fallbackNode: outside }));
    process.execPath = desktopNode;
    await setup([]);
    expect(manifest().nodeExecutable).toBe(outside);
    expect(manifest()).not.toHaveProperty("fallbackNode");
    rmSync(desktopNode);
    expect(launch("ccodex", minimalPath)).toBe("outside-node");
  });

  it("uses an explicitly selected new runtime instead of the legacy fallback", async () => {
    writeFileSync(join(product, "install.json"), JSON.stringify({ nodeExecutable: desktopNode, fallbackNode: desktopNode }));
    await setup([]);
    expect(manifest().nodeExecutable).toBe(running);
  });
});
