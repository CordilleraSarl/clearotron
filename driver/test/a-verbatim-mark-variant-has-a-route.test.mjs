// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-verbatim-mark-variant-has-a-route.test.mjs —, the follow-on to.
//
// made the compiler refuse an annotated variant at any length, which is right: `ZEPHYR (root)`
// dispatched verbatim is a nil search that reads as a clean. The open question it left was what happens
// to a value that genuinely IS a mark carrying that punctuation — a device mark recorded with its
// Vienna code — because the refusal ended "the mark-shaped term(s) it stands for must be authored
// instead", which is a dead end for a value that already is the mark.
//
// THE ESCAPE EXISTS AND IT IS ONE LANE OVER, deliberately. `term_literal` is stamped by `literalStamp`
// for manifest-provenance values only, on the authority register-plan.mjs states in place: "manifest
// provenance is the term_literal authority: the manifest is the matter's RATIFIED mark". So the MARK is
// already shielded and needs nothing; a model-authored VARIANT claiming the same status is exactly the
// claim the lint exists to check, and the flag's own description forbids it — "Never use it to push a
// label through."
//
// So the fix is not a new flag. It is that the refusal names the route (this is a disclosed deferred
// row; judgment re-proposes it supplementally), and that the variants doctrine says so, because nothing
// said it before and an author meeting the refusal had nowhere to go.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { variantTermIssue } from "../register-plan.mjs";
import { termMarkupIssue, termShapeIssue } from "../../providers/_shared/term-shape.mjs";

const SKILL = readFileSync(new URL("../skills/prelim-variants/SKILL.md", import.meta.url), "utf8");
// `literalStamp`, restated here rather than imported — it is module-private, and pinning the PREDICATE
// is the point: if it stops shielding the ratified mark, the arms below are asserting a route that no
// longer exists.
const literalStamp = (t) => (!termMarkupIssue(t) && termShapeIssue(t) ? { term_literal: true } : {});

test("#1622 the MARK carrying a bracketed element is already shielded — no new flag is needed", () => {
  // The case the issue was filed about, at the place it actually arrives. A device mark recorded with
  // its Vienna code is manifest provenance, so it takes term_literal automatically.
  assert.deepEqual(literalStamp("DOLPHIN DEVICE (VIENNA 03.09.14)"), { term_literal: true });
  // And markup is never shielded, whatever its provenance — the one exclusion in that predicate.
  assert.deepEqual(literalStamp("**BOLD**"), {});
});

test("#1622 a model-authored variant is still refused — the lint is not weakened", () => {
  // The whole point of not adding the flag to the manifest: the earliest, cheapest stage must not be
  // able to self-certify a bypass of the lint that catches its own mistakes.
  for (const t of ["ZEPHYR (root)", "ORVELLA (root)", "ONE; TWO"]) {
    assert.ok(variantTermIssue(t), `${JSON.stringify(t)} stopped being refused`);
  }
  assert.equal(variantTermIssue("DOLPHIN DEVICE"), null, "and an ordinary mark still compiles");
});

test("#1622 the refusal names a route for BOTH readings, not just the label one", () => {
  const v = variantTermIssue("ZEPHYR (root)");
  // The label reading, which was always there and stays.
  assert.match(v, /author the mark-shaped term\(s\) it stands for/);
  // The reading that had no route: what to do when the value really is the mark.
  assert.match(v, /genuinely IS a mark/);
  assert.match(v, /register_propose_supplemental/, "the refusal must name the tool that carries the escape");
  assert.match(v, /term_literal/, "…and the flag it is carried by");
  assert.match(v, /deferred row/, "…and that the refusal is disclosed rather than silent");
  // It must NOT tell the author to strip the punctuation out of a real mark, which silently narrows
  // what was searched — the failure this message is trying to prevent, not cause.
  assert.equal(/remove the punctuation|strip the/i.test(v), false);
});

test("#1622 the variants doctrine states the route, so an author meeting the refusal has somewhere to go", () => {
  // A refusal message is read once, by a model mid-turn. The skill is the surface that stops the value
  // being written in the first place, and it carried nothing about term shape at all before this.
  const FLAT = SKILL.replace(/\s+/g, " ");
  assert.match(FLAT, /A variant VALUE is a mark term, never a note about one/);
  assert.match(FLAT, /rationale column is where the note belongs/, "it must say where the note DOES go");
  assert.match(FLAT, /not this stage's to certify/);
  assert.match(FLAT, /not reachable from this stage and there is no\s*call for you to make/,
    "the doctrine must say the route exists AND that it is not this stage's to take");
  // AND IT MUST NOT NAME A TOOL THIS STAGE CANNOT CALL. `prelim-variants` is granted only
  // `record_prelim_variants`; serving it the supplemental tool's name invites a call that cannot
  // succeed and burns a turn. contract-dictation.test.mjs enforces this across every served surface —
  // it caught the first draft of this very paragraph, which named the tool outright.
  assert.equal(/register_propose_supplemental/.test(FLAT), false,
    "the variants doctrine names a tool the stage has no grant for");
  // The instruction that keeps the honest outcome honest: never work around it by editing the mark.
  // Whitespace-tolerant: the source is hard-wrapped prose, so a phrase can fall across a line break —
  // which is exactly how this assertion failed when first written.
  assert.match(SKILL.replace(/\s+/g, " "), /silently narrows what was searched/);
});
