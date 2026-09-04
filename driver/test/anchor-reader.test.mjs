// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// anchor-reader — R.1 reasoning-integrity primitive #2. Tolerant extraction of a run's field-anchoring
// vocabulary from the three source files; empty/garbled input → empty fields, never throws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readAnchors } from "../anchor-reader.mjs";

const REGISTER = `# Register findings

## Risk-relevant marks
| URI | Mark | Owner | Country | Classes | Status | Filed | Expiry |
|---|---|---|---|---|---|---|---|
| /m/1 | LUMENGARDE | Plesner Advokatpartnerselskab | DK | 09, 41 | Registered | 2021 | 2031 |
| /m/2 | EVERLITE | Acme Lighting Co | US | 11 | Registered | 2019 | 2029 |

### Coverage ledger
| Coverage unit | Status | Reason |
|---|---|---|
| primary-sweep / worldwide | confirmed-clean | full sweep |
`;

const MANIFEST = `# Variant manifest — LUMENGARDE

## Request

- **Marks:** LUMENGARDE
- **Classes:** 9, 11, 41
- **Jurisdiction:** EU / worldwide
- **Industry:** lighting / consumer electronics
- **Product description:** LED lighting fixtures and luminaires

## Mark: LUMENGARDE

### Elements

| Element | Role | Saturation | Famous-mark | Notes |
|---|---|---|---|---|
| EVER | common-word | high | no | morphological |
| LIGHT | common-word | high | no | descriptive of class 11 |
| YOUR | function-word | n/a | no | not searchable |

### Variants

| Category | Value | Rationale | Verify? |
|---|---|---|---|
| exact-phrase | LUMENGARDE | full mark | |
| exact-element | LIGHT | distinctive | |
`;

const MATTER = `# Matter context

- **Sector:** lighting
- **Materially-matters jurisdictions:** EU, US
`;

test("readAnchors: owners, classes, sector, jurisdictions, elements, marks from the three files", () => {
  const a = readAnchors({ registerFindingsMd: REGISTER, matterContextMd: MATTER, variantManifestMd: MANIFEST });
  assert.ok(a.owners.includes("plesner advokatpartnerselskab"));
  assert.ok(a.owners.includes("acme lighting co"));
  // classes normalised so 09 / 9 both anchor
  assert.ok(a.classes.includes("9") && a.classes.includes("09"));
  assert.ok(a.classes.includes("41") && a.classes.includes("11"));
  // jurisdiction bullet (manifest) wins; sector from the manifest industry line
  assert.ok(a.jurisdictions.includes("eu") && a.jurisdictions.includes("worldwide"));
  assert.match(a.sector, /lighting/);
  // dominant elements: the distinctive (non function-word) elements + exact-phrase/element + the mark
  assert.ok(a.dominantElements.includes("lumengarde"));
  assert.ok(a.dominantElements.includes("light"));
  assert.ok(!a.dominantElements.includes("your"), "function-word elements are dropped");
  assert.ok(a.marks.includes("lumengarde"));
  // G&S derived from product description + sector + classes (no G&S column exists)
  assert.ok(a.goodsServices.some((g) => /lighting/.test(g)));
});

test("readAnchors: garbled / empty input → empty fields, never throws", () => {
  let a;
  assert.doesNotThrow(() => { a = readAnchors({ registerFindingsMd: "## no table here\njust prose", variantManifestMd: "", matterContextMd: "" }); });
  assert.deepEqual(a.owners, []);
  assert.deepEqual(a.classes, []);
  assert.deepEqual(a.dominantElements, []);
  assert.equal(a.sector, "");
  // no-args call is also safe
  assert.doesNotThrow(() => readAnchors());
  assert.deepEqual(readAnchors().jurisdictions, []);
});
