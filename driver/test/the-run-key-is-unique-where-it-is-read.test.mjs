// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — TWO RUNS THAT DRAW ONE CODENAME SHARE A FETCHED SET.
//
// `prelim-<slug>-<codename>-` is the only thing separating one run's rows from another's in the shared
// call ledger, and the screen gate reads that ledger to decide which records a run fetched. Two runs
// with the same key therefore judge goods-drops against each other's fetches — which is `all-fetched`
// on a run whose fetcher failed every call, this issue's signature.
//
// Measured on one `npm run test:full`: 252 mints across 57 processes, slug `tmp2201-novapulse` drawn 94
// times, **10 collisions**. Birthday against a 400-name space predicts ~11, so the rate is the expected
// one and a green sweep of one file says nothing about it.
//
// THE OLD GUARD IS NOT WRONG, IT IS SCOPED SMALLER THAN THE LEDGER. `existsSync` asks about THIS run's
// studio and archive roots; the ledger is shared one scope wider. The claim registry closes exactly that
// gap and lives beside the ledger, so its scope is the ledger's by construction.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mintFreshCodename, claimRunCodename, genCodename } from "../phase0.mjs";

const SLUG = "tmp-collide", DATE = "2026-08-22";
// COMPUTED, NEVER TYPED. `no-client-identifiers` refuses a literal from the generator's own vocabulary
// anywhere in the tree — a committed codename could be a real matter's run identity — and it caught the
// first draft of this file doing exactly that. Deriving it from `genCodename` keeps the fixture honest
// about which name it means without writing one down.
const FIRST = genCodename(() => 0);
const roots = () => {
  const base = mkdtempSync(join(tmpdir(), "run-key-"));
  return { base, studioRoot: join(base, "studio"), archiveRoot: join(base, "archive") };
};

test("#1367 THE PREMISE — two runs in DIFFERENT roots draw the same codename, and the old guard cannot see it", () => {
  // A fixed `rand` is the honest way to state this: the existsSync pair is asked about two roots that
  // have never heard of each other, so it answers clean for both. That is the whole defect, and it is a
  // property of the SCOPE rather than of the draw.
  const a = roots(), b = roots();
  const registry = join(a.base, "reg.jsonl");
  try {
    const fixed = () => 0;   // always the first adjective and the first noun
    const never = () => true;
    const ca = mintFreshCodename({ slug: SLUG, date: DATE, ...a, rand: fixed, claim: never });
    const cb = mintFreshCodename({ slug: SLUG, date: DATE, ...b, rand: fixed, claim: never });
    assert.equal(ca, cb, "the premise failed: two blind roots did not collide, so nothing below is about anything");
    assert.equal(ca, genCodename(fixed));
    assert.ok(!existsSync(registry), "premise: no registry was consulted on that path");
  } finally { rmSync(a.base, { recursive: true, force: true }); rmSync(b.base, { recursive: true, force: true }); }
});

test("#1367 the claim registry makes the SECOND run take a different name", () => {
  const a = roots(), b = roots();
  const registryPath = join(a.base, "run-codenames.jsonl");
  try {
    // Both runs draw the same first candidate; the claim is the only thing that can part them. `rand`
    // walks the space so the loser has somewhere to go.
    let n = 0;
    const walk = () => (n++ % 40) / 40;
    const claim = (o) => claimRunCodename({ ...o, registryPath });
    const ca = mintFreshCodename({ slug: SLUG, date: DATE, ...a, rand: walk, claim });
    n = 0;
    const cb = mintFreshCodename({ slug: SLUG, date: DATE, ...b, rand: walk, claim });
    assert.notEqual(cb, ca,
      `both runs minted ${ca} — the registry did not part them, so the shared ledger still merges their `
      + "fetched sets and the gate can read a record as fetched that this run never fetched");
    const claims = readFileSync(registryPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual([...new Set(claims.map((c) => c.codename))].sort(), [ca, cb].sort(),
      "the registry holds one line per name taken, and nothing else");
  } finally { rmSync(a.base, { recursive: true, force: true }); rmSync(b.base, { recursive: true, force: true }); }
});

test("#1367 FIRST WRITER WINS, and the loser is told — the same name claimed twice", () => {
  const { base } = roots();
  const registryPath = join(base, "r.jsonl");
  try {
    const args = { slug: SLUG, date: DATE, codename: FIRST, registryPath };
    assert.equal(claimRunCodename({ ...args, id: "first" }), true, "the first claimant must own the name");
    assert.equal(claimRunCodename({ ...args, id: "second" }), false,
      "the second claimant was told it owns a name somebody else already has — which is the collision, "
      + "now with a registry that failed to arbitrate it");
    // A DIFFERENT date is a different key: the old guard scopes on slug+date and this must not be stricter.
    assert.equal(claimRunCodename({ ...args, date: "2026-08-23", id: "third" }), true,
      "a claim from another day was refused — that narrows the space for no reason the ledger asks for");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("#1367 a registry that cannot be read or written degrades to the OLD behaviour, never to a refusal", () => {
  // The failure mode is what shipped before this, because a run refused over its own telemetry directory
  // is a worse outcome than the collision this narrows.
  const { base } = roots();
  try {
    const dir = join(base, "sub");
    writeFileSync(dir, "not a directory\n");                       // mkdirSync under it will throw
    assert.equal(claimRunCodename({ slug: SLUG, date: DATE, codename: FIRST, registryPath: join(dir, "r.jsonl") }), true,
      "an unwritable registry refused a claim — that fails a run over telemetry");
    // A torn line from a concurrent append is skipped, and the intact claim below it still arbitrates.
    const torn = join(base, "torn.jsonl");
    writeFileSync(torn, '{"slug":"x","date":"y","codename"\n');
    assert.equal(claimRunCodename({ slug: SLUG, date: DATE, codename: FIRST, registryPath: torn, id: "mine" }), true);
    assert.equal(claimRunCodename({ slug: SLUG, date: DATE, codename: FIRST, registryPath: torn, id: "later" }), false,
      "the torn line above swallowed the arbitration — a JSON parse failure must skip the line, not the check");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("#1367 the mint still refuses a name whose RUN DIR exists — the older guard is not replaced", () => {
  // The claim narrows; it does not take over. A same-root re-mint that hits an existing run dir is the
  // idempotency-skip hazard the header describes, and it is a different scope from the ledger's.
  const { base, studioRoot, archiveRoot } = roots();
  const registryPath = join(base, "r.jsonl");
  try {
    let n = 0;
    const walk = () => (n++ % 40) / 40;
    const claim = (o) => claimRunCodename({ ...o, registryPath });
    const first = mintFreshCodename({ slug: SLUG, date: DATE, studioRoot, archiveRoot, rand: walk, claim });
    // Same roots, and a registry the second mint cannot consult — only the run dir can part them now.
    mkdirSync(join(studioRoot, SLUG, `${DATE}-${first}`), { recursive: true });
    n = 0;
    const second = mintFreshCodename({ slug: SLUG, date: DATE, studioRoot, archiveRoot, rand: walk, claim: () => true });
    assert.notEqual(second, first, "a run dir that already exists was re-minted into — the idempotency skip would serve a stranger's stages");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
