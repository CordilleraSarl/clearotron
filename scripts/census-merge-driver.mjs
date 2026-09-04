#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// census-merge-driver.mjs — resolve driver/suite-census.json's merge by UNION, not by text.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────
//
// The census is a persisted expectation and must stay one: a committed test deletion vanishes from git,
// from the collection glob and from the TAP output at the same instant, so only something written down
// beforehand notices. A census that regenerated itself would guard nothing. That rules out deriving it,
// and it is why the file is committed at all.
//
// The cost of committing it is that every branch touching a test file re-stamps it, and two branches
// that both re-stamped CONFLICT. made `perFile` a per-file map expecting it to "auto-merge to the
// union". It does not: git merges LINES, not JSON. Two branches adding entries in the same alphabetical
// neighbourhood of a 687-key object touch one hunk, and adjacency is decided by filename, which nobody
// chooses. A per-file map made conflicts rarer; it could not make them impossible. Measured over one
// session: two conflicts and three forced re-stamps across five merges.
//
// ── WHY A UNION AND NOT "RE-RUN THE MINTER" ─────────────────────────────────────────────────────────
//
// Re-running the minter here is the obvious idea and it is wrong, for a concrete reason: a merge driver
// runs PER FILE, DURING the merge. The working tree at that moment holds some files merged and some not,
// so the minter would count a tree that is neither branch's and possibly no branch's. It would produce a
// confident number for a state that never existed.
//
// A union of the two censuses is deterministic, invents nothing, and is exactly what the minter WOULD
// produce for the merged file set — because a merge that adds branch A's test files and branch B's test
// files has both, and the census entry for a file is a property of that file alone.
//
// ── WHY THIS CANNOT SILENTLY LAND A WRONG CENSUS ────────────────────────────────────────────────────
//
// Because the union is not trusted. `driver/test/suite-census.test.mjs` runs
// `mint-suite-census.mjs --check` against the ACTUAL tree and asserts it "matches this tree" — so a
// union that does not describe what was merged reds the suite exactly as a stale hand-stamp does. This
// driver removes a conflict; it does not remove the check. That is the whole safety argument, and if
// that arm is ever weakened this file becomes unsafe with it.
//
// ── WHAT IT STILL REFUSES ───────────────────────────────────────────────────────────────────────────
//
// Both sides changing the SAME file's counts to DIFFERENT values is a real disagreement — two branches
// edited one test file — and it exits non-zero so git raises the conflict a human should see. A driver
// that silently picked a side there would be the "matches neither tree" failure in a new costume.

import { readFileSync, writeFileSync } from "node:fs";

const [, , oursPath, basePath, theirsPath] = process.argv;
if (!oursPath || !basePath || !theirsPath) {
  console.error("census-merge-driver: expected %A %O %B — refusing rather than guessing which file is which");
  process.exit(2);
}

const read = (p, label) => {
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch (e) {
    // An unreadable side is not an empty side. Falling back to "{}" here would silently delete every
    // entry that side carried, which is the deletion this whole file exists to make visible.
    console.error(`census-merge-driver: could not read the ${label} census (${p}): ${e.message}`);
    console.error("  Refusing — an unreadable side and an empty side are not the same thing.");
    process.exit(2);
  }
};

const ours = read(oursPath, "ours"), base = read(basePath, "base"), theirs = read(theirsPath, "theirs");
const conflicts = [];

/**
 * KEY ORDER IS PART OF THE OUTPUT, not a cosmetic detail — found by using this driver on a real merge.
 *
 * `mint-suite-census.mjs --check` compares `JSON.stringify(prev) === JSON.stringify(next)`, a byte
 * comparison, and the minter emits keys in `git ls-files` order, which is sorted. A union built by
 * iterating ours-then-theirs appends each of theirs' new files at the END of the map instead of in its
 * sorted place. The result is a census that is SEMANTICALLY PERFECT and still fails --check.
 *
 * That failure is worse than the conflict this driver removes. It reds the suite for a union that
 * describes the merged tree exactly, its diff summary reports "no file added, removed, grown or shrunk"
 * because nothing did, and the only way through is a re-mint — which teaches the reader to re-mint
 * reflexively on a red they have been shown is meaningless. The safety argument above depends on that
 * check firing only when the union is WRONG.
 *
 * Measured 2026-08-26, merging main into this very branch: one file arrived from the other side, landed
 * at the end of a 691-key map, and --check failed with an empty diff summary.
 */
const byKey = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));

/** Three-way union of one `perFile` map. A key both sides changed differently is a conflict, not a pick. */
function mergePerFile(o = {}, b = {}, t = {}, where) {
  const out = {};
  for (const k of new Set([...Object.keys(o), ...Object.keys(t)])) {
    const inO = Object.hasOwn(o, k), inT = Object.hasOwn(t, k);
    const sO = inO ? JSON.stringify(o[k]) : null, sT = inT ? JSON.stringify(t[k]) : null;
    const sB = Object.hasOwn(b, k) ? JSON.stringify(b[k]) : null;
    if (inO && inT) {
      if (sO === sT) { out[k] = o[k]; continue; }
      // One side changed it and the other did not → take the changed one. Both changed it differently →
      // two branches edited the same test file and only a human knows which count is right.
      if (sO === sB) { out[k] = t[k]; continue; }
      if (sT === sB) { out[k] = o[k]; continue; }
      conflicts.push(`${where}/${k}: ours ${sO} vs theirs ${sT}`);
      out[k] = o[k];
      continue;
    }
    // Present on one side only. Absent-because-added and absent-because-DELETED are different, and the
    // base is what tells them apart: absent from base ⇒ the other side added it, keep it. Present in
    // base ⇒ this side deleted it deliberately, and a deletion must survive the merge or the census
    // stops catching the very thing it was built for.
    const side = inO ? o : t;
    if (sB === null) out[k] = side[k];
  }
  return byKey(out);
}

function mergeGroup(oG = {}, bG = {}, tG = {}, label) {
  const out = {};
  for (const name of new Set([...Object.keys(oG), ...Object.keys(tG)])) {
    const o = oG[name], t = tG[name], b = bG[name] ?? {};
    if (!o) { out[name] = t; continue; }
    if (!t) { out[name] = o; continue; }
    out[name] = { ...o, ...t, perFile: mergePerFile(o.perFile, b.perFile, t.perFile, `${label}.${name}`) };
  }
  // Group names too: a workspace added on the other side would otherwise land last, for the same reason.
  return byKey(out);
}

// `_README` is prose about the file, not data in it. Take whichever side changed it; if both did, that is
// a documentation disagreement and a human should read it.
let readme = ours._README;
const sO = JSON.stringify(ours._README), sB = JSON.stringify(base._README), sT = JSON.stringify(theirs._README);
if (sO !== sT) {
  if (sO === sB) readme = theirs._README;
  else if (sT !== sB) conflicts.push("_README: both sides rewrote the census's own explanation");
}

const merged = {
  _README: readme,
  workspaces: mergeGroup(ours.workspaces, base.workspaces, theirs.workspaces, "workspaces"),
  rootScripts: mergeGroup(ours.rootScripts, base.rootScripts, theirs.rootScripts, "rootScripts"),
};

if (conflicts.length) {
  console.error(`census-merge-driver: ${conflicts.length} entr(y/ies) changed on BOTH sides — not ours to pick:`);
  for (const c of conflicts.slice(0, 10)) console.error(`  ${c}`);
  console.error("  Resolve by hand, or re-run `node scripts/mint-suite-census.mjs --apply` on the merged tree.");
  process.exit(1);
}

writeFileSync(oursPath, `${JSON.stringify(merged, null, 2)}\n`);
process.exit(0);
