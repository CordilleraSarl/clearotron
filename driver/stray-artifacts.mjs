// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stray-artifacts.mjs —: a document nobody dictated is a document nobody validated.
//
// R2 @d90d9bd, 2026-08-06, `common-law-half:a`. The run dir came out carrying TWO half-a findings files:
//
//   COMMON-LAW-FINDINGS.half-a.md   18 KB, 08:57   ← nobody asked for this
//   common-law-findings.half-a.md   36 KB, 09:21   ← the dictated output
//
// Different documents, not a copy. `grep -c COMMON-LAW-FINDINGS _driver/run.jsonl` → 0: the driver never
// dictated that path, never validated it, never read it. The model invented a filename and wrote 18 KB
// to it, and the run dir is PUBLISHED AND ARCHIVED. A reader cannot tell the two apart by name, and the
// stray one is the stale one.
//
// Nothing functional broke, and this does not pretend otherwise — it LOGS. Never deletes, never fails a
// run, never gates. Deleting a file a model wrote would destroy evidence about a stage's behaviour, and
// failing the run would turn a cosmetic defect into a lost clearance; the whole value here is that the
// stray stops being invisible. An absence of dictation is a finding in exactly the way an absent file is.
//
// CASE-SENSITIVE BY CONSTRUCTION, and that is not an accident: the observed stray differs from the real
// artifact ONLY in case, so a tolerant compare would have waved through the one file this module exists
// to catch. The filesystem is case-sensitive and both files existed independently.
//
// PURE (no node imports) — the caller reads the directory, this decides. Tests offline.
// common-law-receipts.mjs is pure too, so importing the seat vocabulary from it keeps that promise and
// keeps ONE definition of which seats a split run has.
import { GRID_SEATS } from "./common-law-receipts.mjs";
import { gridProvenancePath } from "./engine/mcp/grid-provenance.mjs";   // — the sidecar's name comes from its writer, never a second spelling

/**
 * Every artifact path the driver dictates, from the paths() factory itself — which IS the dictated
 * vocabulary, so this cannot drift from what the stages write the way a hand-kept list would. String
 * values are taken as they are; the per-half / per-axis FUNCTIONS are called with every value they are
 * ever called with in a run, since a path that only exists for axis "b" is still a dictated path.
 *
 * `runDir` itself is skipped — it is the directory being judged, not an artifact in it.
 *
 * — `halves` DEFAULTS TO EVERY SEAT, not to the two grid halves. The meaning seat writes four
 * root-level artifacts (its findings, its ledger, its disposition form and its obligations sidecar),
 * all of them .md/.json, all of them dictated. Defaulted to ["a","b"] this module would report all
 * four as undictated on every clearance run — and it LOGS rather than failing, so nothing would go red
 * and a detector that is wrong four times a run becomes the detector nobody reads, which is the exact
 * outcome its own doc block argues against.
 */
export function dictatedPaths(P, { halves = GRID_SEATS, axes = [] } = {}) {
  const out = new Set();
  for (const [key, value] of Object.entries(P ?? {})) {
    if (key === "runDir") continue;
    if (typeof value === "string") { out.add(value); continue; }
    if (typeof value !== "function") continue;
    // A path factory takes one discriminator. Feed it every one this run could use; a call that throws
    // on an argument shape it does not expect contributes nothing rather than killing the sweep.
    for (const arg of [...halves, ...axes]) {
      try { const v = value(arg); if (typeof v === "string") out.add(v); } catch { /* not that kind of factory */ }
    }
  }
  // ── Driver-written root files that paths() does not carry ────────────────────────────────────────
  // Each is NAMED and, where the name is computed, DERIVED from the same path the writer computes it
  // from — never a wildcard. A wildcard is how a real stray would hide: `connotation-obligations.*.json`
  // would admit any file a model chose to call that, which is precisely the move being guarded against.
  if (P?.runDir) {
    // the dashboard/portal state, written by writeRunStatus rather than dictated to a stage
    out.add(`${P.runDir}/status.json`);
    // — the grid tool writes the seat's obligations beside the ledger it computed them from, so the
    // record can say what the seat was TOLD it owed. One per half, keyed off that half's own ledger name.
    for (const h of halves) {
      try {
        const ledger = P.commonLawGridHalf?.(h);
        if (typeof ledger === "string") {
          const base = ledger.slice(ledger.lastIndexOf("/") + 1).replace(/\.json$/, "");
          out.add(`${P.runDir}/connotation-obligations.${base}.json`);
        }
      } catch { /* no half ledger on this run shape */ }
    }
    // — 's provenance sidecar, DECLARED. The perplexity server writes
    // `<ledger>.provenance.json` beside whatever grid ledger it served (grid-provenance.mjs — which
    // provider ran the grid, written because the ledger itself is saved verbatim and cannot carry it).
    // Its reader is the run-dir AUDITOR, and that reader is real: 's own header records the
    // 2026-08-24 misread — a SerpAPI counter read across this lane, the lane mis-reported as
    // quota-starved, with no artifact saying which provider served it. Derived from the SAME path
    // function the writer uses, one per ledger the tool can serve (full + each half) — never a
    // wildcard. A provenance file beside any OTHER ledger (a supplemental lane, say) is still
    // reported, deliberately: that would be a new writer nothing has decided about.
    try {
      if (typeof P.commonLawGrid === "string") out.add(gridProvenancePath(P.commonLawGrid));
      for (const h of halves) {
        const ledger = P.commonLawGridHalf?.(h);
        if (typeof ledger === "string") out.add(gridProvenancePath(ledger));
      }
    } catch { /* no grid ledgers on this run shape */ }
  }
  return out;
}

// Driver-written conventions that are not in paths() and are not strays. Each is a NAMED convention the
// driver itself writes — never a wildcard that would let a real stray hide behind it.
//   `.prev-<sha>`  the dispatch supersede chain (driver-written, one per superseded attempt)
//   `.tmp`         the atomic-write staging suffix; a crash can leave one
// Anything matched here is still reported when it does not also resolve to a dictated artifact.
const DRIVER_SUFFIX_RE = /\.prev-[0-9a-f]{6,}$|\.tmp$/;

/**
 * Only documents are judged. A stray .txt scratch file is noise; a stray REPORT is the defect.
 *
 * — WIDENED, because the largest stray this has ever seen would not have been judged. A clearance
 * run produced `<MARK>_Search_Results.csv`, a 39-platform x 12-variant grid with a cell per channel: the
 * biggest single body of evidence its sweep gathered, and the material behind a negative finding. Under
 * `/\.(md|json)$/` it was invisible even to a detector pointed straight at it — and no `.csv` path is
 * dictated anywhere in the driver, so widening cannot produce a false positive from a real artifact.
 *
 * The list is DELIVERABLE SHAPES, not "everything". `.txt` stays out on purpose: scratch notes are noise
 * and this must not become a detector nobody reads. A spreadsheet, a rendered page or a PDF is a document
 * somebody could mistake for product.
 */
const JUDGED_EXT_RE = /\.(md|json|csv|xlsx|html|pdf|docx)$/;

/**
 * Which of `entries` (plain file names at the run-dir root) is a document the driver never dictated?
 *
 * @param {string[]} entries      file names, root level only, directories already excluded
 * @param {Set<string>|string[]} dictated  absolute paths from dictatedPaths()
 * @param {{runDir?: string}} opts
 * @returns {Array<{name:string, why:string}>} empty ⇒ nothing undictated. PURE.
 */
export function findStrayArtifacts(entries, dictated, { runDir = "" } = {}) {
  const names = new Set();
  for (const p of dictated ?? []) {
    const s = String(p ?? "");
    // Root-level basename only: a dictated path inside _driver/ can never collide with a root entry,
    // and treating it as if it could would let a stray root file borrow a sidecar's name.
    const rel = runDir && s.startsWith(`${runDir}/`) ? s.slice(runDir.length + 1) : s;
    if (rel && !rel.includes("/")) names.add(rel);
  }
  const out = [];
  for (const name of entries ?? []) {
    const base = String(name ?? "").replace(DRIVER_SUFFIX_RE, "");
    if (!JUDGED_EXT_RE.test(base)) continue;
    if (names.has(base)) continue;
    out.push({ name,
      why: "no stage dictates this path — it was never validated and nothing downstream reads it" });
  }
  return out;
}

// ── — A WRITE INTO THE DOCTRINE TREE ────────────────────────────────────────────────────────────
//
// Two files were found sitting untracked inside the generated doctrine tree that `CLEAROTRON_INSTRUCTIONS_DIR`
// points at, on production, written during a live clearance:
//
//   skills/merge.sh                 613 B
//   skills/update_dispositions.py   961 B
//
// Both bulk-merged a separately-authored JSON into the meaning seat's disposition form. The seat could
// not fill the form in the flow, so it wrote a tool to do it — and it had somewhere to put the tool,
// because `buildClaudeArgs` passes `--add-dir <skillsDir>`, and an --add-dir root is a WRITE root for
// the file tools (the comment beside that line says so). The doctrine tree is an INPUT. Nothing in a
// clearance has cause to write to it, and a run that does has escaped its run dir.
//
// The run-dir sweep above could never see this: it reads the run dir, and this is one directory over.
//
// SNAPSHOT-AND-DIFF, not a manifest. The tree is generated, so "what belongs" is whatever was there
// when the run started; anything that appears during the run appeared because a stage put it there.
// That needs no second source of truth and cannot drift from one. PURE.
export function treeSnapshot(root, readdir) {
  const out = new Set();
  const walk = (dir, prefix) => {
    let entries;
    try { entries = readdir(dir); } catch { return; }          // unreadable ⇒ nothing to compare, never a throw
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(`${dir}/${e.name}`, rel);
      else out.add(rel);
    }
  };
  walk(root, "");
  return out;
}

/**
 * Files present now that were not present at the snapshot. Returns [] when either side is empty — an
 * absent snapshot is "we never looked", and reporting every file in the tree as a stray would make the
 * first real one invisible. PURE.
 */
export function findStrayInTree(before, after) {
  if (!(before instanceof Set) || !before.size || !(after instanceof Set)) return [];
  return [...after].filter((f) => !before.has(f)).sort();
}

// ── — A NEAR-MISS SIBLING OF A REAL MATTER DIRECTORY ──────────────────────────
//
// On the codex engine a stage wrote its real output — 9.8 KB of findings — into a run directory whose
// MATTER SLUG was mistyped by one letter, and the write landed because that adapter runs with the
// sandbox bypassed, where `--add-dir` stops being a fence and a write outside it silently creates the
// whole tree. The driver's dispatch carried the correct slug every time and the typo zero times, so
// this is not a slug bug: the model was told the right path and wrote to a different one.
//
// What made it expensive is that nothing said so. The validator failed the stage on the thin file at
// the CORRECT path with a content complaint, twice, byte-identical — while the substantive bytes sat
// one directory sideways. And the stray tree stays in the studio root beside real matters, one letter
// off a real matter name, holding a plausible-looking clearance artifact.
//
// SHALLOW ON PURPOSE. The doctrine sweep above walks its tree because that tree is small; the studio
// root holds every matter and every run under them, and walking it per stage would cost more than the
// defect. The unit here is the IMMEDIATE child — a matter directory that appeared during a run that did
// not create it.
//
// NEAR-MISS IS REPORTED, NOT REQUIRED. Any matter directory appearing mid-run is worth a line; the ones
// within one edit of this run's own are the hazardous class, because that is the shape a reader cannot
// tell apart by eye. Flagging rather than filtering means a stray that is NOT a near-miss still gets
// reported instead of being silently judged uninteresting.

/** Edit distance ≤ 1 (one insert, delete or substitution). PURE, and cheap — no matrix. */
export function withinOneEdit(a, b) {
  const s = String(a ?? ""), t = String(b ?? "");
  if (s === t) return false;                       // identical is not a near-miss, it is the thing itself
  if (Math.abs(s.length - t.length) > 1) return false;
  const [short, long] = s.length <= t.length ? [s, t] : [t, s];
  let i = 0, j = 0, slack = 1;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; continue; }
    if (!slack--) return false;
    if (short.length === long.length) { i++; j++; } else j++;
  }
  return true;
}

/** Immediate subdirectory names of a root. PURE — the caller supplies readdir. */
export function matterSiblings(root, readdir) {
  try { return new Set(readdir(root).filter((e) => e.isDirectory()).map((e) => e.name)); }
  catch { return new Set(); }                      // unreadable ⇒ nothing to compare, never a throw
}

/**
 * Matter directories that appeared since the snapshot, each flagged for near-miss. Returns [] when the
 * snapshot is empty — "we never looked" must not report every matter on the box as a stray, which is
 * the same rule findStrayInTree states. PURE.
 */
export function findStrayMatterSiblings(before, after, { own = "" } = {}) {
  if (!(before instanceof Set) || !before.size || !(after instanceof Set)) return [];
  return [...after]
    .filter((n) => !before.has(n))
    .sort()
    .map((name) => ({ name, nearMiss: withinOneEdit(name, own) }));
}
