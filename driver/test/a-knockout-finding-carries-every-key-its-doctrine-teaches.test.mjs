// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A knockout finding written exactly as its doctrine teaches is accepted by every list that polices it.
//
// The knockout doctrine teaches a finding nine keys, `weighedFilings` among them, and the stage's
// instructions ask for that key by name. The recording tool's schema and its transport allowed it; the
// validator's own list did not. So a finding written as taught had its whole stage refused, the retry
// dropped the key, and the delivered findings no longer said which filings they rested on, which is what
// the report derives each finding's source label from.
//
// THE KEYS COME FROM THE DOCTRINE, NOT FROM A LIST. The doctrine's worked example is parsed and its finding
// is driven through each door, so a list that refuses a key the doctrine teaches turns this red. A test
// built from the list under test could not see that. What the tests hold:
//   - the validator accepts the doctrine's finding, and every key it carries survives validation;
//   - the recording transport refuses none of the doctrine's keys, and still refuses one it does not declare;
//   - the chunk validator, the door where the refusal was measured, accepts a finding whose
//     `weighedFilings` names a record the run holds, beside a register read that carries a band;
//   - the tool schema declares exactly the validator's keys for a finding, and exactly the doctrine's keys
//     for a register read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { KNOCKOUT_FINDING_KEYS, validateKnockoutFinding } from "../findings-model.mjs";
import { refuseUndeclared } from "../knockout-assess-record.mjs";
import { validators } from "../verify-knockout.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCTRINE = readFileSync(join(HERE, "..", "skills", "knockout-assess", "SKILL.md"), "utf8");

/** The doctrine's own worked example of knockout-findings.json, parsed. */
function doctrineExample() {
  const at = DOCTRINE.indexOf("**`knockout-findings.json`**");
  assert.ok(at >= 0, "the doctrine no longer introduces its knockout-findings.json example");
  const open = DOCTRINE.indexOf("```json", at);
  const close = DOCTRINE.indexOf("```", open + 7);
  assert.ok(open > at && close > open, "the doctrine's example is not a fenced json block");
  return JSON.parse(DOCTRINE.slice(open + 7, close));
}
const EXAMPLE = doctrineExample();
const TAUGHT = EXAMPLE.marks[0].findings[0];
const TAUGHT_READ = EXAMPLE.marks[0].registerReads[0];

test("the doctrine's example carries a whole finding and a whole register read", () => {
  // A floor on what is driven below, so an example that lost its finding cannot let every test pass.
  assert.ok(Object.keys(TAUGHT).length >= 8, `the doctrine's finding carries ${Object.keys(TAUGHT).length} keys`);
  assert.ok(Object.keys(TAUGHT_READ).length >= 2, `the doctrine's register read carries ${Object.keys(TAUGHT_READ).length} keys`);
  // AND THE KEY THIS FILE EXISTS FOR, by name. Without it, an example that stopped teaching the key the
  // report's source label is derived from would pass every test below.
  assert.ok("weighedFilings" in TAUGHT, "the doctrine's example no longer teaches weighedFilings");
});

test("the doctrine's closed-key count is the number of keys its own example teaches", () => {
  // The count line said "all eight" beside an example with nine, and a seat reading "no others" had two
  // closed sets to choose between. Held to the example, so the sentence cannot fall behind it again.
  const said = /closed keys, all (\w+), no others/.exec(DOCTRINE)?.[1];
  assert.ok(said, "the doctrine stopped stating its finding's closed-key count");
  const WORDS = { seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  assert.equal(WORDS[said], Object.keys(TAUGHT).length,
    `the doctrine says "all ${said}" and its example teaches ${Object.keys(TAUGHT).length}: ${Object.keys(TAUGHT).join(", ")}`);
});

test("the validator accepts a finding written exactly as the doctrine teaches, and keeps every key", () => {
  const out = validateKnockoutFinding(structuredClone(TAUGHT), 0);
  assert.deepEqual(Object.keys(out).sort(), Object.keys(TAUGHT).sort(), "a key the doctrine teaches did not survive validation");
});

test("the recording transport refuses none of the doctrine's keys, and still refuses one it does not declare", () => {
  assert.equal(refuseUndeclared(structuredClone(EXAMPLE)), null, "the transport refused a key the doctrine teaches");
  const invented = structuredClone(EXAMPLE);
  invented.marks[0].findings[0].inventedKey = "x";
  assert.match(String(refuseUndeclared(invented)), /undeclared_field:.*inventedKey/, "the transport no longer polices a finding's keys");
});

// ── the door where the refusal was measured: one chunk, validated against a run's own files ───────────

const FW = { framework_key: "house-triage", bands: [{ label: "Blocking", tone: "severe" }, { label: "Medium", tone: "medium" },
  { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }] };
const MARK = "IRONWHISK";
const EVIDENCE = "https://storefront.invalid/ironwhisk";
const HELD = "/mark/eu/IW-0001";

function runDir() {
  const d = mkdtempSync(join(tmpdir(), "ko-weighed-"));
  mkdirSync(driverDir(d), { recursive: true });
  mkdirSync(join(d, "research"), { recursive: true });
  writeFileSync(driverDir(d, "framework.json"), JSON.stringify(FW));
  writeFileSync(join(d, "research", `${MARK.toLowerCase()}.md`), `# captured research payload (fixture)\n\n${EVIDENCE}\n`);
  writeFileSync(driverDir(d, "register-records.json"), JSON.stringify({ provider: "signa", marks: [{ name: MARK, records: [{ recordId: HELD }] }] }));
  return d;
}

// Values this run can hold, for the keys the doctrine teaches. The KEYS are the doctrine's: a key it
// teaches that has no value here is sent with the doctrine's own placeholder, so it is still sent.
const VALUES = {
  ordinal: 1, name: "IRONWHISK TOOLS", owner: "Ironwhisk Tools Ltd", band: "Manageable", type: "Active Business",
  net: "A small storefront trading as Ironwhisk Tools is unlikely to block the applicant.",
  evidence: [EVIDENCE], basis: "One marketplace storefront under the name, in the same goods, with modest reach.",
  weighedFilings: [HELD],
};
const READ_VALUES = { recordId: HELD, read: "A live registration in class 8, owned by the storefront's operator.", band: "Manageable" };
const asTaught = (taught, values) => Object.fromEntries(Object.keys(taught).map((k) => [k, k in values ? values[k] : taught[k]]));

const chunkWith = (finding) => JSON.stringify({
  chunkSummary: "The chunk's marks are covered here in a measured sentence or two.",
  batch: { productContext: "kitchenware" },
  marks: [{
    name: MARK, classesSearched: [8], classesDriving: [8], contextFraming: "compound",
    rating: "Manageable", ratingQualifier: null,
    bullets: ["Scattered informal uses; no dominant owner."],
    basis: "A compound of two ordinary kitchen words, used informally by several small sellers.",
    factors: ["Two marketplace storefronts trade under the name in the same goods.",
      "No owner has consolidated the name across the field."],
    counterFactors: ["No dominant trader was found on the material searched."],
    mitigation: "Narrowing to the tool classes would put daylight between this and the storefront use.",
    purpleNotes: [], registerEstimate: "moderate filings expected", negatives: [], degraded: null,
    registerReads: [asTaught(TAUGHT_READ, READ_VALUES)],
    findings: [finding],
  }],
});

test("the chunk validator accepts a finding that names a filing it weighed, as the doctrine teaches", () => {
  const d = runDir();
  const f = driverDir(d, "knockout-assess-0.json");
  const finding = asTaught(TAUGHT, VALUES);
  const r = validators.knockoutAssessChunk(f, chunkWith(finding));
  assert.equal(r.ok, true, `a finding written as taught was refused: ${r.reason}`);
  // THE CONTROL: the same chunk naming a filing this run does not hold is refused by the join, so the
  // acceptance above reached the check that reads `weighedFilings` rather than passing before it.
  const stray = validators.knockoutAssessChunk(f, chunkWith({ ...finding, weighedFilings: ["/mark/eu/NOT-HELD"] }));
  assert.equal(stray.ok, false, "a weighedFilings id the run does not hold was accepted");
  assert.match(stray.reason, /weighedFilings/, `refused for another reason: ${stray.reason}`);
});

// ── the tool schema: the third list, held to the other two ─────────────────────────────────────────

/** The property names one `properties: {…}` block declares in the record_knockout_assess tool, after `anchor`. */
function schemaProperties(anchor) {
  const src = readFileSync(join(HERE, "..", "engine", "mcp", "recording-server.mjs"), "utf8");
  const tool = src.slice(src.indexOf('name: "record_knockout_assess"'));
  const block = tool.slice(tool.indexOf(anchor));
  const props = block.slice(block.indexOf("properties: {"));
  const names = [...props.slice(0, props.indexOf("\n                },")).matchAll(/^\s{20}(\w+):/gm)].map((m) => m[1]);
  assert.ok(names.length >= 2, `no properties read after ${anchor}: the schema's layout moved, so this reads nothing`);
  return names;
}

test("the tool schema declares exactly the validator's keys for a finding", () => {
  assert.deepEqual(schemaProperties("findings: {").sort(), [...KNOCKOUT_FINDING_KEYS].sort());
});

test("the tool schema declares exactly the doctrine's keys for a register read, band among them", () => {
  assert.deepEqual(schemaProperties("registerReads: {").sort(), Object.keys(TAUGHT_READ).sort());
  assert.ok(Object.keys(TAUGHT_READ).includes("band"), "the doctrine no longer teaches a register read's band");
});
