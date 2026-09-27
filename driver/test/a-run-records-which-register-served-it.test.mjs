// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A RUN RECORDS WHICH REGISTER SERVED IT, AND THE CONTROL IS THE OTHER REGISTER.
//
// The knockout lane already records this; the clearance lane recorded nothing equivalent, so the same
// question about a clearance run had no answer to look up. What stood in for the field was searching for a
// register's NAME as a substring inside artifacts that happen to mention it — and measured on the archive,
// that instrument could not attribute more than half of two scenarios' runs to any register at all. Those
// are runs whose register is unknown to the record, not runs that used none.
//
// A TEST PINNING ONE VALUE CANNOT TELL A RECORDED FIELD FROM A HARDCODED ONE, which is why the second arm
// is the other register rather than a second assertion about the first. That requirement is the issue's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noteRegisterServed, registersServedFrom, registerServedLine, providerUsageCaveat, forgetRegistersServed, REGISTERS_SERVED }
  from "../register-served.mjs";

const newRun = () => {
  const dir = mkdtempSync(join(tmpdir(), "register-served-"));
  // status.json exists from the first stage; the field lands in the file the lane always writes.
  writeFileSync(join(dir, "status.json"), JSON.stringify({ state: "running", slug: "x" }, null, 2) + "\n");
  return dir;
};
const statusOf = (dir) => JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));

test("the register that served is a field in the run's own record", () => {
  forgetRegistersServed();
  const dir = newRun();
  try {
    noteRegisterServed(dir, "clarivate");
    assert.deepEqual(statusOf(dir)[REGISTERS_SERVED], ["clarivate"],
      "the run's record carries no register, so which one served it is a reconstruction again");
    assert.equal(registerServedLine(statusOf(dir)), "clarivate");
    // The rest of the status is untouched: this adds a field, it does not rewrite a record.
    assert.equal(statusOf(dir).state, "running");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("THE CONTROL: a run on the other register records the other value", () => {
  forgetRegistersServed();
  const dir = newRun();
  try {
    noteRegisterServed(dir, "signa");
    assert.deepEqual(statusOf(dir)[REGISTERS_SERVED], ["signa"],
      "the field does not follow the register that served — a pinned value would pass the arm above");
    assert.equal(registerServedLine(statusOf(dir)), "signa");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a run served by two registers says two, rather than naming the first", () => {
  forgetRegistersServed();
  const dir = newRun();
  try {
    noteRegisterServed(dir, "clarivate");
    noteRegisterServed(dir, "signa");
    assert.deepEqual(statusOf(dir)[REGISTERS_SERVED], ["clarivate", "signa"]);
    assert.match(registerServedLine(statusOf(dir)), /^2 registers served this run: clarivate, signa$/,
      "a run that used two registers reads as one, which is the comparison this field exists to make safe");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("noting the same register twice writes once", () => {
  // Every record fetch resolves the provider, so a run fetching a thousand records must not pay a thousand
  // status writes. The set is the gate: a repeat is not a change.
  forgetRegistersServed();
  const dir = newRun();
  try {
    noteRegisterServed(dir, "clarivate");
    const first = readFileSync(join(dir, "status.json"), "utf8");
    for (let i = 0; i < 5; i++) noteRegisterServed(dir, "clarivate");
    assert.equal(readFileSync(join(dir, "status.json"), "utf8"), first,
      "a repeated note rewrote the record, so a record-heavy run pays a write per fetch");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a resume reads what the earlier process recorded", () => {
  // A NEW PROCESS HAS AN EMPTY MEMO, so without reading the record back a resume on a changed register
  // would record only the half it saw and the run would read as single-register.
  const dir = newRun();
  try {
    forgetRegistersServed();
    noteRegisterServed(dir, "clarivate");
    forgetRegistersServed();                 // the resume: same run directory, no memory of the first pass
    noteRegisterServed(dir, "signa");
    assert.deepEqual(statusOf(dir)[REGISTERS_SERVED], ["clarivate", "signa"],
      "the resume dropped the register the first pass recorded");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an absence is named as an absence, never as none served", () => {
  // THE DISTINCTION THE ARCHIVE IS FULL OF. A run whose register is unknown to the record and a run that
  // used no register are different facts, and a reader who cannot tell them apart is where this started.
  assert.match(registerServedLine({}), /NOT RECORDED/);
  assert.match(registerServedLine({}), /not the same fact as using none/);
  assert.deepEqual(registersServedFrom({}), []);
  assert.deepEqual(registersServedFrom({ [REGISTERS_SERVED]: "clarivate" }), [],
    "a scalar in the field reads as a register, so a malformed record answers as a measured one");
  assert.deepEqual(registersServedFrom(null), []);
});

test("nothing is recorded without a run to record it against", () => {
  forgetRegistersServed();
  assert.equal(noteRegisterServed(null, "clarivate"), null, "a call outside a run invented a record");
  const dir = newRun();
  try {
    assert.equal(noteRegisterServed(dir, ""), null, "an empty register id was recorded as one");
    assert.equal(statusOf(dir)[REGISTERS_SERVED], undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a whole-run tally filed under one register says so when the run served more than one", () => {
  // THE SECOND REGISTER FIELD IN THE SAME STATUS. The provider-usage rollup's key is resolved at PUBLISH
  // while the tally it labels spans the whole run, so on a run whose register changed part-way every call
  // is filed under whichever was active at the end. That is the confident-and-wrong shape this field
  // exists to end, and before the served list existed nothing could contradict it.
  //
  // DRIVEN ON THE DECISION, NOT ON ITS PRECONDITION. The first version of this arm asserted only that the
  // run had served two registers and that one register carries no caveat — which is the setup, not the
  // claim. The decision is its own pure function so the claim itself can fail.
  assert.deepEqual(providerUsageCaveat(["clarivate"]), {},
    "a run served by one register carries a caveat, so every ordinary run gains a field about nothing");
  assert.deepEqual(providerUsageCaveat(["clarivate", "signa"]), { providerUsageSpans: ["clarivate", "signa"] },
    "a tally spanning two registers is filed under one with nothing saying so — the two register fields in "
    + "one record then disagree in silence, which is the state this closes");
  // The absences: nothing served, and a malformed field. Neither may invent a caveat.
  for (const v of [[], null, undefined, "clarivate", [""], [null, 3]])
    assert.deepEqual(providerUsageCaveat(v), {}, `${JSON.stringify(v)}: a caveat was invented from it`);
});

test("the caveat's precondition is reachable from the recorded field", () => {
  // The join between the two halves: the list the caveat reads is the one the run records, so a run that
  // served two registers really does reach the caveat rather than it being reachable only in a test.
  forgetRegistersServed();
  const dir = newRun();
  try {
    noteRegisterServed(dir, "clarivate");
    assert.deepEqual(providerUsageCaveat(registersServedFrom(statusOf(dir))), {});
    noteRegisterServed(dir, "signa");
    assert.deepEqual(providerUsageCaveat(registersServedFrom(statusOf(dir))),
      { providerUsageSpans: ["clarivate", "signa"] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
