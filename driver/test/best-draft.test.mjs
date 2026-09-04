// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the best-draft carry: a recovery park must CONTINUE the work, not restart it.
//
// The measured defect: both common-law halves of the 2026-08-05 R2 run converged 27→4→1 and 21→3→2 inside
// one dispatch, the park re-commissioned the stage cold, and the next cycle restarted at 21 and 13. Three
// cycles of converge-then-reset is exactly what the defect budget allows before terminal.
//
// The unit half is pure and offline. The integration half drives runStage through a fake engine, the same
// way exit1-artifact-rescue.test.mjs does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { beatsBest, readBestDraft, recordBestDraft, bestDraftDir } from "../best-draft.mjs";
import { runStage, registerEngine, draftCarryEligible } from "../gateway.mjs";

// ── beatsBest — ABSENT IS NOT ZERO ────────────────────────────────────────────────────────────────
test("#408: beatsBest — a non-finite score NEVER wins, a lower score does, a tie does not", () => {
  // The rule this module would break most silently. Most failures carry no quantity at all (a timeout, a
  // missing file). Letting one of those become "the best draft" would record it as 0 items outstanding —
  // which is what a PASS looks like — and the next park would then patch a document nobody scored.
  assert.equal(beatsBest(null, null), false);
  assert.equal(beatsBest(undefined, { quantity: 9 }), false);
  assert.equal(beatsBest(NaN, { quantity: 9 }), false);
  assert.equal(beatsBest(0, null), true, "a genuine zero from a validator is still a real score");
  assert.equal(beatsBest(4, null), true, "no incumbent ⇒ any real score is the best so far");
  assert.equal(beatsBest(4, { quantity: null }), true, "an unscored incumbent is not a floor");
  assert.equal(beatsBest(4, { quantity: 27 }), true);
  assert.equal(beatsBest(27, { quantity: 4 }), false, "a regression never replaces the floor — this is the whole point");
  assert.equal(beatsBest(4, { quantity: 4 }), false, "a tie buys nothing and only risks a later, no-better draft");
});

test("#408: record/read round-trip — the best draft survives, and a worse one never displaces it", () => {
  const dir = mkdtempSync(join(tmpdir(), "bestdraft-"));
  const out = join(dir, "common-law-findings.half-b.md");
  try {
    writeFileSync(out, "# draft at 27\n");
    assert.equal(recordBestDraft(dir, "common-law-half:b", out, { quantity: 27, fail: "invalid_file:x:connotation_undisposed:cite_absent=27", attempt: 1, key: "k" }), true);
    writeFileSync(out, "# draft at 4\n");
    assert.equal(recordBestDraft(dir, "common-law-half:b", out, { quantity: 4, fail: "invalid_file:x:connotation_undisposed:cite_absent=4", attempt: 2, key: "k" }), true);
    writeFileSync(out, "# a cold re-derivation, back at 21\n");
    assert.equal(recordBestDraft(dir, "common-law-half:b", out, { quantity: 21, fail: "invalid_file:x:connotation_undisposed:cite_absent=21", attempt: 1, key: "k" }), false,
      "the park's cold restart must NOT overwrite the converged draft — that regression is the issue");

    const best = readBestDraft(dir, "common-law-half:b");
    assert.equal(best.quantity, 4);
    assert.equal(readFileSync(best.path, "utf8"), "# draft at 4\n", "the bytes kept are the converged ones");
    // the two halves are separate stores and never collide
    assert.equal(readBestDraft(dir, "common-law-half:a"), null);
    assert.ok(bestDraftDir(dir, "common-law-half:b").includes("common-law-half:b"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#408: an absent or unreadable store reads as null, never as a zero-scored draft", () => {
  const dir = mkdtempSync(join(tmpdir(), "bestdraft-absent-"));
  try {
    assert.equal(readBestDraft(dir, "common-law-half:b"), null);
    // a score with no file behind it is ABSENT, not a draft scoring 0
    mkdirSync(bestDraftDir(dir, "s"), { recursive: true });
    writeFileSync(join(bestDraftDir(dir, "s"), "score.json"), JSON.stringify({ file: "gone.md", quantity: 1 }));
    assert.equal(readBestDraft(dir, "s"), null);
    // and a write to an artifact that does not exist records nothing rather than throwing
    assert.equal(recordBestDraft(dir, "s", join(dir, "nope.md"), { quantity: 1, fail: "x", attempt: 1, key: "k" }), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── draftCarryEligible — one allowlist, shared with the warm retry ────────────────────────────────
test("#408: only a PATCH-class rejection is carriable — a token meaning 'the sweep did not run' is not", () => {
  const inv = (t) => `invalid_file:x/common-law-findings.half-b.md:${t}`;
  assert.equal(draftCarryEligible(inv("connotation_no_ruling:no_ruling=2;Q-ABCDEFGH")), true);
  assert.equal(draftCarryEligible(inv("connotation_form_damaged:form_damaged=1;receipt_id R-Z is not a candidate")), true);
  // — the narrowest patch on the list: one field, on one named row, in a file already on disk, and
  // the seat's rulings are all accepted. If this goes false the token is missing from WARM_ELIGIBLE_RE,
  // the rejected draft is not carried across the park, and the next attempt re-earns 71 sound rows to fix
  // one quote.
  assert.equal(draftCarryEligible(inv("connotation_quote_unbound:quote_unbound=1;Q-ABCDEFGH [x] split R-5T9SYVN3")), true);
  assert.equal(draftCarryEligible(inv("coverage_ledger_unparseable")), true);
  // the exclusions are the load-bearing half: carrying a draft under these would tell a model
  // "do NOT redo the sweep" over a grid nobody searched, and manufacture a clean read.
  assert.equal(draftCarryEligible(inv("connotation_search_missing")), false);
  assert.equal(draftCarryEligible("missing_file:x/out.md"), false, "no bytes to carry");
  assert.equal(draftCarryEligible("timeout"), false);
  assert.equal(draftCarryEligible("nonzero_exit_1"), false);
  assert.equal(draftCarryEligible(null), false);
});

// ── integration: runStage preserves a rejected draft, and refuses a kill-torn one ─────────────────
async function withEngine(name, runTurn, fn) {
  registerEngine({ name, runTurn });
  const saved = { CLEAROTRON_AI: process.env.CLEAROTRON_AI, CLEAROTRON_RETRY_BACKOFF_MS: process.env.CLEAROTRON_RETRY_BACKOFF_MS, CLEAROTRON_WARM_RETRY: process.env.CLEAROTRON_WARM_RETRY };
  process.env.CLEAROTRON_AI = name;
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "0";
  process.env.CLEAROTRON_WARM_RETRY = "0";   // keep the ladder cold so each attempt is a plain dispatch
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const okTurn = () => ({ code: 0, killed: false, wall: 30, stdout: "ok", stderr: "", laneWaitMs: 0,
  json: { status: "ok", result: { meta: { agentMeta: {} }, payloads: [{ text: "ok" }] } },
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 }, sessionRef: "s" });
const hardWallTurn = (timeoutSec) => ({ code: 137, killed: true, wall: timeoutSec + 60, stdout: "", stderr: "",
  laneWaitMs: 0, json: { status: "timeout", result: { meta: { agentMeta: {} }, payloads: [{ text: "" }] } },
  usage: null, sessionRef: null, signals: { hardWall: true } });
// the shape the connotation gate throws: a count that falls attempt over attempt
const connFail = (n) => ({ ok: false, reason: `connotation_no_ruling:no_ruling=${n};Q-ABCDEFGH [DELPHI gang]`, quantity: n });

test("#408: the ladder's BEST rejected draft is preserved — the converged one, not the last one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "carry-preserve-"));
  const out = join(dir, "common-law-findings.half-b.md");
  mkdirSync(driverDir(dir), { recursive: true });
  const counts = [27, 4, 21];   // converges, then a final attempt that regresses
  let i = 0;
  try {
    const r = await withEngine("fake-converge-then-regress", async () => { writeFileSync(out, `# draft ${counts[i]}\n`); i += 1; return okTurn(); },
      () => runStage("common-law-half:b", {
        agent: "clawdi", sessionKey: "prelim-test-carry", message: "do it",
        model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
        validate: (f, text) => connFail(Number(/# draft (\d+)/.exec(text)[1])), runDir: dir, maxRetries: 2,
      }));
    assert.equal(r.ok, false, "the ladder still exhausts — this changes what SURVIVES it, not whether it passes");
    assert.equal(i, 3, "all three attempts ran");
    const best = readBestDraft(dir, "common-law-half:b");
    assert.equal(best.quantity, 4, "the floor is the best attempt, never the last");
    assert.equal(readFileSync(best.path, "utf8"), "# draft 4\n");
    assert.equal(readFileSync(out, "utf8"), "# draft 21\n", "the on-disk artifact is still the last attempt's — the store is separate");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#408: a draft written by a KILLED attempt is never preserved — a torn file is not a base to patch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "carry-kill-"));
  const out = join(dir, "common-law-findings.half-b.md");
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    await withEngine("fake-kill-after-write", async ({ timeoutSec }) => { writeFileSync(out, "# draft 2\n"); return hardWallTurn(timeoutSec); },
      () => runStage("common-law-half:b", {
        agent: "clawdi", sessionKey: "prelim-test-carry-kill", message: "do it",
        model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
        validate: (f, text) => connFail(Number(/# draft (\d+)/.exec(text)[1])), runDir: dir, maxRetries: 0,
      }));
    assert.equal(readBestDraft(dir, "common-law-half:b"), null,
      "a kill-class attempt's bytes may be torn mid-write and a shape validator cannot prove otherwise");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#408: a rejection whose remedy is a RE-SEARCH is not preserved — carrying it would manufacture a clean read", async () => {
  const dir = mkdtempSync(join(tmpdir(), "carry-nosearch-"));
  const out = join(dir, "common-law-findings.half-b.md");
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    await withEngine("fake-search-missing", async () => { writeFileSync(out, "# no sweep ran\n"); return okTurn(); },
      () => runStage("common-law-half:b", {
        agent: "clawdi", sessionKey: "prelim-test-carry-nosearch", message: "do it",
        model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
        validate: () => ({ ok: false, reason: "connotation_search_missing", quantity: 1 }), runDir: dir, maxRetries: 0,
      }));
    assert.equal(readBestDraft(dir, "common-law-half:b"), null);
    assert.ok(!existsSync(join(bestDraftDir(dir, "common-law-half:b"), "score.json")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
