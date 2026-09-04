// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Warm patch retry (the 2026-06-12 warm-retry design): a content failure whose turn completed
// cleanly gets ONE warm retry resuming the failed session; everything else stays on the fresh-key path.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
// The warm-patch ladder is engine-agnostic runStage logic; exercise it on the standalone anthropic-agent
// engine (mock-claude reproduces the flake/draft/soft_fail/stubborn warm modes via MOCK_WARM_MODE).
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "warm-locks-"));
// D3: runStage now backs off between attempts (default 20s) — pin a tiny value so the retry
// ladders under test stay fast. The backoff itself is pinned in test/retry-backoff.test.mjs.
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "10";
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const { runStage, warmEligible, warmPatchMessage, repairTarget, draftCarryEligible } = await import("../gateway.mjs");

let dir;
beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "warm-retry-"));
  process.env.MOCK_CLAUDE_CALL_LOG = join(dir, "calls.jsonl");
  process.env.MOCK_COUNT_FILE = join(dir, "count");
  process.env.MOCK_OUT_FILE = join(dir, "out.md");
  delete process.env.CLEAROTRON_WARM_RETRY;
});

const calls = () => readFileSync(process.env.MOCK_CLAUDE_CALL_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
// anthropic-agent argv is `claude -p <message> [--resume <session_id>]`. A WARM retry --resumes the winning
// session (same claude session); a FRESH retry omits --resume (a new session). This replaces the retired gatewayw
// `--session-key base vs base-rerunN` distinction; the engine-agnostic winning-key logic is unchanged
// (runStage still returns sessionKey = the winning key, so r.sessionKey stays "prelim-test-base" on a warm win).
const resumed = (c) => (c.argv ?? c).includes("--resume");
const msgOf = (c) => c.prompt ?? "";

const stage = (over = {}) => runStage("test-stage", {
  agent: "clawdi", message: "BASE TASK", sessionKey: "prelim-test-base",
  timeoutSec: 30, expectFile: process.env.MOCK_OUT_FILE, maxRetries: 2, ...over,
});

test("missing_file with a completed turn → ONE warm retry resuming the SAME session key", async () => {
  process.env.MOCK_WARM_MODE = "flake";
  const r = await stage();
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(r.sessionKey, "prelim-test-base");          // winning key = the resumed base session
  const c = calls();
  assert.equal(c.length, 2);
  assert.equal(resumed(c[0]), false);                      // attempt 1 is fresh (no --resume)
  assert.equal(resumed(c[1]), true);                       // warm: the retry --resumes the same session
  assert.match(msgOf(c[1]), /RESUMING your own session/);
  assert.match(msgOf(c[1]), /missing_file/);
  assert.doesNotMatch(msgOf(c[1]), /BASE TASK/);           // patch-only message, not the full re-run
});

test("warm-allowlisted invalid_file (use_check_missing) → warm patch fixes it on the same session", async () => {
  process.env.MOCK_WARM_MODE = "draft";
  const validate = (_p, c) => (/PATCHED|FRESH/.test(c) ? { ok: true } : { ok: false, reason: "use_check_missing:F1" });
  const r = await stage({ validate });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(r.sessionKey, "prelim-test-base");
  assert.equal(readFileSync(process.env.MOCK_OUT_FILE, "utf8").trim(), "draft PATCHED");
  assert.equal(resumed(calls()[1]), true);                 // warm patch --resumed the same session
});

test("non-allowlisted invalid_file reason → fresh-key retry, never warm", async () => {
  process.env.MOCK_WARM_MODE = "draft";
  const validate = (_p, c) => (/FRESH/.test(c) ? { ok: true } : { ok: false, reason: "declared_unavailable" });
  const r = await stage({ validate });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  const c = calls();
  assert.equal(resumed(c[1]), false);                      // fresh path — new session, no --resume
  assert.match(msgOf(c[1]), /BASE TASK/);                  // full corrective message
});

test("incomplete turn (status timeout, no file) → fresh-key retry, never warm", async () => {
  process.env.MOCK_WARM_MODE = "soft_fail";
  const r = await stage();
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(resumed(calls()[1]), false);                // fresh retry — no --resume
});

test("CLEAROTRON_WARM_RETRY=0 kill-switch → today's fresh behavior exactly", async () => {
  process.env.MOCK_WARM_MODE = "flake";
  process.env.CLEAROTRON_WARM_RETRY = "0";
  const r = await stage();
  assert.equal(r.ok, true);
  assert.equal(resumed(calls()[1]), false);                // fresh retry — no --resume
});

// ── build 2 — A WARM REPEAT IS NOT A SECOND SAMPLE ──────────────────────────────────────────────
// REWRITTEN, not supplemented. The old body asserted `attempts === 2` and `calls().length === 2`, which
// is precisely the behaviour being removed: A4 used to break the ladder on ANY byte-identical content
// repeat, including one produced by a warm patch. A warm patch RESUMES the session that produced the
// previous failure, so a session that wrote a document with zero rulings writes it again — the repeat
// proves nothing about whether a fresh dispatch would converge.
//
// The round measured the cost. R6 broke at attempt 2 of 3 with attempt 3's budget
// unspent, parked ~90s, spent one of three defect lanes, and the recovery lane then re-dispatched FRESH
// and ruled 69 of 72 — the attempt the ladder still had in hand.
// — THESE TWO ARMS MOVED FROM `stubborn` TO A WROTE-BUT-INVALID SHAPE, and the move is the point.
// Both are byte-identical warm repeats; only one still escalates. `stubborn` writes nothing, and a fresh
// attempt 3 after a produced-nothing repeat converged 0 of 6 when it was measured — that case now breaks
// (ladder-break.test.mjs asserts it). The escalation these arms are about is unchanged for a seat that
// produced something, which is where it converged 9 of 9.
const INVALID_EVERY_TURN = { validate: () => ({ ok: false, reason: "use_check_missing:F1" }) };

test("#460 a warm patch that reproduces its own failure ESCALATES to a fresh attempt, not to a park", async () => {
  process.env.MOCK_WARM_MODE = "draft";                    // writes every turn; the validator rejects it every turn
  const r = await stage(INVALID_EVERY_TURN);
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 3, "the ladder spends the attempt it used to leave unspent");
  assert.equal(r.warmEscalated, true, "the result says the escalation happened — the round's evidence");
  assert.equal(r.identicalSignature, true, "attempt 3 is COLD and repeats, so A4 fires normally and the break is still honest");
  const c = calls();
  assert.equal(c.length, 3);
  assert.equal(resumed(c[0]), false, "attempt 1 fresh");
  assert.equal(resumed(c[1]), true, "attempt 2 is the single warm patch (--resume)");
  assert.equal(resumed(c[2]), false, "attempt 3 is FRESH — the discarded session is not resumed again");
  assert.match(msgOf(c[2]), /BASE TASK/,
    "the escalated attempt carries the full corrective message, not the short warm-patch message");
  // the seat wrote every turn here — what makes this the escalating case — so the artifact EXISTS and is
  // simply never valid. The produced-nothing shape it used to assert is now ladder-break.test.mjs's.
  assert.equal(existsSync(process.env.MOCK_OUT_FILE), true);
});

test("#460 THE BOUND — exactly one --resume per ladder, however deep the ladder is", async () => {
  // The unbounded-loop guarantee as an assertion. `warm` requires !warmUsed, and `warm` is the
  // escalation's trigger, so the escalation is structurally capped at one per stage run. Break it by
  // resetting warmUsed on escalation, or by keying the escalation on `attempt > 1` instead of `warm`,
  // and a second --resume appears here.
  process.env.MOCK_WARM_MODE = "draft";
  const r = await stage({ maxRetries: 4, ...INVALID_EVERY_TURN });   // 5 attempts allowed
  assert.equal(calls().filter(resumed).length, 1, "one warm attempt in the whole ladder, escalation or not");
  assert.equal(r.attempts, 3, "attempt 3 is fresh, reproduces the signature, and A4 breaks normally");
});

test("#460 NO BUDGET LEFT → the terminal signal survives; nothing is swallowed", async () => {
  // Without the `attempt < maxRetries + 1` guard the escalation branch eats the break on the last
  // attempt, the loop exits through the exhausted return, and `identicalSignature` is lost. That would
  // convert an honest terminal into an unlabelled exhaustion — silently.
  process.env.MOCK_WARM_MODE = "stubborn";
  const r = await stage({ maxRetries: 1 });                // 2 attempts allowed
  assert.equal(r.attempts, 2);
  assert.equal(r.identicalSignature, true, "still a named terminal, not an exhaustion");
  assert.equal(r.warmEscalated, undefined, "nothing was escalated — there was nowhere to escalate to");
  assert.equal(calls().length, 2, "no third dispatch is invented out of a budget that does not exist");
});

test("warmEligible truth table + patch message carries the reason-aware hint", () => {
  const okJson = { status: "ok" };
  assert.equal(warmEligible("missing_file:x/out.md", okJson), true);
  assert.equal(warmEligible("invalid_file:x/narrative.md:use_check_missing:F1", okJson), true);
  assert.equal(warmEligible("invalid_file:x/narrative.md:own_rights_missing:F2", okJson), true);
  assert.equal(warmEligible("invalid_file:x/f.md:declared_unavailable", okJson), false);
  assert.equal(warmEligible("missing_file:x/out.md", { status: "timeout" }), false);
  assert.equal(warmEligible("timeout", okJson), false);
  assert.equal(warmEligible(undefined, okJson), false);
  assert.match(warmPatchMessage("invalid_file:x:use_check_missing:F1", ["/r/prelim-search/x/narrative.md"]),
    /Use-check source/);
});

test("WS-A: coverage_* and grid_* JSON defects are warm-eligible (each joined the allowlist with this test)", () => {
  const okJson = { status: "ok" };
  for (const reason of [
    "coverage_ledger_unparseable: top level must be a JSON ARRAY",
    "coverage_ledger_empty: at least one row per active axis is required",
    "coverage_axis_invalid:satuartion-probe (not in: …)",
    "coverage_axis_missing:incumbent-class",
    "coverage_status_invalid:clean",
    "coverage_key_unknown:notes",
  ]) {
    assert.equal(warmEligible(`invalid_file:x/register-findings.md:${reason}`, okJson), true, reason);
  }
  assert.equal(warmEligible("invalid_file:x/common-law-findings.md:grid_join_missing:novapulse:5/7", okJson), true);
  assert.equal(warmEligible("invalid_file:x/common-law-findings.md:grid_ledger_unparseable:batch missing cells[]", okJson), true);
  // Map #3 — coverage_mirror_missing is RETIRED (JSON is code-derived from the prose, so the mirror
  // cross-check no longer fires); it must NOT be warm-eligible. The structure tokens above still are.
  assert.equal(warmEligible("invalid_file:x/register-findings.md:coverage_mirror_missing:primary-sweep|deferred", okJson), false);
  // an incomplete turn still never warms, whatever the reason
  assert.equal(warmEligible("invalid_file:x/register-findings.md:coverage_ledger_empty", { status: "timeout" }), false);
});

// ── D1: coverage_status_offenum — warm-eligible, PROSE-routed (never the JSON sibling) ─────────────────
test("D1 warm eligibility: coverage_status_offenum warms, and its patch targets the PROSE findings file, never register-coverage-ledger.json", () => {
  const okJson = { status: "ok" };
  const fail = "invalid_file:x/register-findings.md:coverage_status_offenum:not-searched (immaterial (axis primary-sweep — the Status cell is EXACTLY one bare token of: confirmed-clean / coverage-limited / deferred; qualifiers move into reason)";
  assert.equal(warmEligible(fail, okJson), true, "a one-cell prose relabel is exactly the warm shape (43% historic hit-rate would burn a cold digest re-run per hit)");
  assert.equal(warmEligible(fail, { status: "timeout" }), false, "an incomplete turn still never warms");
  // the defect lives in the PROSE Coverage ledger — the patch must target the findings file itself,
  // NOT a register-coverage-ledger.json re-save (that sibling matches by substring: pin the routing)
  const m = warmPatchMessage(fail, ["/r/prelim-search/x/register-findings.md"]);
  // ── CONVERSION 11 MOVED THE REPAIR MECHANISM, NOT THE ROUTING ──────────────────────────────────
  //
  // This arm used to pin "Your saved …/register-findings.md failed validation" and "TARGETED EDITS …
  // using the Edit tool". Both were true of a seat that AUTHORED the file, and neither is expressible
  // now: the driver renders this artifact, so there is no saved file to have failed and no file for the
  // seat to edit. Re-aimed rather than relaxed — what this arm is FOR is the routing (the defect is in
  // the prose ledger, so the message must not send the seat at the JSON mirror) and that is unchanged
  // and still asserted below. The old strings would now pass only by the message drifting back to
  // telling a seat to edit an artifact it no longer owns.
  assert.match(m, /What you sent did not pass \(invalid_file:x\/register-findings\.md:/,
    "the defect is stated against what the seat SENT, not against a file it saved");
  assert.match(m, /Call `record_register_digest`/, "and the repair is another call, not an edit");
  assert.match(m, /never by writing or editing any file/,
    "said outright — a seat that reaches for Edit here would be writing over the driver's render");
  assert.doesNotMatch(m, /register-coverage-ledger\.json/, "never routed to the JSON mirror sibling");
  assert.match(m, /EXACTLY one bare token of confirmed-clean \/ coverage-limited \/ deferred/);
  assert.match(m, /axis primary-sweep/, "the hint names the offending axis");
});

// ── The write-mode branch (E2E R2): a file that EXISTS is patched; a file never written is written whole ──
// THE WITNESS MOVED, and the move is the point rather than an adjustment (, the same
// shape recorded for blind-frame). This arm used `narrative.md` to witness the Edit branch. After
// the writer's conversion no repair may name that file at all: the seat holds no Write and gateway's
// warm-patch branch sends it back through `record_synthesis`. An arm that kept demanding the hand-write
// would be defending the path this conversion deleted. `register-findings.md` carries the property now —
// a real hand-written artifact, the same witness the D1 arm above uses — so the property is unchanged and
// only its witness moved. The narrative direction is asserted below, in the opposite sense.
test("warm patch write-mode: invalid_file patches in place, missing_file still writes the complete file", () => {
  // THE EDIT-BRANCH WITNESS IS A FILE THE SEAT STILL WRITES. It was `register-findings.md`, which
  // conversion 11 made tool-written — so this arm was asserting the Edit branch on an artifact that no
  // longer takes it, and would have gone green again only if the routing regressed. Moved to
  // `common-law-findings.md`, still seat-authored, and `register-findings.md` joins the tool-written
  // loop below. Both branches keep a live witness, which is the property this arm exists for.
  const exists = warmPatchMessage("invalid_file:x/common-law-findings.md:use_check_missing:F1", ["/r/prelim-search/x/common-law-findings.md"]);
  assert.match(exists, /TARGETED EDITS/);
  assert.match(exists, /Edit tool/);
  assert.match(exists, /leave every other line of the file byte-identical/);
  assert.doesNotMatch(exists, /full file, not a diff/, "the whole-document re-emit is what this removes");
  // …and the Edit direction must not strand a genuinely absent file: the fallback is stated in the tail
  assert.match(exists, /does not exist, create it in full with the Write tool/);

  const absent = warmPatchMessage("missing_file:x/out.md", ["/r/prelim-search/x/out.md"]);
  assert.match(absent, /NEVER WRITTEN/);
  assert.match(absent, /Write the COMPLETE file now/, "there is nothing to patch — the work must land in full");
  assert.doesNotMatch(absent, /TARGETED EDITS/);

  // THE OPPOSITE SENSE, on the file this arm used to witness with. A tool-written artifact takes neither
  // branch above: no Edit, no Write, and no file named as the thing to fix. Asserted here rather than
  // only in the recording-agreement file because THIS is where the two write-mode branches are decided —
  // a re-route that regressed would show up as one of them coming back, and the doesNotMatch pair is
  // what makes that visible. Both directions, so a routing that stopped re-routing cannot read as a pass.
  for (const [f, tool] of [["narrative.md", "record_synthesis"], ["findings.json", "record_synthesis"],
                           ["register-findings.md", "record_register_digest"]]) {
    const routed = warmPatchMessage(`invalid_file:x/${f}:use_check_missing:F1`, [`/r/prelim-search/x/${f}`]);
    assert.match(routed, new RegExp(tool), `${f} is tool-written — the warm patch orders the call`);
    assert.doesNotMatch(routed, /TARGETED EDITS/, `${f}: no Edit branch for a file the seat cannot write`);
    assert.doesNotMatch(routed, /Write the COMPLETE file now/, `${f}: and no whole-file re-emit either`);
  }
});

test("warm patch on a multi-file stage aims the repair at the member the token names", () => {
  const files = ["/r/prelim-search/x/common-law-findings.half-a.md", "/r/prelim-search/x/common-law-findings.half-b.md"];
  const m = warmPatchMessage("invalid_file:x/common-law-findings.half-b.md:platforms_missing:etsy", files);
  assert.match(m, /TARGETED EDITS to \/r\/prelim-search\/x\/common-law-findings\.half-b\.md/);
  assert.doesNotMatch(m, /TARGETED EDITS to \/r\/prelim-search\/x\/common-law-findings\.half-a\.md/,
    "aiming at the wrong member is the loop the grid_join hints already guard against");
});

// ── E2E R1 (2026-08-01), carried to 's vocabulary: the connotation tokens — warm-eligible, and
// ── routed at the FORM, which is the gap closed on the way past ─────────────────────────────────
test("connotation defects warm, and the patch orders the TOOL — not the .md, and never any file", () => {
  const okJson = { status: "ok" };
  const half = "invalid_file:x/common-law-findings.half-b.md:connotation_call_partial:call_partial=28;Send only what is left (+27 more)";
  assert.equal(warmEligible(half, okJson), true,
    "the gather ran and its receipts are recorded — the missing rulings are one tool call, not a re-search");
  assert.equal(warmEligible("invalid_file:x/common-law-findings.md:connotation_form_damaged:form_damaged=1;bad id", okJson), true);
  // an incomplete turn still never warms — the receipts may not all be recorded yet
  assert.equal(warmEligible(half, { status: "timeout" }), false);
  // ROUTING. B: there is no seat-writable dispositions file, so the patch orders the one route a ruling
  // can take — a `record_dispositions` call aimed at the FAILING MEMBER's own spec — and no file edit of
  // any kind. A patch naming a file here would be the two halves of one message disagreeing about where
  // the work lands, the exact defect class 's routing fix closed.
  const md = "/r/prelim-search/x/common-law-findings.half-b.md";
  const m = warmPatchMessage(half, [md]);
  assert.match(m, /record_dispositions/, "the tool is the route");
  assert.match(m, /\/r\/prelim-search\/x\/_driver\/grid-spec\.half-b\.json/, "aimed at the half's OWN spec");
  assert.doesNotMatch(m, /EDIT that file|Re-save the COMPLETE corrected JSON/,
    "no file edit of any kind — the seat cannot affect the accumulator by writing");
  assert.match(m, /Do NOT redo the sweep and do NOT rewrite \S*common-law-findings\.half-b\.md \(its own checks passed\)/,
    "and the prose that already passed is left alone");
  assert.equal(repairTarget(half, [md]), md,
    "the landed-check watches the stage's own output — there is no sibling left to watch");
});

test("WS-A: the warm patch for a sibling-JSON defect targets the JSON, never a findings rewrite", () => {
  // ── THE DIGEST LEFT THIS BRANCH AT CONVERSION 11, AND THE MESSAGE CONTRADICTED ITSELF ──────────
  //
  // `register-findings.md` is tool-written now, so the file-veto correctly stops the sibling branch and
  // the message routes to the tool tail. What did NOT follow was the hint's own prose: it still closed
  // with "re-save the COMPLETE JSON file" directly above "never by writing or editing any file" — two
  // opposite orders in one message, which is worse than either alone because a seat obeying the first
  // breaks the grant. A hint says WHAT is wrong; the caller's tail says HOW to repair it, and the one
  // clause that has to know is now passed rather than assumed.
  //
  // The arm's subject is unchanged: a sibling-JSON defect must still be described against the JSON and
  // must not order a findings rewrite. Only the repair ACT moved.
  const m = warmPatchMessage("invalid_file:x:coverage_axis_invalid:satuartion-probe", ["/r/prelim-search/x/register-findings.md"]);
  assert.match(m, /register-coverage-ledger\.json is a JSON ARRAY/, "still described against the JSON sibling");
  assert.match(m, /record_register_digest/, "…and repaired by the call, since the findings file is the driver's");
  assert.doesNotMatch(m, /re-save|Re-save|Write the COMPLETE|TARGETED EDITS/,
    "NOT ONE write order anywhere in the message — the tail forbids writing, so a hint that orders a "
    + "save puts two opposite instructions in front of the seat");
  assert.doesNotMatch(m, /write the COMPLETE corrected file at/, "must not order a findings-file rewrite");
  const g = warmPatchMessage("invalid_file:x:grid_join_missing:novapulse:5/7", ["/r/prelim-search/x/common-law-findings.md"]);
  assert.match(g, /common-law-grid\.json/);
  // A sibling JSON is small and driver-derived: a clean re-save is cheaper and safer than JSON surgery,
  // so the sibling route deliberately keeps its full re-save while the prose route patches.
  assert.doesNotMatch(m, /TARGETED EDITS/, "sibling JSON keeps the full re-save");
  // non-sibling reasons keep the classic wrapper
  assert.match(warmPatchMessage("missing_file:x/out.md", ["/r/prelim-search/x/out.md"]), /Write the COMPLETE file now/);
});

// ── T1: new warm-eligible tokens (J1b band vocabulary repair; J3b review section add) ──────────
test("spec-49 warm eligibility: named_band vocabulary/parse defects and plan_audit_missing are warm; collapsed stays cold", () => {
  const okJson = { status: "ok" };
  assert.equal(warmEligible("invalid_file:run/register-units/us.md:named_band_state_invalid:verified (one of: enumerated, incomplete)", okJson), true);
  assert.equal(warmEligible("invalid_file:run/register-units/us.md:named_band_unparseable: Unexpected token", okJson), true);
  assert.equal(warmEligible("invalid_file:run/register-units/us.md:named_band_block_invalid: each block must be an object", okJson), true);
  assert.equal(warmEligible("invalid_file:run/senior-eye-review.md:plan_audit_missing", okJson), true);
  // a collapsed slice needs a RE-RUN of the search, not a JSON patch — cold by design
  assert.equal(warmEligible("invalid_file:run/register-units/us.md:named_band_collapsed:exact AURA~3", okJson), false);
  // warm only on a clean turn
  assert.equal(warmEligible("invalid_file:run/register-units/us.md:named_band_state_invalid:verified", { status: "error" }), false);
});

test("spec-49 warm patch: a named_band defect targets the BAND sibling, never the prose digest", () => {
  const m = warmPatchMessage("invalid_file:run/register-units/us.md:named_band_state_invalid:verified (one of: enumerated, incomplete)", "/x/run/register-units/us.md");
  // THE SIBLING BRANCH NO LONGER FIRES HERE, and the reason is main's and correct: a tool-written failing
  // file cannot be repaired by re-saving anything by hand, whatever the token's historical sibling was.
  // The note is tool-written now, so the branch is vetoed and the repair comes from the hint plus the
  // call. What the arm is FOR survives — the repair is about the BAND and nothing aims at the digest —
  // and that is asserted by CONTENT rather than by the sibling's filename.
  //
  // WHAT IS GENUINELY LOST is the band's PATH: the seat is told to open "the band file" without being
  // told which one. It holds exactly one, so this is a sharpness question and not a correctness one, and
  // it is recorded on the tracker issue rather than fixed by re-opening a veto that is right about the
  // case it was written for.
  assert.match(m, /band JSON has a defective MODEL-AUTHORED block/, "the repair is about the BAND");
  assert.match(m, /"enumerated"|"incomplete"/, "…and names the states that band may carry");
  assert.match(m, /record_unit_note/, "…and the note is filed by the call that owns it");
  // "do NOT rewrite <the digest>" WAS how the digest was protected, and after the note conversion there is
  // nothing there to protect: the seat holds no writer for it and the driver renders it from the typed
  // call. Naming a path only to forbid it is worse than silence on a converted stage — it reads as a
  // target, and it is what made the agreement guard pair this message's band write-order with the digest.
  // The property is unchanged and is asserted directly: this repair does not aim at the digest.
  assert.doesNotMatch(m, /do NOT rewrite/i,
    "the message forbids the digest by path again — on a converted stage that names a target rather than "
    + "protecting one, and it is what made the agreement guard pair a band write-order with the digest");
  // Read the same way the agreement guard reads it: a quoted failure token names the out file BY
  // CONSTRUCTION (it is what the validator graded), so it is stripped before asking whether the message
  // points at that file. Anywhere else counts.
  const outsideTheToken = m.replace(/\b(?:invalid_file|missing_file):[^\s)]+/g, " ");
  assert.doesNotMatch(outsideTheToken, /register-units\/us\.md/i,
    "the digest's path is named outside the quoted failure token — which is how a repair starts aiming at it");
  assert.match(m, /NOT re-call register_execute_plan/, "carries the reason-aware hint");
});

// ── A1 split review fix (2026-07-12): the retry ladder targets the HALF member's OWN grid ledger ───────
test("A1 split: a half member's grid_* warm patch targets common-law-grid.half-<h>.json — NEVER the canonical merged ledger", () => {
  const files = ["/r/prelim-search/x/common-law-findings.half-a.md"];
  const m = warmPatchMessage("invalid_file:common-law-findings.half-a.md:grid_join_missing:novapulse:3/15", files);
  assert.match(m, /Re-save the COMPLETE corrected JSON at \/r\/prelim-search\/x\/common-law-grid\.half-a\.json/,
    "the repair is aimed at the file validators.commonLawHalf re-judges");
  assert.doesNotMatch(m, /common-law-grid\.json/, "the canonical (driver-derived) ledger is never dictated to a half member");
  assert.match(m, /common-law-grid\.half-a\.json must account for EVERY dictated/, "the hint prose names the half ledger too");
  const u = warmPatchMessage("invalid_file:common-law-findings.half-b.md:grid_ledger_unparseable:Unexpected token", ["/r/x/common-law-findings.half-b.md"]);
  assert.match(u, /common-law-grid\.half-b\.json is the grid call's stdout JSON saved VERBATIM/);
  assert.doesNotMatch(u, /common-law-grid\.json/, "no stray canonical-ledger mention");
  // the single-member path is unchanged
  const g = warmPatchMessage("invalid_file:x:grid_join_missing:novapulse:5/7", ["/r/prelim-search/x/common-law-findings.md"]);
  assert.match(g, /common-law-grid\.json/);
  assert.doesNotMatch(g, /half-/, "no half vocabulary on the canonical member");
});

// ── ION/copper-foundry 2026-07-22: the lane derivation itself, through runStage ───────────────────────
// runStage cannot see the plan's supplemental_lane contract, so it derives the lane from the ONE
// observable the contract leaves here — register_enumerate missing from the stage's toolset — and threads
// it into correctiveMessage/warmPatchMessage. Every other test builds that flag by hand, so THIS is the
// only place the wiring is pinned: delete the derivation (or key the exclusion on a renamed tool id) and a
// lane retry silently gets the legacy hint ordering the tool the attempt does not have — the incident's
// exact shape, with the rest of the suite still green.
// Dynamic import: this file assigns CLEAROTRON_AI/CLEAROTRON_CLAUDE_PATH at module scope, and a hoisted static
// import would evaluate stages.mjs (and driver.config through it) before those land.
const { REGISTER_ENUMERATE_TOOL } = await import("../stages.mjs");
const COLLAPSED_REASON = "named_band_collapsed:exact HALCYON~412";
// named_band_collapsed is NOT warm-eligible, so attempt 2 is a cold retry carrying correctiveMessage.
const collapseOnce = (_p, c) => (/FRESH/.test(c) ? { ok: true } : { ok: false, reason: COLLAPSED_REASON });

test("runStage derives the supplemental lane from excludeTools: the lane retry gets the PROPOSE repair", async () => {
  process.env.MOCK_WARM_MODE = "draft";
  await stage({ validate: collapseOnce, excludeTools: [REGISTER_ENUMERATE_TOOL] });
  const m = msgOf(calls()[1]);
  assert.match(m, /COLLAPSED enumerated slice/, "the corrective hint rode the retry");
  assert.match(m, /register_propose_supplemental/, "the lane repair names the tool the attempt actually has");
  assert.match(m, /BY DESIGN, never an outage or a permission fault/);
  assert.doesNotMatch(m, /Re-run that EXACT slice with register_enumerate/, "never the tool this stage's toolset dropped");
});

test("…and WITHOUT the exclusion the same failure keeps the legacy enumerate repair", async () => {
  process.env.MOCK_WARM_MODE = "draft";
  await stage({ validate: collapseOnce });
  const m = msgOf(calls()[1]);
  assert.match(m, /Re-run that EXACT slice with register_enumerate/);
  assert.doesNotMatch(m, /register_propose_supplemental/);
});

// ──: the register coverage FORM warms; the never-searched class stays cold ─────────────────────
test("#476 warm eligibility: the coverage-form tokens warm, and the never-searched class does NOT", () => {
  const okJson = { status: "ok" };
  const F = (r) => `invalid_file:prelim-search/x/register-findings.md:${r}`;
  // THE ECONOMIC CASE FOR THE ISSUE. Before this the whole coverage-judgment family was cold-only: not one
  // `coverage_clean_*` token was in the allowlist, so every retry re-dispatched a fresh session that re-read
  // a 1.9 MB band and re-derived a 160 KB document. The stage's own measured profile is 105,747 out FAIL →
  // 137,519 out FAIL → 36,362 out PASS, and the attempt that passed is the one that PATCHED.
  assert.equal(warmEligible(F("coverage_no_status:no_status=3;CB-A1B2C3D4 [primary-sweep / exact: LUMEN]"), okJson), true);
  assert.equal(warmEligible(F("coverage_form_damaged:form_damaged=1;unparseable json"), okJson), true);
  // WHY THEY ARE SAFE: the violation is PROOF the searches ran and were accounted — the rows are the
  // driver's, built from the frozen plan and the plan-execution receipt. What is missing is a status on a
  // file already on disk carrying every qid, hit count and receipt reason. A two-field edit, not a re-search.
  //
  // THE NEVER-SEARCHED CLASS STAYS COLD, and that separation is what makes warm safe. Their remedies are a
  // re-run or a relabel of the whole document, not a patch. There was no test pinning this before.
  for (const cold of ["coverage_clean_unexecuted:primary-sweep", "coverage_clean_skipped:incumbent-class",
    "coverage_clean_tainted:primary-sweep", "coverage_clean_deferred:transliteration-numeric"]) {
    assert.equal(warmEligible(F(cold), okJson), false, `${cold} must not warm`);
  }
  // coverage_form_missing is the DRIVER'S defect. A resumed seat cannot patch a file it was never told
  // about (the accumulator lives in `_driver/`), so warming it would spend a turn asking a model to fix a
  // driver bug. It is emitted as invalid_file: precisely so the bare `missing_file` alternation at the head
  // of WARM_ELIGIBLE_RE cannot warm it by accident.
  assert.equal(warmEligible(F("coverage_form_missing:_driver/register-coverage-form.form.json absent"), okJson), false);
  assert.equal(warmEligible("missing_file:x/register-coverage-form.json", okJson), true,
    "…and this is why the token must never be spelled missing_file:");
  // an incomplete turn still never warms
  assert.equal(warmEligible(F("coverage_no_status:no_status=1;CB-X"), { status: "timeout" }), false);
});

test("#476 warm routing, typed transport: the patch orders the record_coverage CALL, and no file at all", () => {
  // B's rule, one lane over: the seat writes no coverage file, so a warm patch that ordered any file
  // edit would aim the seat at an artifact it cannot affect — the two halves of one message
  // disagreeing about where the work lands.
  const fail = "invalid_file:prelim-search/x/register-findings.md:coverage_no_status:no_status=2;CB-A1B2C3D4 [primary-sweep / exact: LUMEN]";
  const m = warmPatchMessage(fail, ["/r/prelim-search/x/register-findings.md"]);
  assert.match(m, /record_coverage/, "the recording route is the tool");
  assert.match(m, /never by writing or editing any file/);
  assert.doesNotMatch(m, /register-coverage-form\.json/, "the dead seat-facing copy is never named");
  assert.doesNotMatch(m, /_driver/, "the seat is never told about the accumulator");
  assert.doesNotMatch(m, /register-coverage-ledger\.json/,
    "never the driver-derived machine ledger — the model is told not to write it");
  assert.doesNotMatch(m, /Re-save the COMPLETE corrected JSON/,
    "re-authoring a driver-written record retypes every field the seat was told not to touch");
  assert.match(m, /do NOT re-run any search/i);
  assert.match(m, /Everything already recorded is kept/);
  //: a rejected draft carries across a recovery park for exactly the tokens whose repair is a patch.
  assert.equal(draftCarryEligible(fail), true);
  assert.equal(draftCarryEligible("invalid_file:x/register-findings.md:coverage_clean_unexecuted:primary-sweep"), false);
});
