// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE FREE-FORM LOOKUP IS THE ONE NOTHING RECORDED.
//
// The driver could prove a common-law lookup HAPPENED — `_driver/tool-calls.jsonl` writes
// server/tool/axis/seq — and could not show what was asked or what came back. A seat's
// `**Use-check source:** <result URL>` line is retyped out of that turn result, so a URL the tool
// returned and one composed around it left the same trace.
//
// NOT the grid path, which was never the gap: grid mode writes its ledger to `spec.output_path` itself
// (machine receipts, saved verbatim) and the driver reconciles it against the dictated cells before
// accepting it. Asserted below so a future reader does not "extend" the log into a path that already
// has a stronger guarantee than a log.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp", "perplexity-server.mjs"), "utf8");
const BAND = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp", "band-server.mjs"), "utf8");

test("both outcomes of a free-form call are logged — success AND failure", () => {
  // The failure half is the one that matters most: without it, "the search ran and found nothing" and
  // "the search errored" leave the same trace, which is the ambiguity the issue is about.
  const calls = [...SRC.matchAll(/logCall\("perplexity_research", (\w+|\{[^}]*\}), \{ ok: (true|false)/g)].map((m) => m[2]);
  assert.ok(calls.includes("true"), "a successful lookup is recorded");
  assert.ok(calls.includes("false"), "a failed lookup is recorded");
});

test("THE RESOLVED PRESET IS LOGGED, not the requested one", () => {
  // `depth` is often absent and detectPreset decides. Logging the request would record a null where the
  // fact is what actually ran.
  assert.match(SRC, /const preset = depth && VALID_PRESETS\.includes\(depth\) \? depth : detectPreset\(task\);/);
  assert.match(SRC, /const asked = \{ task, depth: depth \?\? null, preset,/);
});

test("THE RESPONSE BODY IS NEVER WRITTEN — shape only", () => {
  // It runs to tens of KB, it is the client's matter content, and the question this log answers is
  // answered by its shape. A future edit that logs `data` or the formatted text fails here.
  assert.ok(!/logCall\([^)]*\bdata\b[^)]*\)/.test(SRC), "the raw response object must not reach the log");
  assert.ok(!/ok: true, .*text[,}]/.test(SRC), "nor the formatted answer text");
  assert.match(SRC, /ok: true, bytes: String\(text \?\? ""\)\.length, citations: citationCount\(data\)/,
    "the shape — bytes and citation count — is what rides");
});

test("no credential can reach the log", () => {
  assert.ok(!/logCall\([^)]*API_KEY/.test(SRC));
  assert.ok(!/API_KEY/.test(SRC.slice(SRC.indexOf("function logCall"), SRC.indexOf("function logCall") + 600)));
});

test("IT IS THE SAME LOG AND THE SAME RULE AS THE BAND SERVER — one pattern, not a second one", () => {
  for (const src of [SRC, BAND]) {
    assert.match(src, /"reading-log\.jsonl"/, "same file");
    assert.match(src, /best-effort/i, "same rule: a log failure never breaks a lookup");
  }
  assert.match(SRC, /if \(!RUN_DIR\) return;/, "and no run dir means no log, never a throw");
});

test("the run dir is read from the EXISTING variable, not a newly minted second name", () => {
  // gather-config's serverEnv builds ONE env object for EVERY local server, so CLEAROTRON_BAND_RUN_DIR has
  // always been this process's run dir — it was simply never read here. A second name for one fact is
  // the defect this codebase spent 2026-08-14 removing.
  assert.match(SRC, /process\.env\.CLEAROTRON_BAND_RUN_DIR/);
  assert.ok(!/CLEAROTRON_PERPLEXITY_RUN_DIR|CLEAROTRON_GATHER_RUN_DIR/.test(SRC));
});

test("THE GRID PATH IS UNTOUCHED — it already has a stronger guarantee than a log", () => {
  // Grid mode writes the ledger to spec.output_path itself and the driver reconciles every dictated
  // cell before accepting it. Adding a log there would record a fact the artefact already carries.
  assert.match(SRC, /writeFileSync\(spec\.output_path, cap\.ledgerJson/);
  const gridBlock = SRC.slice(SRC.indexOf("if (grid_spec_path)"), SRC.indexOf("if (!task || task.trim()"));
  assert.ok(!/logCall\(/.test(gridBlock), "the grid path is deliberately not logged");
});
