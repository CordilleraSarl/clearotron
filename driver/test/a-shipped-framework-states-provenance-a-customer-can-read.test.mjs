// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A bundled framework's provenance note, read by a stranger.
//
// The field says where a risk framework came from, and it ships: it is in the package and frozen into
// the demo run artefacts. It read
//
//   "Generic house default — IP Risk Assessment Framework.pptx (Privileged & Confidential), completed
//    by the reviewing lawyer 2026-08-31; supersedes the 2026-07-05 transcription (doc 50), which was
//    partial"
//
// A customer has no way to tell that marks a source we CONSULTED rather than content we SHIPPED, and
// nothing else in the sentence helps: a filename for a document they cannot see, an internal document
// number, and revision history telling them a previous version of our framework was incomplete.
//
// NOTHING WAS LEAKED AND THIS IS NOT THAT ISSUE. Shipping the provenance was ruled acceptable; what was
// wrong was the wording. The field still says whose framework it is, who stands behind it and how
// current it is — which is everything it is for.
//
// THE MANIFEST AND THE FROZEN ARTEFACTS ARE ASSERTED TOGETHER, because they are two places and a fix
// that reaches one of them leaves a demo run contradicting the manifest it was produced from.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The classes a customer must not meet, each with the reason it reads badly rather than a bare pattern.
const NOT_FOR_A_STRANGER = [
  ["a confidentiality marking", /privileged\s*&\s*confidential|attorney work product/i],
  ["a document filename", /\.(?:pptx|docx|pdf|xlsx|key)\b/i],
  ["an internal document number", /\bdoc\s*\d+/i],
];

/** The frameworks that ship to a customer: the house default, the demo account's, and the triage scale. */
const SHIPPED_MANIFESTS = ["risk-framework.manifest.json", "risk-framework-demo.manifest.json",
  "risk-framework-triage.manifest.json"];

const manifestDir = join(ROOT, "driver/skills/prelim-search");
const readDeck = (p) => String(JSON.parse(readFileSync(p, "utf8")).source_deck ?? "");

test("343: a shipped framework's provenance carries nothing a stranger would misread", () => {
  for (const f of SHIPPED_MANIFESTS) {
    const p = join(manifestDir, f);
    assert.ok(existsSync(p), `${f} is missing — this sweep would pass by looking at nothing`);
    const deck = readDeck(p);
    assert.ok(deck.length > 0, `${f} carries no provenance at all; the fix is to reword it, never to delete it`);
    for (const [why, re] of NOT_FOR_A_STRANGER) {
      assert.ok(!re.test(deck), `${f} still carries ${why}: "${deck}"`);
    }
  }
});

test("343: the frozen demo artefacts say the same as the manifest they came from", () => {
  // Joined on framework_key, so this cannot be satisfied by two files that merely both look tidy.
  const byKey = new Map();
  // THE SET THIS WALK DISCOVERS IS ASSERTED BEFORE IT IS WALKED. Named rather than numbered, because a
  // citation in code is refused here and rightly: the guard is
  // `a-discovered-set-can-be-empty-and-still-pass.test.mjs`, and it is what caught this.
  //
  // `readdirSync(...).filter(...)` deciding to return nothing is indistinguishable, from inside the loop,
  // from a tree where every manifest agrees. The join below would then compare each frozen artefact
  // against an empty map — and while that particular comparison happens to fail, that is luck rather
  // than design: it holds only because the frozen walk finds something. Both walks empty is a green
  // test that looked at nothing, which is the shape this file exists to refuse in the product.
  //
  // Asserted against the NAMED list rather than against a bare count, so a manifest renamed or dropped
  // out of the directory is a failure here rather than a quietly smaller set: a floor only catches zero,
  // and four-where-five-are-expected is the shape with nothing under it.
  //
  // WHAT THIS DOES NOT COVER, said plainly so nobody reads it as more than it is. Both sides compared
  // here are TREE-side — `manifestDir` is the source directory, and the named list sits beside it in
  // this file. What actually reaches a customer is decided by `package.json`'s `files` array, which this
  // check never opens. A manifest can sit in that directory, satisfy every assertion below, and ship to
  // nobody.
  //
  // That is live rather than tidy-minded: the packaging rules exclude `risk-framework-*` and then
  // re-include the demo and triage manifests BY NAME. The house default is not re-included by name. It
  // ships only because the exclusion pattern carries a hyphen and its filename carries a dot, so the
  // pattern structurally cannot reach it. Narrow that pattern to `risk-framework*` and the house default
  // stops shipping while this file stays green, because the source file it walks has not moved.
  const discovered = readdirSync(manifestDir).filter((x) => x.endsWith(".manifest.json"));
  assert.ok(discovered.length > 0,
    `no framework manifest was found in ${manifestDir} — the walker broke, or the packaging rules moved them. `
    + `Either way every assertion below would pass by looking at nothing`);
  for (const named of SHIPPED_MANIFESTS) {
    assert.ok(discovered.includes(named),
      `${named} is named as shipped but this directory walk does not find it — the two ways of naming these files have drifted apart`);
  }
  for (const f of discovered) {
    const m = JSON.parse(readFileSync(join(manifestDir, f), "utf8"));
    if (m.framework_key) byKey.set(m.framework_key, String(m.source_deck ?? ""));
  }
  const demoDir = join(ROOT, "demo");
  const frozen = readdirSync(demoDir)
    .map((d) => join(demoDir, d, "run/_driver/framework.json"))
    .filter((p) => existsSync(p));
  assert.ok(frozen.length > 0, "no frozen demo artefact was found — the walker broke, not the tree");
  for (const p of frozen) {
    const d = JSON.parse(readFileSync(p, "utf8"));
    const fromManifest = byKey.get(d.framework_key);
    assert.ok(fromManifest !== undefined,
      `${p} names framework_key "${d.framework_key}", which no bundled manifest carries`);
    assert.equal(String(d.source_deck ?? ""), fromManifest,
      `the frozen artefact for "${d.framework_key}" disagrees with its manifest — reword both or neither`);
  }
});
