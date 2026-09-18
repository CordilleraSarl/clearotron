// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The workbook a run gets when its common-law sweep never reaches the search log.
//
// WHAT HAPPENED. A Chinese-lane clearance ordered its audit .xlsx, delivered, and no workbook existed
// anywhere. buildAudit threw before writeFile and the caller's last-resort catch swallowed the message,
// so the only trace was an absence. Two separate defects sat behind it and this file holds both:
//
//   THE CRASH. Every one of that run's register search terms was a script/meaning variant carrying no
//   class token, so the Scope column was empty on all 17 rows and addSheet dropped it as dead schema.
//   The "What was searched" styler then read row.getCell('Scope') — and exceljs resolves an unknown KEY
//   as a column LETTER, so a five-letter name asks for a column past 16384 and throws. The old comment
//   in xlsx.mjs asserted that the styled columns were "always populated"; they are not, and Link is the
//   same shape and still reachable, so that case is asserted here too.
//
//   THE COVERAGE CLAIM, which matters more. That run's common-law negatives reached audit.md carrying
//   only a source layer and a result — no search term, no platform — so searchRows discarded all of
//   them and the sheet held register rows only. Fixing the crash alone would have shipped a workbook
//   whose "What was searched" tab reads as a complete register-only search, next to a "Coverage & gaps"
//   tab rating common-law areas Clean and a Summary saying register AND common-law were searched. One
//   tab certifying coverage the other shows no search for is worse than no workbook. So the sheet
//   STATES the gap, and the build gate still reports it — a sheet that says so is not a gap closed.
//
// The fixture is the SHAPE of that run's own artifacts: register terms with no class token, common-law
// negative blocks with nothing but a layer and a result, one territory, and a coverage array whose
// common-law areas are confirmed-clean. Prose is trimmed and third-party names are dropped; the shape
// is what carries the defect and the shape is what is copied.
import test from "node:test";
import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { buildAudit, validateAudit } from "../publish/xlsx.mjs";
import { mintSupplementalQid } from "../register-plan.mjs";

const out = (tag) => join(tmpdir(), `audit-cl-unlogged-${tag}-${process.pid}.xlsx`);
const JX = out("jx"), LOGGED = out("logged"), REGONLY = out("regonly"), LINKLESS = out("linkless");

const cellText = (row, i) => { const v = row.getCell(i).value; return v && typeof v === "object" ? (v.text ?? v.hyperlink ?? "") : String(v ?? ""); };
const headers = (ws) => ws.getRow(1).values.slice(1).map(String);
const colIdx = (ws, name) => { let idx = 0; ws.getRow(1).eachCell((c, i) => { if (c.value === name) idx = i; }); return idx; };
const terms = (ws) => { const c = colIdx(ws, "Search term / variant"); const t = []; ws.eachRow((r, n) => { if (n > 1) t.push(cellText(r, c)); }); return t; };
const summary = (wb) => { const rows = []; wb.getWorksheet("Summary").eachRow((r) => rows.push([cellText(r, 1), cellText(r, 2)])); return rows; };

// one rated register finding, fully tagged, so nothing unrelated to this defect trips the gate.
const findings = [
  { ordinal: 1, mark: "VIBRANTE", owner: { name: "ATM Inc.", country: "PA", registrations: [{ uri: "/mark/cn/1180022", classes: ["32"], status: "Valid", filed: "2014-03-02" }] },
    band: "Manageable", disposition: "distinguished",
    meters: { mark_similarity: { token: "medium", basis: "verified-from-record" }, goods_proximity: { token: "medium", basis: "verified-from-record" }, use: { token: "unknown", basis: "inferred-from-signal" }, enforcer: { token: "low", basis: "inferred-from-signal" } },
    source: { source_type: "register-vendor", resolved_link: "https://example.test/mark/cn/1180022" } },
];

// the run rated its common-law areas — this is the half of the workbook the search sheet must not contradict.
const coverage = [
  { area: "register / China — anchor", state: "confirmed-clean", note: "all axes enumerated to completion at zero hits" },
  { area: "common-law / Chinese marketplace, company registry and domain channels", state: "confirmed-clean", note: "the dictated platform grid ran term by term" },
  { area: "common-law / Cyrillic and Greek marketplace forms", state: "open", note: "the grid ran on the Latin and Han forms; the Cyrillic and Greek forms were deferred" },
];

const contract = () => ({
  findings, coverage, fetchState: { "/mark/cn/1180022": "retrieved" },
  verdict: { tier: "Manageable", kinds: { coverage: true } },
  jurisdiction: "China (register) + common-law (Western web / marketplace / social)",
});
const fm = { title: "VIBRANTE FROSTPLUM", matter: "noref-jx", classes: "5, 32", overall_label: "Manageable" };

// THE SHAPE THAT CRASHED. Register terms are script and meaning variants — not one carries a class token,
// so Scope collapses on every row. The common-law blocks carry a layer and a result and nothing else.
const JX_AUDIT = {
  findings: [], audit: [],
  negatives: [
    { source_layer: "Register", search_term: "vibrant (exact / default)", result: "screened out — dead-status", notes: "registered 2018, since cancelled; weighed on status, not on age" },
    { source_layer: "Register", search_term: "vibra (default / contains)", result: "screened out — dead-status", notes: "filed 2013, lapsed; the lapsed predecessor of a live formative family" },
    { source_layer: "Register", search_term: "huo li / huoli (exact, zh-romanised)", result: "screened out — dead-status", notes: "a homophone of the meaning term, not the term itself" },
    { source_layer: "Register", search_term: "sheng dong (exact, zh-romanised)", result: "no hits — clean", notes: "enumerated to completion at zero" },
    { source_layer: "Common-law", result: "No active registrations found for any term in any register/class combination; manual verification recommended." },
    { source_layer: "Common-law", result: "No branded product matches found except one generic feature claim, which is not a brand conflict." },
    { source_layer: "Common-law", result: "One company registration found in an unrelated sector; no registrations for the three remaining terms." },
  ],
};

// the same run with the log the sweep was supposed to leave — the control for every assertion below.
const LOGGED_AUDIT = {
  findings: [], audit: [],
  negatives: [
    ...JX_AUDIT.negatives.filter((n) => n.source_layer === "Register"),
    { source_layer: "Common-law", search_term: "VIBRANTE", platform: "tmall.com", result: "No results", notes: "" },
    { source_layer: "Common-law", search_term: "VIBRANTE", platform: "jd.com", result: "No results", notes: "" },
    { source_layer: "Common-law", search_term: "FROSTPLUM", platform: "tmall.com", result: "No results", notes: "" },
  ],
};

test("a jx-shaped run builds its workbook instead of throwing on a collapsed column", async () => {
  let res, threw = null;
  try { res = await buildAudit(contract(), JX_AUDIT, JX, fm.title, fm); }
  catch (e) { threw = e; }
  assert.equal(threw, null, `buildAudit must not throw on a run whose Scope column collapses (got: ${threw?.message})`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(JX);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Summary", "Findings", "What was searched", "Coverage & gaps"],
    "a real four-tab workbook reaches disk");

  // the fixture really does exercise the collapse — without this the test could pass for the wrong reason.
  const ws = wb.getWorksheet("What was searched");
  assert.ok(!headers(ws).includes("Scope"), "Scope is empty on every row and is dropped — the styler must survive that");
  assert.ok(res.searched > 0, "the sheet still carries its rows");
});

test("the common-law sweep is stated on the sheet, never silently absent", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(JX);
  const t = terms(wb.getWorksheet("What was searched"));

  const head = t.findIndex((x) => /^COMMON-LAW\s+—\s+web/.test(x));
  assert.ok(head >= 0, `the common-law section header is present: ${t.join(" | ")}`);
  assert.ok(t.some((x) => /^COMMON-LAW/.test(x) && /not itemised in this run's search log/i.test(x)),
    "and one honest row underneath names what the log does not hold");

  const ws = wb.getWorksheet("What was searched");
  const noteCol = colIdx(ws, "Note");
  let declNote = "";
  ws.eachRow((r, n) => { if (n > 1 && /not itemised in this run's search log/i.test(cellText(r, colIdx(ws, "Search term / variant")))) declNote = cellText(r, noteCol); });
  assert.match(declNote, /never as evidence that no common-law search ran/i,
    "the row states what the reader must NOT conclude from it");
  assert.match(declNote, /incomplete record/i, "and names the tab as incomplete rather than complete");
  // it must not claim the sweep succeeded — the workbook knows the log, not the sweep.
  assert.ok(!/sweep (?:ran|completed|was completed)/i.test(declNote),
    `the row asserts nothing about what ran, only about what was recorded: "${declNote}"`);
});

test("the Summary stops claiming register AND common-law when the sheet cannot show it", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(JX);
  const rows = summary(wb);

  const caveat = rows.find(([f]) => /Common-law searching/.test(f));
  assert.ok(caveat, `the Summary carries the common-law caveat row: ${rows.map(([f]) => f).join(" / ")}`);
  assert.match(caveat[1], /no per-term common-law rows/i, "and says why the workbook cannot set the sweep out");

  const howTo = rows.find(([f]) => /^\s+What was searched$/.test(f));
  assert.ok(howTo, "the how-to-read line is present");
  assert.ok(!/so you can see we looked everywhere/i.test(howTo[1]),
    `the "we looked everywhere" claim is withdrawn when the sheet cannot carry it: "${howTo[1]}"`);
  assert.match(howTo[1], /NOT set out here/, "and the line says so plainly");

  // the contradiction this whole change exists to prevent: Clean common-law coverage beside a sheet
  // that shows no common-law search, with nothing saying so.
  const cov = wb.getWorksheet("Coverage & gaps");
  let cleanCommonLaw = false;
  cov.eachRow((r, n) => { if (n > 1 && /^common-law/i.test(cellText(r, colIdx(cov, "Area"))) && cellText(r, colIdx(cov, "State")).trim() === "Clean") cleanCommonLaw = true; });
  assert.ok(cleanCommonLaw, "the run's Clean common-law rating still renders — it is the run's judgment, not this module's");
});

test("the build gate still reports the gap — stating it on the sheet does not close it", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(JX);
  const g = validateAudit(wb, { ...contract(), registerOnly: false });
  assert.ok(g.violations.some((x) => /common-law block carries no searched terms/i.test(x)),
    `the unlisted sweep is reported: ${g.violations.join(" | ")}`);
  assert.ok(!g.ok, "and the gate does not read clean");
});

test("a run whose log DID record its common-law terms grows no declaration and trips nothing", async () => {
  const res = await buildAudit(contract(), LOGGED_AUDIT, LOGGED, fm.title, fm);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(LOGGED);

  const t = terms(wb.getWorksheet("What was searched"));
  assert.ok(t.includes("VIBRANTE") && t.includes("FROSTPLUM"), `the real terms are listed: ${t.join(" | ")}`);
  assert.ok(!t.some((x) => /not itemised/i.test(x)), "no declaration row on a run that logged its sweep");

  const rows = summary(wb);
  assert.ok(!rows.some(([f]) => /Common-law searching/.test(f)), "and no caveat row — the Summary is unchanged");
  assert.match(rows.find(([f]) => /^\s+What was searched$/.test(f))[1], /register and common-law/,
    "the original how-to-read line is intact");
  assert.ok(!res.gateViolations.some((x) => /common-law/i.test(x)),
    `no common-law gate finding: ${res.gateViolations.join(" | ")}`);
});

test("a register-only run still must NOT carry a common-law block", async () => {
  const res = await buildAudit({ ...contract(), registerOnly: true }, JX_AUDIT, REGONLY, fm.title, fm);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(REGONLY);
  assert.ok(!terms(wb.getWorksheet("What was searched")).some((x) => /^COMMON-LAW/.test(x)),
    "the declaration is for a run that was supposed to sweep — a register-only run claims nothing");
  assert.ok(!res.gateViolations.some((x) => /common-law/i.test(x)), `no common-law finding: ${res.gateViolations.join(" | ")}`);
  // and the inverted expectation still fires when a block IS there
  const wbLogged = new ExcelJS.Workbook();
  await wbLogged.xlsx.readFile(LOGGED);
  assert.ok(validateAudit(wbLogged, { registerOnly: true }).violations.some((x) => /claims a sweep that did not run/i.test(x)),
    "a common-law block on a register-only run is still a violation");
});

test("a findings set with no links at all drops the Link column without throwing", async () => {
  // the same defect as the crash above, in the Findings styler: every source carries no resolved link,
  // so Link is empty on every row and is dropped, and 'Link' is four letters — past 16384 as a letter.
  const linkless = findings.map((f) => ({ ...f, source: { ...f.source, resolved_link: "" } }));
  let res, threw = null;
  try { res = await buildAudit({ ...contract(), findings: linkless }, LOGGED_AUDIT, LINKLESS, fm.title, fm); }
  catch (e) { threw = e; }
  assert.equal(threw, null, `a linkless findings set must not throw (got: ${threw?.message})`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(LINKLESS);
  assert.ok(!headers(wb.getWorksheet("Findings")).includes("Link"), "the empty Link column is dropped, not shipped blank");
  assert.equal(wb.getWorksheet("Findings").rowCount - 1, 1, "the finding still ships");
  assert.ok(res.gateViolations.some((x) => /link does not resolve/i.test(x)),
    `and the missing link is still reported, never hidden by the drop: ${res.gateViolations.join(" | ")}`);
});

test("cleanup", async () => { for (const p of [JX, LOGGED, REGONLY, LINKLESS]) await unlink(p).catch(() => {}); });

// ── A CONDITION THAT REACHED NO PAGE IS A ROW ON THE GAPS SHEET ─────────────────────────────────────
//
// A report republished from a run recorded before conditions carried two texts can hold one whose
// reader-facing sentence was never stored and cannot be composed. It is dropped rather than printed in
// the engine's own words, and a drop nobody records is the disclosure closing quietly. Ruled
// 2026-09-17: one row here, one line in the run record, no new wording, delivery never fails for it.
//
// BREAK MATRIX:
//   · the drop reaches the gaps sheet        → break: pass it nowhere, arm 1 red
//   · as an ORDINARY row, four columns       → break: give it a shape of its own, arm 2 red
//   · in the run record's own words          → break: compose a sentence for it, arm 3 red
//   · a run with none grows no row           → break: emit a header for nothing, arm 4 red
//   · and the real coverage rows survive     → break: replace them instead of appending, arm 5 red
test("a condition that reached no client surface is an ordinary row on the gaps sheet", async () => {
  const DROPPED = out("dropped");
  const reason = "records_unscreened:12 of 88 rows — the band gave the seat nothing to name";
  const c = contract();
  const before = (c.coverage || []).length;

  await buildAudit({ ...c, droppedConditions: [{ area: "Conditions", state: "open", note: reason }] },
    JX_AUDIT, DROPPED, fm.title, fm);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(DROPPED);
  const ws = wb.getWorksheet("Coverage & gaps");

  // THE SAME FOUR COLUMNS as every other row on this sheet — not a shape of its own and not a new sheet.
  assert.deepEqual(headers(ws), ["Area", "State", "What was done", "What's left"],
    "the gaps sheet grew a column for this");
  const rows = [];
  ws.eachRow((r, n) => { if (n > 1) rows.push([1, 2, 3, 4].map((i) => cellText(r, i))); });
  const row = rows.find((r) => r[0] === "Conditions");
  assert.ok(row, "the dropped condition reaches no row at all");
  assert.equal(row[1], "Open", "the row does not carry the sheet's own state word");

  // THE RUN RECORD'S OWN WORDS, split by the same function that splits every other note on this sheet.
  // Nothing on this path composes prose, so the identifier and its counts are what the row carries.
  assert.ok(`${row[2]} ${row[3]}`.includes("records_unscreened:12"),
    "the row does not say which condition it was");
  assert.ok(`${row[2]} ${row[3]}`.includes("the band gave the seat nothing to name"),
    "the row does not carry what the run record said about it");

  // THE REAL COVERAGE ROWS ARE STILL THERE. Appended, not substituted — a sheet that answered only about
  // the drop would satisfy every assertion above and would be the defect.
  assert.equal(rows.length, before + 1, `${before} coverage row(s) in, ${rows.length - 1} out beside the drop`);

  // AND A RUN WITH NOTHING DROPPED GROWS NOTHING. An empty list must not add a row, or every report in
  // the product would carry a line about work that was never left undone.
  const CLEAN = out("nodrop");
  await buildAudit(contract(), JX_AUDIT, CLEAN, fm.title, fm);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(CLEAN);
  const clean = [];
  wb2.getWorksheet("Coverage & gaps").eachRow((r, n) => { if (n > 1) clean.push(cellText(r, 1)); });
  assert.ok(!clean.includes("Conditions"), "a run that dropped nothing grew a row saying it did");
  assert.equal(clean.length, before, "the ordinary rows moved too");

  await unlink(DROPPED).catch(() => {});
  await unlink(CLEAN).catch(() => {});
});

// ── A PROBE THE RUN DECIDED ON AND DID NOT MAKE IS A ROW ON THE SAME SHEET ────────────────────────
//
// The recall net mints a probe per remembered conflict and one per owner behind it, then dispatches at
// most five owner probes. The excess is recorded with the party and the probe id and reached no reader,
// so a search that decided on nineteen ownership checks, made five and said nothing about the other
// fourteen read as a search that made the checks it wanted. The cap is deliberate and its rows are
// ranked material-first; what was missing is the disclosure, and it lands where the 2026-09-17 ruling
// put the same class of fact.
//
// BREAK MATRIX:
//   · the undispatched probe reaches the sheet   → break: pass it nowhere, arm 1 red
//   · as an ORDINARY row, four columns           → break: give it a shape of its own, arm 2 red
//   · "What was done" is EMPTY                   → break: put a seam in the note, arm 3 red
//   · the party and the probe id both survive    → break: drop either, arm 4 red
//   · a run with none grows no row               → break: emit a header for nothing, arm 5 red
//   · it APPENDS beside a dropped condition      → break: substitute one for the other, arm 6 red
test("a probe the run decided on and never dispatched is an ordinary row on the gaps sheet", async () => {
  const OVER = out("overcap");
  const c = contract();
  const before = (c.coverage || []).length;
  // INVENTED PARTIES, with their probe ids minted the way the run mints them. The first build of this
  // fixture copied two real companies out of the run that showed the defect; the defect is the SHAPE —
  // a party, a probe id, a note with no work in it — and a coined name carries that shape as well.
  const OWNERS = ["Brackenfold Tabletop Ltd", "Oremont Audio Systems"];
  const minted = new Set();
  const ids = OWNERS.map((owner) => mintSupplementalQid({ prefix: "recall-owner", term: owner, used: minted }));
  const probes = OWNERS.map((owner, n) => ({ area: owner, state: "not-searched", note: `over the cap, never dispatched (${ids[n]})` }));

  await buildAudit({ ...c, undispatchedProbes: probes }, JX_AUDIT, OVER, fm.title, fm);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(OVER);
  const ws = wb.getWorksheet("Coverage & gaps");

  // THE SAME FOUR COLUMNS as every other row on this sheet.
  assert.deepEqual(headers(ws), ["Area", "State", "What was done", "What's left"],
    "the gaps sheet grew a column for this");
  const rows = [];
  ws.eachRow((r, n) => { if (n > 1) rows.push([1, 2, 3, 4].map((i) => cellText(r, i))); });

  const row = rows.find((r) => r[0] === OWNERS[0]);
  assert.ok(row, "the undispatched probe reaches no row at all");
  assert.equal(row[1], "Open", "the row does not carry the sheet's own state word");

  // NOTHING WAS DONE, AND THE ROW SAYS SO BY SAYING NOTHING. This is the assertion the issue turns on:
  // a lawyer reads this sheet for the difference between a check that came back clean and a check that
  // was never made. A note carrying an em dash or a semicolon would be split across both columns by the
  // sheet's own splitter and would put words under "What was done" for work nobody did.
  assert.equal(row[2].trim(), "", `"What was done" reads ${JSON.stringify(row[2])} for a probe nobody ran`);
  assert.ok(row[3].includes("over the cap"), "the row does not say why the probe was not made");
  assert.ok(row[3].includes("never dispatched"), "the row does not say the probe was never made");
  assert.ok(row[3].includes(ids[0]), "the row does not carry the probe id");

  // ONE ROW PER PROBE, and the party is the Area — the reviewing lawyer looks these up by name.
  assert.ok(rows.some((r) => r[0] === OWNERS[1]), "only one of two undispatched probes reached the sheet");

  // THE REAL COVERAGE ROWS ARE STILL THERE. Appended, not substituted.
  assert.equal(rows.length, before + probes.length,
    `${before} coverage row(s) in, ${rows.length - probes.length} out beside the probes`);

  // AND IT APPENDS BESIDE A DROPPED CONDITION rather than replacing it: both are rows on this sheet and
  // a run can carry both at once. Substituting one for the other satisfies every assertion above.
  const BOTH = out("overcap-and-drop");
  await buildAudit({ ...c, undispatchedProbes: probes,
    droppedConditions: [{ area: "Conditions", state: "open", note: "records_unscreened:12 of 88 rows — nothing to name" }] },
  JX_AUDIT, BOTH, fm.title, fm);
  const wb3 = new ExcelJS.Workbook();
  await wb3.xlsx.readFile(BOTH);
  const both = [];
  wb3.getWorksheet("Coverage & gaps").eachRow((r, n) => { if (n > 1) both.push(cellText(r, 1)); });
  assert.ok(both.includes("Conditions"), "the dropped condition was pushed off by the probes");
  assert.ok(both.includes(OWNERS[0]), "the probes were pushed off by the dropped condition");
  assert.equal(both.length, before + probes.length + 1, "the two kinds of row do not both append");

  // AND A RUN THAT DISPATCHED EVERYTHING IT MINTED GROWS NOTHING.
  const NONE = out("nocap");
  await buildAudit(contract(), JX_AUDIT, NONE, fm.title, fm);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(NONE);
  const clean = [];
  wb2.getWorksheet("Coverage & gaps").eachRow((r, n) => { if (n > 1) clean.push(cellText(r, 1)); });
  assert.ok(!clean.includes(OWNERS[0]), "a run that dispatched every probe grew a row saying it did not");
  assert.equal(clean.length, before, "the ordinary rows moved too");

  for (const p of [OVER, BOTH, NONE]) await unlink(p).catch(() => {});
});
