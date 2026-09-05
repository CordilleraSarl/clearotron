#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sarl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// WHAT THIS CANNOT SEE IS THE POINT OF IT — a line-number citation guard that states its own blindness.
//
//   node scripts/citation-line-check.mjs          report; exit 1 on a citation that cannot resolve
//   node scripts/citation-line-check.mjs --json   the same, as JSON
//
// measured 808 `file.mjs:N` citations in comments and prose and hand-checked every one pointing
// into a single heavily-edited file: SEVEN OF SEVEN WERE WRONG, smallest miss ~45 lines. It then wrote
// the cheap mechanical detector — does a citation point past its file's last line — and got ZERO hits
// across all 756 resolvable citations. An instrument reporting a clean bill of health on a population
// whose verified sample is 100% defective.
//
// The ruling on that issue: the instrument stays, and its output must state what it cannot see. This is
// that instrument. It is a FRESH one — the detector described above was run ad-hoc and never committed,
// so there was nothing in this tree to make confess (reported, 2026-08-18).
//
// ── WHAT IT CAN DECIDE, AND WHAT IT CANNOT ──────────────────────────────────────────────────────────
//
// DECIDABLE, and therefore checked:
//   - a citation naming a file that is not in the tree. The file was retired and the sentence citing it
//     was not. Two live examples were found by this guard on the commit that introduced it.
//   - a citation pointing past its file's last line.
//
// NOT DECIDABLE, and therefore NOT checked, and therefore SAID OUT LOUD ON EVERY RUN:
//   - a citation pointing at the WRONG LIVE LINE. This is the entire failure class  measured, and
//     no amount of arithmetic reaches it: knowing whether `gather-config.mjs:162` is the line a sentence
//     means requires reading the sentence. A clean run here is NOT evidence that the citations are right.
//
// That last paragraph prints on every run, including a clean one, because a guard whose "clean" is
// near-meaningless and does not say so is worse than no guard: its presence reads as coverage.
//
// The remedy is the convention, not this script — CONTRIBUTING.md, "Cite the SYMBOL, not the line
// number". A symbol survives every move; a number survives none. This guard cannot enforce that (the
// ruling explicitly declines a form guard without an allowlist for the ~800 existing citations), so it
// holds the decidable perimeter and names the gap.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname, basename } from "node:path";

import { trackedFiles } from "../shared/tracked-files.mjs";
import { isWithheld, announceWithheldMode } from "../shared/withheld-paths-access.mjs";   // — the record stays behind; this degrades STRICTER where it is absent
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

// — say which mode this run is in, so a relaxed check is never silent.
announceWithheldMode();

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const GUARD = "citation-line-check (#1135)";

/** What this guard is blind to. Printed on EVERY run, clean or not. Exported so the test can pin it. */
export const BLINDNESS =
  "CANNOT SEE: a citation that points at the WRONG LIVE LINE while that line is real code. Two arms "
  + "narrow that class and neither closes it. #1567 checks a citation against the SYMBOL written beside "
  + "it, which is a minority of this corpus. #1712 checks that the cited span is not entirely blank or "
  + "brace-only — that one needs no symbol, but it recognises only PUNCTUATION: a citation that drifted "
  + "onto a different REAL line reads as correct to it. Two hand measurements, both over citations this "
  + "script had passed — 2026-08-20 (#1135): three of ten then-ambiguous citations pointed at the wrong "
  + "line. 2026-08-23 (#1712): of eleven repointed by hand in one contract file, THREE had landed on a "
  + "wrong NON-BLANK line. Cite the SYMBOL (CONTRIBUTING.md): it is both the fix and the thing that "
  + "makes a citation checkable at all.";

// `file.ext:N` and `file.ext:N-M`. Extensions are the ones this repo's citations actually use; widening
// it pulls in package names and version strings, which are not citations.
export const CITE_RE = /\b([A-Za-z0-9_.\-\/]+\.(?:mjs|js|md|json|ts|tsx|yml|yaml)):(\d+)(?:\s*[-–]\s*(\d+))?\b/g;

/**
 * Citations whose target is deliberately not a real file. Every one is PLANTED DATA — a fixture feeding
 * a test the shape of a citation, or a captured artifact name that only exists inside a run directory.
 * Each carries its reason, and `citation-line-check.test.mjs` asserts every entry still matches, so an
 * exemption that has stopped being needed is deleted rather than carried (the dead-names discipline).
 */
export const EXEMPT_TARGETS = [
  { target: /^driver\/(x|a|f|nope)\.mjs$/, why: "planted names in contract-audit.test.mjs — the test feeds the auditor a citation to a file that does not exist ON PURPOSE" },
  { target: /^driver\/skills\/[ab]\/(rules|SKILL)\.md$/, why: "planted skill paths in contract-audit.test.mjs, same shape" },
  { target: /^planted\//, why: "THE NAMESPACE for a fixture path that must not exist. publication-scrub.test.mjs plants an undeclared path to prove the scrubber sees it, and cut-vendor-keys.test.mjs plants one to prove the record-key detector reports a location. Unlike the namespaced entries below, this one is deliberately shared: `planted/` names the class rather than one test's fixtures, so a new test planting a non-existent path uses it instead of inventing a second convention — and a bare invented name is what reports as a dangling citation to a file nobody meant to create" },
  { target: /^diffcase-[a-z]+\.mjs$/, why: "SYNTHETIC DIFF FIXTURE FILENAMES in pushed-content-guard.test.mjs (tracker issue 1941). That test feeds `addedLines` a hand-written unified diff, so `keep.mjs:4` is a line of DIFF DATA the guard must parse, not a citation to anything. Same class as the contract-audit planted names directly above: a test that must contain a file reference to a file that does not exist, on purpose. NAMESPACED `diffcase-` deliberately: a first cut exempted the bare names `keep|dropped|gone|zz` and SWALLOWED two of this file's own controls, which plant `gone.mjs:12` — an exemption wide enough to cover somebody else's known-bad turns their arm green while it proves nothing" },
  { target: /^driver\/engine\/mcp\/planted-server\.mjs$/, why: "a planted server module name in contract-audit.test.mjs" },
  { target: /^srv\/app\//, why: "SYNTHETIC DEPLOYMENT STACK TRACES. The house rule for fixtures is to use a `/srv/…` path and never a real `/home/<name>/` one (deployment-hostnames.test.mjs polices the other half), so a hand-written trace like \"TypeError: x is not a function at /srv/app/driver/pipeline.mjs:2411:9\" is test DATA the parser under test must read — the line number is the datum, not a claim about our tree. It passed for as long as it did by luck: this resolver strips the prefix and lands on the real driver/pipeline.mjs, so the fixture went green while whatever line it happened to name was real code, and reported BLANK the first time an unrelated edit made that line a brace. NAMESPACED to `srv/app/` for the reason the diffcase- entry gives — nothing in this repo ships under srv/, and a wider prefix would swallow a genuine citation someone writes tomorrow" },
  { target: /^(?:driver\/)?driftcase-[a-z-]+\.mjs$/, why: "SYNTHETIC DRIFT FIXTURE FILENAMES in citation-drift-at-the-diff.test.mjs (tracker issue 1950). That test feeds the drift report a hand-built corpus in which `driftcase-target.mjs:40` is the DATUM being classified — the thing whose movement is measured — not a citation to anything. Same class as the planted names above, and NAMESPACED under `driver/` for the reason the `diffcase-` entry gives: an exemption wide enough to cover another test's known-bad turns their arm green while it proves nothing. The directory prefix is OPTIONAL because one arm cites the BARE BASENAME on purpose: that is the exact shape that made `resolveCited` short-circuit on an always-true `exists` and print a clean tick, so the arm cannot be written any other way. `driftcase-` carries the namespacing on its own — nothing else in this tree uses the prefix" },
  { target: /^common-law-findings\.md$/, why: "a RUN ARTIFACT, written into a run directory at execution time. It is cited by name in doubt-ledger and audit-from-spine tests because that is what the artifact is called; it is not and never will be a tracked file" },
  // ✕ REMOVED: `codex/dist/(helper|cli).js` — a captured CODEX stack trace in
  // exit-cause-survives-the-digest.test.mjs. Both of its citations carry a COLUMN, so `citationsIn`
  // now declines to read them as citations at all and this row became unreachable. The file's own
  // every-exemption-is-REACHED arm said which way to resolve that: delete it rather than carry it.
  // The class it covered is not lost — it moved from a per-vendor name to the general rule that a
  // stack frame is not a citation, which also covers the frames that name OUR files.
  // ✕ REMOVED: `/COVERAGE-GATE-INCIDENT/` — written for a rename-mangled
  // document name in predelivery-lint.test.mjs. The citation sweep repaired that name, publication-scrub
  // refused the repaired form as a withheld path, and the fixture now cites its own quoted prose instead
  // of any document — so the row lost its only customer and the REACHED arm said which way to resolve
  // that: delete it rather than carry it. Its `why` had never been true either: the mangled name sat in a
  // PROVENANCE COMMENT, not in a fixture, so nothing ever fed the lint a corrupted string. This row was
  // excusing an accident while the table above admits only planted data, and no arm here reads a `why`.
];

const exemptTarget = (t) => EXEMPT_TARGETS.find((e) => e.target.test(t)) ?? null;

/**
 * A citation this checker CANNOT resolve and a human has adjudicated anyway. One rule for every member:
 * the entry names the citing FILE and the cited BASENAME, and it carries the reason resolution is
 * impossible rather than merely hard. Anything ambiguous and undeclared FAILS the run — the bucket is
 * not a backlog to hide in, which is what it was until 's second pass emptied it.
 *
 * `citation-line-check.test.mjs` asserts every entry is REACHED — that it still matches a live ambiguous
 * citation — not merely that its regex is well formed. That distinction is the defect this pass found in
 * EXEMPT_TARGETS: an entry there matched two citations and only one ever reached the code.
 */
export const AMBIGUOUS_DECLARED = [
  {
    from: "driver/test/skill-contract-enumerations.test.mjs",
    cited: "SKILL.md",
    why: "a COMPUTED census, not a reference. `sites` is built from the skill text the dispatch loads and "
       + "compared whole, so a passage that MOVES fails that assertion — the line number is bound by the "
       + "test that prints it, which is the opposite of the rot #1135 describes. The bare basename is the "
       + "census's own vocabulary: CLOSURE.files keys every entry that way, so there is no path to name.",
  },
];

const declaredAmbiguous = (c) =>
  AMBIGUOUS_DECLARED.find((d) => d.from === c.from && d.cited === c.cited) ?? null;

/**
 * A citing document that does NOT CROSS THE CUT is reported separately and does not fail the run.
 *
 * Two of these exist today and both are histories: a design record whose subject was deleted, whose own
 * banner already tells a reader the cited files are gone and not to follow the numbers. That is the
 * ADR-0005 remedy applied in the right place — at the document, where a reader meets it.
 *
 * They are COUNTED AND PRINTED rather than exempted, because an internal reader still opens these files
 * and a silent exemption would be the false-clean this guard exists to refuse. They simply do not fail
 * the gate: a document that never reaches a public reader cannot mislead one, and the ruling on
 * forbids a sweep of the existing citations.
 *
 * Derived from `shared/withheld-paths.mjs`, never a path typed here — so a change to what the cut
 * carries moves this set with it, and this file names no withheld path of its own.
 */
const sourceCrossesTheCut = (file) => !isWithheld(file);

/** Index tracked paths by basename, so a citation written without its directory can still be resolved. */
export function indexByBasename(files) {
  const m = new Map();
  for (const f of files ?? []) {
    const b = basename(f);
    if (!m.has(b)) m.set(b, []);
    m.get(b).push(f);
  }
  return m;
}

/**
 * Resolve a cited path to a tracked file. PURE.
 * Returns { state, path } where state is "exact" | "unique" | "ambiguous" | "missing".
 *
 * "ambiguous" is a finding AND an error: a citation reading `SKILL.md:41` names fifteen possible files in
 * this tree, so nothing here can judge it and nothing here ever did. That was its whole defect. Since
 * 's second pass the population is empty apart from AMBIGUOUS_DECLARED, and an undeclared one fails.
 */
export function resolveCited(cited, byBase, exists = (p) => existsSync(join(ROOT, p))) {
  if (exists(cited)) return { state: "exact", path: cited };
  const cands = byBase.get(basename(cited)) ?? [];
  const narrowed = cands.filter((c) => c.endsWith(cited));
  const pick = narrowed.length ? narrowed : cands;
  if (pick.length === 1) return { state: "unique", path: pick[0] };
  if (pick.length > 1) return { state: "ambiguous", path: null, candidates: pick.length };
  return { state: "missing", path: null };
}

/** Every citation in a corpus of {file, text}, with its resolution. PURE. */
export function citationsIn(corpus, byBase, opts = {}) {
  const exists = opts.exists;
  const out = [];
  for (const { file, text } of corpus ?? []) {
    const lines = String(text ?? "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(CITE_RE)) {
        // A V8 STACK FRAME IS NOT A CITATION. `at planRegisterSweeps
        // (file://…/driver/pipeline.mjs:2102:19)` inside a fixture is captured evidence of one run's
        // stack — its numbers describe the tree that threw, and nobody maintains them. Reading them as
        // citations makes every fixture holding a trace a permanent repointing chore, and worse: three
        // frames in repair-digest.test.mjs pointed at pipeline.mjs, and which of them this script
        // reported depended entirely on whether an unrelated line shift happened to land a frame on a
        // blank line. That is a guard whose findings are luck.
        //
        // The discriminator is the COLUMN. `file.mjs:2102:19)` — a second `:number` closing a paren —
        // is a stack frame in every corpus; a prose citation never carries one.
        if (/^:\d+\)/.test(lines[i].slice(m.index + m[0].length))) continue;
        const cited = m[1];
        const start = Number(m[2]);
        const end = m[3] ? Number(m[3]) : start;
        const r = exists ? resolveCited(cited, byBase, exists) : resolveCited(cited, byBase);
        const symbols = symbolsBeside(lines[i], m.index, m[0].length);
        out.push({ from: file, atLine: i + 1, cited, start, end, symbols, ...r });
      }
    }
  }
  return out;
}

/**
 * The two decidable defects, given resolved citations and a line-count lookup. PURE.
 * `dangling` — the cited file is not in the tree and is not planted data.
 * `overrun`  — the citation points past the cited file's last line.
 */
export function decidableHits(citations, lineCountOf, ships = sourceCrossesTheCut) {
  const dangling = [], overrun = [], danglingUnshipped = [], ambiguous = [], exempt = [], declared = [];
  for (const c of citations) {
    const unresolved = c.state === "missing" || c.state === "ambiguous";
    // PLANTED DATA IS EXEMPT WHATEVER IT RESOLVED TO. Consulting this only under `missing` made the
    // exemption UNREACHABLE for any planted path whose basename collides with a real file:
    // `driver/skills/a/SKILL.md` resolves AMBIGUOUS against fifteen real SKILL.md files, so it never
    // reached the entry written for it and sat in the bucket nothing judged. Measured 2026-08-20 —
    // that entry matched two citations and only one reached the code.
    if (unresolved && exemptTarget(c.cited)) { exempt.push(c); continue; }
    if (c.state === "missing") {
      (ships(c.from) ? dangling : danglingUnshipped).push(c);
      continue;
    }
    if (c.state === "ambiguous") {
      (declaredAmbiguous(c) ? declared : ambiguous).push(c);
      continue;
    }
    const n = lineCountOf(c.path);
    if (n != null && Math.max(c.start, c.end) > n) overrun.push({ ...c, fileLines: n });
  }
  return { dangling, overrun, danglingUnshipped, ambiguous, exempt, declared };
}

/**
 * A FLOOR UNDER THE POPULATION, RELATIVE TO THIS TREE — owner ruling 2026-09-02, his words: "keep the
 * verifier, kill the magic."
 *
 * The reason for a floor is unchanged and it is a good one: if the extractor breaks, every count goes to
 * zero and the guard reports a clean tree, which is the exact false-clean this file exists to refuse.
 * What changed is the number. It used to be an absolute 600, calibrated against this repository — and a
 * number calibrated against one tree is an instrument that only works on that tree. Measured 2026-09-02
 * against the exported public tree: 589 citations, legitimately, because that tree is smaller. The
 * checker refused a correct count, so the public repository could not run it at all and would have had
 * nothing watching its line citations.
 *
 * A BROKEN EXTRACTOR SENDS THE COUNT TOWARD ZERO, which is a large PROPORTIONAL drop at any tree size.
 * So the comparison is against the tree's own last recorded count, and the same checker then works on
 * any tree at any size — which is the property that made an absolute floor the wrong shape rather than
 * merely an inconvenient one.
 *
 * The tolerance is deliberately generous. It is not trying to notice a handful of deleted comments; it
 * is trying to notice an instrument that stopped reading. A drop bigger than this is not "unusual", it
 * is "suspect", and the answer is to declare it rather than to widen the tolerance.
 */
export const CITATION_DROP_TOLERANCE = 0.1;

/** Where the tree records what it last counted. Per-tree by nature: a baseline is about ONE corpus. */
export const CITATION_BASELINE = "driver/citation-census.json";

/**
 * The recorded count, or null when the tree has never recorded one.
 *
 * NULL IS NOT A PASS. A tree with no baseline has nothing to compare against, so it cannot tell a
 * healthy corpus from a broken extractor — the caller refuses and says how to record one. That matters
 * most on the tree where it is most tempting to shrug: a brand-new repository, whose first commit is
 * exactly where the baseline belongs.
 */
export function readBaseline(root = ROOT) {
  try {
    const n = JSON.parse(readFileSync(join(root, CITATION_BASELINE), "utf8"))?.citations;
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}

/**
 * @returns {{ok: true} | {ok: false, reason: string}} — whether this count is credible against the record.
 */
export function judgeCount(citations, baseline, { allowLoss = false } = {}) {
  if (baseline == null) {
    return { ok: false, reason: `no recorded citation count in ${CITATION_BASELINE}, so a broken `
      + "extractor and a small tree look identical from here. Record one with --record-count." };
  }
  const floor = Math.floor(baseline * (1 - CITATION_DROP_TOLERANCE));
  if (citations >= floor) return { ok: true };
  if (allowLoss) return { ok: true };
  return { ok: false, reason: `${citations} citation(s) against a recorded ${baseline} — a drop past `
    + `${floor}. Either the extractor stopped matching, or citations were deliberately removed; if the `
    + "second, re-run with --record-count --allow-loss and say in the commit what was removed and why." };
}

export function corpusOf(root = ROOT) {
  const files = trackedFiles(GUARD, { root });
  if (files == null) return null;
  const out = [];
  for (const f of files) {
    // This guard and its test quote citation shapes in order to describe them.
    if (/(^|\/)citation-line-check\.(mjs|test\.mjs)$/.test(f)) continue;
    try { out.push({ file: f, text: readFileSync(join(root, f), "utf8") }); } catch { /* binary or unreadable */ }
  }
  return { files, corpus: out };
}

function main() {
  const loaded = corpusOf();
  if (loaded == null) {
    console.log("citation-line-check did not run — no tracked corpus. This is a SKIP, not a pass.");
    process.exit(0);
  }
  const { files, corpus } = loaded;
  const byBase = indexByBasename(files);
  const citations = citationsIn(corpus, byBase);

  const lineCache = new Map();
  const lineCountOf = (p) => {
    if (!lineCache.has(p)) {
      try { lineCache.set(p, readFileSync(join(ROOT, p), "utf8").split("\n").length); }
      catch { lineCache.set(p, null); }
    }
    return lineCache.get(p);
  };

  // ONE classifier. `ambiguous` and `exempt` used to be recomputed here with their own predicates, and
  // this file's copy of the exempt predicate carried the same `state === "missing"` restriction that made
  // the exemption unreachable — two statements of one rule, drifting together and reported as agreement.
  const { dangling, overrun, danglingUnshipped, ambiguous, exempt, declared } =
    decidableHits(citations, lineCountOf);
  const resolved = citations.filter((c) => c.state === "exact" || c.state === "unique");
  // THE COUNT IS JUDGED AGAINST THIS TREE'S OWN RECORD, never against a number written for another one.
  const baseline = readBaseline();
  const allowLoss = process.argv.includes("--allow-loss");
  const credible = judgeCount(citations.length, baseline, { allowLoss });
  const floorBroken = !credible.ok;

  // RECORDING IS A SEPARATE VERB, and it happens only when the tree is otherwise sound — writing a new
  // baseline out of a run that just found dangling citations would record the damage as the new normal.
  if (process.argv.includes("--record-count")) {
    const clean = !dangling.length && !overrun.length && !ambiguous.length;
    if (!clean && !allowLoss) {
      console.error(`citation-line-check: refusing to record a count from a tree with unresolved `
        + "citations. Fix them, or pass --allow-loss to record deliberately.");
      process.exit(1);
    }
    // THE DIRECTORY MAY NOT EXIST, and the first time it did not the write threw into a spawn that
    // swallowed it — the baseline stayed null, the next run refused, and the reason was invisible. A
    // brand-new repository recording its first baseline is exactly that case.
    const at = join(ROOT, CITATION_BASELINE);
    try {
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, `${JSON.stringify({ citations: citations.length, files: corpus.length }, null, 2)}\n`);
    } catch (e) {
      console.error(`citation-line-check: could not record the count at ${CITATION_BASELINE}: ${e.message}`);
      process.exit(2);   // could not look, never a pass
    }
    console.error(`citation-line-check: recorded ${citations.length} citation(s) across `
      + `${corpus.length} file(s) in ${CITATION_BASELINE}`);
  }

  const linesCache = new Map();
  const readLines = (p) => {
    if (!linesCache.has(p)) {
      try { linesCache.set(p, readFileSync(join(ROOT, p), "utf8").split("\n")); }
      catch { linesCache.set(p, null); }
    }
    return linesCache.get(p);
  };
  const wrongLine = symbolMisses(citations, readLines);
  // — the line-free form. Resolved by DECLARATION, so it survives every edit above
  // the symbol and fails the commit that removes it.
  const symCites = symbolCitationsIn(corpus, byBase);
  const symbolGone = symbolCitationMisses(symCites, readLines);
  const symbolClaims = citations.filter(
    (c) => (c.symbols ?? []).some((sy) => constructRange(readLines(c.path) ?? [], sy)));
  // — the no-symbol slice: a cited span that is entirely blank or brace-only.
  const { misses: blankTarget, unshipped: blankUnshipped } = structuralMisses(citations, readLines);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({
      files: corpus.length, citations: citations.length, resolved: resolved.length,
      dangling, overrun, danglingUnshipped, ambiguous, declared: declared.length,
      exempt: exempt.length, baseline, floorBroken, countReason: credible.ok ? null : credible.reason, blindness: BLINDNESS,
      symbolClaims: symbolClaims.length, wrongLine,
      symbolCitations: symCites.length, symbolGone,
      blankTarget, blankUnshipped: blankUnshipped.length,
    }, null, 2));
    process.exit(dangling.length || overrun.length || ambiguous.length || wrongLine.length
      || symbolGone.length || blankTarget.length || floorBroken ? 1 : 0);
  }

  console.log(`citation-line-check (#1135) - ${citations.length} line citation(s) across ${corpus.length} tracked file(s)`);
  console.log(`  ${resolved.length} resolve to a tracked file - ${overrun.length} point past its last line`);
  console.log(`  ${dangling.length} name a file that is NOT in the tree`);
  console.log(`  ${ambiguous.length} name a bare filename matching several files and are NOT declared - FAILS`);
  console.log(`  ${declared.length} are unresolvable and adjudicated - declared in AMBIGUOUS_DECLARED`);
  console.log(`  ${exempt.length} target planted test data - exempt by name`);
  console.log(`  ${danglingUnshipped.length} dangle inside a document that does not cross the cut - reported, not failed`);

  for (const h of overrun) console.log(`\n  OVERRUN  ${h.from}:${h.atLine}\n    cites ${h.cited}:${h.start} but ${h.path} has ${h.fileLines} lines`);
  for (const h of dangling) console.log(`\n  DANGLING ${h.from}:${h.atLine}\n    cites ${h.cited}:${h.start} - no such file in the tree`);
  for (const h of ambiguous) console.log(`\n  AMBIGUOUS ${h.from}:${h.atLine}\n    cites ${h.cited}:${h.start} - matches ${h.candidates} files, so NOTHING HERE CAN JUDGE IT.\n`
    + "    Name the symbol (CONTRIBUTING.md), or declare it in AMBIGUOUS_DECLARED with the reason it cannot be named.");
  console.log(`  ${symbolClaims.length} name a SYMBOL beside the number, so their line IS checkable - ${wrongLine.length} miss it`);
  console.log(`  ${symCites.length} name a SYMBOL AND NO LINE, so no edit above it can stale them - ${symbolGone.length} name one that is not declared there - FAILS`);
  console.log(`  ${blankTarget.length} cite a span that is ENTIRELY blank or brace-only - FAILS`);
  console.log(`  ${blankUnshipped.length} cite an empty span inside a document the cut does not carry - reported, not failed`);

  for (const h of wrongLine) console.log(`\n  WRONG LINE ${h.from}:${h.atLine}\n`
    + `    cites ${h.cited}:${h.start}${h.end !== h.start ? "-" + h.end : ""} for ${h.symbol}, which is declared at `
    + `${h.path}:${h.declaredAt} (construct ${h.construct[0]}-${h.construct[1]}).\n`
    + "    The citation names its own expected value, and the line it points at is outside that symbol.");
  for (const h of symbolGone) console.log(`\n  SYMBOL GONE ${h.from}:${h.atLine}\n`
    + `    cites ${h.symbol}${h.called ? "()" : ""} in ${h.cited}, and no such declaration is in ${h.path}.\n`
    + "    Renamed, deleted, or moved to another file. Unlike a line number this cannot drift quietly:\n"
    + "    repoint it at what the claim is actually about, or drop the claim.");
  for (const h of danglingUnshipped) console.log(`\n  unshipped ${h.from}:${h.atLine}  cites ${h.cited}:${h.start} - no such file, in a document the cut does not carry`);

  for (const h of blankTarget) console.log(`\n  BLANK TARGET ${h.from}:${h.atLine}\n`
    + `    cites ${h.cited}:${h.start}${h.spanEnd !== h.start ? "-" + h.spanEnd : ""}, and every line of that span is`
    + " blank or a lone brace. Nobody cites punctuation: the target moved and the number did not.");
  for (const h of blankUnshipped) console.log(`\n  unshipped ${h.from}:${h.atLine}  cites ${h.cited}:${h.start}`
    + `${h.spanEnd !== h.start ? "-" + h.spanEnd : ""} - an empty span, in a document the cut does not carry`);

  if (floorBroken) {
    console.log(`\nCOUNT NOT CREDIBLE: ${credible.reason}`);
  }

  console.log(`\n${BLINDNESS}`);
  process.exit(dangling.length || overrun.length || ambiguous.length || wrongLine.length
      || symbolGone.length || blankTarget.length || floorBroken ? 1 : 0);
}



// ──: A CITATION WITH NO LINE NUMBER, WHICH IS THE ONLY KIND THAT SURVIVES AN EDIT ──
//
// Every arm above this one narrows the wrong-line class without closing it, and the file says so in its
// own summary. This arm does not narrow it. It removes the number, which is the thing that goes stale.
//
// A citation naming a SYMBOL is checked by asking whether that symbol is DECLARED in the cited file.
// Move it within its file and the citation still resolves. Rename or delete it and the citation fails,
// in the commit that did it, rather than pointing at whatever code slid into its old line. Nothing here
// is new machinery: `constructRange` below already resolves a symbol to its declaration for the
// arm, and this reuses it.
//
// TWO SPELLINGS, BOTH EXPLICIT, AND THAT IS THE POINT:
//
//     parseCorrectionKinds() in verify.mjs                     a function — the `()` marks it
//     WATCHLIST_OWNERS_MAX declared in variant-manifest-model.mjs   anything else — `declared` marks it
//
// A BARE WORD BEFORE `in <file>` IS NOT A SYMBOL CITATION, deliberately, and this is the difference
// between this arm and 's. reads the token beside a number SPECULATIVELY and drops it when it
// is not declared, because "ALREADY computes (coverage-ledger.mjs:180)" would otherwise manufacture a
// defect out of emphatic prose. This arm cannot do that: an undeclared symbol has to FAIL or the check
// has no teeth at all. So the form is opted into. `the field in scope-ledger.mjs` and `checked in
// verify.mjs` are prose and are not read as citations; `cleanAxisToken() in coverage-ledger.mjs` is a
// claim, and it is checked.
//
// BACKTICKS ARE NOT A MARKER, MEASURED. The first cut accepted `` `NAME` in file.mjs `` and it read four
// pieces of ordinary prose as citations: `CLEAROTRON_DATABASE` in stages.mjs (an environment
// variable READ there, never declared), `contractElements` in stages.mjs (an object key, not a
// declaration), and two more of the same shape. This repo backticks every code-ish span, so backticks
// carry no intent. The word `declared` does: it states the claim the check makes.
//
// NON-CODE TARGETS KEEP THE NUMBER, AND THAT IS A RULE, NOT AN OVERSIGHT. A `.md` file has no symbols to
// name, so there is nothing for this arm to resolve — 7 of the doubt ledger's 81 citations point at
// `digest.md`, `unit.md` and `phase2-execution.md`. Inventing a heading-anchor scheme for them would put
// TWO schemes in one table, which is how the first one stops being read (the note already carries).
// They stay line-form, and the blank-target arm above is what still watches them.
// AND THE `declared in` FORM STILL HAS TO LOOK LIKE A SYMBOL, for a reason measured the same way: the
// word captured before `declared` is whatever the sentence put there, and English puts "is" there. "the
// field is declared in stages.mjs" read as a citation of a symbol named `is`, three times over. SYMBOLIC
// (camelCase / PascalCase / UPPER_SNAKE, the same test uses) drops those. It also means an
// all-lowercase constant cannot use this spelling — a deliberate under-reach: it can use the `()` form,
// and an unchecked citation beats a wrongly flagged one.
const SYMBOL_CITE_RE = /(?:\b([A-Za-z_$][A-Za-z0-9_$]*)\(\)\s+in|`?\b([A-Za-z_$][A-Za-z0-9_$]*)`?\s+declared\s+in)\s+`?([A-Za-z0-9._-]+\.(?:mjs|ts))`?/g;

/** Every symbol citation in a corpus of {file, text}, with the cited file's resolution. PURE. */
export function symbolCitationsIn(corpus, byBase, opts = {}) {
  const exists = opts.exists;
  const out = [];
  for (const { file, text } of corpus ?? []) {
    const lines = String(text ?? "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(SYMBOL_CITE_RE)) {
        const symbol = m[1] ?? m[2];
        // The `declared in` spelling captures whatever word the sentence put before it, so it is held to
        // the same shape test uses. The `` spelling needs no such filter: the parens are the claim.
        if (!m[1] && !SYMBOLIC(symbol)) continue;
        const cited = m[3];
        const r = exists ? resolveCited(cited, byBase, exists) : resolveCited(cited, byBase);
        out.push({ from: file, atLine: i + 1, cited, symbol, called: Boolean(m[1]), ...r });
      }
    }
  }
  return out;
}

/**
 * Symbol citations whose symbol is NOT declared in the file they name. `readLines(path)` returns the
 * cited file's lines, or null when it cannot be read. PURE given its reader.
 *
 * An unreadable or unresolved file is NOT reported here — the dangling and ambiguous arms above own
 * that finding, and reporting it twice would make one defect look like two.
 */
export function symbolCitationMisses(cites, readLines) {
  const out = [];
  for (const c of cites ?? []) {
    if (c.state !== "exact" && c.state !== "unique") continue;
    // PLANTED DATA IS EXEMPT HERE TOO — the table's own header says "EXEMPT WHATEVER IT RESOLVED TO",
    // and the resolver consults it only under `unresolved` while these three walks did not consult it
    // at all. A planted path that resolves EXACTLY (a synthetic "/srv/app/driver/pipeline.mjs" stack
    // trace strips to the real driver/pipeline.mjs) was therefore judged as a claim about our tree. It
    // passed for as long as whatever line it happened to name was real code, and reported the first
    // time an unrelated edit made that line a brace — a finding of luck, which is what this guard's own
    // note two screens up says it must never be. A planted citation's line number is the DATUM a test
    // feeds its parser, never an assertion about this repository.
    if (exemptTarget(c.cited)) continue;
    const body = readLines(c.path);
    if (!body) continue;
    if (!constructRange(body, c.symbol)) out.push(c);
  }
  return out;
}

// ──: THE SLICE OF "WRONG LIVE LINE" THAT IS DECIDABLE ─────────────────────────────────────────
//
// declared the wrong-live-line class undecidable, and for a bare `file.mjs:N` it is. But this tree
// often writes the symbol beside the number — `verify.mjs:607 CORRECTION_KIND_RE`, or the other way
// round, `deriveCoverageStatus (coverage-ledger.mjs:154-161)`. Where it does, the citation carries its
// own expected value and needs no new annotation, so that slice can be checked.
//
// THE RULE IS CONTAINMENT, NOT EQUALITY, and the difference is the whole design. "The cited line
// contains the symbol" was measured against this tree and fired on 34 of 36 — a broken instrument, not
// a finding. It has three false-positive classes, every one legitimate:
//
//   · A MULTI-LINE SYMBOL. `disposition-union.mjs:32 PROVENANCE` — declared at 30, the string runs
//     through 32. The citation pins a line INSIDE the constant and is correct.
//   · A LINE INSIDE A NAMED FUNCTION. `registry-fidelity.mjs:172 readRecordArtifacts` means "the readdir
//     at 172, within that function". Pinning a line within a construct is the useful case, not an error.
//   · A CITED RANGE STRADDLING THE DECLARATION, e.g. `:123-126` where the symbol is declared at 125.
//
// So: a citation is a defect when the symbol is declared in the cited file and the cited line or range
// does not OVERLAP that declaration's construct — from the contiguous comment block above it to the next
// declaration. No invented line-distance threshold; the construct's own boundaries decide.
//
// AN ALL-LOWERCASE WORD IS NOT A SYMBOL. Both grammars sit in prose, so the neighbouring token is often
// English — "at", "fail", "json", "run", "already". Each of those is ALSO a local somewhere in a
// 6,000-line file, so accepting them manufactures defects out of prepositions. A symbol claim must look
// like one: camelCase, PascalCase or UPPER_SNAKE. That is a deliberate under-reach — an all-lowercase
// symbol goes unchecked rather than wrongly flagged — and it is why this stays a slice.
//
// The shape filter does NOT catch everything, and the second line of defence is what actually holds:
// this repo writes emphatic capitals in prose ("… (coverage-ledger.mjs:180) ALREADY computes"), and
// ALREADY passes the shape test. It is dropped one step later, because it is not DECLARED in the cited
// file — `constructRange` returns null and the claim is treated as undecidable rather than as a miss.
// Both grammars are therefore read speculatively and the declaration is the arbiter.

/** camelCase / PascalCase / UPPER_SNAKE. Excludes English prose words. PURE. */
export const SYMBOLIC = (t) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t) && /[A-Z_]/.test(t);

//: PUNCTUATION BETWEEN THE SYMBOL AND THE NUMBER IS TYPOGRAPHIC, NOT SEMANTIC. Until now only
// whitespace and brackets were stepped over, so `applyClosure, doubt-ledger.mjs:420` read as naming no
// symbol at all and went unchecked — the citation that found this was 108 lines stale and green
// throughout. A comma, semicolon, colon or dash separating a symbol from its own citation still leaves
// the citation naming that symbol.
//
// THE FULL STOP IS DELIBERATELY NOT IN THIS SET. A period ends the sentence, so the next token starts a
// new one and is a different claim; stepping over it would read an unrelated word as the symbol.
// Measured on this tree: adding it moved nothing, so it is cost without benefit.
//
// This widens what is READ SPECULATIVELY, not what is FLAGGED. Every token found here is still dropped
// unless it is DECLARED in the cited file — the arbiter the block above describes. That second line of
// defence now carries more weight than it did (a sentence-initial `The` or `A` beside a citation passes
// SYMBOLIC and reaches it), and `citation-line-check.test.mjs` pins that it still holds.
const SEP_AFTER = /^[\s)\],;:—–]*/;
//: A CONNECTOR WORD BETWEEN THE SYMBOL AND ITS CITATION IS TYPOGRAPHIC TOO. `SELECT_ROW_FIELDS at
// placement-form.mjs:91` named its symbol and went unchecked, because SEP_BEFORE stepped over punctuation
// but not over the word `at` — so the token read as the symbol was "at", which fails SYMBOLIC and is
// dropped. Same class as, one word wider. Measured on this tree: 24 -> 27 citations become
// checkable. `in` rides along on the same grammar ("the guard in verify.mjs:786").
//
// This widens what is READ, not what is FLAGGED — the declaration arbiter still decides, so a connector
// preceded by an English word yields a token that is not declared in the cited file and is dropped.
const SEP_BEFORE = /[\s(\[,;:—–]*(?:\b(?:at|in)\b[\s(\[,;:—–]*)?$/;

// TWO SHAPES REACHED BY THE WIDENING MAKE NO CLAIM ABOUT *THIS* NUMBER, and both were found by reading
// the six citations the widening first flagged rather than by predicting them:
//
//   · A CALL, NOT A LOCATION. `(audit-from-spine.mjs:123-126, tablesUnder(/risk|watch/i))` says line
//     123-126 CALLS tablesUnder, which is declared at 39. The parens are the tell: a symbol written as
//     a call is the callee, and the number is the caller's line.
//   · A SYMBOL CARRYING ITS OWN NUMBER. `(verify.mjs:452, hasCoverageLedgerRow at 651)` holds TWO
//     citations; the symbol owns the second. Pairing it with the first flags a line it never claimed —
//     and no correction to the text can satisfy the guard, which is the mark of a false positive rather
//     than a finding.
//
// Both are skipped, per the rule the block above sets: an unchecked symbol beats a wrongly flagged one.
const CALLS = /^\s*\(/;
const OWN_NUMBER = /^\s*(?:at\s+\d|:\d)/;

/** The symbol-shaped tokens adjoining a citation, in BOTH grammars: `cite SYM` and `SYM (cite)`. PURE. */
export function symbolsBeside(line, index, length) {
  const after = String(line).slice(index + length).replace(SEP_AFTER, "");
  const am = after.match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
  const aRest = am ? after.slice(am[0].length) : "";
  const a = am && !CALLS.test(aRest) && !OWN_NUMBER.test(aRest) ? am[0] : undefined;
  const before = String(line).slice(0, index).replace(SEP_BEFORE, "");
  const b = (before.match(/[A-Za-z_$][A-Za-z0-9_$]*$/) || [])[0];
  return [...new Set([a, b].filter((t) => t && SYMBOLIC(t)))];
}

const DECL_OF = (s) => new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var|class)\\s+${s}\\b`);
const ANY_DECL = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+[A-Za-z_$]/;
/** Leading-whitespace width, so a span can end at a SIBLING declaration rather than at any nested one. */
const INDENT_OF = (l) => (String(l).match(/^[ \t]*/) || [""])[0].length;
const COMMENTISH = (l) => /^\s*(\/\/|\/\*|\*)/.test(l) || String(l).trim() === "";

/**
 * The 1-indexed inclusive span a symbol's DECLARATION owns: its doc block, the declaration, and the body
 * up to the next SIBLING declaration — one at the same indentation or shallower. `null` when the symbol is never declared here — a mention in a comment is
 * not a declaration, and treating it as one is how `readRecordArtifacts` looked like it lived at 161
 * when it is declared at 180. PURE.
 */
export function constructRange(body, sym) {
  const lines = body ?? [];
  const d = lines.findIndex((l) => DECL_OF(sym).test(l));
  if (d < 0) return null;
  let start = d;
  while (start > 0 && COMMENTISH(lines[start - 1])) start--;
  // COMMENTISH counts a blank line, so the walk can run past the doc block into the gap above it.
  // Give the blank lines back: the construct starts at its first comment, not at the separator.
  while (start < d && String(lines[start]).trim() === "") start++;
  // ── THE SPAN ENDS AT A SIBLING, NOT AT ANY DECLARATION ──────────────────────
  //
  // This walked to the next line matching ANY_DECL, which carries no indentation constraint — so a
  // function whose body OPENS with a local `const` ended its own span on the line after its declaration.
  // Measured on `3cdf5bb`: of the 73 citations whose symbol resolves in the cited file, 54 owned ZERO
  // body lines. `symbolMisses` then reported every in-body citation as WRONG LINE, which is exactly the
  // case this script's own design notes single out as the one it must not flag.
  //
  // THE FIX IS INDENTATION-AWARE AND NOT "TOP-LEVEL ONLY", and the issue's criterion 1 says top-level, so
  // the deviation is stated here rather than left for a reader to reconcile against the diff. Top-level
  // only would have ended each span at the next column-0 declaration, which for a symbol declared INSIDE
  // a function is the rest of the file: `isDegenerate` in pipeline.mjs would own 2,163 lines and `asOf`
  // in publish/index.mjs 516. A span that swallows its neighbours reports nothing and reads as a pass —
  // criterion 2's failure mode arriving as a green tick. Measured against a sibling instead:
  //
  //   symbol               now   top-level-only   sibling-aware
  //   previousRoundNotice    0             12            12
  //   lintScenarios          0             97            97
  //   settlementOf          10            521            35
  //   isDegenerate           0           2163             0
  //   asOf                   0            516             0
  //
  // The two zeros that stay zero are correct: both are one-line arrow declarations followed immediately
  // by a sibling, so the line they own is their own.
  const own = INDENT_OF(lines[d]);
  let end = d + 1;
  while (end < lines.length && !(ANY_DECL.test(lines[end]) && INDENT_OF(lines[end]) <= own)) end++;
  return { start: start + 1, end, declaredAt: d + 1 };
}

/**
 * Citations naming a symbol whose cited line falls outside that symbol's construct. `readLines(path)`
 * returns the cited file's lines, or null when it cannot be read. PURE given its readers.
 */
export function symbolMisses(citations, readLines) {
  const out = [];
  for (const c of citations) {
    if (c.state !== "exact" && c.state !== "unique") continue;
    // PLANTED DATA IS EXEMPT HERE TOO — the table's own header says "EXEMPT WHATEVER IT RESOLVED TO",
    // and the resolver consults it only under `unresolved` while these three walks did not consult it
    // at all. A planted path that resolves EXACTLY (a synthetic "/srv/app/driver/pipeline.mjs" stack
    // trace strips to the real driver/pipeline.mjs) was therefore judged as a claim about our tree. It
    // passed for as long as whatever line it happened to name was real code, and reported the first
    // time an unrelated edit made that line a brace — a finding of luck, which is what this guard's own
    // note two screens up says it must never be. A planted citation's line number is the DATUM a test
    // feeds its parser, never an assertion about this repository.
    if (exemptTarget(c.cited)) continue;
    const body = readLines(c.path);
    if (!body) continue;
    for (const sym of c.symbols ?? []) {
      const range = constructRange(body, sym);
      if (!range) continue;                                   // not declared here: prose, or imported
      if (c.end >= range.start && c.start <= range.end) break; // overlaps the construct: correct
      out.push({ ...c, symbol: sym, declaredAt: range.declaredAt, construct: [range.start, range.end] });
      break;
    }
  }
  return out;
}

// ──: THE SLICE OF "WRONG LIVE LINE" THAT NEEDS NO SYMBOL ──────────────────────────────────────
//
// checks a citation against the symbol written beside it, which makes it a minority slice: most of
// this corpus writes a bare `file.mjs:N`. This arm reads the other direction and needs no annotation at
// all. Whatever a citation MEANS, it cannot mean a blank line or a line of bare punctuation — the class
// here is "nothing but whitespace, braces, brackets, parens, semicolons or commas", which is wider than
// a lone closing brace and is stated that way so the guard's message matches what its regex admits —
// nobody cites punctuation on purpose. So a span that is entirely that is drift, and it is the drift
// that can be recognised without reading the sentence around it.
//
// THE WHOLE SPAN, NOT THE FIRST LINE. Measured on this tree, 2026-08-23: keying on the first cited line
// alone reports 13 shipping citations and 2 of them are correct — `contract-audit.mjs:270` cites
// `delivery-contract.md:34-37`, `declination-call.mjs:106` cites `synthesis-rules.md:162-165`, and both
// are ranges that open on a blank line and then carry exactly the content they promise. Requiring EVERY
// line of the span to be empty drops both WITHOUT an exemption, and leaves no false positive to exempt.
// That matters more than the two rows: an exemption list here would be keyed on "this citation looks
// like prose about citations", which is the shape that hid 's drift inside its own carve-out.
//
// WHAT IT CANNOT SEE, and why this stays a slice. A citation that lands on the WRONG NON-BLANK LINE is
// invisible to it — that looks identical to a correct one. Three of the eleven citations repointed in
// `stages.mjs` under this issue were exactly that: `stages.mjs:1474` pointed at a transliteration `why:`
// row, `pipeline.mjs:2908` at a different function entirely, and neither line was blank. Only 's
// arm can decide those, and only where the citation names a symbol. A clean run here is evidence about
// punctuation, not about correctness.
//
// AN OVERRUN IS NOT THIS FINDING. A span running past the file's last line is already reported as
// OVERRUN, and reading undefined lines as "blank" would report one defect twice under two names.
//
// IT FAILS NOTHING OUTSIDE THE CUT. A dated design document records what was true when it was written;
// repointing its citations at today's lines would make it claim something it never claimed. On this tree
// that is 16 rows, every one inside a dated design history the cut withholds. They are printed and
// carried, never fixed by this guard.
export const NOTHING_THERE = (s) => /^[\s{}()[\];,]*$/.test(String(s ?? ""));

/**
 * Citations whose ENTIRE cited span is blank or brace-only, split by whether the CITING file crosses the
 * cut. `readLines(path)` returns the cited file's lines, or null when it cannot be read. PURE given its
 * readers — the unit arm calls it with a synthetic corpus and no tree at all.
 */
export function structuralMisses(citations, readLines, ships = sourceCrossesTheCut) {
  const misses = [], unshipped = [];
  for (const c of citations) {
    if (c.state !== "exact" && c.state !== "unique") continue;
    // PLANTED DATA IS EXEMPT HERE TOO — the table's own header says "EXEMPT WHATEVER IT RESOLVED TO",
    // and the resolver consults it only under `unresolved` while these three walks did not consult it
    // at all. A planted path that resolves EXACTLY (a synthetic "/srv/app/driver/pipeline.mjs" stack
    // trace strips to the real driver/pipeline.mjs) was therefore judged as a claim about our tree. It
    // passed for as long as whatever line it happened to name was real code, and reported the first
    // time an unrelated edit made that line a brace — a finding of luck, which is what this guard's own
    // note two screens up says it must never be. A planted citation's line number is the DATUM a test
    // feeds its parser, never an assertion about this repository.
    if (exemptTarget(c.cited)) continue;
    const body = readLines(c.path);
    if (!body) continue;
    const end = c.end ?? c.start;
    if (c.start < 1 || end < c.start || end > body.length) continue;   // OVERRUN owns that row
    const span = [];
    for (let n = c.start; n <= end; n++) span.push(body[n - 1]);
    if (!span.every(NOTHING_THERE)) continue;
    (ships(c.from) ? misses : unshipped).push({ ...c, spanEnd: end });
  }
  return { misses, unshipped };
}

if (isEntrypoint(import.meta.url)) main();
