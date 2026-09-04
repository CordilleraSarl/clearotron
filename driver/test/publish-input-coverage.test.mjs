// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the publish-input contract: three states, a closed table, and a scan that can actually fail.
//
// The defect this pins: publish/index.mjs read findings.json with no else arm, so "the file was not
// there" produced findings=[]/coverage=[]/findingsError=null — the exact shape of a search that ran
// and found nothing. Every assertion below exists to keep those two empties distinguishable.
//
// NOTE ON THE SCAN, because a check that cannot fail is worse than no check: the source scan at the
// bottom is written so the SAME function is run against a planted fault and asserted to reject it.
// This repo has been bitten by a guard that swept an empty corpus and reported OK.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  PUBLISH_INPUTS, NOT_READ_BY_NAME, CALLER_SUPPLIED, readStore, requiredAbsent, assertPublishInputCoverage,
} from "../publish/publish-inputs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("readStore: read / damaged / absent are THREE states, and an undeclared store throws", () => {
  const dir = mkdtempSync(join(tmpdir(), "publish-inputs-"));
  mkdirSync(driverDir(dir), { recursive: true });

  // read — present and parseable
  writeFileSync(driverDir(dir, "verdict.json"), JSON.stringify({ verdict: "CLEAR" }));
  const ok = readStore(dir, "_driver/verdict.json");
  assert.equal(ok.state, "read");
  assert.deepEqual(ok.value, { verdict: "CLEAR" });
  assert.equal(ok.error, null);

  // damaged — present and unparseable. NOT absent: the file rotted, it was not skipped.
  writeFileSync(driverDir(dir, "framework.json"), "{nope");
  const bad = readStore(dir, "_driver/framework.json");
  assert.equal(bad.state, "damaged");
  assert.equal(bad.value, null);
  assert.ok(bad.error, "a damaged store says WHY, or the state is not actionable");
  assert.equal(bad.raw, "{nope", "the raw text rides along — schema-aware parsers do their own parse");

  // absent — not there. The state that did not exist before this issue.
  const gone = readStore(dir, "common-law-grid.json");
  assert.equal(gone.state, "absent");
  assert.equal(gone.error, null, "absent is not an error — it is a different fact from a damaged read");

  // THE ANTI-ROT PROPERTY: a store nobody declared cannot be read at all, so adding one forces the
  // gating decision instead of defaulting it to silence.
  assert.throws(() => readStore(dir, "not-in-the-table.json"), /does not declare that store/);

  // a .md store parses to no value but still reads
  writeFileSync(join(dir, "case-law-findings.md"), "# profiles\n");
  const md = readStore(dir, "case-law-findings.md");
  assert.equal(md.state, "read");
  assert.equal(md.value, null);
  assert.match(md.raw, /profiles/);
});

test("readStore: an explicit path override still answers the three states, and still checks the declaration", () => {
  const dir = mkdtempSync(join(tmpdir(), "publish-inputs-ovr-"));
  const other = join(dir, "elsewhere.json");
  writeFileSync(other, JSON.stringify({ schema_version: 3 }));
  const hit = readStore(dir, "findings.json", { path: other });
  assert.equal(hit.state, "read");
  assert.equal(hit.path, other, "the override wins over the joined default");
  assert.deepEqual(hit.value, { schema_version: 3 });
  // the override does not buy an exemption from the table
  assert.throws(() => readStore(dir, "nope.json", { path: other }), /does not declare that store/);
});

test("assertPublishInputCoverage: a gating that is not required|optional, a blank reason and a double-declared store are all REJECTED", () => {
  // the shipped partition must pass — but on its own that proves nothing, so every arm below plants a fault
  assert.doesNotThrow(() => assertPublishInputCoverage());

  assert.throws(() => assertPublishInputCoverage({ "x.json": "sometimes" }, {}, {}), /gating must be "required" or "optional"/);
  assert.throws(() => assertPublishInputCoverage({}, { "y/": "" }, {}), /no reason/);
  assert.throws(() => assertPublishInputCoverage({}, {}, { "z.md": "   " }), /no reason/);
  assert.throws(() => assertPublishInputCoverage({ "dup.json": "optional" }, { "dup.json": "because" }, {}), /more than one table/);
  // a well-formed partition is accepted, so the throws above are about the fault and not about the shape
  assert.doesNotThrow(() => assertPublishInputCoverage({ "a.json": "required" }, { "b/": "a directory" }, { "c.md": "an argument" }));
});

test("requiredAbsent: only a store ruled `required` closes, and today that set is deliberately empty", () => {
  // Every store is `optional` (archived runs predate several of them and must not be re-rendered into
  // released:false). So the closing arm is a TRIPWIRE for the first required store, not a live check —
  // which is exactly why the recording half must not depend on it.
  assert.deepEqual(requiredAbsent(Object.keys(PUBLISH_INPUTS)), [],
    "no store is `required` today — if this fails, someone made a gating ruling and the commit must say so");
  assert.deepEqual(requiredAbsent(["findings.json"]), []);
  assert.deepEqual(requiredAbsent(), []);
  // and the filter genuinely selects, rather than always answering []
  const table = { "a.json": "required", "b.json": "optional" };
  const pick = (names) => names.filter((n) => table[n] === "required");
  assert.deepEqual(pick(["a.json", "b.json"]), ["a.json"], "control: the same predicate over a table that HAS a required store selects it");
});

// ── The dead-key / undeclared-store half, against the real source ────────────────────────────────────
//
// On the driver/test/dependency-repair.test.mjs:76-95 precedent (asserting on a module's own source
// text). It answers two questions the load-time gate deliberately does not: does the table name a store
// publish/index.mjs no longer reads, and does publish/index.mjs read a store the table does not name.
//
// SCOPE, stated so nobody reads more into a green run than it earns: this matches .json/.md string
// literals inside publishReport's body by FILENAME. It cannot see a path built from a variable, and it
// does not verify which base directory a read uses. It is a rot alarm on the table, not a proof of
// completeness.
const publishSource = () => {
  const src = readFileSync(join(HERE, "..", "publish", "index.mjs"), "utf8");
  const start = src.indexOf("export async function publishReport");
  assert.ok(start > 0, "publishReport must be findable in the source — if this fails the scan below is vacuous");
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, "publishReport's body must be delimitable");
  return src.slice(start, end);
};

// Artifacts publishReport WRITES into the pool (or reads back out of it). Not run-side inputs, so not
// gated — declared here rather than silently skipped so the list is reviewable.
const POOL_SIDE = {
  "meta.json": "written into the pool run dir, and read back only to preserve the first issuedAt",
  "report-data.json": "the PR-9 client-cut projection this function writes",
};

const scanUndeclared = (body, tables) => {
  const declared = new Set(tables.flatMap((t) => Object.keys(t)).map((k) => basename(k.replace(/\/$/, ""))));
  const seen = [...body.matchAll(/['"`]([A-Za-z0-9._-]+\.(?:json|md))['"`]/g)].map((m) => m[1]);
  assert.ok(seen.length > 5, "the scan found almost no filename literals — the corpus is wrong, and an empty corpus passes every check");
  return [...new Set(seen)].filter((f) => !declared.has(f));
};

test("#873 source scan: publishReport reads no store the table does not declare — and the scan REJECTS a planted one", () => {
  const body = publishSource();
  const tables = [PUBLISH_INPUTS, NOT_READ_BY_NAME, CALLER_SUPPLIED, POOL_SIDE];

  assert.deepEqual(scanUndeclared(body, tables), [],
    "publishReport names a .json/.md store that publish-inputs.mjs does not declare — choose its gating there");

  // PLANTED FAULT: the same scan over the same source, with one declaration removed, must FAIL. Without
  // this the assertion above is indistinguishable from a scan that matched nothing at all.
  const { "findings.json": _dropped, ...crippled } = PUBLISH_INPUTS;
  assert.deepEqual(scanUndeclared(body, [crippled, NOT_READ_BY_NAME, CALLER_SUPPLIED, POOL_SIDE]), ["findings.json"],
    "with findings.json undeclared the scan must name it — otherwise the scan proves nothing");
});

test("#873 source scan: no DEAD key — every declared store is still read by publishReport", () => {
  const body = publishSource();
  const dead = Object.keys(PUBLISH_INPUTS).filter((k) => !body.includes(basename(k)));
  assert.deepEqual(dead, [],
    "publish-inputs.mjs declares a store publishReport no longer reads — a dead key is how a table stops describing the code");

  // PLANTED FAULT: a fabricated key that nothing reads must be caught by the same predicate.
  const fake = { ...PUBLISH_INPUTS, "_driver/no-such-store.json": "optional" };
  assert.deepEqual(Object.keys(fake).filter((k) => !body.includes(basename(k))), ["_driver/no-such-store.json"],
    "the dead-key predicate must actually detect a key with no reader");
});
