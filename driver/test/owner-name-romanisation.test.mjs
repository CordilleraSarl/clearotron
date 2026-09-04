// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the owner's name: one asserted fact, one presentation choice.
//
// A CN-owned conflict came back from the register with the owner as character-by-character pinyin —
// eleven lowercase syllables, no word boundaries, no capitals. The narrative resolved it to the proper
// English company name; findings.json kept the raw string; the report renders headings from
// findings.json, so a delivered client report carried a heading of pinyin. Then `reference-integrity`
// looked for the action list's (correct) party among the carded findings, found only the pinyin, and
// reported that no card identified them — and that false failure became an amber banner to the client.
//
// The pins below are the two halves that must BOTH hold: the CJK case renders readably, and the
// never-invent guard that doc-31 step 4 exists for is untouched.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bindFindingsToRecords, REC, ownerDisplayName } from "../registry-fidelity.mjs";
import { renderHtml } from "../publish/render.mjs";
import { parseReport } from "../publish/parse.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickOwnerName, pickOwnerNameNative } from "../../providers/clarivate/src/core.js";
import { referenceChecks } from "../predelivery-lint.mjs";

const URI = "/mark/cn/37554073";
// Stand-ins: this repo is de-identified by design, so the shapes are real and the names are not.
const PINYIN = "shang hai jin rong ke ji you xian gong si";
const NATIVE = "上海金融科技有限公司";
const ENGLISH = "Shanghai Fintech Co., Ltd.";

const withRecord = (recOwner) => new Map([[URI, { statusText: "Registered", classList: ["42"], jurisdiction: "CN", ...recOwner }]]);
const finding = (name) => [{ ordinal: 1, mark: "X", owner: { name, country: "CN", registrations: [{ uri: URI }] } }];

// ── the provider boundary ───────────────────────────────────────────────────────────────────────────

test("#599 the native-script owner survives the provider boundary instead of being collapsed away", () => {
  const applicant = { applicantName: PINYIN, applicantNameNative: NATIVE };
  assert.equal(pickOwnerName(applicant), PINYIN, "the Latin field is still the primary name");
  assert.equal(pickOwnerNameNative(applicant), NATIVE, "and the original script is no longer thrown away");
});

test("#599 an owner whose ONLY name is the native form has no separate native field", () => {
  // pickOwnerName already falls back to the native form here, so reporting it twice would invent a
  // distinction the record does not draw — and would wrongly mark this as a romanisation case below.
  assert.equal(pickOwnerName({ applicantNameNative: NATIVE }), NATIVE);
  assert.equal(pickOwnerNameNative({ applicantNameNative: NATIVE }), null);
});

test("#599 a Latin-only owner has no native form, and nothing changes for it", () => {
  assert.equal(pickOwnerName({ applicantName: "NIKE, INC." }), "NIKE, INC.");
  assert.equal(pickOwnerNameNative({ applicantName: "NIKE, INC." }), null);
  assert.equal(pickOwnerNameNative(null), null);
});

test("#599 REC.ownerNative is provider-blind, like REC.owner", () => {
  assert.equal(REC.ownerNative({ ownerNative: `  ${NATIVE}  ` }), NATIVE);
  assert.equal(REC.ownerNative({ applicantNameNative: NATIVE }), NATIVE, "legacy field name");
  assert.equal(REC.ownerNative({ owner: PINYIN }), "", "absent is empty, not undefined");
});

// ── the binding rule ────────────────────────────────────────────────────────────────────────────────

test("#599 a romanised owner keeps the run's resolved rendering, with the raw form retained as provenance", () => {
  const findings = finding(ENGLISH);
  bindFindingsToRecords(findings, withRecord({ owner: PINYIN, ownerNative: NATIVE }));
  const o = findings[0].owner;
  assert.equal(o.name, ENGLISH, "the heading a lawyer reads");
  assert.equal(o.nameRaw, PINYIN, "the register's own string is never lost");
  assert.equal(o.nameNative, NATIVE, "and the original script is a field, not a parenthetical");
});

test("#599 THE GUARD THAT MUST NOT WEAKEN: a model-invented owner is still overwritten by the record", () => {
  // doc-31 step 4. No native form on the record ⇒ the Latin field is a NAME, not a transliteration, so
  // there is nothing for a "better rendering" to be better than and the record wins outright.
  const findings = finding("Nike International (invented)");
  bindFindingsToRecords(findings, withRecord({ owner: "NIKE, INC." }));
  assert.equal(findings[0].owner.name, "NIKE, INC.");
  assert.equal(findings[0].owner.nameRaw, "NIKE, INC.");
  assert.equal(findings[0].owner.nameNative, undefined, "no native form ⇒ no invented field");
});

test("#599 a romanised owner with NO resolved rendering falls back to the raw form — never blank", () => {
  const findings = [{ ordinal: 1, mark: "X", owner: { name: "", country: "CN", registrations: [{ uri: URI }] } }];
  bindFindingsToRecords(findings, withRecord({ owner: PINYIN, ownerNative: NATIVE }));
  assert.equal(findings[0].owner.name, PINYIN, "unreadable beats absent; the card must still identify someone");
  assert.equal(findings[0].owner.nameRaw, PINYIN);
});

test("#599 a whitespace-only rendering is not a rendering", () => {
  const findings = finding("   ");
  bindFindingsToRecords(findings, withRecord({ owner: PINYIN, ownerNative: NATIVE }));
  assert.equal(findings[0].owner.name, PINYIN);
});

test("#599 with no record set at all it stays a NO-OP — an archived replay is not re-bound", () => {
  const findings = finding(ENGLISH);
  assert.deepEqual(bindFindingsToRecords(findings, new Map()), []);
  assert.equal(findings[0].owner.name, ENGLISH);
  assert.equal(findings[0].owner.nameRaw, undefined, "nothing is asserted from a record set that is not there");
});

// ── the symptom that reached the client ─────────────────────────────────────────────────────────────

test("#599 reference-integrity joins the action list to the card once the heading is readable", () => {
  // The check reads the RENDERED surface, and the heading comes from owner.name — which is exactly why
  // fixing the data fixes the check, with no edit to the check itself.
  const actions = `Clear the Chinese class-42 right held by ${ENGLISH}.`;
  const pinyinSurface = `## ${PINYIN} — MARKX, China\n\n${actions}`;
  const readableSurface = `## ${ENGLISH} — MARKX, China\n\n${actions}`;

  const before = referenceChecks({ actionsText: actions, fullSurface: pinyinSurface, searchedNames: ["MARKX"] });
  assert.equal(before[0].pass, false, "control: this is the false failure the client was shown");
  assert.match(before[0].detail, /no finding card identifies them/);

  const after = referenceChecks({ actionsText: actions, fullSurface: readableSurface, searchedNames: ["MARKX"] });
  assert.equal(after[0].pass, true, "and it joins once the card names the party the action list names");
  assert.equal(after[0].detail, "");
});

// ── the surface the client actually receives ────────────────────────────────────────────────────────
//
// The two tests above prove the FINDING is bound correctly and that reference-integrity joins when the
// surface carries the resolved name. Neither proves the surface will. publish/render.mjs does its OWN
// record lookup (`recordOwner`) and preferred the record outright — so binding the finding alone changed
// no heading, no lint corpus and no banner. These drive the real renderer.

function renderWith(finding, records) {
  const dir = mkdtempSync(join(tmpdir(), "own599-"));
  const md = join(dir, "report.md");
  writeFileSync(md, `# Preliminary clearance\n\n## Findings\n\n### Finding 1 — MARKX\n\nBody.\n`);
  return renderHtml(parseReport(md), [finding], [], { runId: "o599", recordsByUri: records });
}

test("#599 the RENDERED report shows the resolved name for a romanised owner, not the pinyin", () => {
  const findings = finding(ENGLISH);
  const records = withRecord({ owner: PINYIN, ownerNative: NATIVE });
  bindFindingsToRecords(findings, records);          // exactly the order publish/index.mjs uses
  const html = renderWith(findings[0], records);
  assert.ok(html.includes(ENGLISH), "the heading a lawyer reads must carry the resolved name");
  assert.ok(!html.includes(PINYIN),
    "and NOT the character-by-character pinyin — this is the string that shipped to a client");
});

test("#599 the RENDERED report still shows the RECORD's name for a Latin-only owner", () => {
  // The never-invent guard, at the surface rather than in the data: render must not start trusting the
  // model's owner just because the romanised case now can.
  //
  // DELIBERATELY UNBOUND. Running bindFindingsToRecords first would set owner.name to the record's string,
  // and then render's own lookup and its fallback return the SAME value — the test could not fail however
  // render behaved, which is what the break matrix caught. Unbound is also a real path: render's fallback
  // exists for archived/replay runs, and this is the case where it must not win.
  const findings = finding("Nike International (invented)");
  const records = withRecord({ owner: "NIKE, INC." });
  const html = renderWith(findings[0], records);
  assert.ok(html.includes("NIKE, INC."));
  assert.ok(!html.includes("Nike International"), "a model-typed owner never reaches the page");
});

test("#599 render and the data layer cannot disagree — both ask the same function", () => {
  const args = { raw: PINYIN, native: NATIVE, resolved: ENGLISH };
  assert.equal(ownerDisplayName(args), ENGLISH);
  assert.equal(ownerDisplayName({ raw: "NIKE, INC.", native: "", resolved: "Nike Intl" }), "NIKE, INC.");
  assert.equal(ownerDisplayName({ raw: "", native: "", resolved: ENGLISH }), ENGLISH, "no record ⇒ the run's own value");
  assert.equal(ownerDisplayName({ raw: "", native: "", resolved: "" }), "");
  assert.equal(ownerDisplayName({ ...args, resolved: "  " }), PINYIN, "a blank rendering is not a rendering");
  // Idempotent: render calls this AFTER bindFindingsToRecords has already chosen.
  assert.equal(ownerDisplayName({ ...args, resolved: ownerDisplayName(args) }), ENGLISH);
});

test("#599 a REPUBLISH of an archived run is byte-identical — no delivered report is rewritten", () => {
  // pool-admin's doRepublish re-renders any archived run through this same path, so a change here can
  // silently rewrite a report a client already has. It does not. An archived findings.json carries an
  // owner.name the OLD rule already bound to the record's string, so `resolved` equals `raw`,
  // ownerDisplayName returns that same string, and the page is unchanged. The fix reaches runs bound
  // after it lands, and nothing else.
  const records = withRecord({ owner: PINYIN, ownerNative: NATIVE });
  const archived = finding(PINYIN);                    // as the old binding left it on disk
  const beforeFix = ownerDisplayName({ raw: PINYIN, native: NATIVE, resolved: PINYIN });
  assert.equal(beforeFix, PINYIN, "the archived value survives the new rule untouched");
  const html = renderWith(archived[0], records);
  assert.ok(html.includes(PINYIN), "a republished archived run still reads exactly as delivered");
});
