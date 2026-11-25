// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// An accepted start_run puts an order in the queue. The engine claims it later and checks that it can run,
// and it can fail there, before anything is searched. The ops pack told the assistant to confirm "Starting
// now" before it had even called start_run, so a requester whose order was refused, or failed before
// start, had already been told it was starting. Both packs now say submitted, the ops pack sends its confirmation only
// once the order is accepted or found already submitted, and a start is reported from the run's own status.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (pack) => readFileSync(new URL(`../../skills/${pack}/SKILL.md`, import.meta.url), "utf8");
const ops = read("clearotron-ops");
const account = read("clearotron-account");
const flat = (text) => text.replace(/\s+/g, " ");

test("the ops pack confirms a submission, and only once it is accepted or found already submitted", () => {
  assert.ok(ops.includes('End with **"Submitted on this understanding — reply to correct anything."**'));
  for (const line of ["If validation refuses the submission, correct the named input and try once more.",
    "If the ID is already queued or processing, check the existing order.",
    "If the outcome is unknown, check its status before trying again.",
    "Confirm submission only after acceptance or after verifying that this order was already submitted.",
    "Give the requester the actionable reason in plain words. Keep raw diagnostics for staff.",
    "Report a start once the matching run has a status, and give its actual state.",
    "Check the order's status before reporting progress."])
    assert.ok(flat(ops).includes(line), `the ops pack lacks: ${line}`);
});

test("the account pack says submitted, not started, after an accepted start_run", () => {
  assert.ok(account.includes("**An accepted `start_run` means submitted, not started.**"));
  for (const line of ["Tell the user it is submitted, never that it is starting or running.",
    "Report a start once the matching run has a status, and give its actual state."])
    assert.ok(flat(account).includes(line), `the account pack lacks: ${line}`);
});

test("neither pack has an assistant tell anyone a search started on the strength of an accepted call", () => {
  for (const [name, text] of [["ops", ops], ["account", account]]) {
    assert.doesNotMatch(text, /Starting now/, `${name}: the confirmation before the call`);
    assert.doesNotMatch(text, /I've (started|submitted) the search/, `${name}: a second prescribed claim in the applicant question`);
    assert.doesNotMatch(text, /the search is already running/, `${name}: the reply to a second "proceed"`);
    assert.doesNotMatch(text, /silence means it is still working/, `${name}: progress read from silence`);
    assert.doesNotMatch(text, /nothing was submitted/, `${name}: every refusal read as nothing submitted, which re-submits an accepted order`);
  }
});
