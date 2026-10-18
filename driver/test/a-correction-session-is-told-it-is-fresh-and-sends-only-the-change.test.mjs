// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CORRECTION OR A REPAIR IS A FRESH SESSION, AND ITS WORDS SAY SO.
//
// Every follow-up to the writer and the reviewer is attempt 1 of a new stage call, so it opens a new
// session on both engines; only a warm retry resumes the session it retries. The messages on this path
// used to open "You are RESUMING your own … session — your narrative and all inputs are already in your
// context", which a fresh session cannot honour: it has no draft in mind and goes looking for nothing.
// They now say the session is fresh and point at the files that hold the earlier work.
//
// THE SAVE THEY ORDER IS THE SAVE THE TOOL TAKES. The correction told the writer to put the corrections
// marker and the corrected coverage, action and mark-assessment lines at the top level of the call, where
// the save tool's own description does not put them, and the delivery-check repair ordered the whole record
// again although the writer's save merges a patch into the record it holds. Both now ask for only the
// change, in the shape the tool describes, and neither promises that untouched bytes survive later
// validation, folding or a driver repair: the save keeps the values a patch does not replace, and that is
// all it promises.
//
// The texts below are the approved wording, pinned whole. A change to any of them is a change to what the
// model reads and needs the same approval again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { REPAIR_COMPOSERS } from "../repair-composers.mjs";
import { composeFollowup } from "../stages.mjs";
import { correctionHint, heldSynthesisRecord } from "../gateway.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const composer = (key) => {
  const c = REPAIR_COMPOSERS.find((x) => x.key === key);
  assert.ok(c, `${key} is not registered`);
  return c;
};
const linesOf = (text) => String(text).split("\n");

const FRESH_SYNTHESIS = "This is a fresh session: your earlier synthesis is not in your context";

const V1 = "This is a fresh session: your earlier synthesis is not in your context, and you do NOT redo it from scratch. The driver holds the record it last accepted from you; your earlier work is in narrative.md and findings.json — open them for the parts each flag names — and your inputs are listed below. The independent refutation flagged the corrections below. Apply them (minimum-change per flag — correct the statement to what the evidence supports, demote the tier, remove the sentence, or verify-flag for re-check) to BOTH deliverables. A caveat, hedge, qualifier or disclaimer is NEVER a repair: an unsupported statement is corrected or it is removed, never softened.";
const V3 = "2. mirror every correction into the finding objects the flags name (owner names, levels/composites, meters). A finding the review KILLS is not deleted: keep its object, set \"disposition\": \"withdrawn\" and add \"withdrawn_reason\": \"<the review flag that killed it>\". Add a \"corrections\": {\"applied\": true, \"note\": \"<one line per flagged entity: corrected / withdrawn / no-change-because-…>\"} marker inside the call's `findings` object.";
const V4 = "3. A flag about a line the reader sees that is NOT a finding — a coverage row's \"note\", an action's \"text\", or the mark assessment's \"distinctiveness\" or \"connotation\" — is applied in the same PATCH, inside the call's `findings` object beside the \"corrections\" marker: send the complete `coverage` array (every row, the unflagged ones exactly as you last sent them), the complete `actions` array, or the complete `mark_assessment` object, with the flagged line rewritten. A row left out of the array is a row deleted, so send every row. Rewording a coverage note is NOT reopening the coverage account: keep its area, its state and every fact it states, and change only how it says them. A flagged line you leave as written is named in the \"corrections\" note with the reason, as the flag names it — for example: the coverage line for \"<area>\": no-change-because …";
const V5 = "Send it all in ONE `record_synthesis` PATCH call, sending only the change: `narrative` carrying only the sections you corrected; `findings_patch` carrying the complete corrected finding object(s), each with the `ordinal` it replaces; and `findings` carrying the \"corrections\" marker and any register from step 3, complete, and never a `findings[]` list. The driver merges this patch into the last accepted record, keeps the values the patch does not replace, and renders both files. There is no file to write or edit and nothing you write by hand is read.";
const V6 = "This is a fresh session: your earlier synthesis is not in your context, and the driver holds the record it last accepted from you. Your corrective pass updated the narrative but did NOT re-emit findings.json — the structured findings the client report renders from. The review named: #1, #4. Its flags are in senior-eye-review.md; open it and findings.json for the findings it names.";
const V7 = "Apply each flag to the finding objects it names: correct the fields, or set \"disposition\": \"withdrawn\" + \"withdrawn_reason\" for a killed finding, and add the \"corrections\": {\"applied\": true, \"note\": \"…\"} marker inside the call's `findings` object. Change nothing else.";
const V8 = "Send the correction with `record_synthesis`, sending only the change: a PATCH call carrying `findings_patch` — the complete corrected finding object(s), each with the `ordinal` it replaces — and `findings` carrying only the \"corrections\" marker, never a `findings[]` list; nothing else. The driver merges this patch into the last accepted record, keeps the values the patch does not replace, and renders both files. There is no file for you to write or edit and nothing you write by hand is read.";
const V9 = "A TARGETED CORRECTION, and the shape the repair prompts ask for. Send the complete corrected finding object(s), each carrying the `ordinal` of the finding it replaces, and send NOTHING else — no `findings[]` list, no `narrative` unless you also corrected a section, and a `findings` object only to carry the registers you changed or the \"corrections\" marker. The driver merges this patch into the last accepted record, keeps the values the patch does not replace, and renders both files. It cannot remove a finding: an ordinal names one to replace, and there is no way to express a deletion. Sending a `findings` document that carries its `findings[]` list instead REPLACES the record, which is how fifteen findings were lost once — if you mean to correct four findings, send four rows here, not a document containing four.";
const V12 = "The findings document — schema_version, rated_under_framework, findings[], coverage[], ask_answers[] and the other top-level registers. On a first call, send it whole. To correct part of the record, send no `findings[]` list (a finding is corrected through `findings_patch`) and only the registers you changed, each complete, with the \"corrections\" marker when the repair asks for it: every register you do not send is held. A `findings` object that carries a `findings[]` list replaces the whole record; so does one that changes `schema_version` or `rated_under_framework`, which must then carry its list. Already typed values; it arrives here instead of being written as a file so the joins below can run, and it is validated through the shipped parser, which names its own defect tokens.";
const V12_SECOND_TEXT_OPENS = " TWO OF ITS FIELDS ALSO RENDER INTO THE NARRATIVE, which is why they are here and not on `narrative`:";
const V18 = "This is a fresh session: your earlier refutation is not in your context, and you do NOT redo it from scratch. Your prior verdict and its flags are in senior-eye-review.md — open it first — and the source files you refuted against are listed below.";
const V19_OPEN_TOOL = (label, file, tool) => `This is a fresh session: your earlier ${label} work is not in your context — the driver wrote ${file} from your \`${tool}\` call, and the deterministic pre-delivery lint failed these checks on it:`;
// The writer's form names both files its call wrote, and the content its faults were found in (design's answer on the
// writer route, 2026-10-18).
const V19_OPEN_WRITER = (findings, narrative) => `This is a fresh session: your earlier synthesis work is not in your context. The driver wrote ${findings} and ${narrative} from your \`record_synthesis\` call. The deterministic pre-delivery checks found these faults in content rendered from that record:`;
const V19_READ_WRITER = (findings, narrative) => `Read ${findings} and ${narrative}, then correct the finding or narrative section that owns each fault.`;
const V19_OPEN_HAND = (label, file) => `This is a fresh session: your earlier ${label} work is not in your context — ${file} is already written and the deterministic pre-delivery lint failed these checks on it:`;
const V19_SAVE_WRITER = "Apply the fix in ONE `record_synthesis` PATCH call, sending only the change: `narrative` carrying only the sections you corrected; `findings_patch` carrying the complete corrected finding object(s), each with the `ordinal` it replaces; and `findings` carrying any register you corrected, complete, and never a `findings[]` list. The driver merges this patch into the last accepted record, keeps the values the patch does not replace, and renders both files. You hold no Write or Edit tool for it and nothing you write by hand is read.";
const V19_SAVE_OTHER = (tool) => `Apply the fix by calling \`${tool}\` AGAIN with the corrected values — the COMPLETE payload, not a patch, because the driver re-renders the whole artifact from what you send. You hold no Write or Edit tool for it and nothing you write by hand is read.`;
const V20 = "This is a fresh session: your earlier synthesis is not in your context. The findings file you emitted (findings.json) ";
const V21 = "Add ONE top-level \"actions\": [...] key that registers every forward step your own narrative (narrative.md) names (\"actions\": [] ONLY if the opinion genuinely demands nothing beyond ordinary filing). Same findings, same judgments — the findings themselves do not change.";
const V22 = "This is a fresh session: your earlier synthesis is not in your context, and you do NOT redo the analysis.";
const V23 = (paths) => `YOUR DECLARED INPUTS, on disk — this dispatch is a fresh session and does not carry them, so open the ones the instruction above turns on (and only those): ${paths.join(", ")}.`;
const TODAYS_INPUTS_LINE = (paths) => `YOUR DECLARED INPUTS, unchanged and on disk — this dispatch is a fresh session and does not carry them, so open the ones the instruction above turns on (and only those): ${paths.join(", ")}.`;

test("the writer's correction opens fresh, names its earlier work, and saves only the change in the tool's shape", () => {
  const c = composer("synthesis:corrective");
  for (const s of c.samples) {
    const out = linesOf(c.compose(s.args));
    assert.equal(out[0], V1, `${s.name}: the opening line`);
    assert.ok(out.includes(V3), `${s.name}: step 2 puts the corrections marker inside the call's findings object`);
    assert.ok(out.includes(V4), `${s.name}: step 3 puts the corrected lines inside the call's findings object`);
    assert.ok(out.includes(V5), `${s.name}: the save line`);
  }
});

test("the follow-up when a correction missed the findings is fresh, points at the flags, and keeps the marker", () => {
  const c = composer("synthesis:corrective-findings");
  for (const s of c.samples) {
    const out = linesOf(c.compose(s.args));
    assert.deepEqual(out.slice(0, 3), [V6, V7, V8], s.name);
  }
});

test("the reviewer's re-check opens fresh and points at its own verdict file", () => {
  const c = composer("narrative-refutation:verdict-recheck");
  for (const s of c.samples) assert.equal(linesOf(c.compose(s.args))[0], V18, s.name);
});

test("the delivery-check repair opens fresh; the writer saves a patch, every other tool its whole payload", () => {
  const c = composer("*:lint-repair");
  const failures = [{ id: "x", detail: "a check the lint named" }];
  const writer = linesOf(c.compose({ label: "synthesis", file: "narrative.md", toolWritten: { tool: "record_synthesis" }, findings: "findings.json", narrative: "narrative.md",
    failures: [...failures, { id: "y", finding: 2, detail: "a fault in a sentence composed from finding 2" }] }));
  assert.equal(writer[0], V19_OPEN_WRITER("findings.json", "narrative.md"));
  assert.deepEqual(writer.slice(1, 4), ["- a check the lint named", "- finding 2: a fault in a sentence composed from finding 2", V19_READ_WRITER("findings.json", "narrative.md")],
    "the faults, each in a line composed from the record named by its finding, then the order to read both files");
  assert.equal(writer.at(-1), V19_SAVE_WRITER, "the writer's save takes only the change");
  assert.ok(!writer.some((l) => l.includes("COMPLETE payload")), "and is never ordered to re-send the whole record");

  const overview = linesOf(c.compose({ label: "report-overview", file: "report-overview.md", toolWritten: { tool: "record_report_overview" }, failures }));
  assert.equal(overview[0], V19_OPEN_TOOL("report-overview", "report-overview.md", "record_report_overview"));
  assert.equal(overview.at(-1), V19_SAVE_OTHER("record_report_overview"), "the overview keeps its own save line");

  const hand = linesOf(c.compose({ label: "case-law", file: "case-law-findings.md", toolWritten: null, failures }));
  assert.equal(hand[0], V19_OPEN_HAND("case-law", "case-law-findings.md"));

  // THE NEW BRANCH HAS ITS OWN SAMPLE, or the census walks two of its three save lines.
  assert.ok(c.samples.some((s) => s.args.toolWritten?.tool === "record_synthesis"),
    "no sample of *:lint-repair takes the writer's branch");
});

test("the old-format and missing-actions repairs open fresh, and the latter says where the narrative is", () => {
  const down = composer("synthesis:schema-downlevel");
  for (const s of down.samples) assert.ok(linesOf(down.compose(s.args))[0].startsWith(V20), s.name);
  const act = composer("synthesis:actions-missing");
  for (const s of act.samples) {
    const out = linesOf(act.compose(s.args));
    assert.ok(out[0].startsWith(V20), s.name);
    assert.equal(out[1], V21, s.name);
  }
});

test("the three re-sends open fresh", () => {
  for (const key of ["synthesis:finding-reemit", "synthesis:action-reemit", "synthesis:ask-answer-reemit"]) {
    const c = composer(key);
    for (const s of c.samples) assert.equal(linesOf(c.compose(s.args))[0], V22, `${key} / ${s.name}`);
  }
});

test("the finding re-send and the missing-actions repair promise only what the save keeps", () => {
  // Design's correction to the packet (2026-10-18): each sentence that promised more than the merge keeps
  // ("comes back byte-identical", "nothing else moves") is replaced by the approved merge sentence.
  const MERGE = "The driver merges this patch into the last accepted record, keeps the values the patch does not replace, and renders both files.";
  for (const key of ["synthesis:finding-reemit", "synthesis:actions-missing"]) {
    const c = composer(key);
    for (const s of c.samples) {
      const text = c.compose(s.args);
      assert.ok(text.includes(MERGE), `${key} / ${s.name}: the approved merge sentence is missing`);
      assert.doesNotMatch(text, /comes back byte-identical|so nothing else moves/, `${key} / ${s.name}`);
    }
  }
});

test("the writer's retry after a failed check sends only the change while the driver holds its record, and the whole record otherwise", () => {
  const PATCH = "Fix exactly that in ONE `record_synthesis` PATCH call, sending only the change: `findings_patch` carrying the complete corrected finding object(s), each with the `ordinal` it replaces, and `findings` carrying any register you corrected, complete, and never a `findings[]` list; leave the narrative prose unchanged";
  const WHOLE = "Fix exactly that, re-save the COMPLETE findings.json, and leave the narrative prose unchanged";
  const tok = "finding_meter_unknown:1";
  assert.ok(correctionHint(tok, { heldRecord: true }).includes(PATCH), "a held record takes the patch");
  assert.ok(correctionHint(tok).includes(WHOLE) && !correctionHint(tok).includes(PATCH), "no held record takes the whole save");
  assert.ok(correctionHint("finding_legacy_scale_forbidden:composite", { heldRecord: true }).includes(WHOLE), "a version being replaced takes the whole save");
  assert.ok(!correctionHint("coverage_status_offenum (axis primary-sweep)", { heldRecord: true }).includes("record_synthesis"), "another stage's hint is unchanged");
  // The run's own files decide: an accepted save is the record the driver holds.
  const dir = mkdtempSync(join(tmpdir(), "held-record-"));
  try {
    const findings = join(dir, "findings.json");
    assert.equal(heldSynthesisRecord([join(dir, "narrative.md"), findings]), false);
    mkdirSync(join(dir, "_driver", "synthesis-calls"), { recursive: true });
    writeFileSync(join(dir, "_driver", "synthesis-calls", "accepted.json"), "{}\n");
    assert.equal(heldSynthesisRecord([join(dir, "narrative.md"), findings]), true);
    assert.equal(heldSynthesisRecord([join(dir, "register-findings.md")]), false, "files of another stage hold no writer's record");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("no message on the writer's and the reviewer's path tells a fresh session it is resuming", () => {
  const onPath = REPAIR_COMPOSERS.filter((c) => c.stage === "synthesis" || c.stage === "narrative-refutation" || c.key === "*:lint-repair");
  assert.ok(onPath.length >= 9, `only ${onPath.length} composers found on the path — the selector has gone quiet`);
  const resuming = [];
  for (const c of onPath) {
    for (const s of c.samples) {
      if (/\bRESUMING\b/.test(c.compose(s.args))) resuming.push(`${c.key} / ${s.name}`);
    }
  }
  assert.deepEqual(resuming, [], "these compose a resume claim");
  for (const key of ["synthesis:corrective", "synthesis:schema-downlevel", "synthesis:actions-missing", "synthesis:finding-reemit"]) {
    const c = composer(key);
    assert.ok(c.compose(c.samples[0].args).startsWith(FRESH_SYNTHESIS), `${key} opens fresh`);
  }
});

test("no follow-up calls its inputs unchanged: the writer's and the reviewer's, and every other stage's", () => {
  // V23 on the writing path; its extension to every other follow-up (packet row D10, 2026-10-18) makes the line one
  // text again.
  const ctx = { paths: {}, framework: null };
  const paths = ["register-findings.md", "placements.md"];
  for (const stage of ["synthesis", "narrative-refutation", "common-law", "register-digest"]) {
    const out = linesOf(composeFollowup(stage, ctx, { followup: "the instruction", inputs: paths }));
    assert.equal(out.at(-1), V23(paths), stage);
    assert.notEqual(out.at(-1), TODAYS_INPUTS_LINE(paths), `${stage}: the old line, which called the inputs unchanged`);
  }
});

// ── THE SAVE TOOL'S FORM, AS THE MODEL RECEIVES IT ───────────────────────────────────────────────────

function servedTools() {
  const script = join(DRIVER, "engine", "mcp", "recording-server.mjs");
  return new Promise((resolve, reject) => {
    const p = spawn("node", [script], { stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: join(DRIVER, "..", ".no-such-run") } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("recording-server.mjs did not answer tools/list — could not look")); }, 20000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return resolve(m.result?.tools ?? []);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fresh-session-words", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

test("the save tool describes the patch it merges, accepts a correction without the spine and the verdict, and says what a findings object without a list does", async () => {
  const tool = (await servedTools()).find((t) => t.name === "record_synthesis");
  assert.ok(tool, "record_synthesis was not served — that is a finding, not a pass");
  const props = tool.inputSchema?.properties ?? {};
  assert.equal(props.findings_patch?.description, V9);
  assert.equal(props.narrative?.required, undefined,
    "the form refused a correction that left out the spine or the verdict before the save code saw it");
  assert.ok(props.narrative?.properties?.spine && props.narrative?.properties?.verdict, "both sections are still declared");
  assert.ok(String(props.findings?.description).startsWith(V12 + V12_SECOND_TEXT_OPENS),
    "the findings document's first text, followed by its unchanged second text");
});
