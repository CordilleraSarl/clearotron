// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE KNOCKOUT REGISTER READER READS THE PART OF THE PROVIDER MANUAL IT CAN USE.
//
// The reader holds one register tool, the propose tool, and its manuals ride its opening message, which every later call in
// the session sends again. Its message named the whole provider manual, written for the clearance unit's seven tools. Two
// providers now split out the part a reader uses, how a question is asked and how its answer reads, into a questions file:
// the reader reads that file alone, and the clearance unit reads both, so it reads everything it read before. Each fact
// keeps one home. The other providers are unchanged, the clearance unit's sentence for them included.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAGES, providerMeta, providerManuals } from "../stages.mjs";
import { KO_STAGES, koPaths, readerProviderDoc } from "../stages-knockout.mjs";
import { PROVIDERS } from "../driver.config.mjs";
import { DRIVER } from "./model-stage-dispatches.mjs";

const SPLIT = { clarivate: "Clarivate", signa: "Signa" };
const OPENING = "Use this guide to interpret the supplied filings and propose follow-up register questions.";
const read = (ref) => readFileSync(join(DRIVER, ref), "utf8");
const unitMessage = (register) => STAGES["register-unit"].message({ register, axis: "primary-sweep",
  paths: { variantManifest: "vm.json", matterContext: "mc.md", registerBand: (a) => `band-${a}.json`, registerUnit: (a) => `unit-${a}.md`, registerPlan: "plan.json" },
  job: { ref: "N-1", markName: "TARNWICK", classes: [11], goods: "lamps" }, profile: {},
  registerPlan: { plan_version: 1, regions: [], entries: [{ qid: "primary-sweep:exact:tarnwick", axis: "primary-sweep", predicate: "exact", term: "TARNWICK", nice_classes: ["11"], expected_kind: "enumerate" }] } });

test("a provider that splits its manual opens the questions file with the reader's sentence, and the reader reads it alone", () => {
  for (const [id, label] of Object.entries(SPLIT)) {
    const meta = PROVIDERS[id];
    assert.equal(meta.questionsDoc, `skills/clearance-register/providers/${id}-questions.md`);
    assert.ok(read(meta.questionsDoc).startsWith(`# ${label} — asking the register and reading its answers\n\n${OPENING}\n`), `${id}: the questions file's opening`);
    assert.equal(readerProviderDoc(meta), meta.questionsDoc, `${id}: the reader is not pointed at the questions file`);
    const msg = KO_STAGES["knockout-register-read"].message({ K: koPaths("/run"), job: {}, readingLines: [], providerDoc: readerProviderDoc(meta) });
    assert.ok(msg.includes(meta.questionsDoc) && !msg.includes(meta.skillDoc), `${id}: the reader's message names the whole manual`);
    // The reader cannot fetch a record, so its file tells it to fetch none.
    assert.doesNotMatch(read(meta.questionsDoc), /deep-fetch|pass it to `register_record_fetch`/, `${id}: the reader's file tells it to fetch a record`);
    // Nor does it send the reader to the clearance unit's manual, which the reader is never handed.
    assert.doesNotMatch(read(meta.questionsDoc), /`unit\.md`/, `${id}: the reader's file points at unit.md`);
  }
  // The unit fetches a record of unknown status once; a full record that still reads unknown stays unknown, with no second fetch.
  assert.match(read(PROVIDERS.clarivate.skillDoc).replace(/\s+/g, " "), /deep-fetch it\. If a full record has already returned an unknown status, keep it unknown\./);
  // A Signa reader holding a list row or goods wording alone reads only the fields it was shown.
  assert.match(read(PROVIDERS.signa.questionsDoc).replace(/\s+/g, " "), /When the filing detail includes a full record, use the fields below\. With a list row or goods wording alone, use only the fields shown\./);
});

test("the clearance unit reads both files, its opening and its follow-ups alike", () => {
  for (const id of Object.keys(SPLIT)) {
    const meta = PROVIDERS[id];
    assert.deepEqual(providerManuals(id), [meta.skillDoc, meta.questionsDoc]);
    assert.ok(unitMessage(id).includes(` Read and follow ${meta.skillDoc} and ${meta.questionsDoc} for THIS provider's exact tool names + operator vocabulary;`), `${id}: the unit's sentence`);
    assert.deepEqual(STAGES["register-unit"].followupSkillReads({ register: id }), [meta.skillDoc, meta.questionsDoc]);
    // Read together, the two files say each thing once.
    const lines = (ref) => new Set(read(ref).split("\n").map((l) => l.trim()).filter((l) => l.length > 30));
    const both = [...lines(meta.skillDoc)].filter((l) => lines(meta.questionsDoc).has(l));
    assert.deepEqual(both, [], `${id}: a line is in both files`);
  }
});

test("a provider with one manual is read as before: by the reader whole, and by the unit in the same sentence", () => {
  const single = Object.keys(PROVIDERS).filter((id) => PROVIDERS[id].skillDoc && !PROVIDERS[id].questionsDoc);
  assert.ok(single.length >= 4, `only ${single.length} single-manual providers: ${single.join(", ")}`);
  for (const id of single) {
    const meta = providerMeta(id);
    assert.equal(readerProviderDoc(meta), meta.skillDoc, `${id}: the reader's manual moved`);
    assert.ok(unitMessage(id).includes(` Read and follow ${meta.skillDoc} for THIS provider's exact tool names + operator vocabulary; use only that provider's register tools.`), `${id}: the unit's sentence changed`);
    assert.deepEqual(STAGES["register-unit"].followupSkillReads({ register: id }), [meta.skillDoc]);
  }
});
