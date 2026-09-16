// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// WHERE EACH CHECK RUNS, as data rather than as prose.
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
// This is what those two were routed behind. Their acceptance criteria are browser behaviours no
// clearance round touches, and certifying them by hand-clicking is not certifying them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { publishedOf } from "../../shared/reference-guard-classes.mjs";

const GUARD = "browser-check membership";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CI_PATH = ".github/workflows/ci.yml";
const CI = readFileSync(join(ROOT, CI_PATH), "utf8");

// `git ls-files`, not readdirSync, for the reason shared/tracked-files.mjs gives: a directory walk
// lists a contributor's scratch file and an editor backup too, and the claim here is about what ships.
//
// TWO POPULATIONS, UNIONED, AND THE SECOND ONE IS WHY. The first draft of this file enumerated
// `scripts/*-check.mjs` alone — a NAMING CONVENTION standing in for a property. `report-screenshot.mjs`
// drives a real browser and is not named `-check`, so it sat outside the population entirely: it ran
// nowhere, carried no exemption, and this arm reported green over it. The gap was invisible from inside
// the file, because the arm's own subject was defined by the thing that excluded it.
//
// So the population is also derived from what a script DOES — it spawns the browser binary — and the
// two lists are unioned. Union rather than replacement, because the property matcher can only see a
// literal call site: a check that reached a browser through a helper module would drop out of the
// property list, and swapping one for the other would SHRINK the population while staying green. That
// is the same failure this file exists to catch, one level up. Both halves carry their own floor below.
const CHECK_BY_NAME = ["scripts/*-check.mjs"];

// A CALL, not a mention. `render-check.mjs` says "Needs `google-chrome` on PATH" in a comment, and
// several others discuss it in prose; matching the bare string would pull in anything that merely
// talks about the browser. The binary has to appear as the first argument to a spawning function.
const DRIVES_A_BROWSER = /(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(\s*["'`]google-chrome["'`]/;

// THE OPTIONS OBJECT OF EACH BROWSER SPAWN, so the arm below can ask what was passed rather than
// whether a word appears somewhere in the file. A file-wide search for `env` would pass on a script
// that mentions the environment in a comment and hands the browser nothing.
//
// `null` for a spawn whose options this cannot find, which the arm reports as a failure rather than
// skipping: a call shaped in a way this reader does not understand is exactly the case where the
// answer "no environment was passed" and the answer "I could not tell" must not look alike.
export const browserSpawnOptions = (text) => {
  const out = [];
  const re = new RegExp(DRIVES_A_BROWSER.source, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    const argsEnd = text.indexOf("], {", m.index);
    if (argsEnd === -1) { out.push(null); continue; }
    const open = text.indexOf("{", argsEnd);
    let depth = 0, end = -1;
    for (let j = open; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    out.push(end === -1 ? null : text.slice(open, end + 1));
  }
  return out;
};

// ── THE POPULATION IS WHAT THIS CHECKOUT PUBLISHES, NOT WHAT IT TRACKS ────────────────────────────
//
// This arm judges a script against the PUBLIC `ci.yml` and the PUBLIC exemption list below. The suite
// also runs over a bigger tree: the withheld corpus is laid back over a clone at its pre-cut paths, and
// that overlay stages what it lays without committing it. So under the control, `scripts/` holds files
// that exist in no public repository — and a laid script can be in neither the public workflow nor the
// public exemption list, which made this arm permanently red there over a file the public tree does not
// have.
//
// BOTH OBVIOUS REPAIRS ARE WRONG. Naming a private script in `ci.yml` or in the list below publishes a
// private filename in the public tree. Listing this arm as a known red buries a live diagnosis, which
// the expected-failure list's own header forbids. The right answer is that the arm was asking the wrong
// population: a laid script is judged by the private side's own rules, not by this file.
//
// `publishedOf` is the discriminator and it is exact rather than a heuristic about paths — a laid path
// is in the index and not in HEAD. It is imported rather than re-derived, because the floor and the mint
// already read it and two spellings of "the population" is one population and one guess.
const populations = () => {
  const byName = trackedFiles(GUARD, { root: ROOT, pathspec: CHECK_BY_NAME });
  const allScripts = trackedFiles(GUARD, { root: ROOT, pathspec: ["scripts/*.mjs"] });
  if (byName === null || allScripts === null) return null;

  // A TREE THAT CANNOT SAY WHAT IT PUBLISHED IS A COULD-NOT-LOOK, and it must not read as "nothing is
  // laid here" — that is the permissive answer and the one that passes over a population it never
  // narrowed. It surfaces as the same loud skip as having no checkout at all.
  const pubName = publishedOf(byName, ROOT);
  const pubAll = publishedOf(allScripts, ROOT);
  if (pubName.error || pubAll.error) return { error: pubName.error ?? pubAll.error };

  const byProperty = pubAll.files.filter((f) => {
    try { return DRIVES_A_BROWSER.test(readFileSync(join(ROOT, f), "utf8")); } catch { return false; }
  });
  const union = [...new Set([...pubName.files, ...byProperty])].sort();
  return { byName: pubName.files.slice().sort(), byProperty: byProperty.slice().sort(), union,
    laid: pubName.laid + pubAll.laid };
};

const checkScripts = () => {
  const p = populations();
  if (p === null) return null;
  if (p.error) return { error: p.error };
  return p.union;
};

/** The skip sentence for either could-not-look: no checkout at all, or a checkout with no HEAD. */
const cannotLook = (scripts) => (scripts === null ? skipReason(GUARD)
  : scripts?.error ? `${GUARD} — ${scripts.error}` : null);

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
// the workflow instead — that is what the declaration rule was about.
const CANNOT_RUN_IN_CI = [
  {
    path: "scripts/report-screenshot.mjs",
    why: "it ASSERTS NOTHING, so there is no verdict for CI to fail on. It takes the path of a report "
      + "the demo publisher has already rendered and captures one frame of it for the README — there is "
      + "no such path in a fresh checkout, and nothing about the picture it writes is a pass or a fail. "
      + "It also allows network and loads the brand webfonts ON PURPOSE, which is the exact opposite of "
      + "the render checks: those block DNS so a layout fails the way CI fails, in fallback fonts. Two "
      + "intents, and wiring this one into the browser job would break the other's reason for existing.",
  },
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

test("every browser check in scripts/ is either run by CI or declared as one that cannot be", (ctx) => {
  const scripts = checkScripts();
  const why = cannotLook(scripts);
  if (why) return ctx.skip(why);
  const ci = invoked();
  const declared = new Map(CANNOT_RUN_IN_CI.map((d) => [d.path, d.why]));
  const orphans = scripts.filter((s) => !ci.has(s) && !declared.has(s));
  assert.deepEqual(orphans, [],
    `these checks run NOWHERE and say so nowhere:\n  ${orphans.join("\n  ")}\n`
    + `Add the invocation to ${CI_PATH}, or declare it in CANNOT_RUN_IN_CI with the reason it cannot run.`);
});

test("render-check is INVOKED by CI, and the exemption that kept it out is gone", (ctx) => {
  const scripts = checkScripts();
  const why = cannotLook(scripts);
  if (why) return ctx.skip(why);
  assert.ok(scripts.includes("scripts/render-check.mjs"), "the script this issue is about must still exist");

  // This arm REPLACES an earlier "render-check is DECLARED …", which asserted the opposite and was correct
  // until the workflow moved. It is a replacement rather than a deletion because the property worth guarding never
  // changed: the only check that measures a report INSIDE the portal's iframe must not fall out of this
  // file silently. What changed is which side of the ledger it belongs on.
  assert.ok(invoked().has("scripts/render-check.mjs"),
    "render-check must be invoked by " + CI_PATH + " — it joined the blocking browser step in #1489, and "
    + "an invocation deleted without an exemption to replace it is the silent loss this file exists to catch");
  assert.equal(CANNOT_RUN_IN_CI.find((d) => d.path === "scripts/render-check.mjs"), undefined,
    "and it must not ALSO be declared un-runnable — a check listed in both places is a contradiction that "
    + "reads as coverage from either end");
});

test("no declared exemption has gone stale", (ctx) => {
  const scripts = checkScripts();
  const why = cannotLook(scripts);
  if (why) return ctx.skip(why);
  const ci = invoked();
  const present = new Set(scripts);
  for (const { path, why } of CANNOT_RUN_IN_CI) {
    assert.ok(present.has(path), `${path} is declared here and no longer exists — delete the entry`);
    assert.ok(!ci.has(path), `${path} is declared as unable to run in CI and ${CI_PATH} runs it — delete the entry`);
    assert.ok(why.trim().length > 40, `${path}: an exemption without a usable reason is an exemption nobody can retire`);
  }
});

test("the enumeration and the invocation parse both have floors — a broken glob names itself", (ctx) => {
  const scripts = checkScripts();
  const why = cannotLook(scripts);
  if (why) return ctx.skip(why);
  // An absence is a finding. Zero matched scripts, or zero parsed invocations, is the shape in which
  // this whole file silently stops asserting anything while reporting the same green.
  assert.ok(scripts.length >= 9,
    `only ${scripts.length} script(s) in the union — the enumeration is broken, not the tree`);
  // AND A FLOOR ON EACH HALF SEPARATELY. A union floors at the size of whichever half still works, so
  // one matcher can break completely while the total stays above the line. These two are what make a
  // broken glob and a broken property matcher name themselves instead of hiding behind each other.
  const pop = populations();
  assert.ok(pop.byName.length > 3,
    `only ${pop.byName.length} matched ${CHECK_BY_NAME.join(", ")} — the name glob is broken, not the tree`);
  assert.ok(pop.byProperty.length > 3,
    `only ${pop.byProperty.length} script(s) matched as driving a browser — the property matcher is broken, `
    + `not the tree. It looks for the binary as the first argument to a spawn, so a refactor behind a helper `
    + `module would empty it silently`);
  const ci = invoked();
  const checks = [...ci].filter((p) => /-check\.mjs$/.test(p));
  assert.ok(checks.length >= 7,
    `only ${checks.length} check invocations parsed out of ${CI_PATH} — the parse is broken, not the workflow. `
    + `Found: ${checks.join(", ") || "none"}`);
  // And the parse must be reading STEPS, not the prose around them: this string appears only in a
  // comment, so a parse that counted comment lines would pick it up.
  assert.ok(!ci.has("scripts/does-not-exist.mjs"));
});

// ── EVERY BROWSER SPAWN GETS A TEMP ROOT OF ITS OWN ──────────────────────────────────────────────
//
// A browser writes its process-singleton lock into the SYSTEM temp directory, not into the profile
// directory it is given, and under a name the caller never learns. Every check here removed its own
// profile and none could remove that; the residue was thousands of lock directories under one shared
// temp root, left by runs that ended before their cleanup.
//
// The fix is per-run and therefore per-call-site, which is what makes it worth a guard: a check added
// later that spawns a browser the old way leaks again, and nothing about its own run would say so.
// This asserts the WIRING — that the helper reaches the spawn — over the same discovered population
// the rest of this file uses, so a launcher cannot be outside both checks at once.
const TEMP_ROOT_MODULE = "shared/browser-temp-root.mjs";

test("every script that spawns a browser passes it an environment", (ctx) => {
  const p = populations();
  if (p === null || p.error) return ctx.skip(p?.error ? `${GUARD} — ${p.error}` : skipReason(GUARD));
  const faults = [];
  for (const f of p.byProperty) {
    const text = readFileSync(join(ROOT, f), "utf8");
    const blocks = browserSpawnOptions(text);
    if (blocks.length === 0) { faults.push(`${f}: matched as driving a browser but no spawn was found`); continue; }
    blocks.forEach((b, i) => {
      if (b === null) faults.push(`${f}: spawn ${i + 1} has options this arm could not read — say so, do not assume`);
      else if (!/\benv\s*:/.test(b)) faults.push(`${f}: spawn ${i + 1} passes no env, so the browser inherits the shared temp directory`);
    });
  }
  assert.deepEqual(faults, [],
    `these browser spawns leak a lock directory into the shared temp root:\n  ${faults.join("\n  ")}\n`
    + `Take the root and the environment from ${TEMP_ROOT_MODULE} and pass it as the spawn's \`env\`.`);
});

test("and takes that environment from the one module that owns the temp root", (ctx) => {
  const p = populations();
  if (p === null || p.error) return ctx.skip(p?.error ? `${GUARD} — ${p.error}` : skipReason(GUARD));
  // The env assertion above can be satisfied by any object. This is what stops a second, hand-rolled
  // TMPDIR appearing beside the helper — two definitions of where a browser's lock goes is one
  // definition and one imitation of it, and the imitation is whichever the reader did not run.
  const missing = p.byProperty.filter((f) => !readFileSync(join(ROOT, f), "utf8").includes(TEMP_ROOT_MODULE));
  assert.deepEqual(missing, [],
    `these spawn a browser without importing ${TEMP_ROOT_MODULE}:\n  ${missing.join("\n  ")}\n`
    + `The budget check lives there too: past 66 characters of root the browser aborts with a core dump `
    + `rather than reporting anything, and only that module refuses instead of letting it.`);
});

test("the temp-root population has a floor — an empty one is not a clean sweep", (ctx) => {
  const p = populations();
  if (p === null || p.error) return ctx.skip(p?.error ? `${GUARD} — ${p.error}` : skipReason(GUARD));
  // Both arms above iterate `byProperty`. An empty list passes both while asserting nothing, and the
  // property matcher CAN empty itself — it reads a literal call site, so a refactor behind a helper
  // module removes every member at once.
  assert.ok(p.byProperty.length >= 9,
    `only ${p.byProperty.length} script(s) matched as spawning a browser; the two arms above iterate `
    + `that list, so this is the enumeration breaking rather than the tree being clean`);
});

// A CHECK THAT PROMISES TO KEEP THE PROFILE MUST TAKE ITS ROOT OUT OF THE SWEEP.
//
// The profile directory now lives inside a run root that is removed when the process exits. Four of
// these checks take a `--keep` flag whose entire purpose is to leave that directory behind for
// somebody to open after a run that went wrong. Wiring the root without wiring the flag defeated all
// four at once, and defeated them SILENTLY: the flag still parsed, and the removal it guarded still
// did not run, so nothing about the check's own output changed.
//
// Neither arm above can see it — an environment still reaches the spawn and the module is still
// imported. The property is different: the flag must reach the deregistration.
const KEEP_FLAG = /--keep/;
const DEREGISTERS = /if\s*\(\s*(?:keep|has\(\s*["']keep["']\s*\))\s*\)\s*[A-Za-z_$][\w$]*\s*\(\s*\)/;

test("a browser check offering --keep takes its run root out of the exit sweep", (ctx) => {
  const p = populations();
  if (p === null || p.error) return ctx.skip(p?.error ? `${GUARD} — ${p.error}` : skipReason(GUARD));
  const offering = p.byProperty.filter((f) => KEEP_FLAG.test(readFileSync(join(ROOT, f), "utf8")));
  // A FLOOR ON THE POPULATION, because the arm is vacuous over an empty one and the selector is a
  // regex over source: rename the flag and this stops looking at anything while staying green.
  assert.ok(offering.length >= 4,
    `only ${offering.length} check(s) matched as offering --keep; four do, so this is the selector `
    + `breaking rather than the flag going away`);
  const broken = offering.filter((f) => !DEREGISTERS.test(readFileSync(join(ROOT, f), "utf8")));
  assert.deepEqual(broken, [],
    `these offer --keep but let the exit sweep remove the root anyway:\n  ${broken.join("\n  ")}\n`
    + `Call the handle browserRun returns as \`keep\` (or removeOnExit's return) when the flag is set, `
    + `or the flag reads as working while the directory it promises goes at exit.`);
});

// ── THE DISCRIMINATOR ITSELF, DRIVEN ───────────────────────────────────────────────────────────────
//
// The narrowing above is the whole fix for a red this arm carried under the private control, so it is
// driven rather than described. A laid path is in the index and NOT in HEAD — that is exact, and it is
// what a real overlay produces: it stages what it lays and never commits it.
//
// Built here rather than asserted about the real tree, because the public checkout has nothing laid in
// it: an arm that only checked `laid === 0` here would pass just as well if the discriminator had been
// deleted.
test("a script staged but never committed is OUT of the population, and one in HEAD is in", () => {
  const dir = mkdtempSync(join(tmpdir(), "browser-check-laid-"));
  try {
    const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "t@example.test");
    git("config", "user.name", "t");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "published-check.mjs"), "// published\n");
    git("add", "scripts/published-check.mjs");
    git("commit", "-qm", "published");

    // Laid: staged at its path and never committed, exactly as the overlay leaves it.
    writeFileSync(join(dir, "scripts", "laid-check.mjs"), "// laid by the overlay\n");
    git("add", "scripts/laid-check.mjs");

    const tracked = git("ls-files").split("\n").filter(Boolean);
    assert.ok(tracked.includes("scripts/laid-check.mjs"),
      "the fixture is wrong: a staged file must be tracked, or this arm proves nothing");

    const pub = publishedOf(tracked, dir);
    assert.equal(pub.error, undefined, `publishedOf could not read HEAD: ${pub.error}`);
    assert.deepEqual(pub.files, ["scripts/published-check.mjs"],
      "the committed script must stay in the population");
    assert.equal(pub.laid, 1, "the staged-not-committed script must be counted as laid and excluded");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a tree with no HEAD is a could-not-look, never an empty population", () => {
  // THE PERMISSIVE READING IS THE DANGEROUS ONE. A tree that cannot say what it published must not
  // answer "nothing is laid here", because that is the answer that passes over a population never
  // narrowed. It has to come back as an error the arms turn into a loud skip.
  const dir = mkdtempSync(join(tmpdir(), "browser-check-nohead-"));
  try {
    execFileSync("git", ["-C", dir, "init", "-q"]);
    const pub = publishedOf(["scripts/whatever-check.mjs"], dir);
    assert.ok(pub.error, "a repository with no commit must report an error, not an empty laid count");
    assert.equal(pub.files, undefined, "and it must not hand back a population it could not compute");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
