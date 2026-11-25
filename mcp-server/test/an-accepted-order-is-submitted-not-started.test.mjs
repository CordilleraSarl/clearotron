// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// An accepted start_run puts an order in the queue. The engine claims it later and checks that it can run,
// and it can fail there, before anything is searched. The ops pack told the assistant to confirm "Starting
// now" before it had even called start_run, so a requester whose order was refused, or failed before
// start, had already been told it was starting. Both packs now say submitted, and the ops pack sends its
// confirmation only after the call returns ok.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (pack) => readFileSync(new URL(`../../skills/${pack}/SKILL.md`, import.meta.url), "utf8");
const ops = read("clearotron-ops");
const account = read("clearotron-account");

test("the ops pack confirms a submission, and only after start_run returns ok", () => {
  assert.ok(ops.includes('End with **"Submitted on this understanding — reply to correct anything."**'));
  assert.ok(ops.includes("send the confirmation only once it returns ok: an accepted call means the\nsearch is submitted, not started."));
  assert.ok(ops.includes("If it refuses again, send no confirmation;"));
  assert.ok(ops.includes("It has started once `list_runs` shows it."));
});

test("the account pack says submitted, not started, after an accepted start_run", () => {
  assert.ok(account.includes("**An accepted `start_run` means submitted, not started.**"));
  assert.ok(account.includes("Tell the user it is submitted, never that it is starting or running."));
});

test("neither pack has an assistant tell anyone a search started on the strength of an accepted call", () => {
  for (const [name, text] of [["ops", ops], ["account", account]]) {
    assert.doesNotMatch(text, /Starting now/, `${name}: the confirmation before the call`);
    assert.doesNotMatch(text, /I've started the search/, `${name}: the applicant question's claim`);
    assert.doesNotMatch(text, /the search is already running/, `${name}: the reply to a second "proceed"`);
  }
});
