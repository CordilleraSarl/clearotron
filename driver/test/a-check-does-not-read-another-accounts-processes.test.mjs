// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issues 193 and 109 — two checks read a machine they do not own.
//
// Driven on a real deployment: `doctor` reported five running programs as "executing a DIFFERENT
// checkout" and advised repointing or restarting them. All five belonged to another account's
// PRODUCTION install. The advice was addressed to a reader with no business touching those processes,
// about a deployment that was not theirs and was not wrong. `live-surface-check` read every drainer on
// the kernel the same way.
//
// A check that reads a machine it does not own does not report a fault; it invents one — and the fault
// it invents comes with instructions.
//
// THE SECOND HALF IS THE ONE THAT HIDES. Scoping alone turns this box's answer from "seven programs on
// another checkout" into "nothing was placed on any tree" — and the old code called that `current`,
// meaning everything agrees. So the uid filter without the verdict split would have replaced a loud
// wrong answer with a quiet one. Both are here, and the last arm is the reason why.
import test from "node:test";
import assert from "node:assert/strict";
import { processTable } from "../../shared/process-table.mjs";
import { programsFromAnotherCheckout } from "../../shared/checkout-move.mjs";

/** A `ps` whose output this arm controls, so both the plant and the control are real reads. */
const psOf = (lines) => () => ({ status: 0, stdout: lines.join("\n") + "\n" });
const line = (pid, uid, cmd) => `${pid} ${uid} Mon Sep  1 08:21:53 2026 ${cmd}`;

const OURS = "/home/me/clearotron";
const THEIRS = "/home/someone-else/app/node_modules/clearotron";
const ENTRY = ["driver/portal-service.mjs"];

test("193/109 a process belonging to another account is not in the table this product reads", () => {
  const ps = psOf([
    line(101, 1000, `/usr/bin/node ${OURS}/driver/portal-service.mjs`),
    line(202, 1007, `/usr/bin/node ${THEIRS}/driver/portal-service.mjs`),
  ]);
  const mine = processTable({ platform: "darwin", runPs: ps, uid: 1000 });
  assert.deepEqual(mine.map((p) => p.pid), [101],
    "another account's process reached a reader that is only ever about this account's install");

  // The control: the row is real and readable, so the arm above is a FILTER working, not a parse failing.
  const all = processTable({ platform: "darwin", runPs: ps, uid: 1000, everyUser: true });
  assert.deepEqual(all.map((p) => p.pid), [101, 202]);
  assert.equal(all.find((p) => p.pid === 202).uid, 1007, "the uid is read off the line, not assumed");
});

test("193 another account's install is never counted, and never advised on", () => {
  const ps = psOf([line(202, 1007, `/usr/bin/node ${THEIRS}/driver/portal-service.mjs`)]);

  // What shipped: the whole box, so somebody else's production is a program to repoint or restart.
  const unscoped = programsFromAnotherCheckout({
    table: processTable({ platform: "darwin", runPs: ps, uid: 1000, everyUser: true }),
    checkoutDir: OURS, entrypoints: ENTRY });
  assert.equal(unscoped.state, "elsewhere");
  assert.equal(unscoped.programs.length, 1, "the plant must be visible unscoped, or this arm proves nothing");

  // Scoped, which is the default every reader now gets without asking.
  const scoped = programsFromAnotherCheckout({
    table: processTable({ platform: "darwin", runPs: ps, uid: 1000 }),
    checkoutDir: OURS, entrypoints: ENTRY });
  assert.equal(scoped.programs.length, 0, "another account's process was still counted");
  assert.notEqual(scoped.state, "elsewhere",
    "another account's install would still be reported as a deployment this reader should repoint");
});

test("193 nothing attributable is NOT everything agreeing", () => {
  // A box where this product is not running at all. The old code answered `current` — the word for
  // "every running program is on the tree this install names" — from having placed nothing.
  const ps = psOf([line(303, 1000, "/usr/bin/node /home/me/something-else.mjs"), line(304, 1000, "sshd")]);
  const v = programsFromAnotherCheckout({
    table: processTable({ platform: "darwin", runPs: ps, uid: 1000 }),
    checkoutDir: OURS, entrypoints: ENTRY });
  assert.equal(v.state, "unplaced");
  assert.match(v.detail, /Not agreement/);
  assert.notEqual(v.state, "current", "could-not-place was reported as everything-agrees");
});

test("193 a program on the named tree IS agreement, and says so", () => {
  const ps = psOf([line(101, 1000, `/usr/bin/node ${OURS}/driver/portal-service.mjs`)]);
  const v = programsFromAnotherCheckout({
    table: processTable({ platform: "darwin", runPs: ps, uid: 1000 }),
    checkoutDir: OURS, entrypoints: ENTRY });
  assert.equal(v.state, "current");
  assert.equal(v.attributed, 1, "agreement has to be able to say what it placed, or it is not evidence");
});

test("193/109 could-not-look survives the filter — an unreadable table is not an empty box", () => {
  assert.equal(processTable({ platform: "darwin", runPs: () => ({ status: 1, stdout: "" }), uid: 1000 }), null,
    "a ps that did not run must stay null through the scoping, never become an empty machine");
  const v = programsFromAnotherCheckout({ table: null, checkoutDir: OURS, entrypoints: ENTRY });
  assert.equal(v.state, "unknown");
});

test("193/109 a platform with no user id reads the whole box rather than guessing", () => {
  // Guessing either way is worse than saying so: nothing is filtered, and the row carries what it knows.
  const ps = psOf([line(202, 1007, `/usr/bin/node ${THEIRS}/driver/portal-service.mjs`)]);
  const t = processTable({ platform: "darwin", runPs: ps, uid: null });
  assert.equal(t.length, 1, "a box that cannot answer 'is this mine' must not answer 'none of it is'");
});
