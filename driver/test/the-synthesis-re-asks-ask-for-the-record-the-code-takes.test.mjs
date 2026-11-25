// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the synthesis re-asks against the parser and the patch merge, on invented records
//
// THE SYNTHESIS RE-ASKS ASK FOR THE RECORD THE CODE TAKES.
//
// Four of them described a record the parser does not take: a version re-ask asked for version 4 while the dispatch
// asks for the current one, two action re-asks left the model to guess where a patch's actions go, one left out the
// optional condition, and the correction re-ask made a context note's owner mandatory. Here, each re-ask's own text
// against the code it describes:
//   · the version re-ask asks for the current version, and a reply still below it is recorded at any version;
//   · an action shaped as the action re-asks say is accepted, and one that breaks that shape is refused;
//   · the complete actions list sent in `findings.actions` keeps every action's condition and the rest of the record;
//   · a context note with or without an owner is accepted, and one with an owner that is not text is refused.
// Invented values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REPAIR_COMPOSERS } from "../repair-composers.mjs";
import { FINDINGS_SCHEMA_VERSION, validateAction, parseFindingsJson } from "../findings-model.mjs";
import { mergeSynthesisPatch } from "../synthesis-record.mjs";
import { versionStillShort } from "../steps/synthesis.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const composer = (key) => REPAIR_COMPOSERS.find((c) => c.key === key);
const textOf = (key, args) => { const out = composer(key).compose(args ?? composer(key).samples[0].args); return Array.isArray(out) ? out.join("\n") : String(out); };
const LIST_SENTENCE = "Send the complete actions list in `findings.actions` through `record_synthesis`.";
const DEADLINE_SENTENCE = "A deadline, when present, needs a date and may include a kind.";
const SHAPE = '{"id","kind","text","ordinals"} plus an OPTIONAL "deadline" {"kind","date"} and an OPTIONAL "condition" (CONDITION kinds only)';

test("the version re-ask asks for the current version, and a reply still below it is recorded at any version", () => {
  const text = textOf("synthesis:schema-downlevel", { findings: "findings.json", declaredSv: 3, frameworkKey: "invented-framework", bandLabels: ["clear", "blocked"] });
  assert.ok(text.includes(`the dictation requires "schema_version": ${FINDINGS_SCHEMA_VERSION} — rated`), text);
  assert.ok(text.includes(`at schema_version ${FINDINGS_SCHEMA_VERSION}, each rated finding carrying "band" (EXACTLY one of: clear / blocked)`), text);
  assert.ok(text.includes("Keep the findings and their judgments. Supply the fields the current record requires."), text);
  assert.doesNotMatch(text, /Change nothing else|schema_version"?:? 4\b/, "the re-ask still asks for an older record, or to change nothing");
  for (const declared of [3, 4, 6]) assert.deepEqual(versionStillShort(declared), { event: "findings-schema-downlevel", declared, required: FINDINGS_SCHEMA_VERSION });
  assert.equal(versionStillShort(FINDINGS_SCHEMA_VERSION), null);
  assert.equal(versionStillShort(null), null, "an unreadable file was recorded as a version");
});

test("an action shaped as both action re-asks say is accepted, and one that breaks that shape is refused", () => {
  const missing = textOf("synthesis:actions-missing");
  const reemit = textOf("synthesis:action-reemit");
  for (const [name, text] of [["actions-missing", missing], ["action-reemit", reemit]]) {
    assert.ok(text.includes(SHAPE), `${name}: the action's shape`);
    assert.ok(text.includes(DEADLINE_SENTENCE), `${name}: the deadline`);
    assert.ok(text.includes(LIST_SENTENCE), `${name}: where the actions go`);
    assert.doesNotMatch(text, /PATCH call carrying only "actions"/);
  }
  assert.ok(reemit.includes(`${LIST_SENTENCE} Include every existing action, with the requested corrections.`));
  assert.ok(missing.includes('Add ONE "actions": [...] field to the findings document'));
  assert.doesNotThrow(() => validateAction({ id: 1, kind: "consent", text: "Consent from the invented owner is needed.", ordinals: [1],
    condition: "Consent from the invented owner is not yet in hand.", deadline: { date: "2027-01-31" } }, 0));
  assert.doesNotThrow(() => validateAction({ id: 1, kind: "monitoring", text: "Watch the invented register.", ordinals: [] }, 0));
  assert.throws(() => validateAction({ id: 1, kind: "monitoring", text: "Watch.", ordinals: [], condition: "Not yet watched." }, 0), /^Error: finding_action_condition_on_advisory:1/);
  assert.throws(() => validateAction({ id: 1, kind: "consent", text: "Consent.", ordinals: [1], deadline: { kind: "opposition" } }, 0), /^Error: finding_action_deadline_invalid:1/);
  assert.throws(() => validateAction({ id: 1, kind: "consent", text: "Consent.", ordinals: [1], owner: "Invented Owner" }, 0), /^Error: finding_action_key_unknown:owner/);
});

test("the complete actions list in findings.actions keeps every action's condition and the rest of the record", () => {
  const doc = JSON.parse(synthesisFindings(null));
  const kept = { id: 1, kind: "consent", text: "Consent from the invented owner is needed.", ordinals: [1], condition: "Consent from the invented owner is not yet in hand." };
  const other = { id: 2, kind: "monitoring", text: "Watch the invented register for new filings.", ordinals: [] };
  const narrative = { spine: "Invented spine.", verdict: "Invented verdict." };
  const stored = { narrative, findings: { ...doc, actions: [kept, other] } };
  const corrected = { ...other, text: "Watch the invented register for new filings in class 9." };
  const m = mergeSynthesisPatch(stored, { findings: { actions: [kept, corrected] } });
  assert.equal(m.ok, true, m.reason);
  assert.deepEqual(m.merged.findings.actions, [kept, corrected], "the list sent is not the list held");
  assert.deepEqual(m.merged.findings.findings, doc.findings, "the findings moved");
  assert.deepEqual(m.merged.narrative, narrative, "the narrative moved");
  // Why the re-ask asks for every existing action: the list sent replaces the held one, so one left out is gone.
  const short = mergeSynthesisPatch(stored, { findings: { actions: [corrected] } });
  assert.equal(short.ok, true, short.reason);
  assert.deepEqual(short.merged.findings.actions, [corrected]);
});

test("a context note with or without an owner is accepted, and one whose owner is not text is refused", () => {
  const text = textOf("synthesis:corrective");
  assert.ok(text.includes('context_notes entries are EXACTLY {"type","mark","context"} plus an OPTIONAL "owner"'), "the correction re-ask's context note");
  const withNotes = (notes) => JSON.stringify({ ...JSON.parse(synthesisFindings(null)), context_notes: notes });
  const note = { type: "famous-neighbour-ungrounded", mark: "QZORVEL", context: "An invented famous mark with no fetched record." };
  assert.doesNotThrow(() => parseFindingsJson(withNotes([note])));
  assert.doesNotThrow(() => parseFindingsJson(withNotes([{ ...note, owner: "Invented Owner Co" }])));
  assert.throws(() => parseFindingsJson(withNotes([{ ...note, owner: 7 }])), /context note owner must be a string/);
  assert.throws(() => parseFindingsJson(withNotes([{ ...note, country: "US" }])), /findings_context_note_key_unknown:country/);
});
