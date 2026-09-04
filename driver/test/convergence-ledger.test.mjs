// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the convergence ledger. Two facts the retry machinery had but threw away:
//
//   1. the PROGRESS COUNT ("9 meaning receipts undisposed") as a NUMBER, un-truncated, on the attempt
//      row and in the break/park comparison. The signature cannot carry it: normalizeReason collapses
//      every digit run to "N" so the same defect signs identically across attempts. Measured on the R1
//      shape (VIBRANTE FROSTPLUM CN, 2026-08-02): 6, 9 and 11 undisposed all sign the SAME hash, so a
//      session that had converged 25 → 9 → 6 was indistinguishable from one repeating itself.
//   2. an attempt whose failure is BYTE-IDENTICAL to its predecessor, recorded as `noChange`.
//
// RECORDING ONLY. Every assertion here that touches a decision asserts it is UNCHANGED — the sigs are
// pinned to their pre- literals and decideRecovery's verdict is asserted identical whatever the
// quantity says. What the machinery should DO with a converging ladder is, and is not here.
//
// The fixture shape is the shipped one — verify.mjs connotationDispositionFail's own token, as it
// appears in the in-repo real-run corpus (warm-retry.test.mjs). The run evidence behind those counts
// is not in this repo, so the counts are the four ladders records, carried by the real token shape.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { progressQuantity, failureSignature, decideRecovery } from "../repairs.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "converge-locks-"));
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "10";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const { runStage } = await import("../gateway.mjs");

// ── the shipped token, at an arbitrary count ─────────────────────────────────────────────────────
// connotationDispositionFail lists whole query names up to ~120 chars and puts the rest in "(+N more)".
const QUERIES = ["novapulse gang", "novapulse slang meaning"];
const undisposed = (n) => `connotation_undisposed:${QUERIES.slice(0, Math.min(n, 2)).join(",")}${n > 2 ? ` (+${n - 2} more)` : ""}`;
const REASON = (n) => `invalid_file:x/common-law-findings.half-b.md:${undisposed(n)}`;

// ── part 1: the extractor ────────────────────────────────────────────────────────────────────────

test("#246 the count survives as a number: listed names + the overflow, from the untruncated reason", () => {
  assert.deepEqual(progressQuantity(REASON(29)), { token: "connotation_undisposed", value: 29 });
  assert.deepEqual(progressQuantity(REASON(2)), { token: "connotation_undisposed", value: 2 });
  assert.deepEqual(progressQuantity(REASON(1)), { token: "connotation_undisposed", value: 1 });
  // the wrapper the max_tokens fault adds never hides the token
  assert.equal(progressQuantity(`max_tokens_no_output:${REASON(11)}`).value, 11);
  // the sibling token counts ONE named result plus its overflow — never split on commas, that payload
  // is a copied result title
  assert.deepEqual(progressQuantity("connotation_recurrent_uncited:Reuters, 2019: the slur explained (+3 more)"),
    { token: "connotation_recurrent_uncited", value: 4 });
});

// ── item 2: the token now front-loads a per-cause CENSUS, and the census is the exact count ──────
// repairs.mjs's own house rule — "an entry joins this table only with the throw site's literal template in
// hand and a test" — applies to the new shape too. These strings are the throw site's template verbatim
// (verify.mjs connotationDispositionFail). A wrong count here reads a converging run as plateaued and ends
// its ladder early, which is silent: the run simply stops, having looked like it repeated itself.
test("#347 the cause census is the exact quantity — summed across causes, immune to a comma inside a query", () => {
  const tok = (payload) => `invalid_file:x/common-law-findings.half-b.md:connotation_undisposed:${payload}`;
  // both causes present: the total is the sum, whatever the named lists were budgeted down to
  assert.deepEqual(
    progressQuantity(tok('cite_too_short=8,cite_absent=4;cite_too_short:VENZY wikipedia [title "Harry Venzy"];cite_absent:VENZ gang (+10 more)')),
    { token: "connotation_undisposed", value: 12 });
  // one cause, fully listed, no overflow
  assert.deepEqual(progressQuantity(tok("cite_absent=1;cite_absent:DAVENA gang")),
    { token: "connotation_undisposed", value: 1 });
  // THE SHAPE THE OLD COUNTER GOT WRONG: a query containing a comma. The census does not care.
  assert.deepEqual(progressQuantity(tok('cite_absent=2;cite_absent:Reuters, 2019 slur coverage,BIO VELTRIN gang')),
    { token: "connotation_undisposed", value: 2 });
  // the LEGACY shape (archived runs, and any tail whose census was lost to a display slice) still counts
  assert.deepEqual(progressQuantity(REASON(29)), { token: "connotation_undisposed", value: 29 });
  // a zero census is malformed, and ABSENT is not zero
  assert.equal(progressQuantity(tok("cite_absent=0;cite_absent:")), null);
});

// ── — the newest token counts, or a converging quote ladder reads as stuck ───────────────────────
test("#518 connotation_quote_unbound carries a census, so its residual is visible to the ledger", () => {
  const tok = (payload) => `invalid_file:x/common-law-findings.half-b.md:connotation_quote_unbound:${payload}`;
  assert.deepEqual(progressQuantity(tok("quote_unbound=3;Q-1F4YWF87 [x] split R-5T9SYVN3")),
    { token: "connotation_quote_unbound", value: 3 });
  // The exact shape died on: one row left, and it must read as 1 rather than as absent. A null here
  // makes progress.kind "unknown" and beatsBest refuse every draft — and re-created together,
  // and neither throws.
  assert.deepEqual(progressQuantity(tok("quote_unbound=1;Q-1F4YWF87 [冰冻浆果 meaning] split R-5T9SYVN3")),
    { token: "connotation_quote_unbound", value: 1 });
  assert.equal(progressQuantity(tok("quote_unbound=0;")), null, "a zero census is malformed — ABSENT, not converged");
});

test("#246 ZERO SEMANTICS: a failure with no quantity records ABSENT (null), never 0", () => {
  // most failures carry no count at all. None of these may return a number — a 0 here would read as
  // "nothing left undisposed", which is what SUCCESS looks like.
  for (const r of ["timeout", "nonzero_exit_1", "unparseable_json", "lane_wedge", "status_overloaded",
    "missing_file:x/common-law-findings.half-b.md",
    "invalid_file:x/synthesis.md:finding_use_check_missing:12",   // 12 is an ORDINAL, not progress
    "invalid_file:x/digest.md:coverage_clean_deferred:goods,services", ""])
    assert.equal(progressQuantity(r), null, `${r} carries no progress quantity`);
  // a truncated payload is ABSENT too: the token cannot fire with zero receipts, so a zero here means
  // the string was cut short of its list — not that it converged.
  assert.equal(progressQuantity("invalid_file:x/half-b.md:connotation_undisposed:"), null);
  assert.equal(progressQuantity(null), null);
  // and the carrier keeps them apart: null is not 0
  assert.notEqual(progressQuantity(REASON(3)).value, null);
  assert.equal(failureSignature("common-law-half:b", "timeout").quantity, null);
  assert.notEqual(failureSignature("common-law-half:b", "timeout").quantity, 0);
});

test("#246 the signature is UNCHANGED — the quantity is the sole new discriminator", () => {
  // Pinned to the pre- literals. These are what the machinery signs; a diff that moves them moves
  // which runs go repeat-signature terminal, which is 's decision and not this issue's.
  const sigs = [6, 9, 11, 25, 29].map((n) => failureSignature("common-law-half:b", REASON(n)).sig);
  for (const s of sigs) assert.equal(s, "common-law-half:b|022c140ae114", "the sig still collapses the digit — unchanged");
  // …and the count that the sig cannot see now rides beside it
  assert.deepEqual([6, 9, 11, 25, 29].map((n) => failureSignature("common-law-half:b", REASON(n)).quantity), [6, 9, 11, 25, 29]);
});

// ── part 2: the four observed ladders, replayed through the real stage ladder ────────────────────

let dir;
beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "converge-ladder-"));
  mkdirSync(driverDir(dir), { recursive: true });
  delete process.env.MOCK_FAIL_STAGE;
  process.env.MOCK_CLAUDE_FILE = "content\n";
});

const rows = (name) => readFileSync(driverDir(dir, `${name}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const counts = (name) => rows(name).map((r) => r.quantity);
const changes = (name) => rows(name).map((r) => r.noChange ?? false);

// Replays one ladder. `steps` is the undisposed count per attempt; null = that attempt PASSES.
// `stamp` chooses the source: the validator's own exact count (as verify.mjs now stamps it) or the
// allowlisted read of the fail string (the path the run-level catch has to use).
const replay = async (name, steps, { stamp = true, maxRetries = 3 } = {}) => {
  let i = 0;
  const validate = () => {
    const n = steps[Math.min(i++, steps.length - 1)];
    return n === null ? { ok: true, reason: "ok" } : { ok: false, reason: undisposed(n), ...(stamp ? { quantity: n } : {}) };
  };
  const out = join(dir, `${name}.md`);
  return runStage(name, {
    agent: "clawdi", message: `BASE TASK — write your output to the ABSOLUTE path: ${out}`,
    sessionKey: `prelim-${name}`, timeoutSec: 30, expectFile: out, maxRetries, runDir: dir, validate,
  });
};

test("#246 ladder 29 → 11 → pass (converging) is distinguishable from 25 → 9 → 9 (repeating)", async () => {
  const converging = await replay("converging", [29, 11, null]);
  assert.equal(converging.ok, true, "attempt 3 passed, exactly as the 08-01 run did");
  assert.deepEqual(counts("converging"), [29, 11, null], "the passing attempt records ABSENT, never 0");
  assert.deepEqual(changes("converging"), [false, false, false]);

  const repeating = await replay("repeating", [25, 9, 9], { stamp: false });
  assert.equal(repeating.ok, false);
  assert.equal(repeating.attempts, 3);
  assert.deepEqual(counts("repeating"), [25, 9, 9], "the text path derives the same numbers the validator would stamp");
  assert.deepEqual(changes("repeating"), [false, false, true], "attempt 3 reproduced attempt 2 byte-for-byte — no-change");

  // THE NAMED REQUIREMENT. Both ladders' failures sign IDENTICALLY — that is what the machinery
  // compared, and why a converging session read as one repeating itself. The ledger now separates them.
  assert.equal(failureSignature("common-law-half:b", REASON(11)).sig, failureSignature("common-law-half:b", REASON(9)).sig);
  assert.notDeepEqual(counts("converging"), counts("repeating"));
  assert.notDeepEqual(changes("converging"), changes("repeating"));
});

test("#246 ladder 12 → 11 → 11 (the terminate case) records the stall as no-change", async () => {
  const r = await replay("stalled", [12, 11, 11]);
  assert.equal(r.ok, false);
  assert.deepEqual(counts("stalled"), [12, 11, 11]);
  assert.deepEqual(changes("stalled"), [false, false, true]);
  // the settled attempt's count rides the return, so the run-level throw carries the exact number
  assert.equal(r.quantity, 11);
  assert.equal(r.noChange, true);
  // POLICY UNCHANGED: the A4 break still stops at the first byte-identical repeat, at attempt 3 of 4.
  assert.equal(r.attempts, 3);
  assert.equal(r.identicalSignature, true);
});

test("#246 ladder 7 → 6 → 5, park, 6 → 3 → pass: the count crosses the park, re-roll and all", async () => {
  const before = await replay("parked", [7, 6, 5], { maxRetries: 2 });
  assert.equal(before.ok, false);
  assert.deepEqual(counts("parked"), [7, 6, 5], "three different counts — nothing repeated, so nothing is no-change");
  assert.deepEqual(changes("parked"), [false, false, false]);
  assert.equal(before.quantity, 5, "the count the run parks ON");

  // the park's fresh sample re-rolled ABOVE where it parked (6 > 5) and then converged to a pass. The
  // ledger says so; whether that is worth another park is 's call, not this record's.
  const after = await replay("resumed", [6, 3, null], { maxRetries: 2 });
  assert.equal(after.ok, true);
  assert.deepEqual(counts("resumed"), [6, 3, null]);

  // ACROSS the park: the comparison is handed the parked count via the history row.
  const sig = failureSignature("common-law-half:b", REASON(5)).sig;
  const d = decideRecovery({ failClass: "unknown", sig, reason: REASON(6), recoveryMax: 3, quantity: 6,
    history: [{ sig, stage: "common-law-half:b", class: "unknown", lane: "defect", attempt: 1, quantity: 5 }] });
  assert.deepEqual(d.progress, { quantity: 6, priorQuantity: 5, delta: 1, kind: "diverging" });
});

test("#246 a quantity-less ladder records ABSENT on every row — an absence is not a converged zero", async () => {
  process.env.MOCK_FAIL_STAGE = "BASE TASK";              // every turn: exit(1) → nonzero_exit_1
  const r = await runStage("transport", { agent: "clawdi", message: "BASE TASK", sessionKey: "prelim-transport",
    timeoutSec: 30, expectFile: join(dir, "t.md"), maxRetries: 2, runDir: dir });
  assert.equal(r.ok, false);
  assert.deepEqual(counts("transport"), [null, null, null]);
  for (const c of counts("transport")) assert.notEqual(c, 0, "0 would read as converged; these failures simply have no count");
  // the repeat IS recorded — recording is wider than A4's break, which stays content-class only …
  assert.deepEqual(changes("transport"), [false, true, true]);
  // … and the break itself did NOT fire: three attempts ran, exactly as before this change.
  assert.equal(r.attempts, 3);
  assert.equal(r.identicalSignature, undefined);
});

// ── part 3: the break/park comparison sees the magnitude and decides exactly as before ───────────

test("#246 decideRecovery REPORTS the convergence and DECIDES identically — no policy moved", () => {
  const sig = failureSignature("common-law-half:b", REASON(9)).sig;
  const park = (quantity, prior) => decideRecovery({
    failClass: "unknown", sig, reason: REASON(quantity ?? 9), recoveryMax: 3, priorAttempts: 1, quantity,
    history: [{ sig, stage: "common-law-half:b", class: "unknown", lane: "defect", attempt: 1, quantity: prior }],
  });
  const converging = park(9, 25);
  const stuck = park(9, 9);
  assert.deepEqual(converging.progress, { quantity: 9, priorQuantity: 25, delta: -16, kind: "converging" });
  assert.deepEqual(stuck.progress, { quantity: 9, priorQuantity: 9, delta: 0, kind: "no-change" });
  // an ABSENT count on either side is "unknown" — never "no-change", the reading that would make a
  // converging session look stuck.
  assert.equal(park(null, 9).progress.kind, "unknown");
  assert.equal(park(9, null).progress.kind, "unknown");
  assert.deepEqual(park(null, null).progress, { quantity: null, priorQuantity: null, delta: null, kind: "unknown" });

  // THE POLICY GUARD: same signature, same history length ⇒ same verdict, whatever the magnitude says.
  const verdict = (d) => ({ recoverable: d.recoverable, terminalKind: d.terminalKind, parkBudget: d.parkBudget,
    repeat: d.repeat, sigAttempts: d.sigAttempts, lane: d.lane, laneAttempts: d.laneAttempts, laneCeiling: d.laneCeiling });
  assert.deepEqual(verdict(converging), verdict(stuck));
  assert.deepEqual(verdict(converging), verdict(park(null, null)));
  assert.equal(converging.recoverable, false, "one unknown park already spent ⇒ repeat-signature terminal, exactly as before");
  assert.equal(converging.terminalKind, "repeat-signature");
});
