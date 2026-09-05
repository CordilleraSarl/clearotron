// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// report-record-link-host.test.mjs —. The record link a reader CLICKS belongs to the register the
// run actually searched.
//
// built the allow-list (`recordOriginsFor`) and a gate inside the findings parser, and covered both
// at unit level. Nothing opened a produced report.html. That mattered, because the gate is wired into
// verify.mjs and NOT into the publish path — measured on origin/main before this PR, a run whose receipts
// said `clarivate` republished 18 absolute record anchors on a vendor host Clarivate does not publish, and
// a correctly-configured `euipo` run still leaked 9 through the provenance line. A report that cites one
// registry and links to another is wrong in the one place this product cannot be wrong, and it is silent:
// the link resolves to a real page, so nothing errors and no test goes red.
//
// WHAT THIS FILE ASSERTS, and why it is shaped this way:
//
//  1. IT ENUMERATES THE PROVIDER TABLE. The failure designed for is a SEVENTH provider added later with no
//     test written for it — so the cases come from `Object.keys(PROVIDERS)`, never a hand-written list, and
//     the roster test at the foot fails if the loop ever runs over fewer providers than the table holds.
//
//  2. IT ASSERTS NO HOST. Every expectation is derived from `recordOriginsFor(id)`, which is the one place
//     provider knowledge lives. A second copy of that knowledge inside a test is the same defect class the
//     issue is about, one layer up: the copy drifts, the test still passes, and the report is still wrong.
//
//  3. THE RECORD/EVIDENCE SPLIT COMES FROM THE FIELD, NEVER FROM THE URL. findings-model.mjs already owns
//     that judgement and this file reuses it rather than restating it: `owner.registrations[].uri` is a
//     record link unconditionally; `source.resolved_link` is one ONLY when `source_type` starts with
//     "register", because a common-law finding's resolved_link is a marketplace or a company site BY
//     DEFINITION. `use_check.source`, `own_rights.source` and prose links point at arbitrary sites and are
//     asserted to SURVIVE UNTOUCHED on every provider — that half is what stops the fix over-reaching.
//
//     The `RECORD…`/`EVIDENCE…` tokens below are NOT a URL pattern match standing in for that judgement.
//     They are the fixture's own tracer dye: each field is given a distinct URL so a rendered anchor can be
//     ATTRIBUTED to the field that produced it. Production data carries no such token and none is looked for
//     outside this file.
//
//  4. IT RENDERS THROUGH THE REAL PUBLISHER. `publishReport` is where the repair lives, so a test that
//     called the renderer directly would stay green the day somebody deletes the normalisation call.
//
// A BOUNDARY THIS TEST DELIBERATELY DOES NOT POLICE, pinned below so nobody "fixes" it with a host regex:
// the model's own PROSE can carry a register URL (`- Source: [EUIPO · 018575624](https://euipo.europa.eu/…)`
// is in demo's report.md today). A prose link is markdown the synthesis wrote; NOTHING in the
// data distinguishes a prose register citation from any other prose link, so constraining it would mean
// pattern-matching the URL — which is the one move the issue rules out. It is asserted to survive verbatim.
import { test } from "node:test";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

// Pin the deployment config BEFORE the publish import — driver.config reads env at module load and its
// pool-root DEFAULT IS THE REAL ARCHIVE. Same trap publish-stamp.test.mjs documents; a synthetic run must
// never be able to land in a production pool.
const ROOT = mkdtempSync(join(tmpdir(), "record-link-host-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
// The ask-AI chrome anchors are minted only when this is set, and they carry `rel="noopener"` without
// `noreferrer` by deliberate decision — the arm that pins that decision does not cross the cut, so it is
// described rather than cited. Unset so the anchor census below is the report's own links and not an
// artefact of the box's environment.
delete process.env.CLEAROTRON_MCP_URL;
// THE RUN'S REGISTER IS READ FROM ITS OWN RECEIPTS, NEVER FROM TODAY'S DEPLOYMENT — a republished archive
// keeps the register it searched. This is set to a provider that is WRONG for every case below except one,
// and the fixture's off-register links are built on the host it declares: if the publish path ever consults
// the environment instead of `_driver/receipts.json`, those links become "legitimate" and the assertions
// for the other five providers go red.
const ENV_PROVIDER = "corsearch";
pinEnv(process.env, "CLEAROTRON_DATABASE", ENV_PROVIDER);

const { publishReport } = await import("../publish/index.mjs");
const { PROVIDERS, KNOWN_REGISTER_PROVIDERS } = await import("../driver.config.mjs");
const { recordOriginsFor } = await import("../record-origins.mjs");

const ENV_ORIGIN = recordOriginsFor(ENV_PROVIDER)[0];
assert.ok(ENV_ORIGIN, `precondition: ${ENV_PROVIDER} must declare a record origin for this fixture to mean anything`);

// ── the fixture ──────────────────────────────────────────────────────────────────────────────────────
//
// Tracer URLs, one per field. `.invalid` is reserved by RFC 2606 and can never be a real register.
const EV = {
  use: "https://storefront-somewhere.invalid/listing/EVIDENCEUSE",
  own: "https://applicant-company.invalid/about/EVIDENCEOWN",
  commonLaw: "https://marketplace-somewhere.invalid/item/EVIDENCECL",
  prose: "https://an-office-page.invalid/register/EVIDENCEPROSE",
};
const REL_URI = "/mark/eu/RECORDRELATIVE0001";              // the canonical record identity this system stores
const FOREIGN_URI = `${ENV_ORIGIN}/mark/eu/RECORDFOREIGN0002`;   // an absolute uri on another register's host
const FOREIGN_LINK = `${ENV_ORIGIN}/record/RECORDPROVENANCE0003`; // …and the provenance link, likewise
const ownUri = (origins) => (origins.length ? `${origins[0]}/mark/eu/RECORDOWNHOST0004` : null);

const IS_RECORD = /RECORD(RELATIVE|FOREIGN|PROVENANCE|OWNHOST)\d+/;
const IS_EVIDENCE = /EVIDENCE(USE|OWN|CL|PROSE)/;

const REPORT_MD = `---
type: prelim-clearance
matter: TMP0775
title: KURENA
client: House default
use: synthetic fixture for the record-link host invariant
classes: 9
run: 2026-08-12 · register + common-law
overall_label: Manageable
overall_badge: l2
overall_caption: Synthetic single-purpose fixture for the #775 rendered-link regression.
---

# Summary
Synthetic fixture. The one thing this document is for is the hosts its anchors name.

# Methodology
The register was searched. Prose citation, which is the synthesis writing markdown and not a record field:
[an office page](${EV.prose}).

# Coverage
Synthetic coverage panel.
`;

const findingsDoc = (origins) => {
  const own = ownUri(origins);
  return JSON.stringify({
    schema_version: 1,
    findings: [
      {
        ordinal: 1,
        mark: "KURENA",
        owner: {
          name: "Kurena SA", country: "CH",
          // Three record uris: the canonical path, one absolute on another register's host, and — where
          // the provider declares one at all — one already on a host it legitimately publishes. The last
          // exists so "no foreign anchors" cannot be satisfied by rendering no links whatsoever.
          registrations: [
            { uri: REL_URI, classes: ["9"], status: "Registered", jurisdiction: "EU" },
            { uri: FOREIGN_URI, classes: ["9"], status: "Registered", jurisdiction: "EU" },
            ...(own ? [{ uri: own, classes: ["9"], status: "Registered", jurisdiction: "EU" }] : []),
          ],
        },
        composite: 4, level: "B", dispute_type: "paper-conflict",
        meters: {
          mark_similarity: { token: "high", basis: "verified-from-record" },
          goods_proximity: { token: "medium", basis: "verified-from-record" },
          use: { token: "confirmed", basis: "verified-from-record" },
          enforcer: { token: "high", basis: "inferred-from-signal" },
        },
        quadrant: { x: 0.5, y: 0.5 },
        source: { source_type: "register-vendor", resolved_link: FOREIGN_LINK },
        use_check: { source: EV.use },
        own_rights: { source: EV.own },
      },
      {
        ordinal: 2,
        mark: "KURENNA",
        owner: { name: "Kurenna Trading", country: "SG", registrations: [] },
        composite: 2, level: "C", dispute_type: "paper-conflict",
        meters: {
          mark_similarity: { token: "medium", basis: "inferred-from-signal" },
          goods_proximity: { token: "low", basis: "inferred-from-signal" },
          use: { token: "confirmed", basis: "verified-from-record" },
          enforcer: { token: "low", basis: "inferred-from-signal" },
        },
        quadrant: { x: 0.3, y: 0.3 },
        // A common-law finding's resolved_link is a marketplace BY DEFINITION. It is not a record link and
        // must never be judged as one, on any provider.
        source: { source_type: "common-law-marketplace", resolved_link: EV.commonLaw },
        use_check: { source: EV.commonLaw },
      },
    ],
    coverage: [{ area: "register / EU", state: "confirmed-clean", note: "" }],
  });
};

/** Publish the fixture as a run whose OWN receipts name `providerId`, and return its report.html. */
async function publishAs(providerId, { findings = null, records = null, tag = providerId } = {}) {
  const runDir = join(ROOT, `run-${tag}`);
  mkdirSync(driverDir(runDir), { recursive: true });
  if (records) {
    mkdirSync(join(runDir, "_records"), { recursive: true });
    for (const [file, body] of Object.entries(records)) writeFileSync(join(runDir, "_records", file), JSON.stringify(body));
  }
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId: `fixture-${tag}`, markName: "KURENA" }));
  writeFileSync(join(runDir, "report.md"), REPORT_MD);
  writeFileSync(join(runDir, "findings.json"), findings ?? findingsDoc(recordOriginsFor(providerId)));
  // The register a run searched is a fact about THE RUN, recorded here at fetch time.
  writeFileSync(driverDir(runDir, "receipts.json"), JSON.stringify({
    schema_version: 1,
    receipts: [{ uri: REL_URI, provider: providerId, fetched_at: "2026-08-12T09:00:00.000Z", context: "fixture", fields: ["uri", "provider"] }],
  }));
  const poolRoot = join(ROOT, `pool-${tag}`);
  mkdirSync(poolRoot, { recursive: true });
  const runId = `tmp0775-2026-08-12-${tag}`;
  await publishReport({
    runId, codename: providerId, reportMd: join(runDir, "report.md"),
    findingsJson: join(runDir, "findings.json"),
    poolRoot, poolUrl: "https://trademark.test", customerKey: "generic", runDir, skipRegen: true,
  });
  return readFileSync(join(poolRoot, runId, "report.html"), "utf8");
}

/** Every `<a …>` open tag with its href, as written. */
const anchorsOf = (html) => [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"[^>]*>/gi)].map((m) => ({ tag: m[0], href: m[1] }));

const covered = [];

for (const id of Object.keys(PROVIDERS)) {
  test(`#775 a run on ${id} links records only to hosts ${id} publishes — and leaves evidence alone`, async () => {
    const origins = recordOriginsFor(id);
    const html = await publishAs(id);
    covered.push(id);

    // The strict parse must be the one that ran. A schema slip drops publishReport into its LENIENT
    // branch, which quarantines the offending finding and renders a degraded document — and every
    // assertion below would then be judging a page that never had the links in it. Counted from the
    // per-finding audit ref, which the renderer emits for every card whether or not it carries a link.
    const cards = [...html.matchAll(/audit ref F\d+/g)].length;
    assert.equal(cards, 2,
      `${id}: ${cards} of the fixture's 2 findings rendered — publish fell into the lenient/quarantine ` +
      `branch, so everything below would be judging a degraded document`);

    const abs = anchorsOf(html).filter((a) => /^https?:\/\//i.test(a.href));
    const record = abs.filter((a) => IS_RECORD.test(a.href));
    const evidence = abs.filter((a) => IS_EVIDENCE.test(a.href));
    const unattributed = abs.filter((a) => !IS_RECORD.test(a.href) && !IS_EVIDENCE.test(a.href));

    // ── 1. every record anchor belongs to the register this run searched ────────────────────────────
    const wrongHost = record.filter((a) => !origins.includes(new URL(a.href).origin));
    assert.equal(wrongHost.length, 0,
      `${id}: ${wrongHost.length} record anchor(s) name a host this run's register does not publish. ` +
      `recordOriginsFor("${id}") = ${JSON.stringify(origins)}; found:\n  ${wrongHost.map((a) => a.href).join("\n  ")}`);

    if (origins.length) {
      // ── 2a. a provider WITH a public record page still links: the assertion above must not be
      //        satisfiable by a render that emits no record links at all.
      assert.ok(record.length > 0,
        `${id} publishes record pages at ${JSON.stringify(origins)} yet the report carries no record anchor — ` +
        `"no foreign host" passed only because nothing was linked`);
      assert.ok(record.some((a) => a.href === ownUri(origins)),
        `${id}: a record uri ALREADY on a host this provider publishes was not passed through untouched`);
    } else {
      // ── 2b. a provider with hasPublicRecordUrl:false publishes no per-record page, so no absolute
      //        record link is legitimate — the office register and the number are stated in text instead.
      //        (The remedy the  refusal message prescribes, word for word.)
      assert.equal(record.length, 0,
        `${id} publishes no per-record page, so no absolute record link on this report can resolve to one:\n  ` +
        record.map((a) => a.href).join("\n  "));
      // "No link" is only the right answer if the reader is still told WHICH record. Read the whole
      // list item the number sits in, so this cannot be satisfied by the string appearing anywhere.
      const item = (() => {
        const i = html.indexOf(REL_URI);
        if (i < 0) return "";
        const s = html.lastIndexOf("<li", i), e = html.indexOf("</li>", i);
        return s >= 0 && e > i ? html.slice(s, e) : "";
      })();
      assert.ok(item, `${id}: the record number vanished from the report — it must remain readable as text`);
      assert.ok(!/<a\b/i.test(item), `${id}: the record number is still inside an anchor:\n  ${item.slice(0, 200)}`);
      assert.ok(item.includes("EU"), `${id}: the office register is not named beside the number:\n  ${item.slice(0, 200)}`);
    }

    // ── 3. evidence is not record data and must reach the reader exactly as found ────────────────────
    for (const [field, url] of Object.entries(EV))
      assert.ok(abs.some((a) => a.href === url),
        `${id}: the ${field} evidence URL was altered or dropped. A common-law sweep points at arbitrary ` +
        `sites; constraining it to register hosts is the fix over-reaching, not working.`);
    assert.ok(evidence.length >= Object.keys(EV).length,
      `${id}: ${evidence.length} evidence anchors for ${Object.keys(EV).length} evidence fields — the census came up short`);

    // ── 4. an external link that does not open OUT of the frame is a dead link ────────────────
    const noTarget = abs.filter((a) => !/\starget="_blank"/i.test(a.tag));
    const noRel = abs.filter((a) => !/\srel="[^"]*\bnoopener\b/i.test(a.tag));
    assert.equal(noTarget.length, 0,
      `${id}: ${noTarget.length} of ${abs.length} external anchors carry no target="_blank"; inside the ` +
      `portal's null-origin frame they navigate the frame and the click does nothing:\n  ${noTarget.map((a) => a.tag.slice(0, 140)).join("\n  ")}`);
    assert.equal(noRel.length, 0,
      `${id}: ${noRel.length} external anchors open a new window without rel="noopener":\n  ${noRel.map((a) => a.tag.slice(0, 140)).join("\n  ")}`);

    // ── 5. nothing on the page came from somewhere this test cannot account for ──────────────────────
    // Every field of the fixture carries a tracer, so an absolute anchor with none is a link the renderer
    // minted from something else. That is not automatically wrong — but it is not covered by anything
    // above, and a new emitter is exactly how this defect class comes back.
    assert.deepEqual(unattributed.map((a) => a.href), [],
      `${id}: absolute anchors that trace to no fixture field — a new render emitter is unpoliced here`);
  });
}

test("#775 reducing a record uri to its path RE-BINDS it to the record the run actually fetched", async () => {
  // THE CONSEQUENCE THAT IS NOT ABOUT HREFS, pinned here because it changes what a card SAYS and because
  // pool-admin's doRepublish() re-renders archived deliveries.
  //
  // The run's record set is a Map keyed by the `/mark/<cc>/<n>` PATH (registry-fidelity.readRecordArtifacts),
  // and bindFindingsToRecords runs AFTER the normalisation. So a registration the run genuinely FETCHED, but
  // which the model cited as an absolute vendor URL, used to MISS that map: bindFindingsToRecords took the
  // "cited, not fetched" branch and dropped the model's fields, and the card rendered a bare
  // "(register-index entry)". Reducing the uri to its path makes the lookup hit, and the card states the
  // fetched record instead.
  //
  // That is a REPORT SAYING MORE THAN IT SAID BEFORE, so it is deliberate and asserted rather than left as a
  // side effect: the record was fetched, the receipt is on file, and the old card understated the run's own
  // evidence. Nothing is invented — the fields come from the artifact, and a uri with no artifact behind it
  // still renders as an index entry.
  const KEY = "/mark/eu/RECORDBOUND0001";
  const foreign = `${ENV_ORIGIN}${KEY}`;
  const doc = JSON.parse(findingsDoc([]));   // clarivate: empty origins, so the reduction certainly fires
  doc.findings[0].owner.registrations = [{ uri: foreign, classes: ["9"], status: "Registered", jurisdiction: "EU" }];
  const html = await publishAs("clarivate", {
    tag: "bound", findings: JSON.stringify(doc),
    // The map key is derived from `_uri`; the file name is the fallback. Both are the path, never a host.
    records: {
      "eu-RECORDBOUND0001.json": {
        _uri: KEY, uri: KEY, provider: "clarivate", office: "EU",
        applicationNumber: "RECORDBOUND0001", registrationNumber: "RECORDBOUND0001",
        applicationDate: "2019-03-04", registrationDate: "2019-11-08",
        statusClass: "live", statusText: "REGISTERED", markText: "KURENA", niceClasses: ["9"],
        owner: "Kurena SA", _receipt: { fetched_at: "2026-08-12T09:00:00.000Z", context: "fixture" },
      },
    },
  });

  const i = html.indexOf(KEY.slice(1));
  assert.ok(i > 0, "the record identity is not on the page at all");
  const item = html.slice(html.lastIndexOf("<li", i), html.indexOf("</li>", i));
  assert.ok(!item.includes(foreign), `the foreign absolute uri survived into the card:\n  ${item}`);
  assert.ok(!/<a\b/i.test(item), `clarivate publishes no record page, so this must not be a link:\n  ${item}`);
  assert.match(item, /REGISTERED/, `the fetched record's status did not reach the card:\n  ${item}`);
  assert.match(item, /2019/, `the fetched record's dates did not reach the card:\n  ${item}`);
  assert.doesNotMatch(item, /register-index entry/,
    `the card still says the record was only CITED, though the run fetched it and the receipt is on file:\n  ${item}`);
  assert.match(html, /record fetched 2026-08-12/, "the fetch receipt line is not stated");
});

test("#775 the enumeration ran over the WHOLE provider table", () => {
  // The point of the loop is the provider nobody has written a test for yet. If the table grows and this
  // file silently iterates the old set — or the config stops loading and it iterates nothing — that has to
  // be a failure here rather than a green run that proves less than it did yesterday.
  const ids = Object.keys(PROVIDERS);
  assert.ok(ids.length >= 6, `the provider table holds ${ids.length} entries — it did not load`);
  assert.deepEqual([...covered].sort(), [...ids].sort(), "a provider in the table got no rendered-report case");
  assert.deepEqual([...ids].sort(), [...KNOWN_REGISTER_PROVIDERS].sort(),
    "PROVIDERS and KNOWN_REGISTER_PROVIDERS disagree — iterating either one would now miss a provider");
  assert.ok(ids.some((id) => recordOriginsFor(id).length === 0), "no hasPublicRecordUrl:false provider — branch 2b was never exercised");
  assert.ok(ids.some((id) => recordOriginsFor(id).length > 1), "no composite provider — the multi-office branch was never exercised");
});
