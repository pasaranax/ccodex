import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
const executable = (path: string, script: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return path;
};
describe("no codex on PATH", () => {
  const realPlatform = process.platform;
  const onPlatform = (value: NodeJS.Platform) => Object.defineProperty(process, "platform", { value });

  beforeEach(() => {
    const home = mkdtempSync(join(tmpdir(), "ccodex-no-codex-"));
    executable(join(home, "Applications", "ChatGPT.app", "Contents", "Resources", "codex-cli", "bin", "codex"), 'echo "codex-cli 0.164.0"');
    vi.stubEnv("HOME", home);
    vi.stubEnv("CCODEX_HOME", join(home, ".ccodex"));
    vi.stubEnv("CCODEX_CONFIG", join(home, "none.toml"));
    vi.stubEnv("CCODEX_CODEX", undefined);
    vi.stubEnv("CODEX_INSTALL_DIR", join(home, ".local", "bin"));
    vi.stubEnv("PATH", "/usr/bin:/bin");
  });
  afterEach(() => {
    onPlatform(realPlatform);
    vi.unstubAllEnvs();
  });

  it("on macOS leaves Desktop's CLI, what a Desktop launch runs anyway, instead of stopping CCodex", () => {
    onPlatform("darwin");
    expect(loadConfig().codex).toMatch(/\/ChatGPT\.app\/Contents\/Resources\/codex-cli\/bin\/codex$/u);
  });

  it("stays an error on Linux", () => {
    onPlatform("linux");
    expect(() => loadConfig()).toThrow("No `codex` found on PATH");
  });
});
