// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE WRITE BOUNDARY DID NOT SEE BASH, AND A COMMENT ASSERTED IT DID NOT NEED TO.
//
// The hook's matcher was `Write|Edit|MultiEdit|NotebookEdit`. Seats have Bash — 4,593 calls across 567
// recorded sessions, naming absolute paths outside the granted roots — so a seat could not `Write` into
// a guarded tree and could `>` its way there freely. The premise that this was fine came from a comment
// in the enforcement file itself, asserting a grant table's effect in the present tense. It was checked
// at source by three readers in one day and satisfied all three.
//
// THESE TESTS ASSERT A DETECTOR, DELIBERATELY. Nothing here claims coverage, because the arm sees
// redirects and known writing commands and does not parse the shell. The tests that matter most are the
// ones asserting what it must NOT do: a false deny breaks legitimate seat work, the hook gets removed,
// and then nothing is guarded at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bashWriteTargets } from "../engine/deny-authority-write.mjs";
import { authorityTrees, denyReason } from "../authority-trees.mjs";

const RUN = "/run/prelim-search/2026-08-16-a-run";
const trees = () => authorityTrees({ runDir: RUN });
const denied = (cmd) => bashWriteTargets(cmd).filter((t) => denyReason(t, trees()));

// ── WHAT IT MUST CATCH: the shape that actually happened ────────────────────────────────────────────

test("a redirect into a guarded tree is seen", () => {
  assert.equal(denied(`jq '.rows' x.json > ${RUN}/_driver/common-law-dispositions.half-m.form.json`).length, 1);
  assert.equal(denied(`echo hi >> ${RUN}/_driver/run.jsonl`).length, 1);
});

test("a known writing command naming a guarded path is seen", () => {
  assert.equal(denied(`cp /tmp/x.json ${RUN}/_driver/x.json`).length, 1);
  assert.equal(denied(`tee ${RUN}/_driver/x.json < /tmp/y`).length, 1);
  assert.ok(denied(`sed -i 's/a/b/' ${RUN}/_driver/run.jsonl`).length >= 1, "in-place editing is writing");
});

test("several targets in one command are all seen, not just the first", () => {
  const cmd = `cat a > ${RUN}/_driver/one.json; cat b > ${RUN}/_driver/two.json`;
  assert.equal(denied(cmd).length, 2, "denying on the first found is fine; SEEING only the first is not");
});

// ── WHAT IT MUST NOT DO, AND THIS IS THE HALF THAT PROTECTS THE GUARD'S EXISTENCE ───────────────────

test("READING a guarded file is untouched — this is normal, frequent seat behaviour", () => {
  // Both of these are real commands from the corpus, against the run at the centre of the 2026-08-15
  // failure. If either is ever denied, seats lose the ability to inspect their own obligations and the
  // hook gets removed — after which nothing is guarded at all.
  assert.deepEqual(denied(`grep -c '"receipt_id": null' ${RUN}/_driver/common-law-dispositions.half-m.form.json`), []);
  assert.deepEqual(denied(`jq '.rows[] | select(.receipt_id == null)' ${RUN}/_driver/x.json`), []);
  assert.deepEqual(denied(`cat ${RUN}/_driver/run.jsonl | head -20`), []);
});

test("writing into the seat's OWN workspace is untouched — the run dir's top level stays wide open", () => {
  assert.deepEqual(denied(`python3 fill.py > ${RUN}/common-law-dispositions.half-m.json`), []);
  assert.deepEqual(denied(`cp /tmp/draft.md ${RUN}/common-law-findings.half-m.md`), []);
  assert.deepEqual(denied(`echo x > ${RUN}/scratch.json`), []);
});

test("shell plumbing is not a file", () => {
  assert.deepEqual(bashWriteTargets("ls -l 2>&1 | head"), [], "`2>&1` names a descriptor, not a path");
  assert.deepEqual(bashWriteTargets("noisy_thing > /dev/null 2>&1"), [], "/dev/null is not an artifact");
});

test("an empty or absent command yields nothing, and does not throw", () => {
  for (const c of [null, undefined, "", "   "]) assert.deepEqual(bashWriteTargets(c), []);
});

// ── THE VOID CONTROL ────────────────────────────────────────────────────────────────────────────────

test("VOID CONTROL: the guarded-tree list must still name something", () => {
  // Every assertion above is of the form "this path is/is not denied". If the tree list ever went empty,
  // the catching tests would fail loudly — but a subtler regression, one that stopped naming `_driver/`
  // while still naming something else, would leave this file green while guarding nothing that matters.
  const t = trees();
  assert.ok(Array.isArray(t) && t.length, "no guarded trees at all — every test above is measuring nothing");
  assert.ok(denyReason(`${RUN}/_driver/anything.json`, t),
    "`_driver/` stopped being a guarded tree; the Bash arm now passes on the exact shape it was built for");
});

test("VOID CONTROL: the detector must be able to find a target at all", () => {
  // A regex that stopped matching would make every "must not deny" test above pass by finding nothing,
  // which is an absence reading as a pass — the failure mode this whole family exists to refuse.
  assert.ok(bashWriteTargets(`echo x > ${RUN}/_driver/y.json`).length,
    "the extraction found nothing; the negative tests above are now vacuous");
});
