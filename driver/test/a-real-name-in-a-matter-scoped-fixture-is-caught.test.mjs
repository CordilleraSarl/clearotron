// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REAL NAME NOBODY HAS SEEN BEFORE, arriving in a fixture captured from a real matter.
//
// A blocklist cannot catch this. A blocklist knows the names somebody has already retired; the case that
// matters is the FIRST time a real proprietor or conflict mark arrives, when it is on no list anywhere.
// The discriminator is not the name — it is the PATH: a fixture filed under a matter is a capture from a
// real run, and every identity inside one is real by construction unless it was de-identified.
//
// ── WHY THIS CHECK SKIPS TODAY, AND WHY THAT IS THE POINT ────────────────────────────────────────────
//
// This repository carries NO matter-scoped captures — invented names only. So the sweep finds nothing and
// says so. That is not a check that does nothing: it is a check whose population is empty, and the day
// somebody adds a capture from a real matter it stops skipping and starts judging, without anyone having
// to remember this file exists.
//
// The alternative — an anti-vacuity floor asserting the corpus is non-empty — would be WRONG here and is
// deliberately absent. A floor calibrated to a corpus this tree does not have would red permanently and
// be silenced within a week, which is how a guard becomes furniture.
//
// ── WHAT IT MAY NOT PRINT ───────────────────────────────────────────────────────────────────────────
//
// A hit is a real identity, and this runs in PUBLIC CI whose logs are retained and readable. So a hit is
// reported by FILE and ENTRY NUMBER and never by value. The number is a pointer: whoever holds the tree
// can resolve it, and the log cannot. Printing the name would publish, in the act of complaining about
// it, exactly the thing being complained about.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles as trackedCorpus, skipReason } from "../../shared/tracked-files.mjs";
import { norefHits } from "../../shared/identifier-classes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "a real name in a matter-scoped fixture";

// STRUCTURAL, never identity-bearing. A capture is recognised by where it is filed and by the header it
// declares — not by anything it contains, which is the whole reason this can live on a public tree.
//
// A SYNTHETIC MATTER IS NOT A MATTER. The reserved form is a noref whose id begins with three zeros, and
// `norefHits` in shared/identifier-classes.mjs is where the tree defines that — it drops them. This uses
// that function rather than a second copy of the rule, because a discovery rule that disagreed with the
// class definition would judge fixtures the rest of the tree calls synthetic. Measured: without it, this
// check fires on `mcp-server/test/fixtures/report.internal.md`, which declares `matter: noref000001` and
// is invented from end to end.
export const MATTER_PATH_RE = /(?:^|\/)(noref[0-9a-f]{6})-[a-z0-9]+\//i;
export const MATTER_DECLARATION_RE = /^matter:\s*(noref[0-9a-f]{6})\s*$/mi;
const FRONT_MATTER_BYTES = 2000;      // a capture declares its matter in the header, not halfway down

/** A real matter, by the tree's OWN definition of one. */
const isRealMatter = (id) => norefHits(String(id ?? "")).length > 0;

// The two shapes an identity takes inside a capture. `LEGAL_FORM` is the public vocabulary of company
// suffixes and names nobody.
const LEGAL_FORM =
  "Ltd|Limited|GmbH|SAS|SARL|S\\.A\\.|B\\.V\\.|N\\.V\\.|LLC|L\\.L\\.C\\.|Inc\\.?|Incorporated|" +
  "Pty|Oy|AB|AG|Corp\\.?|Corporation|Company|Holdings|Foundation|Bank|Plc|PLC";
export const PROPRIETOR_RE =
  new RegExp(`[A-Z][A-Za-z0-9&.'/-]*(?:[ ][A-Z][A-Za-z0-9&.'/-]*){0,4}[ ](?:${LEGAL_FORM})(?![a-z])`, "g");
export const CONFLICT_MARK_RE = /<span class="cm-mark">([^<]+)<\/span>/g;

// EMPTY, AND IT MUST STAY EMPTY ON THIS TREE. A declaration says "this real identity is allowed to be
// here, for this reason" — so a non-empty set on a public repository would BE the publication it exists
// to prevent, written down deliberately. If a capture ever needs a declared identity, the capture belongs
// somewhere else.
export const DECLARED = new Set();

/** Both discovery routes, exported so the arms can drive them over planted trees. Pure. */
export function findMatterCaptures(corpus, read) {
  const byPath = [], byDeclaration = [];
  for (const f of corpus ?? []) {
    const onPath = f.match(MATTER_PATH_RE);
    if (onPath && isRealMatter(onPath[1])) { byPath.push(f); continue; }
    // A capture filed outside a matter directory still declares its matter in its own header. Without
    // this route a capture moved one directory up becomes invisible, which is a discovery rule that
    // depends on filing convention rather than on what the file says it is.
    const head = (read(f) ?? "").slice(0, FRONT_MATTER_BYTES);
    const declared = head && head.match(MATTER_DECLARATION_RE);
    if (declared && isRealMatter(declared[1])) byDeclaration.push(f);
  }
  return { byPath, byDeclaration };
}

/** Every identity a capture carries, in a stable order so an entry number means the same thing twice. */
export function identitiesIn(text) {
  const out = [];
  const add = (s) => { const v = String(s ?? "").trim(); if (v && !out.includes(v)) out.push(v); };
  for (const m of String(text ?? "").matchAll(CONFLICT_MARK_RE)) add(m[1]);
  for (const m of String(text ?? "").matchAll(PROPRIETOR_RE)) add(m[0]);
  return out;
}

/**
 * The report. FILE AND ENTRY NUMBER, NEVER THE VALUE — see the header. The count and the ordinal are
 * enough for whoever holds the tree to resolve it, and useless to anyone reading the log.
 */
export function undeclaredReport(rows) {
  return `${rows.length} undeclared identit(y/ies) in matter-scoped fixture(s):\n`
    + rows.map((r) => `  ${r.file}: entry #${r.entry} of ${r.total}`).join("\n")
    + "\n\n  Each is a real proprietor or conflict mark in a capture from a real matter. De-identify it, or"
    + "\n  move the capture out of this repository. The identities are deliberately not printed: this log"
    + "\n  is public and retained, and naming them here would publish what this check exists to stop.";
}

const read = (f) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return null; } };

test("every identity in a matter-scoped fixture is declared", (ctx) => {
  const corpus = trackedCorpus(GUARD, { root: ROOT });
  if (!corpus) return ctx.skip(skipReason(GUARD));

  const { byPath, byDeclaration } = findMatterCaptures(corpus, read);
  const captures = [...byPath, ...byDeclaration];

  // ZERO SEMANTICS. An empty population is reported, never asserted against and never passed over in
  // silence. Both halves matter: a floor here would red forever on a tree that legitimately has none,
  // and a bare `pass` would read as "swept and clean" when nothing was swept at all.
  if (!captures.length) {
    return ctx.skip(`no matter-scoped capture is tracked here — ${corpus.length} file(s) swept, `
      + "0 matched a matter path and 0 declared a matter in their header. This repository carries "
      + "invented names only, so an empty population is the expected state rather than a failure to "
      + "look. This check begins judging the day a capture from a real matter is added.");
  }

  const rows = [];
  for (const f of captures) {
    const ids = identitiesIn(read(f));
    ids.forEach((id, i) => {
      if (!DECLARED.has(id)) rows.push({ file: f, entry: i + 1, total: ids.length });
    });
  }
  assert.equal(rows.length, 0, undeclaredReport(rows));
});

test("THE CANARY — with the corpus empty, this is the only proof the check can fire", () => {
  // The arm above skips on this tree, so on its own it proves nothing about whether the machinery works.
  // This plants a capture on each discovery route and requires the sweep to find it and refuse it.
  const planted = new Map([
    ["providers/x/test/fixtures/noref123456-arbora/capture.html",
      '<span class="cm-mark">Northwind Trading Ltd</span>'],
    ["providers/x/test/fixtures/loose-capture.md",
      "matter: noref654321\n\nProprietor: Zephyr Beverages GmbH\n"],
  ]);
  const { byPath, byDeclaration } = findMatterCaptures([...planted.keys()], (f) => planted.get(f));
  assert.deepEqual(byPath, ["providers/x/test/fixtures/noref123456-arbora/capture.html"],
    "the matter-path route must find a capture filed under a matter directory");
  assert.deepEqual(byDeclaration, ["providers/x/test/fixtures/loose-capture.md"],
    "…and the header route must find one that is not, or a capture moved one directory up goes unseen");

  for (const [f, text] of planted) {
    const ids = identitiesIn(text);
    assert.ok(ids.length > 0, `${f}: the extractor found no identity in a file that carries one`);
    assert.ok(ids.every((id) => !DECLARED.has(id)), "and nothing on this tree is declared");
  }
});

test("the report names a FILE and an ORDINAL, and never an identity", () => {
  // The property that lets this run in public CI at all. Driven over a planted hit rather than asserted
  // about the format, because the format is not the risk — what reaches the string is.
  const text = '<span class="cm-mark">Northwind Trading Ltd</span> and Zephyr Beverages GmbH';
  const ids = identitiesIn(text);
  assert.equal(ids.length, 2, "the fixture must carry two identities or this arm proves nothing");
  const said = undeclaredReport(ids.map((_, i) => ({ file: "p/x/test/fixtures/noref123456-a/c.html", entry: i + 1, total: ids.length })));
  for (const id of ids) assert.ok(!said.includes(id), `the report carries the identity ${JSON.stringify(id)}`);
  assert.match(said, /entry #1 of 2/);
  assert.match(said, /entry #2 of 2/);
  assert.match(said, /deliberately not printed/);
});

test("the declaration set is EMPTY, and that is an assertion rather than an accident", () => {
  // A declared identity is a real name written into a public repository with a reason beside it. There is
  // no reason that survives being on this tree, so the set is empty and an arm says so — otherwise the
  // first person who needs one adds it and nothing objects.
  assert.equal(DECLARED.size, 0,
    "a declaration on the public tree would BE the publication this check exists to prevent");
});

test("a capture with no identity in it is not a finding", () => {
  // The other direction. A capture that carries nothing must not be reported as carrying something, or
  // the arm cries wolf on every synthetic fixture that happens to sit under a matter path.
  assert.deepEqual(identitiesIn("nothing here but prose and a lowercase ltd"), []);
  assert.deepEqual(identitiesIn(""), []);
  assert.deepEqual(identitiesIn(null), []);
});
