// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The dispatch receipt answers "did that block reach the seat". It used to record a builder only when
// it produced text, so a builder that ran and had nothing to flag appeared on the receipt exactly like
// one that never ran at all — and only the second of those is a defect.
//
// FOUND THE HARD WAY. The narrative refutation block reached the seat with hits and the seat rewrote
// none, and the receipt could not be used to establish that, because "ran with nothing to say" and
// "did not run" were one reading. A measurement nobody can take is the thing that made a second defect
// invisible, so the receipt is fixed first and the rewrite is written against what it then shows.
//
// TWO EMPTIES, KEPT APART. Collapsing them repeats the fault one level in: a builder that read every
// visible line and found nothing to flag has made a negative finding, while a builder whose record was
// not on disk has not looked at all. These arms drive both and assert they do not answer alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { composeDispatchExtra } from "../pipeline.mjs";
import { stampDispatchBlocks, dispatchBlockState, dispatchBlockWhy, nothingFound, nothingToRead, emptyReturn } from "../stages.mjs";

const DEMO = new URL("../../demo/global-preliminary-search/run/findings.json", import.meta.url);
const ID = "refute-plain-register";
const STAGE = "narrative-refutation";

// A record a run really wrote, mutated in place so every ordinal an action references still resolves.
const recordWith = (mutate) => {
  const doc = JSON.parse(readFileSync(DEMO, "utf8"));
  mutate(doc);
  const f = join(mkdtempSync(join(tmpdir(), "receipt-states-")), "findings.json");
  writeFileSync(f, JSON.stringify(doc));
  return f;
};

const composeOver = (findings) => {
  const ctx = { paths: { findings, runDir: "/nonexistent" }, job: { marks: [] } };
  const out = composeDispatchExtra(STAGE, ctx);
  return { out, ctx };
};

// Every default-visible surface emptied of words the plain-register read can flag, while LEAVING the
// lines themselves in place. Deleting them instead would reach a different state — nothing read rather
// than nothing found — and an arm that cannot tell those apart is the arm this file exists to add.
const cleanRecord = () => recordWith((doc) => {
  doc.findings = (doc.findings ?? []).map((f) => ({ ...f, net: "A short clean line about the name." }));
  doc.coverage = (doc.coverage ?? []).map((c) => ({ ...c, note: "Looked at the usual places." }));
  doc.actions = (doc.actions ?? []).map((a) => ({ ...a, text: "Send the client a short note." }));
  // ONLY KEYS THE RECORD ALREADY CARRIES. `parseFindingsJson` enforces an exact top-level key set, so
  // adding one here makes the builder THROW and every arm below then reads a failure rather than the
  // empty state it was written for — a fixture that cannot reach its state, passing on the way past.
  if (doc.markAssessment) {
    doc.markAssessment = { ...doc.markAssessment, distinctiveness: "The name is made up.", connotation: "It means nothing in English." };
  }
});

test("a builder that read every visible line and flagged none says so, and is not read as absent", () => {
  const { out, ctx } = composeOver(cleanRecord());
  assert.deepEqual(out.failed, [], "a well-formed record must not throw");
  assert.ok(!out.ids.some((x) => x.id === ID), "this record was built to produce no text");
  // THE WHOLE POINT. Before this, the assertion below read "absent".
  assert.equal(dispatchBlockState(ctx, STAGE, ID), "nothing-found");
  assert.match(dispatchBlockWhy(ctx, STAGE, ID) ?? "", /visible line/,
    "the receipt carries how much was read, so a clean read is distinguishable from a read of nothing");
});

test("a builder whose record was not on disk did not look, and the receipt does not call that a clean read", () => {
  const ctx = { paths: { findings: join(tmpdir(), "no-such-run", "findings.json"), runDir: "/nonexistent" }, job: { marks: [] } };
  composeDispatchExtra(STAGE, ctx);
  assert.equal(dispatchBlockState(ctx, STAGE, ID), "nothing-to-read");
  assert.match(dispatchBlockWhy(ctx, STAGE, ID) ?? "", /no findings record/);
});

test("the two empties are different states, which is the property that stops one hiding in the other", () => {
  const { ctx: read } = composeOver(cleanRecord());
  const notRead = { paths: { findings: join(tmpdir(), "no-such-run", "findings.json"), runDir: "/nonexistent" }, job: { marks: [] } };
  composeDispatchExtra(STAGE, notRead);
  assert.notEqual(dispatchBlockState(read, STAGE, ID), dispatchBlockState(notRead, STAGE, ID),
    "a clean read and a record that was never opened answer the same, so one hides inside the other");
});

test("a block that did build still reads present, and a stage nobody composed still reads absent", () => {
  // The older three states are unchanged. A change that fixed the empty case by moving these would be
  // trading one wrong reading for another.
  const built = recordWith((doc) => {
    doc.findings = (doc.findings ?? []).map((f, i) => (i === 0 ? { ...f, net: "The proprietor holds a subsisting right." } : { ...f, net: "A short clean line." }));
  });
  const { out, ctx } = composeOver(built);
  assert.ok(out.ids.some((x) => x.id === ID), "this record was built to produce text");
  assert.equal(dispatchBlockState(ctx, STAGE, ID), "present");
  assert.equal(dispatchBlockState(ctx, "synthesis", ID), "absent", "a stage this ctx composed nothing for");
  assert.equal(dispatchBlockState({}, STAGE, ID), "absent", "an unstamped ctx claims nothing");
  assert.equal(dispatchBlockWhy(ctx, STAGE, ID), null, "a built block has no empty sentence");
});

test("a builder that returns a bare nothing is recorded as having named no reason", () => {
  // Not silently counted as either empty. A builder nobody has taught to discriminate is a third thing,
  // and reading it as a clean look would be this file's own defect one level in.
  const ctx = {};
  stampDispatchBlocks(ctx, STAGE, { built: [], failed: [], empty: [{ id: "x", kind: "empty-unstated", why: "the builder returned nothing and named no reason" }] });
  assert.equal(dispatchBlockState(ctx, STAGE, "x"), "empty-unstated");
});

test("the sentinel is recognised by shape, and an ordinary value is not mistaken for one", () => {
  assert.equal(emptyReturn(nothingFound("read 4 lines"))?.dispatchEmpty, "nothing-found");
  assert.equal(emptyReturn(nothingToRead("no record"))?.dispatchEmpty, "nothing-to-read");
  for (const v of ["", "some text", null, undefined, 0, {}, { dispatchEmpty: 1 }, { why: "x" }]) {
    assert.equal(emptyReturn(v), null, `${JSON.stringify(v)} is not a sentinel`);
  }
});
