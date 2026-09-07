// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Every disposition row KIND the driver emits is described in the doctrine the seat reads.
//
// ── WHY ───────────────────────────────────────────────────────────────────────────────────
//
// The driver emits `kind: "recurrence"` rows (connotation-search.mjs) and the seat's doctrine never
// mentioned the kind. Not once, in any file under driver/skills/. The row also breaks the shape the
// doctrine DOES describe: it carries `queries` as a list where a query row carries `query` as a string,
// and its `receipt_id` arrives pre-filled.
//
// The consequences ran in both directions, which is what makes it worth a guard rather than a fix:
//
//   · R2's seat DECLINED to improvise on gang names, ECHR case law and abuse-ring pages — correct
//     behaviour with no way to express it — and stalled at four byte-identical attempts. No retry
//     teaches a model a shape its instructions do not describe.
//   · R1's seat improvised confidently on easier material and DELIVERED. 156 recurrence rulings across
//     at least 8 production matters were made against no doctrine, and in the artefact they are
//     indistinguishable from directed ones.
//
// A validator cannot catch that: both rows are well-formed. The only durable fix is that a kind cannot
// reach a seat without the doctrine describing it, which is what this asserts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { trackedFiles as trackedCorpus, skipReason } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "disposition-row-kinds-documented";
const DOCTRINE = "driver/skills/prelim-common-law/SKILL.md";

// The kinds as the EMITTER writes them, read from the source rather than from a list I maintain here —
// a hand-kept list is the second copy that drifts, which is the defect class this round has fixed four
// times over.
function emittedKinds() {
  const src = readFileSync(join(ROOT, "driver", "connotation-search.mjs"), "utf8");
  const kinds = new Set();
  for (const m of src.matchAll(/^\s*kind:\s*"([a-z-]+)"\s*,/gm)) kinds.add(m[1]);
  return [...kinds].sort();
}

test("#561 every emitted disposition row kind is named in the seat's doctrine", (t) => {
  const all = trackedCorpus(GUARD, { root: ROOT, pathspec: ["driver/skills"] });
  if (all === null) return t.skip(skipReason(GUARD));
  assert.ok(all.includes(DOCTRINE), `${DOCTRINE} is tracked and in scope`);

  const kinds = emittedKinds();
  assert.ok(kinds.length >= 2, `expected the emitter's kinds, found ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes("recurrence"), "the kind #561 was about must still be found by this reader");

  const doctrine = readFileSync(join(ROOT, DOCTRINE), "utf8");
  const undocumented = kinds.filter((k) => !doctrine.includes(k));
  assert.deepEqual(undocumented, [],
    "a row kind the seat is asked to rule on, that its doctrine never describes. No retry teaches a "
    + "model a shape its instructions do not carry — it improvises (R1, delivered) or it stalls (R2, "
    + `four byte-identical attempts). Describe it in ${DOCTRINE}: ${undocumented.join(", ")}`);
});

// Markdown WRAPS. A guard keyed on an exact phrase fails the moment somebody rewraps a paragraph — this
// one did, on its own first tightening pass: "Four or\n  more distinct queries" broke the literal it was
// looking for. Assert MEANING across whitespace, or the guard reports a doctrine change that is really a
// line break, and the next person learns to override it.
const says = (text, ...words) => new RegExp(words.join("\\s+"), "i").test(text.replace(/\n\s*/g, " "));

test("#561 the doctrine carries the three things that make a recurrence row different", () => {
  const d = readFileSync(join(ROOT, DOCTRINE), "utf8");
  // Naming the kind is not describing it. These are the properties a seat cannot infer from a query row.
  assert.ok(says(d, "`queries`", "is", "a", "LIST"), "the LIST field — where a query row has one string");
  assert.ok(says(d, "pre-filled") || says(d, "already", "chosen"), "that receipt_id arrives filled and must not be changed");
  assert.ok(says(d, "four", "or", "more", "distinct", "quer"), "what promotes a result to a recurrence row at all");
});

test("#561 the doctrine carries the HONEST-DECLINATION path", () => {
  // The half that R2 proved is missing: a seat facing material it cannot responsibly rule needs a move
  // that is not improvisation and not silence. Without it, correct caution reads to the gate exactly
  // like a failure — which is what happened.
  const d = readFileSync(join(ROOT, DOCTRINE), "utf8");
  assert.ok(says(d, "do", "not", "improvise"), "improvising is named and refused");
  assert.ok(says(d, "cannot", "responsibly") || says(d, "could", "not", "establish"),
    "the case where the material does not support a confident ruling is described");
  assert.ok(says(d, "state", "plainly", "what", "you", "could", "not", "establish"),
    "and the seat is told what to WRITE, not merely what not to do");
});
