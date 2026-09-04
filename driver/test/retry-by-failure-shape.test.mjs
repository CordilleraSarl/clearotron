// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A WARM PATCH CANNOT FIX A WHOLE-FILE FAILURE, AND THE LADDER PAID 17 MINUTES TO LEARN IT.
//
// Two m-seat failures in the same hour, engine 089399a, 2026-08-10, both runs in flight together:
//
//   run  failure                        scope           first retry   wall   outcome
//   R5   connotation_quote_unbound=3    3 rows of many  warm patch     83s   closed
//   R6   connotation_no_ruling=75       EVERY row       warm patch   1007s   byte-identical, discarded
//
// The warm patch is right on R5 and unwinnable on R6. A resumed session re-reads its own output and
// cannot produce rulings it did not produce the first time when the defect is "you ruled none of the 75
// rows" — and the difference is legible in the failure string before the retry is dispatched. The engine
// already reaches that conclusion in its own log ("a resumed session cannot disagree with itself") and
// pays a full attempt to reach it. 1007s on R6 alone, plus ~9 min across two byte-identical warm-patch
// pairs on the R2 measured.
//
// THE ASSERTION IS ON THE ATTEMPT SEQUENCE, NEVER ON EVENTUAL SUCCESS. The byte-identical escalation
// already lands these runs on a fresh dispatch — one attempt and 1007 seconds later. A test that
// asserted "it ends up fresh" would pass with this change reverted. What changed is that the warm
// attempt is not spent finding out, so that is what is measured: no `--resume` on the retry after a
// total defect, and `--resume` still present after a partial one.
//
// BREAK MATRIX:
//   · a total defect skips the warm patch            → break: drop the veto, arm 2 goes red
//   · a partial defect still warm-patches            → break: veto everything, arm 3 goes red
//   · the classifier is the token, closed            → break: widen or narrow it, arm 1 goes red
//   · the warm attempt is NOT spent by the skip      → break: set warmUsed on the skip, arm 4 goes red
//   · the token stays warm-ELIGIBLE (routing)        → break: drop it from the allowlist, arm 5 goes red
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "shape-locks-"));
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "10";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const { runStage, vetoResumeRuledNone, warmEligible, warmPatchMessage } = await import("../gateway.mjs");

let dir;
beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "retry-shape-"));
  process.env.MOCK_CLAUDE_CALL_LOG = join(dir, "calls.jsonl");
  process.env.MOCK_COUNT_FILE = join(dir, "count");
  process.env.MOCK_OUT_FILE = join(dir, "out.md");
  delete process.env.CLEAROTRON_WARM_RETRY;
});

const calls = () => readFileSync(process.env.MOCK_CLAUDE_CALL_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const resumed = (c) => (c.argv ?? c).includes("--resume");
// TWO SHAPES OF THE SAME FAILURE, and the difference is load-bearing. A validator returns the BARE
// reason and runStage prefixes it with `invalid_file:<file>:` before the warm allowlist ever sees it —
// so a fixture that hands `validate` an already-prefixed string produces `invalid_file:out.md:
// invalid_file:…`, which matches nothing in WARM_ELIGIBLE_RE and is cold for a reason that has nothing
// to do with what is under test. (That is how the first cut of arms 3 and 4 failed.)
const REASON = (tok, n) => `connotation_${tok}:${tok}=${n};Q-1F4YWF87 [x]`;
const FAIL = (tok, n) => `invalid_file:common-law-findings.half-m.md:${REASON(tok, n)}`;

const stage = (over = {}) => runStage("test-stage", {
  agent: "clawdi", message: "BASE TASK", sessionKey: "prelim-test-base",
  timeoutSec: 30, expectFile: process.env.MOCK_OUT_FILE, maxRetries: 2, ...over,
});

test("#589 arm 1 — the veto keys on the DIRECT STATE, and a missing count reads as ZERO", () => {
  // 's hold is why this arm exists: the first cut keyed the veto on TOTAL_DEFECT_TOKENS, a closed
  // two-member list of form-path token names — and when the typed transport armed, the failure token
  // moved out of the list and the veto silently stood down with every assertion still green. The veto
  // now reads the run's own counted rulings (syncDispositionForm → lastUnion), never a token name, so
  // no fifth token can forget to enrol.
  // Attempt 1 never vetoes; a stage owing no meaning sweep (state null) never vetoes.
  assert.equal(vetoResumeRuledNone(1, { countable: true, ruled: 0 }), false, "there is nothing to resume before attempt 2");
  assert.equal(vetoResumeRuledNone(2, null), false, "a stage with no meaning population has no rulings count to read");
  // THE CONDITION: zero ruled rows ⇒ a resumed session cannot rule what it did not rule ⇒ FRESH.
  assert.equal(vetoResumeRuledNone(2, { countable: true, ruled: 0, total: 75 }), true, "R6's shape — the 1007-second resume");
  assert.equal(vetoResumeRuledNone(2, { countable: true, ruled: 12, total: 75 }), false, "a seat that has recorded rows is a seat warm can help — R5's case");
  // ── THE RIDER, PINNED: ABSENCE READS AS ZERO, DELIBERATELY — THE VETO FIRES. ──────────────────────
  // This inverts the house absence-is-a-finding rule, and it is correct in exactly this one place: the
  // veto's failure direction is resuming-when-it-shouldn't. Reading an unknown count as "some rows were
  // ruled" resumes a session that may have ruled nothing (the 2026-08-15 terminal); reading it as zero
  // costs one fresh dispatch. Do NOT "fix" these expectations to false — that is the fix this comment
  // exists to refuse.
  assert.equal(vetoResumeRuledNone(2, { countable: false }), true, "an uncountable state must refuse the resume");
  assert.equal(vetoResumeRuledNone(2, { countable: true }), true, "a missing ruled count reads as zero, not as some");
  assert.equal(vetoResumeRuledNone(2, { countable: true, ruled: NaN }), true, "an unparseable count reads as zero, not as some");
});

test("#589 arm 2 — a form-era TOTAL token is COLD by ineligibility: the retry does not resume", async () => {
  process.env.MOCK_WARM_MODE = "draft";
  // `connotation_form_untouched` died with the form path and left the warm allowlist with it — so a
  // parked pre-upgrade run resumed on this engine, whose recorded lastFail still carries it, dispatches
  // FRESH. That is the same safe direction the old veto bought, reached by ineligibility: a dead
  // whole-population token must never warm. (The LIVE ruled-none case is the direct-state veto's, and
  // veto-resume-ruled-none.test.mjs drives it through the real pipeline.)
  const validate = (_p, c) => (/PATCHED|FRESH/.test(c) ? { ok: true } : { ok: false, reason: REASON("form_untouched", 75) });
  const r = await stage({ validate });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  const c = calls();
  assert.equal(c.length, 2);
  assert.equal(resumed(c[0]), false, "attempt 1 is always fresh");
  assert.equal(resumed(c[1]), false,
    "THE DEFECT: attempt 2 resumed the session that produced a form it never opened. That is R6's 1007 seconds");
  // …and it is the FULL corrective message, not a patch-only one: a fresh session holds nothing.
  assert.match(c[1].prompt ?? "", /BASE TASK/, "a fresh dispatch must carry the whole task");
});

test("#589 arm 3 — a PARTIAL defect still warm-patches. R5 closed in 83 seconds this way", async () => {
  process.env.MOCK_WARM_MODE = "draft";
  const validate = (_p, c) => (/PATCHED|FRESH/.test(c) ? { ok: true } : { ok: false, reason: REASON("quote_unbound", 3) });
  const r = await stage({ validate });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  const c = calls();
  assert.equal(resumed(c[1]), true,
    "the veto widened to a bounded defect — this is the retry that works, and it is now being thrown away");
  assert.match(c[1].prompt ?? "", /RESUMING your own session/);
});

test("#589 arm 4 — the skip does NOT spend the warm attempt", async () => {
  // R6's real shape, one step further: total on attempt 1, and a seat that has now worked on the form
  // on attempt 2. Attempt 3 is the case warm is good at and must still get it.
  process.env.MOCK_WARM_MODE = "draft";
  let n = 0;
  const validate = (_p, c) => {
    if (/PATCHED/.test(c)) return { ok: true };
    n += 1;
    return { ok: false, reason: n === 1 ? REASON("form_untouched", 75) : REASON("token_absent", 40) };
  };
  const r = await stage({ validate, maxRetries: 3 });
  const c = calls();
  assert.equal(resumed(c[1]), false, "attempt 2 follows the total defect and must be fresh");
  assert.ok(c.length >= 3, "the ladder must reach attempt 3 for this arm to prove anything");
  assert.equal(resumed(c[2]), true,
    "the warm lane was consumed by a skip that never used it — a partial defect later in the ladder lost its cheap retry");
});

test("#589 arm 5 — the LIVE family stays WARM-ELIGIBLE, because that allowlist routes the repair", async () => {
  // The veto lives at the warm decision, NOT in WARM_ELIGIBLE_RE. That allowlist also decides whether a
  // rejected draft survives a park (draftCarryEligible); dropping a live token from it to skip one warm
  // attempt would change what a park may carry — the coupling. `call_never_made` is eligible AND
  // always vetoed (ruled none ⇒ direct state refuses the resume): eligibility and the veto answer
  // different questions on purpose.
  const f = FAIL("call_partial", 40);
  assert.equal(warmEligible(f, { status: "ok" }), true);
  const patch = warmPatchMessage(f, ["/run/common-law-findings.half-m.md"]);
  assert.match(patch, /record_dispositions/, "the repair names the recording tool");
  assert.match(patch, /\/run\/_driver\/grid-spec\.half-m\.json/, "…aimed at the failing member's own spec");
  assert.equal(warmEligible(FAIL("call_never_made", 75), { status: "ok" }), true,
    "eligibility is not the veto — see vetoResumeRuledNone for what refuses the ruled-none resume");
});
