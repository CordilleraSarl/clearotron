// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SEARCH THAT DID NOT ANSWER IS NEVER RECORDED AS ONE THAT FOUND NOTHING.
//
// On a test run, a writer whose every research question was refused for want of a credential recorded "no result" on
// eleven findings and a low enforcement likelihood on fourteen, and the report prints that value as a search that ran
// and found nothing. Its instruction for an outage said to write it, the refusals left no line in the run's research
// log, and nothing in the record could tell. The ruled distinction (design, 2026-10-28): a search that failed, was
// refused, was not asked, or has no available saved answer supplies no search result, and no-result is recorded only
// when a completed search returned none. A successful search about one owner must not make a failed one about another
// look successful, so a no-result names the question whose completed answer it rests on, and the review is handed the
// research behind each claim.
//
// The research tool is driven over its real stdio protocol through each outcome, with nothing sent out: the network
// call is replaced in the server's own process. The run it leaves is then handed to the writer's record. Every owner
// and mark below is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { driverDir } from "../../shared/driver-dir.mjs";

// The writer's session, as its tools are told it; the research tool below asks under the same one.
const SESSION = "clearance-acme-run-amber-fox-synthesis";
process.env.CLEAROTRON_GATHER_SESSION_KEY = SESSION;
process.env.MOCK_FINDINGS_N = "3";
const M = await import("./mock-stage-fixtures.mjs");
const SR = await import("../synthesis-record.mjs");
const RA = await import("../research-answers.mjs");
const { STAGES, paths, stageInputs } = await import("../stages.mjs");
const { correctionHint } = await import("../gateway.mjs");
const { validators } = await import("../verify.mjs");
const { parseFrameworkManifest } = await import("../framework.mjs");
const { sandboxManifest } = await import("../stage-context.mjs");
const { messageCtxFor } = await import("../pipeline.mjs");
const { runOwnerChecks } = await import("../owner-use-check.mjs");
const KO = await import("../publish/render-knockout.mjs");
const RC = await import("../research-checks.mjs").catch(() => null);   // absent before the review was handed its evidence

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(HERE, "..");
const SERVER = join(DRIVER, "engine", "mcp", "perplexity-server.mjs");

// The ruled sentences, word for word (design, 2026-10-28). Written out here so a change to any of them fails this file.
const RULED = "A search that failed, was refused, was not asked, or has no available saved answer supplies no search result. "
  + "Use relevant evidence already held, and leave any remaining use or enforcement question unknown. "
  + "Never describe the unanswered question as a search that found no result, no use, or no enforcement, and do not infer a low "
  + "enforcement likelihood from that failure. Record no-result only when a completed search actually returned no result. "
  + "Preserve unaffected findings and complete the report from the evidence available.";
const CORRECTION = "Correct the affected findings and any narrative, answers, actions or conclusions that depend on them. "
  + "If the driver already holds an accepted record, use record_synthesis to send only the corrected findings, affected narrative "
  + "sections and changed registers. Otherwise complete the initial recording with the corrected values. Preserve unaffected work.";
const REVIEW = "Check a claimed research result against the relevant saved answer and its completion record. "
  + "A failed or unanswered question is not a negative result. An unknown status alone does not require an invented source. "
  + "Flag unsupported claims and the conclusions that depend on them; preserve unaffected work.";
const CHECKED = "The driver checks the structured finding record. A required use-check source belongs in that record. "
  + "An unknown use status does not require an invented source. The reviewer checks whether the available evidence supports the claim.";
const NO_RESULT = "perplexity_research — no result";

const ask = (owner) => `Does ${owner} use the mark QZORVEL for toys in France, and has it opposed or sued over a similar mark?`;

// The research service's reply, set in the server's own process: nothing leaves this machine. "empty" is a search that
// completed and found nothing, "fail" a refusal of the key by the service, "unreadable" a reply with no text in it, and
// "unlinked" a completed answer that names no page.
const STUB = `
const mode = process.env.STUB_RESEARCH;
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const say = (text) => json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] });
globalThis.fetch = async () => {
  if (mode === "fail") return new Response("invalid api key", { status: 401 });
  if (mode === "unreadable") return json({ status: "completed", output: [] });
  if (mode === "unlinked") return say("The owner sells wooden toys in France under QZORVEL, from its own shop.");
  return say("No marketplace use of QZORVEL by this owner was found, and no opposition or court action by it.");
};`;
const PRELOAD = `data:text/javascript,${encodeURIComponent(STUB)}`;

/** One call to the real research server over stdio. `key` empty is a run with no research credential. */
async function callResearch(runDir, args, { key = "placeholder-not-a-key", stub = "empty" } = {}) {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "perplexity_research", arguments: args } },
  ];
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", PRELOAD, SERVER], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PERPLEXITY_API_KEY: key, STUB_RESEARCH: stub, CLEAROTRON_BAND_RUN_DIR: runDir, CLEAROTRON_GATHER_SESSION_KEY: SESSION } });
    let buf = "", text = null;
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(text ?? ""); };
    const timer = setTimeout(done, 15000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id === 2) text = m.result?.content?.[0]?.text ?? ""; } catch { /* not a reply */ }
      }
      if (text !== null) { clearTimeout(timer); done(); }
    });
    child.on("error", reject);
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}

// The writer's three findings, as the stand-in engine writes them, and the duty to account for each of their records.
const DOC = JSON.parse(M.synthesisFindings(null, ""));
const URIS = ["/mark/us/90000001", "/mark/us/90000002", "/mark/us/90000003"];
const SECTIONS = {
  spine: "Dominant-element analysis across the three near marks of one owner family, each read against the client's goods in class 9. "
    + "The marks share the element that carries the client's mark, and the goods overlap in the searched class, so the read turns on that overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The register search ran across the instructed classes and territory." },
};
function run(t) {
  const dir = mkdtempSync(join(tmpdir(), "unanswered-search-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "declination-spec.json"), JSON.stringify({ schema_version: 1, rows: URIS.map((uri, i) => ({ uri, mark: DOC.findings[i].mark, owner: "an invented owner", tier: "headline-candidate" })) }) + "\n");
  return dir;
}
const lines = (at) => existsSync(at) ? readFileSync(at, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const readingLog = (d) => lines(driverDir(d, "reading-log.jsonl"));
// The answers the run keeps for a later attempt, a replay or the writer's record: completed searches only.
const kept = (d) => lines(driverDir(d, "research-answers.jsonl")).length;

// A finding whose owner's use was "checked" with nothing found, naming the question it rests on (or none).
const noResult = (f, question) => ({ ...f, use_check: { source: NO_RESULT, ...(question ? { question } : {}) },
  meters: { ...f.meters, use: { token: "not-confirmed", basis: "inferred-from-signal" }, enforcer: { token: "low", basis: "inferred-from-signal" } } });
// The same finding left honestly open: nothing completed, so use and enforcement are unknown and no check is cited.
const leftUnknown = (f) => {
  const { use_check: _drop, ...rest } = f;
  return { ...rest, meters: { ...f.meters, use: { token: "unknown", basis: "inferred-from-signal" }, enforcer: { token: "unknown", basis: "inferred-from-signal" } } };
};
const save = (dir, list) => SR.recordSynthesis(dir, { save_findings: list });
const whole = (dir, findings) => SR.recordSynthesis(dir, { findings: { ...DOC, findings }, narrative: SECTIONS });

// Each outcome, run once against a run folder of its own, asking about one owner.
const OUTCOMES = {
  "a completed search that found nothing": async (d) => callResearch(d, { task: ask("Sample Trading") }),
  "a question refused for want of a credential": async (d) => callResearch(d, { task: ask("Sample Trading") }, { key: "" }),
  "a question the service failed": async (d) => callResearch(d, { task: ask("Sample Trading") }, { stub: "fail" }),
  "a reply the tool could not read": async (d) => callResearch(d, { task: ask("Sample Trading") }, { stub: "unreadable" }),
  "a question never asked": async () => "",
  "a replayed question with no saved answer": async (d) => {
    writeFileSync(driverDir(d, "research-replay.json"), JSON.stringify({ replayOf: "the run's saved research answers", answers: 0 }) + "\n");
    return callResearch(d, { task: ask("Sample Trading") }, { key: "" });
  },
};

test("each research outcome leaves its own trace: only a completed search is logged as answered and kept", async (t) => {
  const seen = {};
  for (const [name, act] of Object.entries(OUTCOMES)) {
    const d = run(t);
    const reply = await act(d);
    seen[name] = { reply, log: readingLog(d).map((r) => ({ ok: r.ok, replay: Boolean(r.args?.replay), error: String(r.error ?? "") })), held: kept(d) };
  }
  const done = seen["a completed search that found nothing"];
  assert.match(done.reply, /^No marketplace use of QZORVEL/);
  assert.deepEqual([done.log.map((r) => r.ok), done.held], [[true], 1], "a completed empty answer is not logged as answered and kept");

  const refused = seen["a question refused for want of a credential"];
  assert.match(refused.reply, /^ERROR: PERPLEXITY_API_KEY not set/);
  assert.equal(refused.log.length, 1, "a refused question left no line in the research log, so it reads as one never asked");
  assert.equal(refused.log[0].ok, false);
  assert.match(refused.log[0].error, /^refused: no research credential$/);
  assert.equal(refused.held, 0);

  const failed = seen["a question the service failed"];
  assert.match(failed.reply, /^ERROR: Research failed — Perplexity API 401/);
  assert.deepEqual([failed.log.map((r) => r.ok), failed.held], [[false], 0]);

  const unreadable = seen["a reply the tool could not read"];
  assert.match(unreadable.reply, /^ERROR: Perplexity returned a response but no text content could be extracted/);
  assert.deepEqual(unreadable.log.map((r) => r.ok), [false], "a reply the tool could not read is logged as answered");
  assert.equal(unreadable.held, 0);

  assert.deepEqual([seen["a question never asked"].log, seen["a question never asked"].held], [[], 0]);

  const replay = seen["a replayed question with no saved answer"];
  assert.match(replay.reply, /^ERROR: replay — the run asked no question worded exactly like this one/);
  assert.deepEqual([replay.log.map((r) => [r.ok, r.replay]), replay.held], [[[false, true]], 0]);
});

test("the writer's record takes a no-result only where the question it names completed", async (t) => {
  for (const [name, act] of Object.entries(OUTCOMES)) {
    const d = run(t);
    await act(d);
    const saved = save(d, [noResult(DOC.findings[0], ask("Sample Trading"))]);
    const all = run(t);
    await act(all);
    const recorded = whole(all, [noResult(DOC.findings[0], ask("Sample Trading")), DOC.findings[1], noResult(DOC.findings[2], ask("Sample Trading"))]);
    if (name === "a completed search that found nothing") {
      assert.deepEqual([saved.saved?.length, saved.save_refused], [1, []], `${name}: the save was refused`);
      assert.equal(recorded.refused, null, `${name}: ${recorded.refused}`);
      continue;
    }
    assert.equal(saved.saved?.length, 0, `${name}: a no-result was saved with no completed search behind it`);
    assert.equal(saved.save_refused?.[0]?.reason, `synthesis_save_no_result_without_a_completed_search:0 — finding 1 names a question `
      + `this writer holds no completed answer to. The completed questions this writer holds: none. ${RULED}`, name);
    assert.equal(recorded.refused, "synthesis_no_result_without_a_completed_search:1,3 — finding 1 names a question this writer holds no completed "
      + `answer to; finding 3 names a question this writer holds no completed answer to. The completed questions this writer holds: none. ${RULED}`,
      `${name}: the whole record took a no-result`);
    assert.equal(existsSync(join(all, "findings.json")), false, `${name}: a refused record was written`);
  }
  // A no-result that names no question is refused in the same way, whatever the run holds.
  const d = run(t);
  await callResearch(d, { task: ask("Sample Trading") });
  assert.match(save(d, [noResult(DOC.findings[0])]).save_refused?.[0]?.reason ?? "",
    /^synthesis_save_no_result_without_a_completed_search:0 — finding 1 names no question\. A search that failed/);
});

test("owner A answered and owner B failed: B's no-result is refused, and A's stands", async (t) => {
  const d = run(t);
  assert.match(await callResearch(d, { task: ask("Alder Holdings") }), /^No marketplace use/);
  assert.match(await callResearch(d, { task: ask("Birchmoor Ltd") }, { stub: "fail" }), /^ERROR: Research failed/);
  // The boundary first, in the record's old shape: B's no-result names nothing, and the run holds A's completed answer.
  // One completed answer anywhere used to let it pass.
  const bare = whole(d, [DOC.findings[0], noResult(DOC.findings[1]), DOC.findings[2]]);
  assert.match(bare.refused ?? "", /^synthesis_no_result_without_a_completed_search:2 — finding 2 names no question. /,
    "a completed answer about one owner let a failed question about another pass as a search that found nothing");
  // Then each names its own question, on a run of its own, so no earlier refusal can have taken anything off.
  const e = run(t);
  await callResearch(e, { task: ask("Alder Holdings") });
  await callResearch(e, { task: ask("Birchmoor Ltd") }, { stub: "fail" });
  const a = noResult(DOC.findings[0], ask("Alder Holdings"));
  const b = noResult(DOC.findings[1], ask("Birchmoor Ltd"));
  const r = whole(e, [a, b, DOC.findings[2]]);
  assert.match(r.refused ?? "", /^synthesis_no_result_without_a_completed_search:2 — finding 2 names a question this writer holds no completed answer to\. /,
    "a completed answer about one owner let a failed question about another pass as a search that found nothing");
  assert.ok(r.refused.includes(`The completed questions this writer holds: "${ask("Alder Holdings")}".`), "the refusal does not hand back the question that did complete");
  // Spelled as research-answers.md hands it on, on one line and without its question mark, it is the same question:
  // on a run of its own, so no earlier refusal can have taken the no-result off.
  const d2 = run(t);
  await callResearch(d2, { task: ask("Alder Holdings") });
  const respelled = noResult(DOC.findings[0], `  ${ask("Alder Holdings").replace(/\?$/, "").replace(/ /g, "\n ")}  `);
  assert.equal(whole(d2, [respelled, leftUnknown(DOC.findings[1]), DOC.findings[2]]).refused, null);
  const kept1 = JSON.parse(readFileSync(join(d2, "findings.json"), "utf8")).findings.find((f) => f.mark === DOC.findings[0].mark);
  assert.equal(kept1.use_check?.source, NO_RESULT, "a supported no-result was taken off the record");
});

test("earlier evidence stays usable: a handed answer needs no new call, a replayed one counts, and a bank answer never asked does not", async (t) => {
  // An earlier stage's answer, handed to the writer in research-answers.md, cited with no new call.
  const handed = run(t);
  appendFileSync(driverDir(handed, "research-answers.jsonl"), JSON.stringify({ ts: "2026-01-01T10:00:00.000Z",
    session: "clearance-acme-run-amber-fox-common-law-half-a", task: ask("Example Holdings"), text: "No use found for toys." }) + "\n");
  assert.equal(RA.handResearchAnswers(handed, SESSION, { ofRun: true }), 1);
  const before = readingLog(handed).length;
  assert.equal(save(handed, [noResult(DOC.findings[0], ask("Example Holdings"))]).saved.length, 1, "a handed answer did not count");
  assert.equal(readingLog(handed).length, before, "reusing an answer already held made a new call");

  // A replay: the bank holds the run's answers, its own stage's later ones among them, in a copy outside the arm that
  // the replay's marker names. One the writer asked is replayed to it and counts, with its answer; one it never asked
  // sits in the bank and does not.
  const replayed = run(t);
  const bankDir = mkdtempSync(join(tmpdir(), "unanswered-search-bank-"));
  t.after(() => rmSync(bankDir, { recursive: true, force: true }));
  const bank = join(bankDir, "research-answers.jsonl");
  for (const owner of ["Sample Trading", "Hidden Later Co"]) {
    appendFileSync(bank, JSON.stringify({ ts: "2026-01-01T10:00:00.000Z",
      session: "clearance-acme-run-amber-fox-synthesis-of-the-saved-run", task: ask(owner), text: `No use found for ${owner}.` }) + "\n");
  }
  writeFileSync(driverDir(replayed, "research-replay.json"), JSON.stringify({ replayOf: "the run's saved research answers", answers: 2, answersFrom: bank }) + "\n");
  assert.equal(await callResearch(replayed, { task: ask("Sample Trading") }, { key: "" }), "No use found for Sample Trading.");
  assert.equal(save(replayed, [noResult(DOC.findings[0], ask("Sample Trading"))]).saved.length, 1, "a replayed answer did not count");
  assert.equal(RA.heldResearchAnswers(replayed, SESSION).get(RA.questionKey(ask("Sample Trading")))?.answer,
    "No use found for Sample Trading.", "a replayed answer counted without its text, so the review cannot read it");
  assert.match(save(replayed, [noResult(DOC.findings[1], ask("Hidden Later Co"))]).save_refused?.[0]?.reason ?? "",
    /^synthesis_save_no_result_without_a_completed_search:0 — finding 2 names a question this writer holds no completed answer to/,
    "an answer the writer was neither handed nor given by the tool counted as one it held");

  // A link to evidence already held stands where every question was refused.
  const linked = run(t);
  await callResearch(linked, { task: ask("Sample Trading") }, { key: "" });
  const cited = { ...DOC.findings[0], use_check: { source: "https://register.example/record/90000001" } };
  assert.equal(save(linked, [cited]).saved.length, 1, "a cited link was refused for want of research");

  // A completed answer that names no page is still a completed answer: what it supports is the model's to judge.
  const unlinked = run(t);
  assert.match(await callResearch(unlinked, { task: ask("Sample Trading") }, { stub: "unlinked" }), /wooden toys/);
  assert.equal(save(unlinked, [noResult(DOC.findings[0], ask("Sample Trading"))]).saved.length, 1);
});

test("a refusal is not a stop: a repeat is taken with the unsupported no-result off, and the original kept", async (t) => {
  const d = run(t);
  await callResearch(d, { task: ask("Sample Trading") }, { key: "" });
  const findings = [noResult(DOC.findings[0], ask("Sample Trading")), DOC.findings[1], DOC.findings[2]];
  assert.ok(whole(d, findings).refused, "premise: the first call is refused");
  const again = whole(d, findings);
  assert.equal(again.refused, null, `a repeat was refused again, which would stop the run: ${again.refused}`);
  const stored = JSON.parse(readFileSync(join(d, "findings.json"), "utf8")).findings.find((f) => f.mark === DOC.findings[0].mark);
  assert.equal(stored.use_check, undefined, "the unsupported no-result reached the record");
  assert.equal(stored.legal_position, DOC.findings[0].legal_position, "the rest of the finding was not kept");
  const removed = lines(driverDir(d, "no-result-removed.jsonl"));
  assert.deepEqual(removed.map((r) => [r.layer, r.use_check?.source]), [["call", NO_RESULT]], "the original is not kept beside the run");
  // A save after a refusal is taken the same way.
  const s = save(d, [noResult(DOC.findings[1], ask("Sample Trading"))]);
  assert.deepEqual([s.saved.length, s.save_refused], [1, []]);
});

test("a correction on a retry's session keeps the main pass's no-result, and its evidence keeps the main pass's questions", async (t) => {
  const d = run(t);
  await callResearch(d, { task: ask("Alder Holdings") });                 // the main pass, on the writer's session
  await callResearch(d, { task: ask("Birchmoor Ltd") }, { key: "" });      // and a question of it that was refused
  const main = whole(d, [noResult(DOC.findings[0], ask("Alder Holdings")), leftUnknown(DOC.findings[1]), DOC.findings[2]]);
  assert.equal(main.refused, null, main.refused);
  // The correction after the review, on a retry's session, changing another finding.
  const retry = `${SESSION}-rerun1`;
  const patch = SR.recordSynthesis(d, { findings_patch: [{ ...leftUnknown(DOC.findings[1]), ordinal: 2, legal_position: "Corrected on the record's own evidence." }] }, { sessionKey: retry });
  assert.equal(patch.refused, null, `a correction to another finding reopened a stored no-result: ${patch.refused}`);
  const stored = JSON.parse(readFileSync(join(d, "findings.json"), "utf8")).findings.find((f) => f.mark === DOC.findings[0].mark);
  assert.equal(stored.use_check?.source, NO_RESULT, "the main pass's supported no-result was taken off");
  assert.ok(readFileSync(paths(d).researchChecks, "utf8").includes(`- "${ask("Birchmoor Ltd")}": did not complete (refused: no research credential)`),
    "the review's evidence lost the main pass's refused question after the correction");
  // A changed finding naming the main pass's completed question holds it, on a retry of a retry.
  const again = SR.recordSynthesis(d, { findings_patch: [{ ...noResult(DOC.findings[2], ask("Alder Holdings")), ordinal: 3 }] }, { sessionKey: `${retry}-rerun1` });
  assert.equal(again.refused, null, again.refused);
  // And a changed finding is still judged: a no-result on the refused question is refused.
  const bad = SR.recordSynthesis(d, { findings_patch: [{ ...noResult(DOC.findings[1], ask("Birchmoor Ltd")), ordinal: 2 }] }, { sessionKey: retry });
  assert.match(bad.refused ?? "", /^synthesis_no_result_without_a_completed_search:2 — finding 2 names a question this writer holds no completed answer to/);
});

// A frozen ladder, so the record's own check judges which findings are material, as it does on a run.
const FIVE = parseFrameworkManifest({
  schema_version: 1, framework_key: "five-rung-test", title: "Invented five-rung ladder", source_deck: "none", entity_label: "the company",
  bands: [{ label: "Very High", tone: "severe" }, { label: "High", tone: "high" }, { label: "Medium", tone: "medium" },
    { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }],
  structure: { kind: "bands" },
});

test("an honest unknown is a complete record with no search behind it, as it was before", async (t) => {
  const recordWith = async (shape) => {
    const d = run(t);
    writeFileSync(driverDir(d, "framework.json"), JSON.stringify(FIVE, null, 2));
    await callResearch(d, { task: ask("Sample Trading") }, { key: "" });
    const doc = JSON.parse(M.synthesisFindings(d));
    const findings = doc.findings.map(shape);
    const saved = save(d, [findings[0]]);
    const r = SR.recordSynthesis(d, { findings: { ...doc, findings }, narrative: SECTIONS });
    assert.equal(r.refused, null, r.refused);
    return { saved, verdict: validators.findings(join(d, "narrative.md"), readFileSync(join(d, "narrative.md"), "utf8")) };
  };
  const open = await recordWith(leftUnknown);
  assert.deepEqual(open.saved.save_refused, [], "an unknown use was refused");
  assert.equal(open.verdict.ok, true, `the record's own check asked a source of an unknown use: ${open.verdict.reason}`);
  // The control: the same findings asserting "not confirmed" with nothing cited are what that check names.
  const asserted = await recordWith((f) => {
    const { use_check: _drop, ...rest } = f;
    return { ...rest, meters: { ...f.meters, use: { token: "not-confirmed", basis: "inferred-from-signal" } } };
  });
  assert.equal(asserted.verdict.ok, false);
  assert.match(asserted.verdict.reason, /^finding_use_check_missing:/);
});

test("the review is handed the research behind each claim, its outcome and its answer, on either engine", async (t) => {
  assert.ok(RC, "the review is handed no research evidence");
  const d = run(t);
  await callResearch(d, { task: ask("Alder Holdings") });
  await callResearch(d, { task: ask("Birchmoor Ltd") }, { key: "" });
  const r = whole(d, [noResult(DOC.findings[0], ask("Alder Holdings")), leftUnknown(DOC.findings[1]), DOC.findings[2]]);
  assert.equal(r.refused, null, r.refused);
  const P = paths(d);
  const text = readFileSync(P.researchChecks, "utf8");
  assert.ok(text.includes(`use check: no result; question "${ask("Alder Holdings")}": completed.`), "the claim and its completion are not set out");
  assert.ok(text.includes(`- "${ask("Alder Holdings")}": No marketplace use of QZORVEL by this owner was found`), "the cited answer is not handed over");
  assert.ok(text.includes(`- "${ask("Birchmoor Ltd")}": did not complete (refused: no research credential)`), "the refused question is not shown as refused");
  assert.equal((text.match(/No marketplace use of QZORVEL/g) ?? []).length, 1, "an answer no claim cites was copied in");
  // The review's message names it, in design's words, and an experiment's copy of the review carries it. It stays out
  // of the review's declared inputs, the freshness map, because it moves only with the narrative the review declares.
  // Nothing here depends on the engine: both read the same message and the same run folder.
  const ctx = messageCtxFor("narrative-refutation", { paths: P, run: null });
  const message = String(STAGES["narrative-refutation"].message({ ...ctx, job: {}, registerOnly: true }));
  assert.ok(message.includes(`${REVIEW} The research behind the findings' use checks is in ${P.researchChecks}:`), "the review is not told to check claims against the evidence");
  assert.equal(stageInputs("narrative-refutation", P).includes(P.researchChecks), false, "the freshness map widened");
  assert.ok(sandboxManifest("narrative-refutation", P).some((e) => e.path === P.researchChecks), "an experiment's review would not carry the evidence");
  // A run whose record wrote none sends no pointer to a file that is not there.
  const bare = paths(run(t));
  assert.equal(String(STAGES["narrative-refutation"].message({ ...messageCtxFor("narrative-refutation", { paths: bare, run: null }), job: {}, registerOnly: true })).includes(REVIEW), false);
});

test("the ruled words stand where the writer, its correction and the review read them", (t) => {
  assert.equal(RA.NO_SEARCH_RESULT, RULED);
  const dir = run(t);
  const message = String(STAGES.synthesis.message({ paths: paths(dir), axes: ["primary-sweep"], registerOnly: true, job: {} }));
  const useCheck = message.slice(message.indexOf("USE-CHECK (enforced)"));
  assert.ok(useCheck.includes(RULED), "the writer's message does not carry the ruled sentence");
  assert.ok(useCheck.includes('After a completed search, use is "confirmed" or "not-confirmed", never "unknown".'));
  assert.equal(message.includes("On a perplexity outage"), false, "the writer is still told to write no-result on an outage");
  assert.ok(useCheck.includes('non-use revocation/cancellation as the mitigant), run ONE scoped'), "the writer still owes a source line for an unknown use");
  assert.ok(useCheck.includes('and with a no-result also "question": "<the research question whose completed answer returned it, word for word as it was asked>"'));

  const flat = (p) => readFileSync(join(DRIVER, "skills", ...p), "utf8").replace(/\s+/g, " ");
  const manual = flat(["clearance-search", "phase2-execution.md"]);
  const step = manual.slice(manual.indexOf("## Step 3.5"), manual.indexOf("## Step 3.6"));
  assert.ok(step.includes(RULED), "Step 3.5 does not carry the ruled sentence");
  assert.equal(step.includes("accepted satisfying answer"), false, "Step 3.5 still calls no-result the answer to an outage");
  assert.ok(step.includes(`${CHECKED} The synthesis stage cannot ship an *inferred* "no use"`), "Step 3.5 still names the retired validator");
  const rules = flat(["clearance-search", "synthesis-rules.md"]);
  assert.ok(rules.includes(`"perplexity_research — no result">\` line. ${CHECKED} A use-negative`), "the synthesis manual still names the retired validator");
  const review = flat(["narrative-refutation", "SKILL.md"]);
  assert.ok(review.includes(`an un-run check dressed as a clean negative is a defect. ${CHECKED}`), "the review still names the retired validator");

  // The correction for a use check corrects what depends on the finding, in its two existing branches.
  const held = correctionHint("finding_use_check_missing:4,5", { heldRecord: true });
  assert.ok(held.includes(`The failed check was: finding_use_check_missing:4,5. ${RULED} ${CORRECTION} Send it in ONE \`record_synthesis\` PATCH call`));
  assert.ok(held.endsWith("In `narrative`, send only the sections you changed — the rest are held"));
  const initial = correctionHint("finding_use_check_source_missing:4", { heldRecord: false });
  assert.ok(initial.endsWith(`${RULED} ${CORRECTION.replace(/\.$/, "")}`), "the first recording is told to patch, or to re-save a file the tool writes");
  for (const h of [held, initial]) assert.equal(/leave the narrative prose unchanged|re-save the COMPLETE findings\.json/.test(h), false);
  // Every other findings check keeps its correction, word for word.
  assert.ok(correctionHint("finding_band_off_table:3", { heldRecord: true }).endsWith("never a `findings[]` list; leave the narrative prose unchanged"));
});

test("an unknown use owes no source line in the manuals or the review", () => {
  const flat = (p) => readFileSync(join(DRIVER, "skills", ...p), "utf8").replace(/\s+/g, " ");
  const step = flat(["clearance-search", "phase2-execution.md"]);
  const contract = step.slice(step.indexOf("**Output contract"), step.indexOf("> `- **Use-check source:** <the perplexity_research result URL>"));
  assert.ok(contract.includes("names non-use revocation/cancellation as the mitigant), the finding's actual-use line MUST end"));
  assert.equal(/unknown/i.test(contract), false, "Step 3.5 still owes a source line for an unknown use");
  const rules = flat(["clearance-search", "synthesis-rules.md"]);
  const filed = rules.slice(rules.indexOf("## Filed-vs-used check"), rules.indexOf("## Own-rights evidence"));
  assert.ok(filed.includes('(non-use revocation/cancellation, "not in actual use", "no marketplace use found") MUST carry'));
  assert.equal(filed.includes("owner's use unknown"), false, "the synthesis manual still owes a source line for an unknown use");
  const review = flat(["narrative-refutation", "SKILL.md"]);
  const bullet = review.slice(review.indexOf("**Use-negative without a search.**"), review.indexOf("### Optics-escalation checks"));
  assert.ok(bullet.includes('non-use revocation/cancellation as the mitigant): does the finding carry'));
  assert.equal(bullet.includes("owner's use unknown"), false, "the review still flags an honest unknown as blocking");
});

test("the record reads the no-result value as the report does, spelling for spelling", (t) => {
  // The frozen renderer keeps its own copy of the match, so the two copies are held the same here, as written.
  const copy = (p) => {
    const src = readFileSync(join(DRIVER, ...p), "utf8");
    const at = src.indexOf("const isUseCheckNoResult = ");
    assert.ok(at >= 0, `${p.join("/")} has no no-result match`);
    const value = src.match(/const USE_CHECK_NO_RESULT = (['"])(.*?)\1;/)?.[2];
    return { value, match: src.slice(at, src.indexOf("};", at)).replace(/'/g, '"') };
  };
  assert.deepEqual(copy(["findings-model.mjs"]), copy(["publish", "render.mjs"]));
  assert.equal(copy(["findings-model.mjs"]).value, NO_RESULT);
  // A no-result spelled with a hyphen is the same value, and is refused the same way.
  const d = run(t);
  const hyphen = { ...noResult(DOC.findings[0]), use_check: { source: "perplexity_research - no  result" } };
  assert.match(save(d, [hyphen]).save_refused?.[0]?.reason ?? "", /^synthesis_save_no_result_without_a_completed_search:0 /);
});

test("the quick search: an unreadable reply is a lookup that did not answer, and its card says so", async () => {
  const owners = [{ mark: "QZORVEL", owner: "Sample Trading", recordIds: ["/mark/eu/1"], classes: [28] }];
  const unreadable = "ERROR: Perplexity returned a response but no text content could be extracted. Status: completed";
  const [row] = await runOwnerChecks({ owners, exec: async () => ({ ok: true, text: unreadable }), runDir: null });
  assert.deepEqual([row.ok, row.source], [false, null], "an unreadable reply was recorded as an answer");
  assert.deepEqual(KO.ownerCheckOutcome(row), { kind: "unavailable" });
  assert.equal(KO.ownerCheckText(KO.ownerCheckOutcome(row)), "Use check unavailable.");
  const [linkless] = await runOwnerChecks({ owners, exec: async () => ({ ok: true, text: "The owner sells wooden toys." }), runDir: null });
  assert.equal(KO.ownerCheckText(KO.ownerCheckOutcome(linkless)), "link unavailable.", "a completed answer with no link read as a search that found nothing");
});
