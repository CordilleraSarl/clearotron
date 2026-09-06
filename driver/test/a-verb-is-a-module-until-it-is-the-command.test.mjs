// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Importing a verb reads a module; it does not start a command — tracker issue 183.
//
// `import("../bin/connect.mjs")` did not import a module. It ran the whole verb, printed the assistant
// menu and waited for an answer, which hung the run. That was found the only way it could be — by an arm
// that needed one message helper out of that file and could not have it.
//
// The cost is not the hang. It is that a verb whose module cannot be imported can only be exercised by
// SPAWNING it, so its pure parts — message composers, argument parsing, state predicates — get arms that
// spawn a process, or get no arms at all. The second is what had happened: the failure path in tracker
// issue 121 shipped with a message nobody could assert on, and nobody noticed it said nothing useful.
//
// `bin/clearotron.mjs` has carried the guard from the start and its own comment says why in terms that
// apply unchanged here: "Without the guard, importing it to read the verb table would DISPATCH — the
// test that holds the table to disk would run a clearance verb."
//
// ── WHY NINE FILES ARE DECLARED RATHER THAN FIXED ───────────────────────────────────────────────────
//
// Measured before the work was sized, and it changed the answer. Nine of the ten unguarded verbs run
// their whole body at module TOP LEVEL rather than inside a function, so guarding them is not a line —
// it is wrapping between 63 and 364 lines each into a `main()`, nine times, with nine separate ways to
// break a command an operator runs by hand.
//
// And every one of them exports NOTHING. So the guard buys them nothing today: there is no helper to
// import, and therefore nobody imports them. What it buys is the moment somebody wants one — which is
// exactly what happened to `connect.mjs`, and is why that file and `disconnect.mjs` carry it now.
//
// Overwatch ruled the nine deliberately undone (2026-09-05): they become a bundle of their own the day
// something needs exporting from one of them, or never. This arm is what keeps that a DECISION rather
// than a discovery — an eleventh unguarded verb fails here, and a declared file that grows an export
// fails here too, which is the moment the reasoning above stops being true of it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const BIN = join(ROOT, "bin");

/**
 * The verbs that dispatch unguarded, each with the reason it has not been fixed.
 *
 * A NAME HERE IS A CLAIM, not a way to quiet the arm: that the file runs its body at top level, that it
 * exports nothing, and that both are still true. The arms below check all three, so an entry that stops
 * describing its file fails rather than rotting.
 */
const DECLARED_UNGUARDED = Object.freeze({
  "cancel.mjs": "top-level script, exports nothing",
  "example.mjs": "top-level script, exports nothing",
  "grant.mjs": "top-level script, exports nothing",
  "key.mjs": "top-level script, exports nothing",
  "passphrase.mjs": "top-level script, exports nothing",
  "signa-sync.mjs": "top-level script; its one export is a data table, not a helper an arm needs to drive",
  "status.mjs": "top-level script, exports nothing",
  "stop.mjs": "top-level script, exports nothing",
  "uspto-sync.mjs": "top-level script, exports nothing",
});

const verbFiles = () => readdirSync(BIN).filter((n) => n.endsWith(".mjs"));
const read = (n) => readFileSync(join(BIN, n), "utf8");
const guarded = (src) => /isEntrypoint\(import\.meta\.url\)/.test(src);

test("tracker issue 183 — every verb either guards its dispatch or is declared with the reason", () => {
  const files = nonEmpty(verbFiles(), "bin/*.mjs — no verbs were walked, so this arm checked nothing");
  const undeclared = files.filter((n) => !guarded(read(n)) && !(n in DECLARED_UNGUARDED));
  assert.deepEqual(undeclared, [],
    "these verbs dispatch on import and are not declared. Importing one runs the command instead of "
    + "reading the module, so nothing inside it can be tested without spawning a process. Add the "
    + "`isEntrypoint(import.meta.url)` guard, or name the file above with the reason it cannot have one");
});

test("tracker issue 183 — a declaration that no longer describes its file is a failure", () => {
  // An exemption outliving its condition is the shape this repository keeps paying for. Each claim is
  // checked against the file rather than trusted: still present, still unguarded, still exportless.
  const files = new Set(verbFiles());
  for (const [name, why] of Object.entries(DECLARED_UNGUARDED)) {
    assert.ok(files.has(name), `${name} is declared unguarded and is not in bin/ — delete the entry`);
    const src = read(name);
    assert.equal(guarded(src), false,
      `${name} now carries the guard, so its exemption is dead and should be deleted. It read: ${why}`);
    // THE CONDITION THE RULING RESTS ON. "It exports nothing, so nobody imports it" is what makes
    // leaving this one undone safe; the day it exports something, that reasoning is false and the file
    // needs the guard rather than a line here.
    const exported = src.split("\n").filter((l) => /^export\s/.test(l));
    const allowed = name === "signa-sync.mjs" ? 1 : 0;
    assert.ok(exported.length <= allowed,
      `${name} has grown an export, so something now imports it — and importing it RUNS it. The reason `
      + `it was left unguarded no longer holds: give it the guard and remove this entry.`);
  }
});

test("tracker issue 183 — the two guarded verbs really are guarded, and the check can tell", () => {
  // The predicate, driven both ways. An `guarded()` that always answered true would make the arms above
  // vacuous, and they are the whole mechanism.
  assert.equal(guarded(read("clearotron.mjs")), true, "the dispatcher's own guard is not detected");
  assert.equal(guarded(read("connect.mjs")), true, "connect lost the guard that made its helpers testable");
  assert.equal(guarded(read("disconnect.mjs")), true, "disconnect lost its guard");
  assert.equal(guarded("main();\n"), false, "the predicate calls an unguarded dispatch guarded");
});
