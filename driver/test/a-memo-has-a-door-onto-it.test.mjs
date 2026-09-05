// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The memo capability is REACHABLE (tracker issue 132).
//
// WHAT WAS ACTUALLY WRONG. Every piece of the memo existed and nothing could reach it: whatif-memo.mjs
// composed one, whatIfRefusal admitted `kind: "memo"` on a finished run, decodeOp validated a memo op —
// and NOTHING CALLED composeMemo, because whatIfPlan hard-required a stage and so no memo token could be
// minted. A capability that is composed and unreachable reads as done and answers nothing. The sibling
// arm (a-memo-over-a-delivered-report-leaves-it-alone) proves the composer; this one proves the door.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whatIfPlan, decodeOp } from "../../mcp-server/lib/whatif.mjs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { askArchivedRun, digestRunDir, movedArtifacts, parentRatedUnder, seatReason, validateMemoReply, composeMemoMessage, MEMO_FAILS, MEMO_DIR } from "../whatif-memo-run.mjs";

// A delivered run on disk. Its own temp directory every time: /tmp is shared across logins on this box
// and carries files weeks old — a bare join(tmpdir(), "findings.json") reads somebody else's, which is
// how the first draft of this arm passed a case it never exercised.
function deliveredRun(over = {}) {
  const dir = mkdtempSync(join(tmpdir(), "memo-door-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ findings: [{ ordinal: 2, mark: "ALIGN" }] }));
  writeFileSync(join(dir, "report.md"), "# Clearance report\n");
  writeFileSync(join(dir, "_driver", "profile.json"), JSON.stringify({ profileKey: "petcary" }));
  writeFileSync(join(dir, "_driver", "run.jsonl"), JSON.stringify({ event: "stage", stage: "synthesis" }) + "\n");
  return { runId: "acme-2026-09-01-teal-otter", runDir: dir, markName: "ALIGN", url: "report.html", location: "archive", state: "delivered", ...over };
}

const READING = {
  body: "Finding 2's weight drops: an abandoned application is not an enforceable prior right.",
  limits: [{
    cannot: "whether the application is in fact abandoned",
    smallestSearch: "a current Korean register status check on that one application",
    text: "Abandonment is the assumption applied here, not a fact this memo established.",
  }],
};
const reason = async () => READING;

// ── the door that did not exist ──────────────────────────────────────────────────────────────────────

test("a memo can be PLANNED on a delivered run — the step that made everything else unreachable", () => {
  const plan = whatIfPlan({ run: deliveredRun(), kind: "memo", instructions: "treat the Korean application as abandoned" });
  assert.equal(plan.runnable, true, "this is the defect: no memo token could be minted at all");
  assert.equal(plan.kind, "memo");
  assert.ok(plan.confirmationToken, "and without a token nothing downstream can run");
});

test("the planned token decodes as a memo op — plan and run agree about what was asked", () => {
  const plan = whatIfPlan({ run: deliveredRun(), kind: "memo", instructions: "treat it as abandoned" });
  const op = decodeOp(plan.confirmationToken, "test");
  assert.equal(op.kind, "memo");
  assert.equal(op.instructions, "treat it as abandoned", "the assumption travels verbatim through the token");
  assert.ok(!op.stage, "a memo re-runs no stage, and decodeOp refuses a memo token that carries one");
});

test("a memo plan states it spends nothing, because that is what makes it safe to offer on a delivered report", () => {
  const plan = whatIfPlan({ run: deliveredRun(), kind: "memo", instructions: "x" });
  assert.match(plan.externalCalls, /no searching|nothing billed/i);
  assert.equal(plan.affectsFinalReport, false);
  assert.match(plan.parentUntouched, /not modified/i);
});

test("planning a memo without an assumption refuses, and says what is missing", () => {
  const r = whatIfPlan({ run: deliveredRun(), kind: "memo" });
  assert.equal(r.runnable, false);
  assert.match(r.reason, /needs the assumption/i);
});

test("the STAGE plan path is untouched — a memo mode is not a licence to re-run a delivered report", () => {
  const refused = whatIfPlan({ run: deliveredRun(), stage: "synthesis" });
  assert.equal(refused.runnable, false, "a stage re-run on an archived run must still be refused");
  assert.match(refused.reason, /live runs only/);
});

// ── the entry point ──────────────────────────────────────────────────────────────────────────────────

test("askArchivedRun writes a memo beside the run and states the rating authority", async () => {
  const run = deliveredRun();
  const r = await askArchivedRun({ runId: run.runId, question: "treat the Korean application as abandoned" },
    { resolveRun: () => run, reason });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.ratedUnder, "petcary", "a memo must rate under the SAME authority as its parent, or say it did not");
  assert.ok(existsSync(join(run.runDir, r.memoPath)), "the memo must actually be on disk beside the run");
  const text = readFileSync(join(run.runDir, r.memoPath), "utf8");
  assert.match(text, /SUPPLEMENTARY MEMO/, "the banner is first and not optional");
  assert.match(text, /treat the Korean application as abandoned/, "the assumption is carried verbatim");
  assert.match(text, /teal-otter/, "and the parent is named");
});

test("limits come back as STRUCTURED ROWS, not only as prose in the memo", async () => {
  // The client cut goes through the scrubber. A limit that exists only inside a paragraph forces that
  // decision to be made by regexing prose, which is the shape this repo keeps paying for.
  const run = deliveredRun();
  const r = await askArchivedRun({ runId: run.runId, question: "q" }, { resolveRun: () => run, reason });
  assert.equal(r.statedLimits.length, 1);
  assert.deepEqual(Object.keys(r.statedLimits[0]).sort(), ["cannot", "smallestSearch", "text"]);
  assert.match(r.statedLimits[0].smallestSearch, /register status check/,
    "a limit names the SMALLEST search that would settle it — an acceptance criterion, so it is a field and not prose");
});

test("a build whose skill is missing REFUSES — it never returns a hollow memo", async () => {
  // The defect this whole change is about, one layer up: something that reads as done and answers
  // nothing. A memo with an empty body would be exactly that. The seat is the default reasoning pass
  // now, so the genuinely unwired state is a build that shipped without the dictation.
  const run = deliveredRun();
  const r = await askArchivedRun({ runId: run.runId, question: "q" },
    { resolveRun: () => run, reason: (a) => seatReason(a, { skillPath: "/nonexistent/SKILL.md", runStage: async () => ({ ok: true }) }) });
  assert.equal(r.ok, false);
  assert.equal(r.fail, MEMO_FAILS.NOT_WIRED);
  assert.match(r.detail, /skill is missing/);
});

test("the seat is the DEFAULT — the door is wired, not merely openable", () => {
  // The thing this PR is about. If askArchivedRun's default were null again, every call would refuse
  // and the capability would be back where it started: composed, and unreachable.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "whatif-memo-run.mjs"), "utf8");
  assert.match(src, /reason = seatReason/, "the seat must be the default reasoning pass");
  assert.ok(!/reason = null/.test(src), "a null default would silently un-wire the door");
});

// ── the seat's own seam ──────────────────────────────────────────────────────────────────────────────

test("the memo dispatches WITHOUT becoming a pipeline stage", async () => {
  // runStage reads no entry from the STAGES table, so a memo rides the same gateway ladder without a
  // seventeenth stage, a place in STAGE_ORDER it has no meaning in, or a freshness relationship with a
  // delivered report. The token contract on main says the same from the other end: a memo carries no stage.
  const run = deliveredRun();
  const seen = [];
  const runStage = async (label, opts) => {
    seen.push({ label, opts });
    writeFileSync(opts.expectFile, JSON.stringify({ body: "Finding 2 weakens.", limits: [] }));
    return { ok: true };
  };
  const r = await askArchivedRun({ runId: run.runId, question: "treat it as abandoned" },
    { resolveRun: () => run, reason: (a) => seatReason(a, { runStage }) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].label, "whatif-memo");
  assert.ok(seen[0].opts.expectFile, "the reply is a FILE the seat writes, not prose scraped from a transcript");
  assert.ok(seen[0].opts.sessionKey, "and it carries its own session key");
  const stages = await import("../stages.mjs");
  assert.ok(!("whatif-memo" in stages.STAGES), "a memo must NOT be in the stage table");
  assert.ok(!stages.STAGE_ORDER.includes("whatif-memo"), "nor in the order of a run it is not part of");
});

test("the dispatch carries the assumption verbatim, the parent's framework, and the real findings", () => {
  const msg = composeMemoMessage({
    assumption: "treat the Align Networks Korean application as abandoned",
    findings: { findings: [{ ordinal: 2, mark: "ALIGN" }] },
    ratedUnder: "petcary",
    skill: "# skill",
  });
  assert.match(msg, /treat the Align Networks Korean application as abandoned/, "verbatim, never paraphrased");
  assert.match(msg, /petcary — assess under this one, not the house default/);
  assert.match(msg, /"ordinal": 2/, "the run's own findings, not our summary of them");
  const houseMsg = composeMemoMessage({ assumption: "x", findings: {}, ratedUnder: null, skill: "" });
  assert.match(houseMsg, /froze no customer profile/, "and null says which fact that is");
});

// ── the reply contract: typed, so a phrasing choice can never fail it ────────────────────────────────

test("a valid reply passes, fenced or bare", () => {
  const doc = { body: "Finding 2 weakens.", limits: [{ cannot: "whether abandoned", smallestSearch: "a KR status check", text: "s" }] };
  assert.equal(validateMemoReply(doc).ok, true);
  assert.equal(validateMemoReply(JSON.stringify(doc)).ok, true);
  assert.equal(validateMemoReply("```json\n" + JSON.stringify(doc) + "\n```").ok, true,
    "the skill says no fence; a seat that adds one answered correctly in the wrong wrapper");
});

test("every way a reply can be useless has its own reason code", () => {
  const cases = [
    ["nonsense", MEMO_FAILS.REPLY_UNREADABLE],
    ["[]", MEMO_FAILS.REPLY_UNREADABLE],
    [{ limits: [] }, MEMO_FAILS.REPLY_NO_BODY],
    [{ body: "x" }, MEMO_FAILS.REPLY_NO_LIMITS],
    [{ body: "x", limits: "none" }, MEMO_FAILS.REPLY_NO_LIMITS],
    [{ body: "x", limits: [{ cannot: "y" }] }, MEMO_FAILS.REPLY_BAD_LIMIT],
    [{ body: "x", limits: [{ smallestSearch: "z" }] }, MEMO_FAILS.REPLY_BAD_LIMIT],
  ];
  for (const [raw, fail] of cases) {
    const r = validateMemoReply(raw);
    assert.equal(r.ok, false, `expected a refusal for ${JSON.stringify(raw)}`);
    assert.equal(r.fail, fail, `wrong code for ${JSON.stringify(raw)}`);
  }
});

test("an ABSENT limits key and an EMPTY one are different claims", () => {
  // The skill makes an empty list an assertion — "nothing here waits on a search". Supplying one for a
  // seat that never made it would publish an honesty claim on its behalf.
  assert.equal(validateMemoReply({ body: "x" }).fail, MEMO_FAILS.REPLY_NO_LIMITS);
  assert.equal(validateMemoReply({ body: "x", limits: [] }).ok, true);
});

test("a limit that names no smallest search is refused — the whole point of the field", () => {
  const r = validateMemoReply({ body: "x", limits: [{ cannot: "whether it is abandoned" }] });
  assert.equal(r.fail, MEMO_FAILS.REPLY_BAD_LIMIT);
  assert.match(r.detail, /not something a reader can act on/,
    "\"you need more searching\" tells a lawyer nothing they can buy");
});

test("each refusal names its own state", async () => {
  const run = deliveredRun();
  assert.equal((await askArchivedRun({ runId: run.runId, question: "  " }, { resolveRun: () => run, reason })).fail,
    MEMO_FAILS.NO_ASSUMPTION);
  assert.equal((await askArchivedRun({ runId: "nope", question: "q" }, { resolveRun: () => null, reason })).fail,
    MEMO_FAILS.NO_RUN);
  const empty = mkdtempSync(join(tmpdir(), "memo-empty-"));
  assert.equal((await askArchivedRun({ runId: "x", question: "q" },
    { resolveRun: () => ({ runId: "x", runDir: empty }), reason })).fail, MEMO_FAILS.NO_EVIDENCE,
    "a memo over a run with no findings would reason from nothing in the voice of a document that read something");
});

// ── the immutability proof ───────────────────────────────────────────────────────────────────────────

test("the parent run is BYTE-IDENTICAL after a memo, proved rather than asserted", async () => {
  const run = deliveredRun();
  const before = digestRunDir(run.runDir);
  const r = await askArchivedRun({ runId: run.runId, question: "q" }, { resolveRun: () => run, reason });
  assert.equal(r.ok, true);
  assert.deepEqual(movedArtifacts(before, digestRunDir(run.runDir)), [],
    "not one delivered artifact may move — this is the whole safety case for offering it on a client's report");
});

test("a reasoning pass that touches the parent FAILS the call", async () => {
  // The check has to cover a write from anywhere, not just from this file. A safety case resting on
  // nobody having introduced a write is one that decays.
  const run = deliveredRun();
  const vandal = async () => { writeFileSync(join(run.runDir, "report.md"), "# Rewritten\n"); return READING; };
  const r = await askArchivedRun({ runId: run.runId, question: "q" }, { resolveRun: () => run, reason: vandal });
  assert.equal(r.ok, false);
  assert.equal(r.fail, MEMO_FAILS.PARENT_MOVED);
  assert.ok(r.moved.some((m) => m.path === "report.md"), "and it names which artifact moved");
});

test("a DELETED artifact counts as moved — an absence is a change, not a clean read", async () => {
  assert.deepEqual(movedArtifacts({ "report.md": "abc:10" }, {}), [{ path: "report.md", before: "abc:10", after: null }]);
  assert.deepEqual(movedArtifacts({}, { "surprise.md": "def:2" }), [{ path: "surprise.md", before: null, after: "def:2" }]);
  assert.deepEqual(movedArtifacts({ "a.md": "x:1" }, { "a.md": "x:1" }), []);
});

test("the memo's own directory is excluded, or every successful memo would fail its own check", async () => {
  const run = deliveredRun();
  mkdirSync(join(run.runDir, MEMO_DIR), { recursive: true });
  writeFileSync(join(run.runDir, MEMO_DIR, "earlier.md"), "an earlier memo");
  const d = digestRunDir(run.runDir);
  assert.ok(!Object.keys(d).some((p) => p.startsWith(MEMO_DIR)), "_memos/ is where this call legitimately writes");
  assert.ok(Object.keys(d).some((p) => p === "report.md"), "but the delivered artifacts are still covered");
  assert.ok(Object.keys(d).some((p) => p.startsWith("_driver/")), "and _driver/ is walked, not just the top level");
});

test("parentRatedUnder reads the FROZEN sidecar, and null means none was frozen", () => {
  const run = deliveredRun();
  assert.equal(parentRatedUnder(run.runDir), "petcary");
  // THREE ways there is no key, and they must all read null. A plant that defaulted to "generic" was
  // caught by NONE of these until the middle two existed: an absent FILE hits the catch and returns null
  // whatever the default is, so an arm that only tested a bare directory passes a build that
  // manufactures the exact substitution tracker issue 135 is about.
  const bare = mkdtempSync(join(tmpdir(), "memo-bare-"));
  assert.equal(parentRatedUnder(bare), null, "no sidecar at all");

  const noKey = mkdtempSync(join(tmpdir(), "memo-nokey-"));
  mkdirSync(join(noKey, "_driver"), { recursive: true });
  writeFileSync(join(noKey, "_driver", "profile.json"), JSON.stringify({ frozenAt: "2026-09-01" }));
  assert.equal(parentRatedUnder(noKey), null,
    "a sidecar with no profileKey must read null — defaulting to \"generic\" here would state a rating "
    + "authority the parent never used, which is the substitution this whole feature refuses to make");

  const nullKey = mkdtempSync(join(tmpdir(), "memo-nullkey-"));
  mkdirSync(join(nullKey, "_driver"), { recursive: true });
  writeFileSync(join(nullKey, "_driver", "profile.json"), JSON.stringify({ profileKey: null }));
  assert.equal(parentRatedUnder(nullKey), null, "an explicit null key is still no key");

  const corrupt = mkdtempSync(join(tmpdir(), "memo-corrupt-"));
  mkdirSync(join(corrupt, "_driver"), { recursive: true });
  writeFileSync(join(corrupt, "_driver", "profile.json"), "{ not json");
  assert.equal(parentRatedUnder(corrupt), null, "an unreadable sidecar is a could-not-look, never a customer");
});
