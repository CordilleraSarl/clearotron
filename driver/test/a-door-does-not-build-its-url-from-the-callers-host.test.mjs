// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a request URL built from the caller's own Host header is a crash, not a feature.
//
// `new URL(req.url, `http://${req.headers.host}`)` throws on any value that is not a valid authority.
// The outer try answers 500 with a stack in the log, and at the MCP face all of that happened ABOVE the
// `authenticate FIRST` block — so an unauthenticated caller who could reach the port got it. Measured
// 2026-08-26: six of nine Host values crashed that door; all nine answered 401 at the portal, which has
// always used a constant base.
//
// It also SKIPPED THE GUARD BUILT FOR THAT HEADER. `TRADEMARK_MCP_ALLOWED_HOSTS` arms the transport's
// DNS-rebinding protection and the server refuses to start without it — but a Host malformed enough to
// throw never reaches the transport, so the one check written to inspect the header was bypassed by a
// malformed value of it.
//
// TWO doors carried it, not one — the MCP face and the OAuth bridge's warm server — which is why this is
// a corpus arm and not two edits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "door-url-base (tracker issue 1928)";
const SELF = "driver/test/a-door-does-not-build-its-url-from-the-callers-host.test.mjs";

// `new URL(req.url, …)` whose BASE mentions the request headers. Deliberately narrow: it is the
// CALLER-CONTROLLED case that crashes. `driver/dev-portal.mjs` interpolates a `host` too, and it is NOT
// this defect — that value is a function parameter defaulting to 127.0.0.1 which the same file REFUSES
// unless it is loopback, so no caller can reach it. Adjudicated rather than swept in, and the narrow
// pattern is what keeps that distinction instead of leaving it to a reviewer.
const FROM_HEADERS = /new URL\(\s*req\.url\s*,[^)]*req\.headers/;

export function doorsBuildingUrlFromTheCaller(files, read) {
  const out = [];
  for (const rel of files) {
    let text; try { text = read(rel); } catch { continue; }
    text.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;   // a comment about the hazard is not the hazard
      if (FROM_HEADERS.test(line)) out.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  return out;
}

test("#1928 no door builds its request URL from the caller's Host — the corpus", (ctx) => {
  const all = trackedFiles(GUARD, { root: ROOT, pathspec: ["*.mjs"] });
  if (all === null) return ctx.skip(`${GUARD}: not a git checkout — the corpus cannot be read`);
  const files = all.filter((f) => f !== SELF);
  assert.ok(!files.includes(SELF), "the self-exclusion must apply, or this arm reads its own specimen");
  assert.ok(files.length > 50, `only ${files.length} tracked .mjs file(s) — the reader has broken, not the tree`);
  assert.deepEqual(doorsBuildingUrlFromTheCaller(files, (rel) => readFileSync(join(ROOT, rel), "utf8")), [],
    "the base exists only so a bare `req.url` parses as a path, and no door here reads the authority. "
    + "Taking it from the caller buys a 500 — before authentication, with a stack in the log — and no "
    + "behaviour at all. Use `\"http://localhost\"`, which the portal has always used.");
});

test("#1928 the detector fires on the shipped shape and spares the configured one", () => {
  const shipped = 'const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);';
  const configured = 'const url = new URL(req.url, `http://${host}`);';
  const fixed = 'const url = new URL(req.url, "http://localhost");';
  const read = (rel) => ({ a: shipped, b: configured, c: fixed }[rel]);
  assert.equal(doorsBuildingUrlFromTheCaller(["a"], read).length, 1, "the caller-controlled base must be caught");
  assert.equal(doorsBuildingUrlFromTheCaller(["b"], read).length, 0,
    "dev-portal's loopback-validated parameter is not this defect and must not be swept in");
  assert.equal(doorsBuildingUrlFromTheCaller(["c"], read).length, 0, "the constant base must not be reported");
});
