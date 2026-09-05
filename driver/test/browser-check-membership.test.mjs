// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// #968 — WHERE EACH CHECK RUNS, as data rather than as prose.
//
// The browser checks in scripts/ are the only things in this repository that can observe a scrollbar,
// a sticky header, a frame two pixels shorter than its contents, or a control meant to be clicked
// being printed onto paper. Every other test here asserts on strings. They live in scripts/, which is
// not an npm workspace, so `npm test` and `npm run test:full` never reach them — CI's build-and-verify
// job is the whole of their coverage.
//
// That made their membership a fact stated in two places and checked in none: a shell line inside
// ci.yml, and a table in scripts/README.md that was already missing entries. `render-check.mjs` sat
// outside both for months and nothing said so out loud; the README's own paragraph had to be written
// by hand to admit it. A check that quietly stops running looks exactly like a check that passes.
//
// So: every `scripts/*-check.mjs` is either invoked by a job in ci.yml, or declared below with a
// reason it cannot be. Both halves are asserted, and so is the enumeration itself — a glob that stops
// matching would otherwise report the same green as full coverage.
//
// This is what #705 and #1000 were routed behind. Their acceptance criteria are browser behaviours no
// clearance round touches, and certifying them by hand-clicking is not certifying them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const GUARD = "browser-check membership";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CI_PATH = ".github/workflows/ci.yml";
const CI = readFileSync(join(ROOT, CI_PATH), "utf8");

// `git ls-files`, not readdirSync, for the reason shared/tracked-files.mjs gives: a directory walk
// lists a contributor's scratch file and an editor backup too, and the claim here is about what ships.
const checkScripts = () => {
  const files = trackedFiles(GUARD, { root: ROOT, pathspec: ["scripts/*-check.mjs"] });
  return files === null ? null : files.slice().sort();
};

// Invocations, from NON-COMMENT lines only. The comments in build-and-verify discuss these scripts by
// name at length — reading them as invocations would make every one of them look wired up, which is
// the exact inversion of what this file is for.
const invoked = () => {
  const out = new Set();
  for (const line of CI.split("\n")) {
    if (/^\s*#/.test(line)) continue;
    for (const m of line.matchAll(/node\s+(scripts\/[A-Za-z0-9._-]+\.mjs)/g)) out.add(m[1]);
  }
  return out;
};

// A check that CANNOT run in CI says so here, with the reason, and the reason has to be a property of
// the check rather than a preference. Anything that could run and simply is not wired up belongs in
// the workflow instead — that is what #968 was about.
const CANNOT_RUN_IN_CI = [
  {
    path: "scripts/live-surface-check.mjs",
    why: "it interrogates a RUNNING DEPLOYMENT — the processes, the environment they were started in, "
      + "and the commit they were started from. CI has no deployment; pointed at one it would be "
      + "asserting about the last box someone happened to name.",
  },
  // THE DEPLOY-DRIFT ENTRY IS GONE BECAUSE THE CHECK IS NOT ON THIS TREE — WITHHELD, NOT RETIRED.
  // It asks a box whether its deployed copy of the deploy script matches the tracked one, so it belongs
  // with the ops scripts in the configuration repository rather than in a public product tree, and that
  // is where the cut left it. Deleting the entry is what this file's staleness arm demands: an exemption
  // naming a file nobody can open is an exemption nobody can retire. Recording WHY here, because the
  // deletion on its own reads as "somebody decided that check was unnecessary", which is not what
  // happened and would be the wrong thing for the next reader to conclude.
  {
    path: "scripts/merge-presence-check.mjs",
    why: "it re-states a merge against the tree AFTER the merge, over a range of commits that does not "
      + "exist while the pull request is still open. Running it in the gate would ask it about its own "
      + "unmerged head.",
  },
];

// THE HONEST EXCEPTION FELL ON 2026-08-24, and the entry is deleted rather than reworded. Its own text
// said the reason was "NOT a property of the check" — nobody had wired it, and it exited 1 on one dev
// box where Chrome dies on SIGTRAP identically on an unmodified checkout of main. Neither is a fact
// about `report-frame-check.mjs`.
//
// What it needed was to be seen passing somewhere, and it was:
//
//   shipped sandbox: allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads
//   browser kept:    allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads
//     ok   required  allow-scripts / allow-popups / allow-popups-to-escape-sandbox
//     ok   forbidden allow-same-origin / allow-top-navigation
//   the browser accepts exactly the boundary we wrote           (exit 0)
//
// It is now invoked in the browser job, blocking. THIS TABLE IS EMPTY-ABLE AND THAT IS THE POINT: an
// exemption that nobody can retire is one nobody re-reads, so the arm below asserts every remaining
// entry still names a check that exists, and the day the last one goes this list goes with it.

test("#968 every browser check in scripts/ is either run by CI or declared as one that cannot be", (ctx) => {
  const scripts = checkScripts();
  if (scripts === null) return ctx.skip(skipReason(GUARD));
  const ci = invoked();
  const declared = new Map(CANNOT_RUN_IN_CI.map((d) => [d.path, d.why]));
  const orphans = scripts.filter((s) => !ci.has(s) && !declared.has(s));
  assert.deepEqual(orphans, [],
    `these checks run NOWHERE and say so nowhere:\n  ${orphans.join("\n  ")}\n`
    + `Add the invocation to ${CI_PATH}, or declare it in CANNOT_RUN_IN_CI with the reason it cannot run.`);
});

test("#1489 render-check is INVOKED by CI, and the exemption that kept it out is gone", (ctx) => {
  const scripts = checkScripts();
  if (scripts === null) return ctx.skip(skipReason(GUARD));
  assert.ok(scripts.includes("scripts/render-check.mjs"), "the script this issue is about must still exist");

  // This arm REPLACES "#968 render-check is DECLARED …", which asserted the opposite and was correct
  // until #1489. It is a replacement rather than a deletion because the property worth guarding never
  // changed: the only check that measures a report INSIDE the portal's iframe must not fall out of this
  // file silently. What changed is which side of the ledger it belongs on.
  assert.ok(invoked().has("scripts/render-check.mjs"),
    "render-check must be invoked by " + CI_PATH + " — it joined the blocking browser step in #1489, and "
    + "an invocation deleted without an exemption to replace it is the silent loss this file exists to catch");
  assert.equal(CANNOT_RUN_IN_CI.find((d) => d.path === "scripts/render-check.mjs"), undefined,
    "and it must not ALSO be declared un-runnable — a check listed in both places is a contradiction that "
    + "reads as coverage from either end");
});

test("#968 no declared exemption has gone stale", (ctx) => {
  const scripts = checkScripts();
  if (scripts === null) return ctx.skip(skipReason(GUARD));
  const ci = invoked();
  const present = new Set(scripts);
  for (const { path, why } of CANNOT_RUN_IN_CI) {
    assert.ok(present.has(path), `${path} is declared here and no longer exists — delete the entry`);
    assert.ok(!ci.has(path), `${path} is declared as unable to run in CI and ${CI_PATH} runs it — delete the entry`);
    assert.ok(why.trim().length > 40, `${path}: an exemption without a usable reason is an exemption nobody can retire`);
  }
});

test("#968 the enumeration and the invocation parse both have floors — a broken glob names itself", (ctx) => {
  const scripts = checkScripts();
  if (scripts === null) return ctx.skip(skipReason(GUARD));
  // An absence is a finding. Zero matched scripts, or zero parsed invocations, is the shape in which
  // this whole file silently stops asserting anything while reporting the same green.
  assert.ok(scripts.length >= 9,
    `only ${scripts.length} scripts/*-check.mjs matched — the glob is broken, not the tree`);
  const ci = invoked();
  const checks = [...ci].filter((p) => /-check\.mjs$/.test(p));
  assert.ok(checks.length >= 7,
    `only ${checks.length} check invocations parsed out of ${CI_PATH} — the parse is broken, not the workflow. `
    + `Found: ${checks.join(", ") || "none"}`);
  // And the parse must be reading STEPS, not the prose around them: this string appears only in a
  // comment, so a parse that counted comment lines would pick it up.
  assert.ok(!ci.has("scripts/does-not-exist.mjs"));
});
