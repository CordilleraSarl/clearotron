#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// deprecate-below.mjs — put one warning on every published version below a named stable, or on a named
// range of published versions.
//
//   node scripts/deprecate-below.mjs --below 0.3.1 [--dry-run]
//   node scripts/deprecate-below.mjs --range "0.2.0..0.4.0-beta.0 except 0.3.3" [--dry-run]
//
// ── WHY THIS IS A SCRIPT IN CI AND NOT SOMETHING A PERSON RUNS ──────────────────────────────────────
//
// Nobody on a development box can do it: the publish credential lives only in CI, `npm whoami` is 401
// there by design, and that design is not something to work around. So the work is a script, and the way
// a person asks for it is a workflow dispatch.
//
// ── WHAT IT REFUSES, AND WHY EACH REFUSAL IS CHEAPER THAN THE MISTAKE ───────────────────────────────
//
// `npm deprecate` takes a RANGE, and a range is the dangerous part: `npm deprecate pkg "<1.0.0"` is one
// command that can warn every version a project ever shipped, and the undo is another command per
// version. So no range reaches npm from here. The versions are enumerated, compared one at a time, and
// deprecated one at a time, which is slower and is the point.
//
// THE NAMED STABLE IS NEVER TOUCHED, nor is anything above it. A message telling a reader to upgrade to
// the version they are already on is worse than no message: it reads as a defect in the version they
// just chose.
//
// ALREADY-DEPRECATED VERSIONS ARE LEFT ALONE. Re-deprecating replaces one message with another, and the
// existing one may be more specific than this one — a security note, say.
//
// ── THE READ-BACK IS PER VERSION, AND THAT IS NOT A STYLE CHOICE ────────────────────────────────────
//
// `npm view <pkg> deprecated --json` over a range returns a value whose SHAPE depends on how many
// versions matched: a string for one, an object keyed by version for several, and nothing at all for
// none. Reading that as a map is how a verification passes over versions it never checked. So each
// version is read back on its own, by its own exact spec, and the answer is a string or it is absent.
import { execFileSync } from "node:child_process";

const PKG = "clearotron";

// NOTHING HAPPENS AT IMPORT. The argument parsing and its refusal used to sit here at the top, so
// importing this module to test its comparison ran the refusal and exited 2 before a single arm ran. A
// CLI module that does work when required is the same defect this repository has met with a top-level
// await, and the same fix: the body belongs in `main`, and `main` runs only from the entry check.

/** Compare two semver-ish versions. A pre-release sorts BELOW its own release, which is what npm means. */
export function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre = ""] = String(v).split("-");
    return { nums: core.split(".").map((n) => Number(n) || 0), pre };
  };
  const A = split(a), B = split(b);
  for (let i = 0; i < 3; i++) {
    if ((A.nums[i] ?? 0) !== (B.nums[i] ?? 0)) return (A.nums[i] ?? 0) < (B.nums[i] ?? 0) ? -1 : 1;
  }
  // Same core. No pre-release outranks any pre-release; two pre-releases compare as text, which is
  // right for `beta.2` against `beta.10` only up to ten — so the identifiers are compared numerically
  // where they are numbers.
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  const ap = A.pre.split("."), bp = B.pre.split(".");
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const x = ap[i], y = bp[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x), ny = Number(y);
    if (Number.isInteger(nx) && Number.isInteger(ny)) return nx < ny ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// ── THE RANGE MODE: A NAMED SET OF VERSIONS, ONE SENTENCE, NO REASON GIVEN ──────────────────────────
//
// Some versions have to be warned that are not simply "everything below a stable": a stretch of betas
// and stables with one version held out because an install still runs it. The range says exactly that,
// inclusive at both ends in npm's own order, and the exceptions are named one by one.
//
// ITS SENTENCE IS FIXED HERE AND NOT TYPED AT DISPATCH. It is public text on every version page, so it
// is the owner's sentence, approved word for word, and a dispatch box is no place to redraft it.
//
// IT REPLACES AN OLDER MESSAGE IN THE RANGE, unlike the mode above. A range is warned for one reason, so
// every version in it reads the same; a version that already says exactly this is left alone.
//
// IT NEVER TOUCHES A VERSION A DIST-TAG POINTS AT. `latest` and `beta` are what `npm install` resolves
// to, and a warning on the version a reader is told to install is worse than none.
export const RANGE_MESSAGE = "This version is no longer supported. Please upgrade to the latest version of clearotron.";

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;

/** Read "<from>..<through>[ except <v>[,<v>…]]". Throws on anything else. */
export function parseRangeSpec(spec) {
  const m = String(spec ?? "").trim().match(/^(\S+)\.\.(\S+?)(?:\s+except\s+(\S+))?$/);
  if (!m) throw new Error(`"${spec}" is not a range: write <from>..<through>, optionally followed by " except <v>,<v>"`);
  const [, from, through, ex = ""] = m;
  const except = ex ? ex.split(",").map((v) => v.trim()).filter(Boolean) : [];
  for (const v of [from, through, ...except]) if (!VERSION.test(v)) throw new Error(`"${v}" is not a version`);
  if (compareVersions(from, through) > 0) throw new Error(`${from} is above ${through}: the range is empty`);
  return { from, through, except };
}

/**
 * The published versions a range names, in order: from and through inclusive, the exceptions out.
 * Throws, before anything is written, when a bound is not published, an exception lies outside the
 * range or is not published, or a selected version is one a dist-tag points at.
 */
export function selectRange(all, { from, through, except }, distTags = {}) {
  for (const b of [from, through]) if (!all.includes(b)) throw new Error(`${b} is not a published version of ${PKG}`);
  const inRange = (v) => compareVersions(v, from) >= 0 && compareVersions(v, through) <= 0;
  for (const e of except) {
    if (!all.includes(e)) throw new Error(`the exception ${e} is not a published version of ${PKG}`);
    if (!inRange(e)) throw new Error(`the exception ${e} lies outside ${from}..${through}`);
  }
  const picked = all.filter((v) => inRange(v) && !except.includes(v)).sort(compareVersions);
  const tagged = Object.entries(distTags).filter(([, v]) => picked.includes(v));
  if (tagged.length) {
    throw new Error(`the range takes ${tagged.map(([t, v]) => `${v} (${t})`).join(", ")}, which a dist-tag points at; `
      + "move the tag or hold the version out");
  }
  return picked;
}

const npm = (...args) => execFileSync("npm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Every published version, and the deprecation message each carries. Read once, as a list. */
function published() {
  const versions = JSON.parse(npm("view", PKG, "versions", "--json"));
  return Array.isArray(versions) ? versions : [versions];
}

/** How long to keep asking the registry to show a write it has already accepted. */
export const CONFIRM_BUDGET_MS = 90_000;
const CONFIRM_STEP_MS = 3_000;

/**
 * Confirm writes the registry has ACCEPTED but may not be serving yet.
 *
 * WHY THIS IS A SECOND PASS AND NOT A READ AFTER EACH WRITE. `npm deprecate` returns when the registry
 * has taken the write, not when every reader can see it. Reading back one line later asks a question
 * the registry has not finished answering, and on 2026-09-17 that reported ELEVEN successful
 * deprecations as failures — run 35219705516, where the messages were all in place minutes later and
 * the job had already exited 1. The outside read was the truth and the job's red was not evidence.
 *
 * SO THE WRITES GO FIRST AND THE READING COMES AFTER, which also collapses a per-version read into one
 * pass over what is left. Anything still unseen is asked for again until the budget runs out.
 *
 * A WRITE THAT WAS ACCEPTED AND IS NOT YET VISIBLE IS NOT A FAILED WRITE, and the caller is told so in
 * those words rather than having the two folded together. `npm deprecate` exiting 0 is what says the
 * write happened; this pass says whether the registry is serving it yet.
 */
export async function confirmWrites({ versions, read, sleep, now = () => Date.now(),
                                      budgetMs = CONFIRM_BUDGET_MS, stepMs = CONFIRM_STEP_MS }) {
  const pending = new Set(versions);
  const confirmed = [];
  const started = now();
  while (pending.size) {
    for (const v of [...pending]) {
      let msg = null;
      try { msg = read(v); } catch { msg = null; }   // a read that threw is asked again, not judged
      if (msg) { confirmed.push(v); pending.delete(v); }
    }
    if (!pending.size || now() - started >= budgetMs) break;
    await sleep(stepMs);
  }
  return { confirmed, unconfirmed: [...pending], waitedMs: now() - started };
}

/** One version's deprecation message, read by its own exact spec. Null when it carries none. */
function deprecationOf(version) {
  // `--json` on a field that is absent prints nothing at all, which JSON.parse refuses. An empty read is
  // "this version carries no message", and it is a different fact from a read that failed — so a failure
  // throws and a caller decides, rather than being folded into "not deprecated".
  const out = npm("view", `${PKG}@${version}`, "deprecated", "--json").trim();
  if (!out) return null;
  const v = JSON.parse(out);
  return typeof v === "string" && v.trim() ? v : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const DRY = argv.includes("--dry-run");
  const range = at("--range");
  if (range) return deprecateRange(range, DRY);
  const below = at("--below");
  if (!below) {
    console.error("deprecate-below: --below <version> or --range \"<from>..<through> except <v>\" is required.");
    return 2;
  }
  const MESSAGE = `This version is superseded. Please upgrade to ${below} or later: npm install ${PKG}@${below}`;

  const all = published();
  if (!all.length) {
    console.error("deprecate-below: the registry listed no versions — refusing rather than reporting zero to deprecate.");
    return 2;
  }
  if (!all.includes(below)) {
    console.error(`deprecate-below: ${below} is not a published version of ${PKG}. `
      + "Refusing: pointing readers at a version that does not exist is worse than leaving them unwarned.");
    return 2;
  }

  const candidates = all.filter((v) => compareVersions(v, below) < 0);
  console.log(`deprecate-below: ${all.length} published version(s); ${candidates.length} below ${below}.`);

  let done = 0, skipped = 0, failed = 0;
  const wrote = [];
  for (const v of candidates) {
    let existing;
    try { existing = deprecationOf(v); }
    catch (e) {
      console.error(`  ${v}: could NOT be read (${String(e.message).split("\n")[0]}) — left alone.`);
      failed += 1;
      continue;
    }
    if (existing) { console.log(`  ${v}: already deprecated — left alone ("${existing.slice(0, 60)}")`); skipped += 1; continue; }
    if (DRY) { console.log(`  ${v}: would deprecate`); done += 1; continue; }
    try {
      npm("deprecate", `${PKG}@${v}`, MESSAGE);
    } catch (e) {
      console.error(`  ${v}: deprecate FAILED — ${String(e.stderr ?? e.message).split("\n")[0]}`);
      failed += 1;
      continue;
    }
    // ACCEPTED. Whether the registry is SERVING it yet is asked once, after every write, below.
    console.log(`  ${v}: deprecate accepted`);
    wrote.push(v);
  }

  // ── NOW ASK WHETHER THE REGISTRY IS SERVING THEM ────────────────────────────────────────────────
  let confirmed = [], unconfirmed = [], waitedMs = 0;
  if (wrote.length && !DRY) {
    ({ confirmed, unconfirmed, waitedMs } = await confirmWrites({
      versions: wrote,
      read: (v) => deprecationOf(v),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    }));
    done += confirmed.length;
    for (const v of confirmed) console.log(`  ${v}: serving the message`);
    for (const v of unconfirmed) {
      console.error(`  ${v}: WRITE ACCEPTED, not yet served after ${Math.round(waitedMs / 1000)}s — `
        + "the registry took it and is not showing it yet. Read the version from outside before treating "
        + "this as undone; re-running is safe and will report it as already deprecated.");
    }
  } else if (DRY) {
    done += wrote.length;
  }

  console.log(`deprecate-below: ${done} deprecated, ${skipped} already carried a message, `
    + `${unconfirmed.length} accepted but not yet served, ${failed} failed.`);
  // ONLY A FAILED WRITE IS A FAILURE. A write the registry accepted and has not caught up on is not a
  // release gone wrong, and exiting 1 for it is what turned eleven successful deprecations into a red.
  return failed ? 1 : 0;
}

/** The range mode's run: select, write the fixed sentence where it is not already, read each back. */
async function deprecateRange(spec, DRY) {
  let picked;
  try {
    const parsed = parseRangeSpec(spec);
    const all = published();
    if (!all.length) throw new Error("the registry listed no versions");
    const distTags = JSON.parse(npm("view", PKG, "dist-tags", "--json"));
    picked = selectRange(all, parsed, distTags);
    console.log(`deprecate-below: ${all.length} published version(s); ${picked.length} in ${spec}.`);
  } catch (e) {
    console.error(`deprecate-below: refusing — ${e.message}. Nothing was written.`);
    return 2;
  }
  let done = 0, skipped = 0, failed = 0;
  const wrote = [];
  for (const v of picked) {
    let existing;
    try { existing = deprecationOf(v); }
    catch (e) {
      console.error(`  ${v}: could NOT be read (${String(e.message).split("\n")[0]}) — left alone.`);
      failed += 1;
      continue;
    }
    if (existing === RANGE_MESSAGE) { console.log(`  ${v}: already carries this message`); skipped += 1; continue; }
    const was = existing ? ` (replacing "${existing.slice(0, 60)}")` : "";
    if (DRY) { console.log(`  ${v}: would deprecate${was}`); done += 1; continue; }
    try {
      npm("deprecate", `${PKG}@${v}`, RANGE_MESSAGE);
    } catch (e) {
      console.error(`  ${v}: deprecate FAILED — ${String(e.stderr ?? e.message).split("\n")[0]}`);
      failed += 1;
      continue;
    }
    console.log(`  ${v}: deprecate accepted${was}`);
    wrote.push(v);
  }
  let unconfirmed = [];
  if (wrote.length && !DRY) {
    // A replaced message is confirmed only once THIS sentence is served, not merely any sentence.
    const r = await confirmWrites({
      versions: wrote,
      read: (v) => (deprecationOf(v) === RANGE_MESSAGE ? RANGE_MESSAGE : null),
      sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    });
    unconfirmed = r.unconfirmed;
    done += r.confirmed.length;
    for (const v of r.confirmed) console.log(`  ${v}: serving the message`);
    for (const v of unconfirmed) {
      console.error(`  ${v}: WRITE ACCEPTED, not yet served after ${Math.round(r.waitedMs / 1000)}s — read it from `
        + "outside before treating it as undone; re-running is safe and reports it as already carrying the message.");
    }
  }
  console.log(`deprecate-below: ${done} ${DRY ? "would be " : ""}deprecated, ${skipped} already carried this message, `
    + `${unconfirmed.length} accepted but not yet served, ${failed} failed.`);
  return failed ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("deprecate-below.mjs")) process.exit(await main());
