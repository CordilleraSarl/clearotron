// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// item 4 — the EUIPO environment is recorded by the DRIVER, and no doctrine file asks a seat to
// type it into the findings.
//
// WHY THIS IS TREE-WIDE AND NOT THREE NAMED FILES. changed two of the three docs that carried the
// instruction and left the third — `providers/euipo.md`, which is EUIPO's own `skillDoc` and therefore
// the file a seat reading for EUIPO specifics weights most. The tree then served a direct contradiction:
// two files forbidding the tag, one commanding it, all three live, each naming the other's issue number.
// The acceptance says "one of the two, not both silently"; the result was both. A guard listing the
// files it knows about would have been written from the same list that was already incomplete.
//
// WHAT THIS CANNOT SEE: the OVERLAY. Skill resolution is layered — a deployment config store overlays
// this git-tracked base tree, file by file (see skills-overlay.test.mjs). An overlay copy of any doc
// below can carry the retired dictation and this test will not know, because that tree lives in the
// config repo and never merges into the product. A green run here means the BASE tree is consistent,
// and nothing more.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";
import { join } from "node:path";

const SKILLS = new URL("../skills/", import.meta.url).pathname;

/**
 * Every markdown file in the skills tree, found rather than listed. ONE read, walked ONCE, and the set
 * is asserted non-empty at the site before anything iterates it — a hand-rolled recursion put
 * the only assertion in the caller, where the census member that watches for zero-iteration loops
 * cannot see it, and it was right to red.
 */
function skillDocs() {
  const entries = nonEmpty(readdirSync(SKILLS, { recursive: true, withFileTypes: true }),
    "the skills tree");
  return entries.filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => join(e.parentPath ?? e.path, e.name));
}
const rel = (p) => p.slice(p.indexOf("/skills/") + 1);

// The retired dictation's actual token. Permissive on purpose: this is a DELETE-direction guard, so it
// must catch the shape rather than one exact spelling — `EUIPO (production)`, "EUIPO(sandbox)", backticked.
const TAG_FORM = /EUIPO[^\S\n]{0,3}[`'"]?\(\s*(?:production|sandbox)\s*\)/i;

test("#1393 CONTROL — the detector fires on the exact line that regressed", () => {
  assert.match("carry that word into the findings (`EUIPO (production)`), so no reader mistakes",
    TAG_FORM, "the detector does not match the wording #1393 was reopened for, so its zero means nothing");
  assert.match("tag the record EUIPO(sandbox) in the findings", TAG_FORM, "spacing defeats the detector");
  assert.doesNotMatch("the tag is `EUIPO` and nothing more", TAG_FORM,
    "the detector fires on the CORRECTED wording, so the tree can never be made to pass");
  assert.doesNotMatch("EUIPO live against production", TAG_FORM,
    "the detector fires on a factual note about which environment a seam was verified against "
    + "(providers/free-tier.md says exactly this) — it would red on prose that instructs nobody");
});

test("#1393 NO doctrine file asks for the environment in the findings — the whole tree, every file", () => {
  const docs = skillDocs();
  assert.ok(docs.length >= 40, `only ${docs.length} skill docs discovered — the walk broke and a clean `
    + "result below would mean nothing");
  const offenders = docs.filter((p) => TAG_FORM.test(readFileSync(p, "utf8")));
  assert.deepEqual(offenders.map(rel), [],
    "a skills doc commands the environment tag in the findings. The driver records the corpus on every "
    + "receipt in _driver/receipts.json; a seat asked to type it as well is #1393's regression returning. "
    + "If this is a doc QUOTING the retired instruction to forbid it, reword the quote — this guard is "
    + "deliberately permissive and cannot tell a command from a citation of one.");
});

test("#1393 every doc that carries the doctrine says the SAME thing — half a fix is what regressed", () => {
  // KEYED ON THE DOCTRINE, NOT ON A CITATION OF IT. This used to find carriers by `body.includes("#1393")`
  // — the issue number was the index. The owner ruled the numbers out of the skill files on 2026-09-03
  // ("we just remove the actual issue number"), and a guard that indexes on one is a guard that goes
  // quiet the moment the rule it protects is tidied. The prohibition itself is the stable key: it is the
  // thing that must not be lost, and a doc that stops saying it is exactly what this arm exists to catch.
  const PROHIBITION = /never (?:tag|typed)/i;
  const carriers = skillDocs()
    .map((p) => [p, readFileSync(p, "utf8")])
    .filter(([, body]) => PROHIBITION.test(body));
  assert.ok(carriers.length >= 3,
    `only ${carriers.length} doc(s) state the prohibition. Three carried this doctrine when it was fixed — `
    + "prelim-register/SKILL.md, prelim-register/digest.md and providers/euipo.md. A drop means a doc "
    + "lost the doctrine rather than that the doctrine got smaller.");
  for (const [p, body] of carriers) {
    assert.ok(/receipts\.json/.test(body),
      `${rel(p)} states the prohibition without naming _driver/receipts.json. It gives the rule and not `
      + "the mechanism, which leaves a seat told not to record the corpus and not told what does.");
    // (the prohibition itself is now the selector above, so asserting it here would be tautological)
    assert.ok(PROHIBITION.test(body),
      `${rel(p)} no longer states the prohibition, so it reads as background rather than as `
      + "an instruction");
  }
});
