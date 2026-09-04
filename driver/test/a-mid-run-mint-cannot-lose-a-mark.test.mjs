// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A mid-run mint decides whether a mark is searched at all, so its identity function is not cosmetic.
//
// Both late lanes derived a qid from `kebab()` — the DISPLAY slug. It NFKD-decomposes and replaces every
// combining mark with a hyphen, so four distinct katakana marks minted ONE identity. Downstream,
// `foldSupplementalEntries` dedupes on qid and `continue`d the siblings: not refused, not recorded,
// nothing on the receipt. Marks nobody searched, and nothing saying so — and the delivered report went
// on to tell a client a script had not been searched.
//
// THE CLASS, NOT THE MARK. The trigger is "the identity is derived from a display form", which is every
// non-Latin script and both lanes. Nothing here keys on kana, on the fullwidth hyphen, or on a provider.
//
// AND THERE ARE TWO CLASSES, NOT ONE. `termIdentity` falls back to the fingerprint only when the Latin
// fold is EMPTY, so a Latin term returns its long fold and the 40-character truncation can still
// collide — two ordinary corporate names sharing a long prefix do it today. Swapping the function alone
// would have closed the non-Latin half and left a live silent drop on Latin owner rows.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { mintSupplementalQid, termIdentity, foldSupplementalEntries } from "../register-plan.mjs";
import { kebab } from "../phase0.mjs";

// The reproduction this criterion names: four DISTINCT marks that differ only by combining marks.
const KATAKANA = ["プロパー", "プロパ－", "プロバー", "フロパー"];

// Two ordinary companies whose names share a 40-character prefix. Not contrived: corporate names do this.
const LATIN_PAIR = [
  "Shanghai International Trading and Manufacturing Company Limited",
  "Shanghai International Trading and Manufacturing Holdings GmbH",
];

const mintAll = (prefix, terms) => {
  const used = new Set();
  return terms.map((term) => mintSupplementalQid({ prefix, term, used }));
};

test("the display slug is what collapsed them — the defect, still reproducible on its own terms", () => {
  // Not a test of the product: a statement of WHY the identity function had to change, so a later
  // reader can see the mechanism without reconstructing it. If this ever stops holding, kebab changed
  // and this file's premise needs re-reading rather than its arms deleting.
  const slugs = KATAKANA.map((m) => kebab(m).slice(0, 40));
  assert.ok(new Set(slugs).size < KATAKANA.length,
    "kebab no longer collapses these four — re-read this file's premise before trusting its other arms");
});

test("four distinct non-Latin marks mint four distinct identities, on BOTH row types", () => {
  for (const prefix of ["xcheck-mark", "xcheck-owner", "recall", "recall-owner"]) {
    const qids = mintAll(prefix, KATAKANA);
    assert.equal(new Set(qids).size, KATAKANA.length,
      `${prefix}: ${KATAKANA.length} distinct marks minted ${new Set(qids).size} identities — ${qids.join(" | ")}`);
  }
});

test("the owner row is fixed with the mark row, because a qid is an identity and not a term rule", () => {
  // The exemption at the cross-check site withholds the ROMANISATION from owner rows — what goes out in
  // the query. Whether a row survives at all is a different question, and a colliding owner qid drops a
  // distinct owner into a substrate that is then read as if it were whole.
  assert.equal(new Set(mintAll("xcheck-owner", KATAKANA)).size, KATAKANA.length);
});

test("two Latin names sharing a 40-character prefix stay distinct — the truncation class", () => {
  const bases = LATIN_PAIR.map((n) => `xcheck-owner-${termIdentity(n).slice(0, 40)}`);
  assert.equal(new Set(bases).size, 1,
    "the pair no longer truncates to one base — pick a pair that does, or this arm proves nothing");

  const qids = mintAll("xcheck-owner", LATIN_PAIR);
  assert.equal(new Set(qids).size, 2, `the truncation collision survived: ${qids.join(" | ")}`);
  assert.match(qids[1], /#2$/, "the second gets the compiler's own #N suffix");
});

test("a Latin term that collides with nothing is BYTE-UNCHANGED, so no existing entry moves", () => {
  const used = new Set();
  assert.equal(mintSupplementalQid({ prefix: "xcheck-mark", term: "NOVAPULSE", used }),
    "xcheck-mark-novapulse");
});

test("minting is idempotent per batch, not per call — the caller mints in a loop", () => {
  const used = new Set();
  const a = mintSupplementalQid({ prefix: "recall", term: "ACME", used });
  const b = mintSupplementalQid({ prefix: "recall", term: "ACME", used });
  assert.notEqual(a, b, "a second call with the same term must not silently hand back the same qid");
});

// ── neither lane may go back to composing an identity from a display slug ─────────────────────────

test("no mid-run lane composes a qid from kebab — asserted against the source, both lanes", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const offenders = src.split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /(?:qid|recall|xcheck)[^\n]*kebab\(/.test(line) && !line.trim().startsWith("//"));
  assert.deepEqual(offenders, [],
    `a qid is being composed from the display slug again at: ${offenders.map(([n]) => n).join(", ")}`);

  // AND THE POSITIVE: both lanes actually reach the shared helper. An absence of kebab would also be
  // true of a lane that had been deleted.
  assert.equal((src.match(/mintSupplementalQid\(/g) ?? []).length, 2,
    "expected exactly two mid-run mint sites routed through the shared helper");
});

// ── and if a collision is ever constructed anyway, it is named rather than dropped ────────────────

test("a batch collision reaches refused[] with a reason instead of vanishing", () => {
  const plan = { entries: [], jurisdictions: [] };
  const twins = [
    { qid: "xcheck-mark-same", axis: "primary-sweep", predicate: "default", term: "ALPHA",
      nice_classes: ["9"], regions: [], expected_kind: "enumerate" },
    { qid: "xcheck-mark-same", axis: "primary-sweep", predicate: "default", term: "BETA",
      nice_classes: ["9"], regions: [], expected_kind: "enumerate" },
  ];
  const folded = foldSupplementalEntries(plan, twins);

  assert.equal(folded.refused.length, 1, "the second entry vanished instead of being refused");
  assert.equal(folded.refused[0].term, "BETA", "the refusal must name the term that lost, not the survivor");
  const issue = JSON.stringify(folded.refused[0]);
  assert.match(issue, /already minted this identity/, "the refusal carries no reason a reader could act on");
  assert.match(issue, /ALPHA/, "the refusal must name the term that CLAIMED the identity, or the reader "
    + "cannot tell a collision from a duplicate");
});

test("the same row offered twice is ONE refusal — the discriminator is the term, not the qid", () => {
  // Keyed on the qid alone, the collision refusal fired on a harmless repeat too and broke the contract
  // that a resume must not re-fold on every attempt. The suite's own arm is what said so; this one
  // states the rule from the other side so the distinction cannot be lost again.
  const plan = { plan_version: 3, entries: [] };
  const row = { qid: "xcheck-mark-same", axis: "primary-sweep", predicate: "default", term: "ALPHA",
    nice_classes: ["9"], regions: [], expected_kind: "enumerate" };
  const folded = foldSupplementalEntries(plan, [row, { ...row }]);
  assert.equal(folded.refused.length, 0, "an identical row twice is one question asked twice, not a collision");
  assert.deepEqual(folded.added, ["xcheck-mark-same"], "and the row itself is still added exactly once");
});

test("a re-proposal of a row the PLAN already holds stays quiet — it is not the defect", () => {
  // Deliberate: refused rows render to the client as OPEN asks, and a supplemental re-proposing a
  // compiler slice is an ordinary event. Turning it into client-visible noise is not this fix's job.
  const plan = { entries: [{ qid: "already-here", axis: "primary-sweep", predicate: "default", term: "ALPHA" }],
    jurisdictions: [] };
  const folded = foldSupplementalEntries(plan, [
    { qid: "already-here", axis: "primary-sweep", predicate: "default", term: "ALPHA",
      nice_classes: ["9"], regions: [], expected_kind: "enumerate" },
  ]);
  assert.equal(folded.refused.length, 0, "a plan re-proposal became a client-visible refusal");
  assert.equal(folded.added.length, 0);
});
