// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// no-vendor-provenance-in-the-public-cut.test.mjs — family 1, the mechanism it was missing.
//
// `d7a7ac4d` removed 22 sites that recorded HOW a paid vendor's behaviour was discovered — probe dates,
// measured hit counts, `probe-verified` — and fixed the producer: `providers/README.md` no longer tells
// the next provider-doc author to ship a "Provenance" section. That closes the regeneration path.
//
// IT CLOSED NOTHING AGAINST A HAND-ADDED LINE, and the test lane proved it rather than suspected it: a
// measured hit count and a probe date were planted back into `providers/signa/src/capabilities.js` and
// `publication-scrub` (11 pass), `register-capabilities` (32 pass) and the whole providers suite (624
// pass) all stayed green. `publication-scrub` guards operator identity, withheld paths and citations —
// vendor provenance is not in its battery — and `providers/*/src/` carries no instruction-load ratchet
// because it is not a skills tree. So the next author writing `// probed: 363` beside a declaration got
// no signal at all, on a `track:oss-launch` issue where the cost of a miss is a published tree.
//
// A rule with no mechanism is not a weak rule; it is a rule that has stopped existing.
//
// ── WHAT THIS DOES AND DOES NOT FLAG ─────────────────────────────────────────────────────────────
//
// The word "probe" is FUNCTIONAL vocabulary here and most of its uses are innocent: `countProbe: "cheap"`
// is a capability value, and "register_enumerate probes POST /count first" describes what the code does.
// Flagging those would make this unrunnable and it would be deleted within a week. The patterns below
// match the shapes that record an INVESTIGATION — a date, a hit count, or the words that name the method.
//
// SCOPED TO THE PAID VENDORS. EUIPO and USPTO are free public offices whose material carries no
// third-party risk, and their notes hold capability facts worth keeping ( says so itself). The
// three `providers/{clarivate,corsearch,signa}/test/` trees are WITHHELD from the public cut and are
// where probe evidence legitimately lives — they are not scanned, by construction, because this is a
// check about what publishes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The files that PUBLISH and name a paid vendor. `providers/_shared/` is here deliberately: it is not
// withheld, it names vendors, and it carried two probe dates that 's own file list did not mention.
const SCANNED = [
  "providers/clarivate/src",
  "providers/corsearch/src",
  "providers/signa/src",
  "providers/_shared",
  "driver/skills/prelim-register/providers/clarivate.md",
  "driver/skills/prelim-register/providers/corsearch.md",
  "driver/skills/prelim-register/providers/signa.md",
  "providers/corsearch/README.md",
];

const WITHHELD_TEST_TREES = /providers\/(clarivate|corsearch|signa)\/test\//;

/**
 * The corpus, and it REFUSES rather than narrows.
 *
 * A listed path that has moved would otherwise contribute nothing and the scan below would report a
 * clean tree over a corpus it could not reach — which is the same defect this guard exists to catch,
 * wearing the guard's own clothes. 's discovered-set census caught the first draft doing exactly
 * that, so both the missing case and the empty-directory case throw by name.
 *
 * A legitimately deleted file is therefore a deliberate edit to SCANNED, not a silent narrowing.
 */
function filesUnder(rel, { top = true, base = ROOT } = {}) {
  const abs = join(base, rel);
  if (!existsSync(abs))
    throw new Error(`[#1375 scan] ${rel} is listed in SCANNED and does not exist. If it moved, repoint `
      + "it; if it was deleted, remove it from the list deliberately — a listed path that silently "
      + "contributes nothing makes every absence below meaningless.");
  if (statSync(abs).isFile()) return [rel];
  // Read, then ASSERT THE SET, then loop. 's discovered-set census wants the non-emptiness stated
  // before the iteration and not inferred after it, and it is right: a loop over an empty directory
  // completes happily and contributes nothing, which is indistinguishable from a directory of clean
  // files at every point downstream.
  const entries = readdirSync(abs, { withFileTypes: true });
  assert.ok(entries.length,
    `[#1375 scan] ${rel} is an empty directory. A loop over it would report every absence below `
    + "without reading anything.");
  const out = [];
  for (const e of entries) {
    const child = `${rel}/${e.name}`;
    if (WITHHELD_TEST_TREES.test(`${child}/`)) continue;
    if (e.isDirectory()) out.push(...filesUnder(child, { top: false, base }));
    else if (/\.(js|mjs|md)$/.test(e.name)) out.push(child);
  }
  // Only at a listed root: an empty SUBdirectory is ordinary, an empty listed one is a moved corpus.
  if (top && !out.length)
    throw new Error(`[#1375 scan] ${rel} yielded no scannable file. The corpus moved, and a clean scan `
      + "over an empty corpus is not evidence of anything.");
  return out;
}

// Each pattern names the SHAPE it catches, so a failure tells an author which rule they met.
const PROVENANCE = [
  { name: "probe-verified", re: /probe[-\s]verified/i },
  { name: "swagger-derived", re: /swagger[-\s]derived/i },
  { name: "a probe/verification DATE", re: /\b(?:probed|re-probed|verified(?:\s+live)?|measured|tested)\b[^\n]{0,40}?\b20\d\d-\d\d-\d\d/i },
  // "probed: 363", "probed, 685 → 375" — the method word bound to a measured figure. The gap is kept
  // short on purpose: "probed to page 137,000 of a 1.37M-hit result set" is EUIPO's, a free office, and
  // is not in scope anyway, but a wide gap would also catch innocent prose that merely mentions a number.
  { name: "a measured hit count beside the method", re: /\b(?:probed|re-probed)\b[\s,:]{0,3}[^\n]{0,12}?\b\d{2,}\b/i },
];

const findings = () => {
  const out = [];
  for (const rel of SCANNED.flatMap(filesUnder)) {
    const lines = readFileSync(join(ROOT, rel), "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const p of PROVENANCE) if (p.re.test(line)) out.push(`${rel}:${i + 1} — ${p.name} — ${line.trim().slice(0, 110)}`);
    });
  }
  return out;
};

test("#1375 the scan reads a real corpus and its matcher works — CONTROL, before any absence is believed", () => {
  // A scan that reads nothing reports every absence, and a pattern that matches nothing reports a clean
  // tree. Both are the failure this issue is about wearing the fix's clothes, so neither is assumed.
  const files = SCANNED.flatMap(filesUnder);
  assert.ok(files.length >= 12, `the scan found ${files.length} file(s) — it has lost its corpus`);
  const corpus = files.map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");

  // The corpus is really the vendor files: a token only they carry.
  assert.match(corpus, /countProbe/, "the scan is not reading the capability files it claims to read");

  // And the matcher fires on the shape it is for — the exact line the test lane planted back in.
  const plant = "// probe-verified 2026-08-17: exact exhausted at 685, contains at 2047, owner-scoped stopped at 400";
  assert.ok(PROVENANCE.some((p) => p.re.test(plant)),
    "the planted line does not match any pattern — a clean scan below would mean the matcher stopped matching");
  // WHICH rules catch it, by name and measured rather than counted to a number I guessed. Two do: the
  // method word and the date. The hit-count rule does NOT, because the specimen says "probe-verified"
  // and not "probed", and asserting otherwise would have pinned a fiction about my own patterns.
  assert.deepEqual(PROVENANCE.filter((p) => p.re.test(plant)).map((p) => p.name),
    ["probe-verified", "a probe/verification DATE"],
    "the specimen is caught by different rules than when this was written — read them before adjusting");
  // And the hit-count rule is not decorative: it is the one that found the site the manual sweep missed.
  assert.ok(PROVENANCE.find((p) => p.name === "a measured hit count beside the method")
    .re.test("// composes in ONE request (probed: term 238, owner 608, term×owner 1054 — three"),
    "the hit-count rule stopped matching the shape it was added for");
});

test("#1375 the FUNCTIONAL probe vocabulary is NOT flagged — or this guard gets deleted within a week", () => {
  // The other half of the control, and the reason this is scoped to shapes rather than to the word.
  // `countProbe` is a capability VALUE and "probes /count first" is what the code does; a check that
  // called those defects would be unrunnable, and an unrunnable guard is removed rather than obeyed.
  for (const innocent of [
    '  countProbe: "cheap",',
    "  // `register_enumerate` therefore probes `POST /count` first. `/count` is cheap, takes the same body",
    "  // chunks a wide OR-stack to the parser's probed nesting bound before it reaches the wire.",
    "Session-key validation: send one cheap `register_search` before doing any real work.",
  ])
    assert.deepEqual(PROVENANCE.filter((p) => p.re.test(innocent)).map((p) => p.name), [],
      `the guard flags functional vocabulary: ${innocent.trim()}`);
});

test("#1375 no file in the public cut records HOW a paid vendor's behaviour was discovered", () => {
  const found = findings();
  assert.deepEqual(found, [],
    "vendor provenance is back in the published tree. State the capability, not how it was learned: "
    + "\"the result ceiling is 5,000 and paging does not fail loud\", never the probe round that "
    + "established it. Evidence belongs with the fixtures under the provider's own `test/` tree, which "
    + "does not publish — see providers/README.md.\n  " + found.join("\n  "));
});

test("#1375 the scan REFUSES a corpus it cannot reach, rather than reporting it clean", () => {
  // The failure mode of every absence check, and the one 's discovered-set census caught here in
  // review: a listed path that moved contributes nothing, the loop walks a shorter list, and the arm
  // above reports a clean tree. Both ways of reaching nothing now throw by name.
  assert.throws(() => filesUnder("providers/does-not-exist/src"), /is listed in SCANNED and does not exist/);
  // Driven over a temp base rather than by writing into the checkout: a guard that edits the tree it is
  // scanning is a worse hazard than the one it guards against.
  const base = mkdtempSync(join(tmpdir(), "scan-corpus-"));
  mkdirSync(join(base, "empty-dir"));
  assert.throws(() => filesUnder("empty-dir", { base }), /is an empty directory/);
  mkdirSync(join(base, "no-matches"));
  writeFileSync(join(base, "no-matches", "data.json"), "{}");
  assert.throws(() => filesUnder("no-matches", { base }), /yielded no scannable file/,
    "a root holding only unscanned file types must refuse, not return an empty corpus");
});
