// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Machine receipts (post-mortem §1b): grid-ledger parsing + the exact join, and the validator's
// machine/legacy path dispatch. Pure + temp-dir tests, offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { parseGridLedger, parseManifestVariants, findGridLedgerViolations, findPlatformIdentityViolations, MIN_CELLS_PER_VARIANT } from "../common-law-receipts.mjs";
import { validators } from "../verify.mjs";

const PLATFORMS = ["store.steampowered.com", "store.epicgames.com", "play.google.com", "apps.apple.com", "gog.com", "itch.io", "web"];
const cells = (term, n = 7) => PLATFORMS.slice(0, n).map((platform) => ({ term, platform, status: "no_hit", results: [] }));
const batch = (c, gaps = []) => ({ cells: c, extras: {}, gaps });

const MANIFEST = `# Variant manifest

## Variants
| Variant | Category |
|---|---|
| novapulse | exact-phrase |
| 转码 | translit-zh |
`;

test("parseGridLedger: single stdout object → distinct platforms per normalized term", () => {
  const p = parseGridLedger(JSON.stringify(batch([...cells("novapulse"), ...cells("转码", 3)])));
  assert.equal(p.get("novapulse").size, 7);
  assert.equal(p.get("转码").size, 3);
});

test("parseGridLedger: ARRAY of per-batch objects merges; duplicate platforms don't double-count", () => {
  const p = parseGridLedger(JSON.stringify([batch(cells("novapulse", 4)), batch(cells("novapulse"))]));
  assert.equal(p.get("novapulse").size, 7);
});

test("parseGridLedger: gap strings ('term | platform | error') count as accounted entries", () => {
  const gaps = PLATFORMS.map((pl) => `转码 | ${pl} | TimeoutError('cell')`);
  const p = parseGridLedger(JSON.stringify(batch(cells("novapulse"), gaps)));
  assert.equal(p.get("转码").size, 7);
});

test("parseGridLedger: malformed input throws (missing cells[], bad cell shape, non-JSON)", () => {
  assert.throws(() => parseGridLedger("not json"));
  assert.throws(() => parseGridLedger(JSON.stringify({ extras: {} })));
  assert.throws(() => parseGridLedger(JSON.stringify({ cells: [{ term: "x" }] })));
});

test("findGridLedgerViolations: complete ledger ⇒ clean; dropped batch ⇒ named short", () => {
  const clean = JSON.stringify(batch([...cells("novapulse"), ...cells("转码")]));
  assert.deepEqual(findGridLedgerViolations(MANIFEST, clean), []);
  const short = JSON.stringify(batch(cells("novapulse")));   // 转码 vanished — the Ember Guard shape
  assert.deepEqual(findGridLedgerViolations(MANIFEST, short),
    [{ variant: "转码", cells: 0, expected: MIN_CELLS_PER_VARIANT }]);
});

// A PACKED KEY, IN A TABLE THE PARSER READS. These arms once built a one-column table, which the parser
// reads as no variants at all, so the check had nothing to judge and passed whatever the alternate split
// did. This is the live manifest's own table shape, and the first assertion says the key was read.
const PACKED = `# Variant manifest

## Variants
| Category | Value | Rationale | Verify? |
|---|---|---|---|
| translit-zh | 缎与钢 / 萨汀 | two renderings of one mark in one row | no |
`;

test("findGridLedgerViolations: a ' / '-packed manifest key is met by a full grid for each alternate, and short when one has none", () => {
  assert.deepEqual(parseManifestVariants(PACKED), ["缎与钢 / 萨汀"], "premise: the parser reads the packed key");
  const both = JSON.stringify(batch([...cells("缎与钢"), ...cells("萨汀")]));
  assert.deepEqual(findGridLedgerViolations(PACKED, both), []);
  const one = JSON.stringify(batch(cells("缎与钢")));
  assert.deepEqual(findGridLedgerViolations(PACKED, one),
    [{ variant: "缎与钢 / 萨汀", cells: 0, expected: MIN_CELLS_PER_VARIANT }]);
});

test("findPlatformIdentityViolations: a packed key's platforms are the union of its alternates' rows", () => {
  const want = PLATFORMS.slice(0, 4);
  const rows = (term, platforms) => platforms.map((platform) => ({ term, platform, status: "no_hit", results: [] }));
  // The four wanted platforms split between the two alternates: together they hold all four.
  const split = JSON.stringify(batch([...rows("缎与钢", want.slice(0, 2)), ...rows("萨汀", want.slice(2))]));
  assert.deepEqual(findPlatformIdentityViolations(PACKED, split, want), []);
  // Together they still miss one, which is named against the packed key. Neither alternate alone reaches
  // the four platforms the check counts to, so only the union can see the gap.
  const gap = JSON.stringify(batch([...rows("缎与钢", [want[0], want[1], "web"]), ...rows("萨汀", [want[2], "itch.io"])]));
  assert.deepEqual(findPlatformIdentityViolations(PACKED, gap, want), [{ variant: "缎与钢 / 萨汀", missing: [want[3]] }]);
});

test("validators.commonLaw: machine path joins the sibling ledger (ok / short / unparseable)", () => {
  const dir = mkdtempSync(join(tmpdir(), "machine-receipts-"));
  try {
    writeFileSync(join(dir, "variant-manifest.md"), MANIFEST);
    const findings = `# Common-law findings

## Findings
| Finding | Platform | URL |
|---|---|---|

### Negative results (per-platform per-variant)
| Variant | Platform | Result |
|---|---|---|
${["novapulse", "转码"].flatMap((v) => PLATFORMS.map((pl) => `| ${v} | ${pl} | No results |`)).join("\n")}

### Coverage ledger
| unit | status | reason |
|---|---|---|
| marketplace / all | confirmed-clean | full grid |

### Audit trail
| step | detail |
|---|---|
| grid | one call |
`;
    const p = join(dir, "common-law-findings.md");
    writeFileSync(p, findings);

    // machine path, complete ledger → ok (and flagged as the machine path)
    writeFileSync(join(dir, "common-law-grid.json"), JSON.stringify(batch([...cells("novapulse"), ...cells("转码")])));
    assert.deepEqual(validators.commonLaw(p, findings), { ok: true, reason: "machine-receipts" });

    // machine path, short ledger → grid_join_missing EVEN THOUGH the prose matrix above is complete
    // (the ledger is what the gate counts now — a pretty markdown table can't vouch for itself)
    writeFileSync(join(dir, "common-law-grid.json"), JSON.stringify(batch(cells("novapulse"))));
    assert.match(validators.commonLaw(p, findings).reason, /^grid_join_missing:转码:0\/7/);

    // machine path, unparseable ledger → fail-safe
    writeFileSync(join(dir, "common-law-grid.json"), "truncated {");
    assert.match(validators.commonLaw(p, findings).reason, /^grid_ledger_unparseable/);

    // legacy path (no ledger file) → prose matrix counting still governs (archived runs)
    rmSync(join(dir, "common-law-grid.json"));
    assert.equal(validators.commonLaw(p, findings).ok, true);
    const shortFindings = findings.replace(/\| 转码 \|[^\n]+\n/g, "");
    writeFileSync(p, shortFindings);
    assert.match(validators.commonLaw(p, shortFindings).reason, /^receipts_short:转码/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validators.commonLaw: the dictated grid-spec is the join source — floor = spec.platforms.length, terms from spec (not prose)", () => {
  const dir = mkdtempSync(join(tmpdir(), "grid-spec-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    // A 3-platform dictated grid (NOT the historical hardcoded 7) for terms the prose manifest never names.
    const SP = ["store.steampowered.com", "play.google.com", "web"];
    const spec = { terms: ["AURORA", "AUR0RA", "ORORA"], platforms: SP, output_path: "/x/studio/clearance-search/r/common-law-grid.json" };
    writeFileSync(driverDir(dir, "grid-spec.json"), JSON.stringify(spec));
    writeFileSync(join(dir, "variant-manifest.md"), MANIFEST); // disagrees with the spec on purpose
    const findings = `# Common-law findings

## Findings
| Finding | Platform | URL |
|---|---|---|

### Negative results (per-platform per-variant)
| Variant | Platform | Result |
|---|---|---|
${spec.terms.flatMap((v) => SP.map((pl) => `| ${v} | ${pl} | No results |`)).join("\n")}

### Coverage ledger
| unit | status | reason |
|---|---|---|
| marketplace / all | confirmed-clean | full dictated grid |

### Audit trail
| step | detail |
|---|---|
| grid | one deterministic call |
`;
    const p = join(dir, "common-law-findings.md");
    writeFileSync(p, findings);
    const specCells = (term) => SP.map((platform) => ({ term, platform, status: "no_hit", results: [] }));

    // complete for the DICTATED 3×3 grid → ok. Floor is 3 (the dictated platform count) — under the old
    // hardcoded 7 this would have falsely failed; the spec keeps gate and run in lockstep.
    writeFileSync(join(dir, "common-law-grid.json"), JSON.stringify(batch(spec.terms.flatMap(specCells))));
    assert.deepEqual(validators.commonLaw(p, findings), { ok: true, reason: "machine-receipts" });

    // a dictated term missing from the ledger → grid_join_missing names it against the /3 floor
    writeFileSync(join(dir, "common-law-grid.json"), JSON.stringify(batch(["AURORA", "AUR0RA"].flatMap(specCells))));
    assert.match(validators.commonLaw(p, findings).reason, /^grid_join_missing:ORORA:0\/3/);

    // right count, WRONG platform (itch.io instead of the dictated web) → platforms_missing (identity join on spec.platforms)
    const wrongPlat = spec.terms.flatMap((t) => (t === "ORORA" ? ["store.steampowered.com", "play.google.com", "itch.io"] : SP)
      .map((platform) => ({ term: t, platform, status: "no_hit", results: [] })));
    writeFileSync(join(dir, "common-law-grid.json"), JSON.stringify(batch(wrongPlat)));
    assert.match(validators.commonLaw(p, findings).reason, /^platforms_missing:ORORA:web/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
