// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ONE SENTENCE, TWO AUTHORS, AND THIS IS WHAT HOLDS THEM TOGETHER.
//
// When the daily allowance is spent, the engine refuses a start with a sentence composed from the limit
// and the operator's name. The browser never receives that string — the usage read carries counts and
// nothing else — so the screen composes it again from the same two facts. That is a second author for
// one sentence, which is the arrangement this codebase keeps finding out about the hard way: two
// definitions of one rule is one definition and one imitation, and the imitation is whichever the
// reader did not run.
//
// It cannot be repaired by deleting one of them. The server must refuse in words even when no browser is
// involved, and the screen must warn before the refusal, when there is still something a reader can do.
// So both stay and this arm reads BOTH FILES and fails when they drift.
//
// WHAT IS COMPARED IS THE SHAPE WITH ITS VALUES REMOVED, not the finished string: one side has a real
// limit and a real brand, the other has template holes, and comparing the rendered text would need this
// file to know today's numbers. The skeleton is what a reader actually meets.
//
// ── ONE EXTRACTION, BECAUSE A SPELLING IS NOT A PROPERTY ─────────────────────────────────────────────
//
// This arm read the two sides with two different patterns, and the engine's ended at the first backtick.
// That held only while the engine wrote the sentence as a single template literal. When the engine's
// copy moved into a named function and was split across two concatenated literals — the same shape the
// screen's copy had always had — the pattern could no longer reach the end of the sentence, matched
// nothing, and the arm failed saying the engine no longer refuses in words. It does; the words had
// moved. The floor is what caught it, and it was right to: an extraction that found nothing would
// otherwise have compared "" with "" and passed.
//
// So both sides are now read the same way, by the shape a reader meets rather than by either file's
// current line breaks: from the opening backtick to the closing one, the concatenation joined up. A
// side that is reflowed back into one literal still matches, and neither file's layout can make this
// arm blind again. The span is BOUNDED because an unbounded lazy match, on a side that had lost its
// ending, would run on through the file to some later "for you." and return a match that is not this
// sentence at all — which is the floor above defeated by the repair meant to preserve it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const SERVER = "driver/portal-service.mjs";
const SCREEN = "portal-ui/src/contract/allowance.ts";

/** The sentence as written in either file: template literals, however many, joined end to end. */
const EXHAUSTED = /`You have used all [\s\S]{0,400}?for you\.`/;

/** A template's holes removed, so two spellings of one sentence can be compared as one. */
const skeleton = (s) => String(s)
  .replace(/\$\{[^}]*\}/g, "\0")        // a template hole, whatever it interpolates
  .replace(/\s+/g, " ")
  .trim();

/** A match as its reader meets it: the `+` between concatenated literals gone, the quoting removed. */
const joined = (m) => m[0].replace(/`\s*\+\s*`/g, "").replace(/^`|`$/g, "");

/** The sentence, or null — never a throw, so the floor below is what reports a side that has moved. */
const sentenceIn = (path) => EXHAUSTED.exec(read(path));

test("THE SCREEN'S EXHAUSTED SENTENCE IS THE SERVER'S, word for word", () => {
  // ── THE FLOOR, FIRST ──
  //
  // Everything below is a comparison between two extracted strings, and an extraction that found
  // nothing would compare "" with "" and pass. Both sites are named and both must be present.
  const serverLine = sentenceIn(SERVER);
  assert.ok(serverLine, `the engine no longer refuses a spent allowance in words, in ${SERVER} — this arm is reading nothing`);

  const clientLine = sentenceIn(SCREEN);
  assert.ok(clientLine, `the screen no longer composes the exhausted sentence, in ${SCREEN} — this arm is reading nothing`);

  assert.equal(skeleton(joined(clientLine)), skeleton(joined(serverLine)),
    "the screen and the engine now say different things about a spent allowance — change both, or neither");
});

test("THE SENTENCE NAMES THE CAP AND THE OPERATOR, and both sides fill them from data", () => {
  // WITHOUT THIS, THE ARM ABOVE PASSES ON TWO IDENTICAL HARDCODED SENTENCES. The skeleton comparison
  // removes every hole — so two copies that had stopped interpolating anything would match perfectly,
  // and a reader would meet a literal brand name and a literal cap on both surfaces.
  for (const [name, path] of [["the engine", SERVER], ["the screen", SCREEN]]) {
    // ITS OWN FLOOR. This read used to dereference the match directly, so a side that had moved came
    // back here as a TypeError about null rather than as the sentence being gone.
    const match = sentenceIn(path);
    assert.ok(match, `${name} no longer writes the exhausted sentence, in ${path} — this arm is reading nothing`);

    const holes = joined(match).match(/\$\{[^}]*\}/g) ?? [];
    assert.equal(holes.length, 2,
      `${name} fills ${holes.length} value(s) into the exhausted sentence, not two — the cap and the operator`);
  }
});
