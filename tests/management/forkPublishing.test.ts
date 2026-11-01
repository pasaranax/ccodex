import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("publishing fork packages", () => {
  it.each([false, true])("uses an explicit provenance override only for bootstrap: %s", (bootstrap) => {
    const root = mkdtempSync(join(tmpdir(), "ccodex-fork-publish-"));
    const bin = join(root, "bin");
    const calls = join(root, "npm-calls");
    mkdirSync(bin);
    mkdirSync(join(root, "package"));
    writeFileSync(join(root, "package", "package.json"), JSON.stringify({ name: "@pasaranax/ccodex", version: "0.5.20-pasaranax.1" }));
    const archive = join(root, "ccodex.tgz");
    execFileSync("tar", ["-czf", archive, "-C", root, "package"]);
    writeFileSync(join(bin, "npm"), `#!/bin/sh
printf '%s\\n' "$*" >> "$CCODEX_TEST_NPM_CALLS"
if [ "$1" = view ]; then printf '%s\\n' E404 >&2; exit 1; fi
`, { mode: 0o755 });
    execFileSync(process.execPath, [
      fileURLToPath(new URL("../../release/publish-tarballs.mjs", import.meta.url)),
      "latest", ...(bootstrap ? ["--no-provenance"] : []), archive,
    ], { env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, CCODEX_TEST_NPM_CALLS: calls } });
    expect(readFileSync(calls, "utf8").trim().split("\n").at(-1)).toBe(
      `publish ${archive} --access public --tag latest${bootstrap ? " --provenance=false" : ""}`,
    );
  });
});
