// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT READS AND RATES A FAMILY AT A TIME. The intake groups the submitted names into families, and code checks the grouping.
// One reader and one rating per family, side by side, a name with no family alone. A family's filings are held once by record ID
// where that expands back exactly. A filing held under one name reaches every other name it resembles in a class that name asks
// for. An owner is asked one question per filing mark, an identical question once. Each Claude stage starts with only the built-in
// tools it uses, and the review reads the carried filings as a table. Names here are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KO_STAGES, koPaths, filingsOnce, expandFilingsOnce, sameRecord } from "../stages-knockout.mjs";
import { familiesDefect } from "../knockout-frame-record.mjs";
import { knockoutReaderFiles } from "../pipeline-knockout.mjs";
import { earlierRights, earlierRightsLines, earlierRightsOutcome, earlierRightsReviewLines } from "../ko-earlier-rights.mjs";
import { composeOwnerQuery, ownersOwedACheck, runOwnerChecks } from "../owner-use-check.mjs";
import { builtinToolsFor } from "../engine/mcp/gather-config.mjs";
import { buildClaudeArgs } from "../engine/anthropic-agent.mjs";
import { registerTable } from "../ko-register-tables.mjs";

const marks = (...names) => names.map((name) => ({ name }));
const fresh = (tag) => mkdtempSync(join(tmpdir(), `ko-family-${tag}-`));
const FRAMEWORK = { bands: [{ label: "High" }, { label: "Low" }] };

// ── THE INTAKE'S FAMILIES ────────────────────────────────────────────────────────────────────────────────

test("the intake's grouping is checked in code: every submitted name in exactly one family, and only submitted names", () => {
  const order = marks("QUILLBRAE", "QUILBRAY", "MOSSVALE");
  assert.equal(familiesDefect(order, [["QUILLBRAE", "quilbray"], ["MOSSVALE"]]), null, "names match whatever their case");
  assert.match(familiesDefect(order, [["QUILLBRAE", "QUILBRAY"]]), /leaves out: "MOSSVALE"/);
  assert.match(familiesDefect(order, [["QUILLBRAE", "QUILBRAY"], ["QUILBRAY", "MOSSVALE"]]), /places a name in more than one family: "QUILBRAY"/);
  assert.match(familiesDefect(order, [["QUILLBRAE", "QUILBRAY"], ["MOSSVALE", "QUILLBRAE GOLD"]]), /names no instructed name: "QUILLBRAE GOLD"/);
  assert.match(familiesDefect(order, [["QUILLBRAE"], []]), /each a non-empty list/);
  assert.match(familiesDefect(order, [["QUILLBRAE"]]), /Put each submitted name verbatim in exactly one group in batch\.families\.$/, "the refusal says what to send");
});

test("the intake is told to group the names, in the approved words, and runs on the fast tier", () => {
  const K = koPaths(fresh("frame"));
  const message = KO_STAGES["knockout-frame"].message({ K, job: {}, profile: null });
  assert.ok(message.includes("Group the submitted names for the same proposed use when they share a recognisable word, phrase, stem, look or sound that could lead to the same earlier conflict."));
  assert.ok(message.includes("Put each submitted name verbatim in exactly one group in batch.families. Keep spellings generated only for searching outside the groups."));
  assert.deepEqual([KO_STAGES["knockout-frame"].model, KO_STAGES["knockout-frame"].thinking], ["haiku", "low"]);
  assert.deepEqual([KO_STAGES["knockout-register-read"].model, KO_STAGES["knockout-register-read"].thinking], ["sonnet", "medium"]);
  for (const stage of ["knockout-assess", "knockout-review", "knockout-correct"])
    assert.deepEqual([KO_STAGES[stage].model, KO_STAGES[stage].thinking], ["opus", "high"], `${stage} keeps the judgment tier`);
});

// ── ONE READER PER FAMILY ───────────────────────────────────────────────────────────────────────────────

test("a family's reader is told it reads a family, and is handed only its family's rows of the plan and the scope", () => {
  const dir = fresh("reader");
  mkdirSync(join(dir, "_driver"), { recursive: true });
  const plan = { schema: 1, batch: { productContext: "candles", executionOrder: ["QUILLBRAE", "MOSSVALE", "QUILBRAY"] },
    marks: [{ name: "QUILLBRAE", classes: [4], priority: 1 }, { name: "MOSSVALE", classes: [4], priority: 2 }, { name: "QUILBRAY", classes: [4], priority: 3 }] };
  const scope = { marks: ["QUILLBRAE", "MOSSVALE", "QUILBRAY"] };
  const family = knockoutReaderFiles(dir, plan, scope, "QUILLBRAE", { family: ["QUILLBRAE", "QUILBRAY"], tag: 0 });
  const familyPlan = JSON.parse(readFileSync(family.planFile, "utf8"));
  assert.deepEqual(familyPlan.marks.map((m) => m.name), ["QUILLBRAE", "QUILBRAY"]);
  assert.ok(familyPlan.marks.every((m) => !("priority" in m)) && !("executionOrder" in familyPlan.batch), "nothing that ranks a name among others");
  assert.deepEqual(JSON.parse(readFileSync(family.scopeFile, "utf8")).marks, ["QUILLBRAE", "QUILBRAY"]);
  const alone = knockoutReaderFiles(dir, plan, scope, "MOSSVALE");
  assert.deepEqual(JSON.parse(readFileSync(alone.planFile, "utf8")).marks.map((m) => m.name), ["MOSSVALE"]);

  const K = koPaths(dir);
  const read = (familySize) => KO_STAGES["knockout-register-read"].message({ K, job: {}, planFile: "/run/plan.family.json", familySize });
  assert.match(read(2), /^You are reading the register for a family of 2 names of a KNOCKOUT screen: close variations the client chose for one proposed use\. Read each distinct filing once, and keep for each name its own source, goods, status, relevance and follow-up questions\./m);
  assert.match(read(2), /^The plan for these names, with what it is for: \/run\/plan\.family\.json$/m);
  assert.match(read(1), /^You are reading the register for one name of a KNOCKOUT screen\. You rate nothing;/m);
  assert.match(read(1), /^The plan for this name, with what it is for: \/run\/plan\.family\.json$/m);
  assert.equal(KO_STAGES["knockout-register-read"].out(K, 2), join(dir, "knockout-register-2.json"), "a family's reader writes its own record");
  assert.equal(KO_STAGES["knockout-register-read"].out(K), K.registerReading);
});

// ── A FAMILY'S FILINGS, HELD ONCE ───────────────────────────────────────────────────────────────────────

test("a family's filings are held once by record ID, each name keeps its own links, and the file expands back exactly", () => {
  const filing = { recordId: "tm_1", mark: "QUILLBRAE", owner: "Brightmoor Candle Co", status: "Registered", classes: [4], goods: ["4: candles"] };
  const doc = { schema: 2, marks: [
    { name: "QUILLBRAE", records: [{ ...filing, why: "the same mark", question: "q1" }], setAsideRecords: [] },
    { name: "QUILBRAY", records: [{ ...filing, why: "one letter apart", question: "q2" }], setAsideRecords: [{ recordId: "tm_2", mark: "QUILBRAY", owner: "Other", why: "lapsed" }] },
  ] };
  const once = filingsOnce(doc);
  assert.equal(once.form, "filings-once");
  assert.deepEqual(Object.keys(once.filings).sort(), ["tm_1", "tm_2"], "each filing once");
  assert.equal(once.filings.tm_1.owner, "Brightmoor Candle Co");
  assert.deepEqual(once.marks[1].records[0], { recordId: "tm_1", why: "one letter apart", question: "q2" }, "a link carries what differs for its name");
  assert.ok(sameRecord(expandFilingsOnce(once), doc), "the compact file gives back every name's record");
  const changed = structuredClone(once);
  changed.marks[0].records[0].why = "a reason no reader gave";
  assert.ok(!sameRecord(expandFilingsOnce(changed), doc), "a changed per-name reason is caught");

  const K = koPaths(fresh("once"));
  mkdirSync(join(K.runDir, "_driver"), { recursive: true });
  writeFileSync(K.registerRecords, "{}");
  const message = (registerRecordsForm) => KO_STAGES["knockout-assess"].message({ K, job: {}, chunkNo: 0, chunkMarks: marks("QUILLBRAE", "QUILBRAY"), chunkTotal: 1,
    framework: FRAMEWORK, frameworkPath: null, probeNote: "", registerRecordsFile: "/run/family.json", registerRecordsForm });
  const SENTENCE = "In this file each filing is held once, under `filings` by its recordId, with its whole record.";
  assert.ok(message("filings-once").includes(SENTENCE));
  assert.ok(!message(null).includes(SENTENCE), "a per-name file is not described as held once");
});

// ── A FILING HELD UNDER ONE NAME REACHES THE OTHERS ─────────────────────────────────────────────────────

function orderWithAFilingUnderTheSibling() {
  const dir = fresh("rights");
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(join(dir, "knockout-plan.json"), JSON.stringify({ schema: 1, batch: {}, marks: [
    { name: "QUILLBRAE", classes: [4], spellings: ["QUILLBRAE"] }, { name: "MOSSVALE", classes: [4], spellings: ["MOSSVALE"] }] }));
  writeFileSync(join(dir, "_driver", "register-records.json"), JSON.stringify({ schema: 2, marks: [
    { name: "QUILLBRAE", records: [] },
    { name: "MOSSVALE", records: [{ recordId: "tm_9", mark: "QUILLBRAE", owner: "Brightmoor Candle Co", status: "Registered", classes: [4], territory: "EU" }] },
  ] }));
  return dir;
}

test("a filing the reading carried under one name reaches another it resembles in a class it asks for, and says where it was found", () => {
  const doc = earlierRights(orderWithAFilingUnderTheSibling());
  const quill = doc.names.find((n) => n.name === "QUILLBRAE");
  assert.deepEqual(quill.rights.map((r) => [r.recordId, r.heldUnder]), [["tm_9", ["MOSSVALE"]]]);
  assert.deepEqual(doc.names.find((n) => n.name === "MOSSVALE").rights, [], "a name is not handed its own filing");
  const alone = earlierRightsLines(doc, ["QUILLBRAE"]);
  assert.equal(alone.length >= 1 && alone[0].startsWith('- Filing recordId "tm_9"'), true, alone.join("\n"));
  assert.ok(!alone.join("\n").includes("MOSSVALE"), "a rating's lines name no other name of the order");
  assert.ok(earlierRightsLines(doc, ["QUILLBRAE", "MOSSVALE"])[0].startsWith('- For "QUILLBRAE": Filing recordId "tm_9"'), "a family's lines say which name each is for");
});

test("the review is shown what each rating did with a filing it was handed, and an unresolved one says so", () => {
  const doc = earlierRights(orderWithAFilingUnderTheSibling());
  const weighed = earlierRightsOutcome(doc, { marks: [{ name: "QUILLBRAE", findings: [{ name: "QUILLBRAE", band: "High", weighedFilings: ["tm_9"] }] }] });
  assert.deepEqual(weighed.map((o) => [o.name, o.recordId, o.state]), [["QUILLBRAE", "tm_9", "weighed"]]);
  const open = earlierRightsReviewLines(earlierRightsOutcome(doc, { marks: [{ name: "QUILLBRAE", findings: [] }] }));
  assert.match(open[0], /^- "QUILLBRAE": recordId "tm_9" .*found under "MOSSVALE": UNRESOLVED/);
});

// ── OWNER CHECKS ────────────────────────────────────────────────────────────────────────────────────────

test("an owner is asked about its own filing marks, each with its classes, and an identical question is asked once", async () => {
  const filing = (recordId, mark, classes) => ({ recordId, mark, owner: "Brightmoor Candle Co", classes, status: "Registered" });
  const records = { marks: [
    { name: "QUILLBRAE", classes: [4], reading: { ownerChecks: ["tm_1", "tm_2"] }, records: [filing("tm_1", "BRIGHTMOOR", [4]), filing("tm_2", "BRIGHT MOOR", [4, 35])] },
    { name: "QUILBRAY", classes: [4], reading: { ownerChecks: ["tm_1", "tm_2"] }, records: [filing("tm_1", "BRIGHTMOOR", [4]), filing("tm_2", "BRIGHT MOOR", [4, 35])] },
  ] };
  const owed = ownersOwedACheck(records);
  assert.equal(owed.length, 2, "one row per name and owner");
  assert.deepEqual(owed[0].filingMarks, [{ mark: "BRIGHT MOOR", classes: [4, 35] }, { mark: "BRIGHTMOOR", classes: [4] }]);
  const query = composeOwnerQuery(owed[0]);
  assert.equal(query, 'What goods or services does the company "Brightmoor Candle Co" actually sell or trade in? The trademark record names this company for "BRIGHT MOOR" in classes 4, 35 and for "BRIGHTMOOR" in class 4. Report what the business does today, with sources. If nothing can be established about this company, say so plainly.');
  assert.ok(!query.includes("QUILLBRAE"), "the question never names the name screened");
  const asked = [];
  const rows = await runOwnerChecks({ owners: owed, runDir: fresh("owners"), exec: async (q) => { asked.push(q); return { ok: true, text: "Brightmoor sells candles. https://example.test/brightmoor" }; } });
  assert.equal(asked.length, 1, "the identical question was asked twice");
  assert.equal(rows.length, 2, "both names hold the answer");
});

test("a rating names an owner with the filing marks it holds, and a family reads an identical question's answer once", () => {
  const dir = fresh("owner-line");
  const K = koPaths(dir);
  mkdirSync(join(dir, "_driver"), { recursive: true });
  const check = (mark) => ({ mark, owner: "Brightmoor Candle Co", query: "the same question", ok: false, filingMarks: [{ mark: "BRIGHTMOOR", classes: [4] }, { mark: "BRIGHT MOOR", classes: [4] }] });
  writeFileSync(K.ownerChecks, JSON.stringify({ checks: [check("QUILLBRAE"), check("QUILBRAY")] }));
  const family = KO_STAGES["knockout-assess"].message({ K, job: {}, chunkNo: 0, chunkMarks: marks("QUILLBRAE", "QUILBRAY"), chunkTotal: 1, framework: FRAMEWORK, frameworkPath: null, probeNote: "" });
  const lines = family.split("\n").filter((l) => l.includes('Brightmoor Candle Co (proprietor of the filings for "BRIGHTMOOR" and "BRIGHT MOOR")'));
  assert.equal(lines.length, 1, `the family reads the shared answer once: ${lines.length}`);
  const alone = KO_STAGES["knockout-assess"].message({ K, job: {}, chunkNo: 0, chunkMarks: marks("MOSSVALE"), chunkTotal: 1, framework: FRAMEWORK, frameworkPath: null, probeNote: "" });
  assert.ok(!alone.includes("Brightmoor Candle Co"), "a name reads only the checks made for its own filings");
});

// ── THE TOOLS A CLAUDE STAGE STARTS WITH ────────────────────────────────────────────────────────────────

test("a reader starts with file read and tool search alone, and the rating, review and correction with read and search", () => {
  assert.deepEqual(builtinToolsFor("knockout-register-read"), ["Read", "ToolSearch"]);
  for (const stage of ["knockout-assess", "knockout-assess#3", "knockout-review", "knockout-correct#0"])
    assert.deepEqual(builtinToolsFor(stage), ["Read", "Grep", "Glob", "ToolSearch"], stage);
  assert.equal(builtinToolsFor("knockout-frame"), null, "a stage not named keeps the engine's own set");
  const argv = (builtinTools) => buildClaudeArgs({ message: "m", model: "opus", thinking: "high", builtinTools, cwd: fresh("argv") }).args;
  const named = argv(["Read", "ToolSearch"]);
  assert.equal(named[named.indexOf("--tools") + 1], "Read,ToolSearch");
  assert.ok(!argv(null).includes("--tools"), "no list, no flag");
});

// ── THE REVIEW'S TABLE ──────────────────────────────────────────────────────────────────────────────────

test("the review's table holds each name's carried filings by record ID with its goods in that name's classes, and what was set aside and why", () => {
  const doc = { marks: [{ name: "QUILLBRAE",
    records: [{ recordId: "tm_1", question: "ko-quillbrae:identical", mark: "QUILLBRAE", owner: "Brightmoor | Candle Co", status: "Registered", territory: "EU", classes: [4, 35],
      goods: ["4: candles", `35: ${"retail ".repeat(60)}`] }],
    setAsideRecords: [{ recordId: "tm_2", mark: "QUILBRAY", owner: "Other", status: "Expired", setAsideBecause: "lapsed" }] }] };
  const table = registerTable(doc, { marks: [{ name: "QUILLBRAE", classes: [4] }] });
  assert.equal(table.columns, "record_id | qid | mark | owner | status | office | classes | goods in this name's classes");
  assert.deepEqual(table.names[0].carried, ["tm_1 | ko-quillbrae:identical | QUILLBRAE | Brightmoor Candle Co | Registered | EU | 4,35 | 4: candles"]);
  assert.deepEqual(table.names[0].setAside, ["tm_2 | QUILBRAY | Other | Expired | lapsed"]);
  const everyClass = registerTable(doc, null).names[0].carried[0];
  assert.ok(everyClass.endsWith("…"), "with no plan to say, every class shows, each cut at its limit");
});
