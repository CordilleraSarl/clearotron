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
// third-party risk, and their notes hold capability facts worth keeping.
//
// EVERY FILE UNDER A PAID VENDOR'S DIRECTORY IS SCANNED, ITS `test/` TREE INCLUDED. An earlier version
// exempted `providers/{clarivate,corsearch,signa}/test/` on the stated ground that those trees are
// withheld from the public cut. That ground was true when it was written and is false now: the trees are
// tracked in the public repository, where anyone reads them without cloning. The package `files` list
// does exclude `**/test/`, so nothing from them reaches the registry — but that shuts one of the two
// doors and this check is named for the other one. The exemption is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The files that PUBLISH and name a paid vendor — each vendor's WHOLE directory, not its `src` alone.
// `providers/_shared/` is here deliberately: it is not withheld, it names vendors, and it carried two
// probe dates that its own file list did not mention.
//
// NAMING THE DIRECTORY RATHER THAN ITS PARTS IS THE POINT. While this list held `<vendor>/src` plus one
// hand-added README, two of the three vendor READMEs were in no entry and a `test/` tree that had since
// appeared in the public repository was read by nothing. Neither gap announced itself, because a list
// that does not mention a file reports no absence for it. A directory covers what is added under it.
const SCANNED = [
  "providers/clarivate",
  "providers/corsearch",
  "providers/signa",
  "providers/_shared",
  "driver/skills/prelim-register/providers/clarivate.md",
  "driver/skills/prelim-register/providers/corsearch.md",
  "driver/skills/prelim-register/providers/signa.md",
];

/**
 * The corpus, and it REFUSES rather than narrows.
 *
 * A listed path that has moved would otherwise contribute nothing and the scan below would report a
 * clean tree over a corpus it could not reach — which is the same defect this guard exists to catch,
 * wearing the guard's own clothes. That discovered-set census caught the first draft doing exactly
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
  // Read, then ASSERT THE SET, then loop. That discovered-set census wants the non-emptiness stated
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

// ── A PROBE ROUND IS ONE RECORD WRITTEN ACROSS SEVERAL LINES, AND EVERY RULE ABOVE READS ONE LINE ──
//
// The shape that got past them: a sentence saying the vendor was probed, and beneath it a table pairing
// query shapes with that vendor's statuses and its measured counts. The sentence carries no figure and no
// row carries a method word, so every line is innocent read alone and the file scanned clean for as long
// as it stood. This is how anybody writes a probe round down, so it recurs rather than being an incident.
//
// BOTH HALVES MUST BE IN A COMMENT, and that constraint is the whole difference between this rule and an
// unrunnable one. Measured over the scanned population: with it, five sites match and all five are real
// probe rounds; without it, four more match and all four are functional test code — a variable named
// `probed` beside a fixture's `total: 900`, a sentence about probing beside a fixture's page size. Figures
// belong in code. A method word in a comment with figures under it does not.
const METHOD_WORD = /\b(?:probed|re-probed|probe[-\s]verified|the\s+probes)\b/i;
const WINDOW = 4;
const isCommentLine = (line, isMarkdown) => isMarkdown || /^\s*(?:\/\/|\/?\*)/.test(line);
// A table ROW rather than a sentence that mentions a figure: two or more numbers, one of them at least
// two digits. One number in a line of prose is a capability statement, which is what we ask authors for.
const isTableRow = (line) => {
  const nums = line.match(/(?:^|[^\w.])\d+(?:,\d{3})*(?![\w.])/g) ?? [];
  return nums.length >= 2 && nums.some((n) => /\d\d/.test(n));
};

export function probeTables(text, { isMarkdown = false } = {}) {
  const lines = String(text).split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!METHOD_WORD.test(lines[i]) || !isCommentLine(lines[i], isMarkdown)) continue;
    for (let j = i + 1; j <= Math.min(i + WINDOW, lines.length - 1); j++) {
      if (isCommentLine(lines[j], isMarkdown) && isTableRow(lines[j])) { out.push({ method: i + 1, row: j + 1 }); break; }
    }
  }
  return out;
}

// ── AND A ROUND IS ALSO WRITTEN AS ONE ORDINARY SENTENCE, WHICH FALLS BETWEEN BOTH RULES ABOVE ──
//
// The table rule looks BELOW the method word, and `a measured hit count beside the method` allows twelve
// characters after it. An author who writes the finding as English — the method word, a few words, then
// the vendor's figures, all on one line — is outside both. Measured over the scanned population the day
// the table rule landed: two such records were in the tree, both in provider source that ships, and this
// whole file was green over them.
//
// THE TWELVE-CHARACTER GAP WAS STANDING IN FOR DIRECTION. A record reads forward — the vendor was probed,
// AND THE ANSWER WAS N — so the figure follows the method word, and a figure standing BEFORE it belongs
// to another clause. Requiring direction rather than proximity flags both real records and nothing else:
// over the whole scanned population 2 matched and both are real, against 15 other comment lines carrying
// a method word that stay clean. The one line a proximity-free rule would otherwise catch — an HTTP
// status early in the sentence — is not matched, because the only figure FOLLOWING its method word is a
// single digit, below the two-figure floor.
//
// The COMMENT constraint is the one that makes the table rule runnable and it does the same work here:
// figures belong in code, so a method word in a comment with a measured figure after it is a record.
const FIGURE_AFTER_METHOD = /\b(?:probed|re-probed)\b[^\n]*?(?:^|[^\w.])\d{2,}(?![\w.])/i;

export function probeSentences(text, { isMarkdown = false } = {}) {
  const lines = String(text).split("\n");
  const out = [];
  lines.forEach((line, i) => {
    if (isCommentLine(line, isMarkdown) && FIGURE_AFTER_METHOD.test(line)) out.push({ line: i + 1 });
  });
  return out;
}

const findings = () => {
  const out = [];
  for (const rel of SCANNED.flatMap(filesUnder)) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const p of PROVENANCE) if (p.re.test(line)) out.push(`${rel}:${i + 1} — ${p.name} — ${line.trim().slice(0, 110)}`);
    });
    for (const t of probeTables(text, { isMarkdown: rel.endsWith(".md") }))
      out.push(`${rel}:${t.method} — a probe round with its figures in a table under it — see line ${t.row}: `
        + lines[t.row - 1].trim().slice(0, 90));
    for (const s of probeSentences(text, { isMarkdown: rel.endsWith(".md") }))
      out.push(`${rel}:${s.line} — a probe round written as one sentence, its figures after the method word — `
        + lines[s.line - 1].trim().slice(0, 90));
  }
  return out;
};

test("the scan reads a real corpus and its matcher works — CONTROL, before any absence is believed", () => {
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

test("the FUNCTIONAL probe vocabulary is NOT flagged — or this guard gets deleted within a week", () => {
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

test("no file in the public cut records HOW a paid vendor's behaviour was discovered", () => {
  const found = findings();
  assert.deepEqual(found, [],
    "vendor provenance is back in the published tree. State the capability, not how it was learned: "
    + "\"the result ceiling is 5,000 and paging does not fail loud\", never the probe round that "
    + "established it. A provider's own `test/` tree is not the place for it either: that tree is in "
    + "the public repository too. Keep the evidence on the tracker issue that measured it.\n  "
    + found.join("\n  "));
});

test("a paid vendor's `test/` tree is in the scanned population, because it publishes too", () => {
  // THE PROPERTY, NOT THE PATHS. The two files that exist today are not named here: this asks the tree
  // which vendor test directories hold something scannable, then requires the scan to have read all of
  // it. A file renamed, or a fourth paid vendor added, keeps this arm honest where a literal list would
  // go quietly out of date — which is exactly what the exemption it replaced had already done.
  const scanned = SCANNED.flatMap(filesUnder);
  let proved = 0;
  for (const v of ["clarivate", "corsearch", "signa"]) {
    const rel = `providers/${v}/test`;
    if (!existsSync(join(ROOT, rel))) continue;
    let expected;
    // A tree holding nothing this scan reads is not this arm's finding; the floor below catches the
    // case where that is true of every one of them.
    try { expected = filesUnder(rel); } catch { continue; }
    assert.deepEqual(scanned.filter((f) => f.startsWith(`${rel}/`)).sort(), expected.sort(),
      `${rel}/ is in the public repository and the scan did not read all of it`);
    proved += expected.length;
  }
  // THE FLOOR ON THE POPULATION. With no vendor test tree in the checkout every iteration above is
  // skipped and the arm passes having read nothing — the shape this whole file exists to refuse.
  assert.ok(proved, "no paid vendor `test/` tree holds a scannable file, so this arm proved nothing");
});

test("a probe round written as a table is caught, though every line of it reads clean alone", () => {
  // THE SPECIMEN IS THE REAL ONE — the shape this rule was written for, kept here rather than described.
  // Each line goes through the per-line rules FIRST: if any of them fires, this arm would pass for a
  // reason that has nothing to do with the table, and the gap it names would still be open.
  const specimen = [
    "  // leading rule above exists for. Probed on the test install, count calls only:",
    "  //   *PLAN ADJ B*   500      *PLAN ADJ B    200, 36 records",
    "  //   *LEVEL ADJ 2*  500      *LEVEL ADJ 2   200, 14 records",
  ];
  for (const line of specimen)
    assert.deepEqual(PROVENANCE.filter((r) => r.re.test(line)).map((r) => r.name), [],
      `a per-line rule already catches this, so the table rule is not what is being tested: ${line.trim().slice(0, 48)}`);
  assert.deepEqual(probeTables(specimen.join("\n")), [{ method: 1, row: 2 }],
    "the method word and the row beneath it are one record and must be reported as one");

  // The gap is the DISTANCE, so drive the other side of it: past the window the two are not one record.
  const spread = [specimen[0], "  //", "  //", "  //", "  //", specimen[1]];
  assert.deepEqual(probeTables(spread.join("\n")), [],
    "a method word must not reach a figure five lines away, or every comment near a number is a finding");
});

test("functional probe vocabulary beside CODE figures is not a probe table — the rule stays runnable", () => {
  // THE CONTROL, and it is the half that decides whether this rule survives contact with the tree. Both
  // specimens are real lines from the scanned population that a comment-blind version of this rule flags.
  for (const innocent of [
    ["        probed.push({ owners: p.owners, classes: p.nice_classes ?? [] });",
     "        if ((p.nice_classes ?? []).length !== 1) return { ok: true, total: 900 };"],
    ["  // The control: a genuinely empty term still earns verified-zero, because it was genuinely probed.",
     "  installCorsearch((u) => (nameClausesOf(u) > 1 ? page(9999, 0, \"stack\") : page(0, 0)));"],
  ])
    assert.deepEqual(probeTables(innocent.join("\n")), [],
      `functional code read as a probe round: ${innocent[0].trim().slice(0, 52)}`);
});

test("a probe round written as one ordinary sentence is caught, and the rules above do not catch it", () => {
  // THE SPECIMENS ARE THE REAL ONES — both were in provider source that SHIPS on the day the table rule
  // landed, with this whole file green over them. Kept here rather than described, so the rule is driven
  // against what it was written for.
  const specimens = [
    " * `ADJ<n>` is real and probed: MONSTER ADJ ENERGY = 67, MONSTER ADJ2 ENERGY = 72, SALT ADJ PEPPER = 27",
    "  // take — limit 1 — carries the whole answer: probed, `limit:1` returned total 685, identical to the",
  ];
  for (const line of specimens) {
    // FIRST through the per-line rules: if one of them fired, this arm could pass for a reason that has
    // nothing to do with the sentence shape, which is how a new rule gets credit for an old rule's work.
    assert.deepEqual(PROVENANCE.filter((r) => r.re.test(line)).map((r) => r.name), [],
      `a per-line rule already catches this — the sentence rule is not what is being tested: ${line.trim()}`);
    assert.equal(probeSentences(line).length, 1, `the sentence rule missed a real record: ${line.trim()}`);
  }

  // THE ONE FALSE POSITIVE IN THE TREE, AS A CASE RATHER THAN AS LUCK. Its two-digit figure is an HTTP
  // status in the first clause and the only figure AFTER its method word is a single digit, so direction
  // is what keeps it clean. If this ever starts matching, direction has been lost and the rule is a
  // nuisance again.
  const innocent = "  // back 200 + envelope. Before the fix each term was probed as 0 and dispositioned verified-zero —";
  assert.equal(probeSentences(innocent).length, 0, "the sentence rule flags a figure standing before the method word");

  // AND THE COMMENT CONSTRAINT, driven rather than asserted about: the same words in CODE are a variable
  // and a fixture, not a record. Figures belong in code.
  assert.equal(probeSentences("  const probed = rows.filter((r) => r.total === 685);").length, 0,
    "the sentence rule reads code as a record");

  // A method word with its figure BEFORE it, and a method word with no figure at all, are both clean.
  assert.equal(probeSentences("  // 685 rows came back before anything was probed").length, 0, "direction is not being read");
  assert.equal(probeSentences("  // nobody has probed this register at all").length, 0, "a method word alone is not a record");
});


test("the scan REFUSES a corpus it cannot reach, rather than reporting it clean", () => {
  // The failure mode of every absence check, and the one the discovered-set census caught here in
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
