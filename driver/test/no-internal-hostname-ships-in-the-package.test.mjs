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
// NO HOST ON THE DEPLOYMENT DOMAIN SHIPS AT ALL, the apex included. A deployment names its own hosts in
// its configuration (the sign-in audience is `CLEAROTRON_OIDC_AUDIENCE`); the package names none. The
// allowlist is kept, empty, so a host that must ship one day is named here as a deliberate literal rather
// than let in by loosening the pattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The hosts on the deployment domain the package may name. None: a deployment names its own. */
const PUBLISHED = new Set([]);
const HOST_RE = /\b(?:[a-z0-9-]+\.)*cordillera\.ch\b/gi;

function shippedFiles() {
  // --ignore-scripts: a `prepack` build must not run inside a test. The list is npm's, so `files`,
  // negations and `.npmignore` are applied exactly as a publish applies them. Offline: a dry-run pack
  // resolves on disk, and npm reaching for a registry it does not need can block rather than fail.
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, npm_config_offline: "true" } });
  const [pack] = JSON.parse(out);
  // AND ONLY WHAT THE COMMIT CARRIES. The package is packed from a clean checkout of a commit, so a file
  // that is not in HEAD's tree is not in it, however npm lists the working tree today. That matters where
  // a working tree holds more than the commit: a checking tree that stages files over a clone of this one
  // put two files the public repository has never carried under directories the package ships, and this
  // arm reported them as shipped (measured 2026-09-11).
  const committed = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .split("\n").filter(Boolean);
  const inCommit = new Set(committed);
  const shipped = (pack?.files ?? []).map((f) => f.path).filter((p) => inCommit.has(p));
  // AND THE SOURCES OF WHAT THE BUILD GENERATES. `portal-ui/dist` ships but is built, not committed, so
  // the filter above drops it; its sources are committed but never in npm's list. So the bundle's
  // inputs are read here instead: a host written into them ships inside the bundle.
  const bundleSources = committed.filter((p) => /^portal-ui\/(src\/|index\.html$|vite\.config\.ts$)/.test(p));
  return { shipped, bundleSources };
}

test("no file the package ships names a host on the deployment domain", () => {
  const { shipped, bundleSources } = shippedFiles();
  // FLOORS, so a pack that listed nothing, or a bundle whose sources moved, cannot read as a clean one.
  assert.ok(shipped.length > 500, `npm listed ${shipped.length} committed file(s) for the package; this guard needs the real list`);
  assert.ok(shipped.some((f) => f.startsWith("demo/") && f.endsWith("/run/status.json")), "the demo samples are not in the list this guard read");
  assert.ok(bundleSources.length >= 20, `only ${bundleSources.length} portal bundle source(s) found; the bundle ships, so its sources must be read`);
  const found = [];
  for (const f of [...shipped, ...bundleSources]) {
    let text;
    try { text = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    for (const m of text.matchAll(HOST_RE)) {
      const host = m[0].toLowerCase();
      if (!PUBLISHED.has(host)) found.push(`${f}: ${host}`);
    }
  }
  assert.deepEqual(found, [], "a host on the deployment domain that the product does not publish is in the package");
});
