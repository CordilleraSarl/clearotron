// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NO INTERNAL HOSTNAME SHIPS IN THE PACKAGE.
//
// A published beta carried a test instance's hostname in five demo sample files, two `status.json` report
// URLs per run and the sample email's links, and the demo's connector handed that address to an assistant
// as the report link (measured 2026-09-11). `deployment-hostnames.test.mjs` walks source extensions, so
// JSON and Markdown under `demo/` were outside it on both counts. This reads WHAT SHIPS instead: npm's
// own file list for the package, every file on it, whatever its extension.
//
// The deployment domain may appear only as the hosts the product deliberately publishes, listed here as
// literals: deriving them from the code that uses them would let an edit there widen this guard silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The hosts on the deployment domain the package may name: the hosted service's published endpoints. */
const PUBLISHED = new Set([
  "cordillera.ch", "www.cordillera.ch",
  "trademark.cordillera.ch", "mcp.cordillera.ch", "clients-mcp.cordillera.ch", "agent-mcp.cordillera.ch",
]);
const HOST_RE = /\b(?:[a-z0-9-]+\.)*cordillera\.ch\b/gi;

function shippedFiles() {
  // --ignore-scripts: a `prepack` build must not run inside a test. The list is npm's, so `files`,
  // negations and `.npmignore` are applied exactly as a publish applies them. Offline: a dry-run pack
  // resolves on disk, and npm reaching for a registry it does not need can block rather than fail.
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, npm_config_offline: "true" } });
  const [pack] = JSON.parse(out);
  return (pack?.files ?? []).map((f) => f.path);
}

test("every file the package ships names no host on the deployment domain but the published ones", () => {
  const files = shippedFiles();
  // A FLOOR, so a pack that listed nothing cannot read as a clean one.
  assert.ok(files.length > 500, `npm listed ${files.length} file(s) for the package; this guard needs the real list`);
  assert.ok(files.some((f) => f.startsWith("demo/") && f.endsWith("/run/status.json")), "the demo samples are not in the list this guard read");
  const found = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    for (const m of text.matchAll(HOST_RE)) {
      const host = m[0].toLowerCase();
      if (!PUBLISHED.has(host)) found.push(`${f}: ${host}`);
    }
  }
  assert.deepEqual(found, [], "a host on the deployment domain that the product does not publish is in the package");
});
