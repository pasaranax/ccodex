import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { update } from "../../src/management/commands.js";

describe("fork updates", () => {
  let calls: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), "ccodex-fork-update-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    calls = join(root, "npm-calls");
    writeFileSync(join(bin, "npm"), `#!/bin/sh
printf '%s\\n' "$*" >> "$CCODEX_TEST_NPM_CALLS"
case "$1:$2" in
  view:@pasaranax/ccodex) printf '%s\\n' '"0.5.20-pasaranax.2"' ;;
  root:-g) printf '%s\\n' "$CCODEX_HOME/global" ;;
  *) exit 91 ;;
esac
`, { mode: 0o755 });
    vi.stubEnv("PATH", bin);
    vi.stubEnv("CCODEX_HOME", join(root, "product"));
    vi.stubEnv("CODEX_INSTALL_DIR", join(root, "remote-bin"));
    vi.stubEnv("CCODEX_TEST_NPM_CALLS", calls);
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(["latest", "next"])("queries the fork's %s channel", async (channel) => {
    expect(await update(["--check", ...(channel === "next" ? ["--next"] : [])])).toBe(0);
    expect(readFileSync(calls, "utf8").split("\n")).toEqual([
      `view @pasaranax/ccodex dist-tags.${channel} --json`, "root -g", "",
    ]);
  });
});
