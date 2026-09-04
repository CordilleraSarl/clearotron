// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE RUN RECORD SAYS WHICH WRITE GUARANTEE THE RUN ACTUALLY GOT.
//
// `deny-authority-write.mjs` calls itself "THE WRITE BOUNDARY, enforced at the moment of the write". It
// is a `claude -p` PreToolUse hook, wired into the anthropic adapter and referenced from nowhere else, so
// on the codex path it does not exist. Codex has no PreToolUse to attach to and its sandbox can only GRANT
// (`--sandbox workspace-write --add-dir`), never subtract — the gap is structural, not a wiring mistake.
//
// e2e stated the consequence on 2026-08-18: "the same job, run on a different engine, gets a different
// write guarantee, and nothing in the run record says so." That silence is the defect this file closes. A
// guarantee that varies by engine is acceptable when it is DECLARED; it is dishonest only while it is
// silent, which is the receipts-lie family applied to write safety.
//
// This does NOT close the gap and must not be read as closing it. Prevention needs either a sandbox that
// can express a denial (it cannot) or `_driver/` outside the granted root (1114 call sites,). What
// changes here is that a reader can tell which guarantee a given run had.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { writeBoundaryOf } from "../gateway.mjs";
import { anthropicAgentEngine } from "../engine/anthropic-agent.mjs";
import { openaiAgentEngine } from "../engine/openai-agent.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("#954 both shipped engines declare a write guarantee, and they differ", () => {
  assert.equal(writeBoundaryOf(anthropicAgentEngine), "enforced");
  assert.equal(writeBoundaryOf(openaiAgentEngine), "none");
  assert.notEqual(writeBoundaryOf(anthropicAgentEngine), writeBoundaryOf(openaiAgentEngine),
    "if these ever agree, either the gap closed or a declaration is lying — both need a human");
});

test("#954 an engine that declares NOTHING reports 'undeclared', it does not vanish", () => {
  // The whole defect was silence. A field that disappears when unset reads as "not applicable" to every
  // later reader, so a new adapter must announce its own silence rather than inherit invisibility.
  assert.equal(writeBoundaryOf({ name: "third-party" }), "undeclared");
  assert.equal(writeBoundaryOf({ name: "x", writeBoundary: "" }), "undeclared");
  assert.equal(writeBoundaryOf({ name: "x", writeBoundary: "   " }), "undeclared",
    "a blank declaration is not a declaration — same rule as #1216");
  assert.equal(writeBoundaryOf(undefined), "undeclared");
  assert.equal(writeBoundaryOf(null), "undeclared");
});

test("#954 the declaration reaches the RECORD, at every site that stamps the engine", () => {
  // Asserted textually because the value is only useful if it is written down. Every row that names the
  // engine must also name the guarantee — a row carrying one without the other is the silence again, in
  // a smaller place.
  const src = read("driver/gateway.mjs");
  const namesEngine = src.split("\n").filter((l) => /engine: engine\.name/.test(l));
  assert.ok(namesEngine.length >= 2, `expected the engine to be stamped in at least 2 rows, found ${namesEngine.length}`);
  for (const line of namesEngine) {
    assert.match(line, /writeBoundary: writeBoundaryOf\(engine\)/,
      `a record row names the engine without its write guarantee:\n  ${line.trim()}`);
  }
});

test("#954 the anthropic declaration is not a claim about nothing — the hook is still wired", () => {
  // "enforced" is only true while the hook is actually attached. If someone unwires it, this declaration
  // becomes a lie in the record, which is worse than the silence it replaced.
  const src = read("driver/engine/anthropic-agent.mjs");
  assert.match(src, /deny-authority-write\.mjs/,
    "anthropic-agent declares its boundary ENFORCED but no longer references the deny hook");
});

test("#954 the codex declaration is not a claim about nothing either — the hook is still absent", () => {
  // The mirror image, and the one that would rot silently: if codex ever gains a boundary, "none" becomes
  // a lie that understates the product's safety and nobody would go looking for it.
  const src = read("driver/engine/openai-agent.mjs");
  assert.doesNotMatch(src, /deny-authority-write/,
    "openai-agent now references the deny hook, so its declaration of \"none\" is stale — re-rule it");
});
