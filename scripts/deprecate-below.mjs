#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// deprecate-below.mjs — put one warning on every published version below a named stable.
//
//   node scripts/deprecate-below.mjs --below 0.3.1 [--dry-run]
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

const npm = (...args) => execFileSync("npm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Every published version, and the deprecation message each carries. Read once, as a list. */
function published() {
  const versions = JSON.parse(npm("view", PKG, "versions", "--json"));
  return Array.isArray(versions) ? versions : [versions];
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

function main() {
  const argv = process.argv.slice(2);
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const DRY = argv.includes("--dry-run");
  const below = at("--below");
  if (!below) {
    console.error("deprecate-below: --below <version> is required — the stable everything under it points at.");
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
    // READ BACK, PER VERSION, and report what the registry says rather than that the command exited 0.
    let now = null;
    try { now = deprecationOf(v); } catch { now = null; }
    if (now) { console.log(`  ${v}: deprecated — registry reads back "${now.slice(0, 60)}"`); done += 1; }
    else { console.error(`  ${v}: deprecate reported success and the registry reads back NOTHING.`); failed += 1; }
  }

  console.log(`deprecate-below: ${done} deprecated, ${skipped} already carried a message, ${failed} failed.`);
  return failed ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("deprecate-below.mjs")) process.exit(main());
