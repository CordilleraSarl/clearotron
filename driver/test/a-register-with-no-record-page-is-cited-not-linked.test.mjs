// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The workbook gate asked every register finding for a link its own engine is forbidden to supply.
//
// WHAT HAPPENED. A delivered clearance's audit workbook carried nine build-gate findings: eight of them
// "link does not resolve to http(s)", one per register finding in the matter. The register that ran
// publishes no per-record page (`hasPublicRecordUrl: false`), so publish's own normalizeRecordLinks had
// emptied every absolute record link the model wrote — deliberately, because constructing a per-record
// URL for a register that publishes none would be a fabricated citation on a legal deliverable. The gate
// then reported the result as a defect, once per finding, scaling with how many register hits the matter
// had. The rule was asking for a URL; what a reader needs is a citation they can act on, which for such a
// register is the registration number and the office.
//
// The distinction is what these arms drive, in both directions: the exemption must not fire for a
// register that DOES publish record pages, for a run that cannot say what its register publishes, for a
// common-law row, or for a register row that cites no record at all. Each of those is a separate arm,
// because a rule that cannot be made to fire is not a rule.
import test from "node:test";
import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { buildAudit, validateAudit } from "../publish/xlsx.mjs";

const out = (tag) => join(tmpdir(), `audit-nolink-${tag}-${process.pid}.xlsx`);
const BOOK = out("book"), BARE = out("bare");

const meters = {
  mark_similarity: { token: "high", basis: "verified-from-record" },
  goods_proximity: { token: "medium", basis: "verified-from-record" },
  use: { token: "low", basis: "inferred-from-signal" },
  enforcer: { token: "low", basis: "inferred-from-signal" },
};

// A register finding as it reaches publish on a no-record-page register: the link is EMPTY (publish
// cleared it) and the record identity is on the row — office + number, from the fetched record.
const registerFinding = (ordinal, number) => ({
  ordinal, mark: `NORTHWIND ${ordinal}`, band: "Manageable", disposition: "distinguished", meters,
  owner: { name: "Northwind Holdings", country: "CH", registrations: [{ uri: `/mark/ch/${number}`, classes: ["9"], status: "Valid", filed: "2019-04-01" }] },
  source: { source_type: "register-vendor", resolved_link: "" },
});
// A common-law finding keeps its real link — publish never touches one, so a missing link here is a gap.
const commonLawFinding = (ordinal, link) => ({
  ordinal, mark: `NORTHWIND web ${ordinal}`, band: "Manageable", disposition: "off-field", meters,
  owner: { name: "A storefront", country: "US", registrations: [] },
  source: { source_type: "common-law-web", resolved_link: link },
});

const coverage = [
  { area: "register / Switzerland — anchor", state: "confirmed-clean", note: "enumerated to completion" },
  { area: "common-law / Western web and marketplace channels", state: "confirmed-clean", note: "the dictated grid ran term by term" },
];
const auditMd = { findings: [], audit: [], negatives: [
  { source_layer: "Register", search_term: "northwind (exact)", result: "no hits — clean", notes: "" },
  { source_layer: "Common-law", search_term: "NORTHWIND", platform: "amazon.com", result: "No results", notes: "" },
] };
const fm = { title: "NORTHWIND", matter: "noref-nolink", classes: "9", overall_label: "Manageable" };

const linkViolations = (g) => g.violations.filter((x) => /link does not resolve/i.test(x));
const identityViolations = (g) => g.violations.filter((x) => /nothing identifies the record/i.test(x));

test("a register that publishes no record page: the number and the office ARE the citation", async () => {
  const findings = [registerFinding(1, "1100011"), registerFinding(2, "1100022"), commonLawFinding(3, "https://example.test/listing/1")];
  const res = await buildAudit({ findings, coverage, fetchState: {}, verdict: { tier: "Manageable" }, jurisdiction: "Switzerland (register) + common-law",
    registerPublishesRecordPages: false }, auditMd, BOOK, fm.title, fm);
  assert.deepEqual(linkViolations({ violations: res.gateViolations }), [],
    `no register row may be reported for a missing link on a register with no record page: ${res.gateViolations.join(" | ")}`);
  assert.deepEqual(identityViolations({ violations: res.gateViolations }), [],
    "and these rows DO carry the identity, so nothing is reported about that either");

  // THE FLOOR, so this arm cannot pass because the gate read nothing: the workbook really has the two
  // linkless register rows, with their identities, and the gate really ran over them.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(BOOK);
  const ws = wb.getWorksheet("Findings");
  const col = (name) => { let i = 0; ws.getRow(1).eachCell((c, n) => { if (c.value === name) i = n; }); return i; };
  const cellText = (row, i) => { const v = row.getCell(i).value; return v && typeof v === "object" ? String(v.text ?? v.hyperlink ?? "") : String(v ?? ""); };
  const cReg = col("Registration(s)"), cMark = col("Conflicting mark");
  const regRows = [];
  ws.eachRow((r, n) => { if (n > 1 && cellText(r, cMark).trim()) regRows.push(cellText(r, cReg).trim()); });
  assert.equal(regRows.length, 3, "three finding rows reached the sheet");
  assert.ok(regRows.filter((x) => /^CH 11000/.test(x)).length === 2, `both register rows carry office + number: ${regRows.join(" | ")}`);

  // AND THE GATE IS STILL A GATE on the same workbook: flip only the register's capability and the same
  // two rows are reported. One build, two judgments — so the difference is the rule, not the fixture.
  const strict = validateAudit(wb, { findings, coverage, registerPublishesRecordPages: true });
  assert.equal(linkViolations(strict).length, 2,
    `a register that DOES publish record pages still owes a link: ${strict.violations.join(" | ")}`);
  const legacy = validateAudit(wb, { findings, coverage, registerPublishesRecordPages: null });
  assert.equal(linkViolations(legacy).length, 2,
    "and a run that cannot say what its register publishes is judged as before — the doubt does not buy an exemption");
});

test("a register row that cites no record at all is reported, and says what is missing", async () => {
  // Same no-record-page register, but the finding carries NO registration — so the row holds the
  // `— (common-law)` placeholder and nothing identifies the record. The missing link is then the second
  // problem, not the first, and the gate must not go quiet because of the exemption above.
  const bare = { ...registerFinding(1, "x"), owner: { name: "Northwind Holdings", country: "CH", registrations: [] } };
  const findings = [bare, commonLawFinding(2, "")];
  const res = await buildAudit({ findings, coverage, fetchState: {}, verdict: { tier: "Manageable" }, jurisdiction: "Switzerland (register) + common-law",
    registerPublishesRecordPages: false }, auditMd, BARE, fm.title, fm);
  assert.equal(identityViolations({ violations: res.gateViolations }).length, 1,
    `the register row that cites nothing is named: ${res.gateViolations.join(" | ")}`);
  // and the exemption is register-only: the linkless COMMON-LAW row is still reported the old way.
  assert.equal(linkViolations({ violations: res.gateViolations }).length, 1,
    `a common-law row with no link is not covered by a register's record-page answer: ${res.gateViolations.join(" | ")}`);
});

test.after(async () => { for (const f of [BOOK, BARE]) await unlink(f).catch(() => {}); });
