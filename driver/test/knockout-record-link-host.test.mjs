// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// knockout-record-link-host.test.mjs —. The knockout lane's register links belong to the register
// the run actually searched.
//
// established this for the clearance lane and was scoped to it. `render-knockout.mjs` had NO
// record-origin logic whatsoever: `linkOrText` rendered whatever `record.url` held, on every provider.
// Same defect, same silence — the link resolves to a real page, so nothing errors and no test goes red —
// and knockout is the product most likely to be run against a register the reader has never heard of,
// because it is the cheap screen people try first.
//
// This file is report-record-link-host.test.mjs's shape, and deliberately so: the four properties that
// make that one work are the four that make this one work.
//
//  1. IT ENUMERATES THE PROVIDER TABLE. The failure designed for is a seventh provider added later with
//     no test written for it, so the cases come from `Object.keys(PROVIDERS)` and the roster test at the
//     foot fails if the loop ever covers fewer providers than the table holds.
//
//  2. IT ASSERTS NO HOST. Every expectation derives from `recordOriginsFor(id)`. A second copy of
//     provider knowledge inside a test is this issue's own defect class one layer up.
//
//  3. THE RECORD/EVIDENCE SPLIT COMES FROM THE DATA. A register record's address is `record.url` inside
//     `register-records.json`; a knockout finding's `evidence[]` is a storefront or a marketplace BY
//     DEFINITION. The split is structural — nothing here pattern-matches a URL to decide which it is,
//     which is the move that produced this defect class. Evidence is asserted to SURVIVE UNTOUCHED on
//     every provider, and that half is what stops the fix over-reaching.
//
//     The RECORD…/EVIDENCE… tokens are the fixture's own tracer dye, so a rendered anchor can be
//     attributed to the field that produced it. Production data carries none and none is looked for
//     outside this file.
//
//  4. IT RENDERS THROUGH THE REAL PUBLISHER. `publishKnockout` is where the repair lives, so a test that
//     called `renderKnockoutHtml` directly would stay green the day somebody deletes the call.
import { test } from "node:test";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

// Pin the deployment config BEFORE the publish import — driver.config reads env at module load and its
// pool-root DEFAULT IS THE REAL ARCHIVE. A synthetic run must never be able to land in a production pool.
const ROOT = mkdtempSync(join(tmpdir(), "ko-record-link-host-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
// THE RUN'S REGISTER IS READ FROM ITS OWN SIDECAR, NEVER FROM TODAY'S DEPLOYMENT — a republished archive
// keeps the register it searched. Set to a provider that is WRONG for every case below except one, and
// the fixture's off-register URLs are built on the host it declares: if the publish path ever consults
// the environment instead of register-records.json's `provider`, those links become "legitimate" and the
// assertions for the other providers go red.
const ENV_PROVIDER = "corsearch";
pinEnv(process.env, "CLEAROTRON_DATABASE", ENV_PROVIDER);

const { publishKnockout } = await import("../publish/knockout.mjs");
const { PROVIDERS } = await import("../driver.config.mjs");
const { recordOriginsFor } = await import("../record-origins.mjs");
const { kebab } = await import("../stages-knockout.mjs");

const ENV_ORIGIN = recordOriginsFor(ENV_PROVIDER)[0];
assert.ok(ENV_ORIGIN, `precondition: ${ENV_PROVIDER} must declare a record origin for this fixture to mean anything`);

const MARK = "KURENA";
const EVIDENCE = "https://storefront-somewhere.invalid/listing/EVIDENCELISTING";
const RECORD_ID = "/mark/eu/RECORDCANONICAL0001";
const FOREIGN_URL = `${ENV_ORIGIN}/mark/eu/RECORDFOREIGN0002`;
const ownUrl = (origins) => (origins.length ? `${origins[0]}/mark/eu/RECORDOWNHOST0003` : null);

const IS_RECORD = /RECORD(CANONICAL|FOREIGN|OWNHOST)\d+/;

const FRAMEWORK = { framework_key: "house-triage", title: "t", bands: [
  { label: "Very High", tone: "severe" }, { label: "High", tone: "high" }, { label: "Medium", tone: "medium" },
  { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }] };

const FINDINGS = {
  marks: [{
    name: MARK, rating: "Medium", bullets: ["Synthetic fixture for the #810 record-link host invariant."],
    findings: [{
      ordinal: 1, name: "Look-alike listing", owner: "Kurena SA", band: "Medium",
      net: "A listing under a closely similar name is live on a marketplace.",
      type: "Active Business", evidence: [EVIDENCE],
    }],
  }],
};

/** The filings sidecar, whose `provider` is the run's own receipt of which register produced these. */
const recordsDoc = (providerId) => {
  const own = ownUrl(recordOriginsFor(providerId));
  return {
    schema: 1, provider: providerId, providerLabel: providerId, takenAt: "2026-08-12T09:00:00.000Z",
    basis: "Synthetic fixture.", cap: 100, listedPredicates: ["identical"], excludedPredicates: [],
    scope: { jurisdictions: null, regions: null, deferredJurisdictions: null, classes: [9] },
    marks: [{
      name: MARK, classes: [9], classScope: "mark",
      terms: [{ term: MARK, basis: "identical", label: "the name itself", ok: true, fetched: 2, total: 2 }],
      // Two records: one on ANOTHER register's host, and — where the provider declares one at all — one
      // already on a host it legitimately publishes. The second exists so "no foreign anchors" cannot be
      // satisfied by a render that emits no record links whatsoever.
      records: [
        { recordId: RECORD_ID, mark: MARK, owner: "Kurena SA", status: "Registered", classes: [9],
          territory: "EU", matchedForm: MARK, matchedBasis: "identical", url: FOREIGN_URL },
        ...(own ? [{ recordId: "/mark/eu/RECORDOWNHOST0003", mark: MARK, owner: "Kurena SA", status: "Registered",
          classes: [9], territory: "EU", matchedForm: MARK, matchedBasis: "identical", url: own }] : []),
      ],
      fetched: own ? 2 : 1, available: own ? 2 : 1, capped: false, cap: 100,
    }],
  };
};

/** Publish the fixture as a run whose OWN sidecar names `providerId`, and return its report.html. */
async function publishAs(providerId) {
  const runDir = mkdtempSync(join(ROOT, `run-${providerId}-`));
  mkdirSync(driverDir(runDir), { recursive: true });
  mkdirSync(join(runDir, "research"), { recursive: true });
  writeFileSync(driverDir(runDir, "framework.json"), JSON.stringify(FRAMEWORK));
  // The receipts door refuses a publish whose citations cannot be traced to the run's own payloads.
  writeFileSync(join(runDir, "research", `${kebab(MARK)}.md`), `# captured research payload (fixture)\n\n${EVIDENCE}\n`);
  writeFileSync(driverDir(runDir, "register-records.json"), JSON.stringify(recordsDoc(providerId)));
  const poolRoot = join(ROOT, `pool-${providerId}`);
  mkdirSync(poolRoot, { recursive: true });
  const runId = `tmp0810-2026-08-12-${providerId}`;
  await publishKnockout({
    runId, codename: providerId, runDir, findings: FINDINGS, framework: FRAMEWORK, overall: "Medium",
    poolRoot, poolUrl: "https://trademark.test", customerKey: "generic", skipRegen: true,
  });
  return readFileSync(join(poolRoot, runId, "report.html"), "utf8");
}

/** Every `<a …>` open tag with its href, as written. */
const anchorsOf = (html) => [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"[^>]*>/gi)].map((m) => ({ tag: m[0], href: m[1] }));

const covered = [];

for (const id of Object.keys(PROVIDERS)) {
  test(`#810 a knockout on ${id} links records only to hosts ${id} publishes — and leaves evidence alone`, async () => {
    const origins = recordOriginsFor(id);
    const html = await publishAs(id);
    covered.push(id);

    // The filings section must actually have rendered, or every assertion below is judging a page that
    // never carried a record link. Matched on the tracer, which appears whether the record rendered as
    // an anchor (href) or as its number in text (the reduced form) — the two outcomes this test is here
    // to tell apart, so the precondition must not presume either.
    assert.ok(IS_RECORD.test(html),
      `${id}: the filings section did not render — nothing below would be measuring anything`);

    const abs = anchorsOf(html).filter((a) => /^https?:\/\//i.test(a.href));
    const record = abs.filter((a) => IS_RECORD.test(a.href));

    // ── 1. every record anchor belongs to the register this run searched ────────────────────────────
    const wrongHost = record.filter((a) => !origins.includes(new URL(a.href).origin));
    assert.equal(wrongHost.length, 0,
      `${id}: ${wrongHost.length} record anchor(s) name a host this run's register does not publish. `
      + `recordOriginsFor("${id}") = ${JSON.stringify(origins)}; found:\n  ${wrongHost.map((a) => a.href).join("\n  ")}`);

    if (origins.length) {
      // ── 2a. a provider WITH a public record page still links: the assertion above must not be
      //        satisfiable by a render that emits no record links at all.
      assert.ok(record.length > 0,
        `${id} publishes record pages at ${JSON.stringify(origins)} yet the report carries no record anchor — `
        + `"no foreign host" passed only because nothing was linked`);
      assert.ok(record.some((a) => a.href === ownUrl(origins)),
        `${id}: a record url ALREADY on a host this provider publishes was not passed through untouched`);
    } else {
      // ── 2b. clarivate and signa publish no per-record page, so no absolute record link is legitimate.
      assert.equal(record.length, 0,
        `${id} publishes no per-record page, so no absolute record link on this report can resolve to one:\n  `
        + record.map((a) => a.href).join("\n  "));
    }

    // ── 3. a record whose link WAS reduced is still identified ──────────────────────────────────────
    // "No link" is only the right answer if the reader is still told which record. The canonical
    // /mark/<cc>/<number> is what the system stores and what the refusal message prescribes stating
    // in text; a repair that dropped it would delete the citation rather than fix it.
    //
    // Only asserted where the reduction actually happened. On the one provider whose own host the
    // fixture's off-register URL belongs to, nothing is reduced and the record correctly stays a link —
    // asserting the fallback there would be requiring the repair to fire on a legitimate URL.
    if (!origins.includes(new URL(FOREIGN_URL).origin)) {
      assert.ok(html.includes(RECORD_ID),
        `${id}: a record whose URL was reduced left no number behind — the citation was deleted, not repaired`);
      assert.ok(!anchorsOf(html).some((a) => a.href === FOREIGN_URL),
        `${id}: the off-register URL survived as an anchor`);
    }

    // ── 4. evidence is not record data and must reach the reader exactly as found ───────────────────
    assert.ok(abs.some((a) => a.href === EVIDENCE),
      `${id}: the finding's evidence URL was altered or dropped. A knockout sweep points at storefronts `
      + `and marketplaces; constraining those to register hosts is the fix over-reaching, not working.`);
  });
}

test("#810 the loop above ran over the whole provider table", () => {
  assert.deepEqual([...covered].sort(), Object.keys(PROVIDERS).sort(),
    "a provider in the table with no case here is a provider whose knockout links nothing checks");
});

// ── THE UNIT, where the two shapes that are NOT a foreign host are pinned ────────────────────────────
test("#810 a sidecar with no provider is a NO-OP, not an empty allow-list", async () => {
  const { normalizeRegisterRecordLinks } = await import("../register-records.mjs");
  // A legacy/archived sidecar that never recorded its register cannot be judged against one. Reading the
  // missing field as "no origins allowed" would strip every link off every archived knockout on
  // republish — the loudest possible way to be wrong about runs nobody was asking about.
  const doc = recordsDoc("corsearch");
  delete doc.provider;
  const before = JSON.stringify(doc);
  assert.deepEqual(normalizeRegisterRecordLinks(doc), []);
  assert.equal(JSON.stringify(doc), before, "byte-identical — the gate is off, not permissive");
  assert.equal(normalizeRegisterRecordLinks(null).length, 0, "and no sidecar at all is not a crash");
});

test("#810 a foreign url is cleared to null, so the workbook's ?? fallback still reaches recordId", async () => {
  const { normalizeRegisterRecordLinks } = await import("../register-records.mjs");
  const doc = recordsDoc("euipo");
  const dropped = normalizeRegisterRecordLinks(doc);
  assert.equal(dropped.length, 1, "one record was on a host euipo does not publish");
  assert.equal(dropped[0].was, FOREIGN_URL);
  assert.equal(dropped[0].recordId, RECORD_ID, "the log line names the record, not just the URL");
  // NULL, not "". The workbook's Record cell is `r.url ?? r.recordId ?? '—'` and `??` passes an empty
  // string straight through — clearing to "" blanks the very cell that carries the fallback. The HTML
  // surfaces test truthiness and would have hidden it.
  assert.equal(doc.marks[0].records[0].url, null);
  assert.notEqual(doc.marks[0].records[0].url, "", "an empty string would blank the workbook's Record column");
  assert.equal(doc.marks[0].records[0].recordId, RECORD_ID, "the identity is untouched");
});

test("#810 a relative url is not a host claim and is left exactly as written", async () => {
  const { normalizeRegisterRecordLinks } = await import("../register-records.mjs");
  const doc = recordsDoc("euipo");
  doc.marks[0].records[0].url = RECORD_ID;
  assert.deepEqual(normalizeRegisterRecordLinks(doc), []);
  assert.equal(doc.marks[0].records[0].url, RECORD_ID);
});
