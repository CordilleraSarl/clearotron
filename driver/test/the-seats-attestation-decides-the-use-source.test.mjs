// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE SEAT'S ATTESTATION DECIDES THE USE-SOURCE CLASS; the host heuristic is the
// fallback for when it is absent, and the register-mirror demotion keeps its precedence exactly.
//
// The measured defect: on one delivered report the seat attested `owner-site` on four of five
// use-check rows and the render called every one "from an independent source", because the join read
// the attestation only for register-mirror and the heuristic needs the full de-suffixed owner token
// inside the host ("acmedocs" is not inside "acmeai"). The one row the heuristic got right was
// the one where it did not matter. These five rows keep that report's shape, with invented owners and hosts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { joinEvidenceStatus, classifyUseSource } from "../registry-fidelity.mjs";

const finding = (owner, source, quality) => ({
  mark: "ACME", owner: { name: owner },
  use_check: { source, ...(quality ? { quality } : {}) },
  meters: { use: { token: "confirmed", basis: "verified-from-record", source } },
});

test("five rows: the four attested owner-site move to owner-site, the independent one stays independent", () => {
  const rows = [
    ["ACME RECORDS HOLDINGS II LTD", "https://www.news.example/labels/read/acme-records-acquires-a-label", "independent", "independent"],
    ["Acme Hospitality, LLC", "https://www.acmehotel.example/harbour/acme-hundred/", "owner-site", "owner-site"],
    ["ACMEDOCS, INC.", "https://acmeai.example/", "owner-site", "owner-site"],
    ["A. N. Owner", "https://acma.example/", "owner-site", "owner-site"],
    ["Example Software Co.", "https://acmesoft.example/showcase/201606/index", "owner-site", "owner-site"],
  ];
  for (const [owner, url, attested, expected] of rows) {
    if (attested === "owner-site") {
      assert.notEqual(classifyUseSource(url, owner), "owner-site",
        `${owner} / ${url}: the host rule already finds this owner, so this row does not test the attestation`);
    }
    const f = finding(owner, url, attested);
    joinEvidenceStatus([f], new Map());
    assert.equal(f.meters.use._useSourceClass, expected,
      `${owner} / ${url}: the seat attested "${attested}" and the join produced "${f.meters.use._useSourceClass}" — `
      + "the attestation must decide the class");
  }
});

test("the register-mirror precedence is NOT inverted: an attested owner-site on a host-detected mirror stays a mirror", () => {
  // The issue's own falsification arm: if this passes as owner-site, the precedence has been inverted.
  const f = finding("MERIDIAN Sports", "https://trademarks.justia.com/854/03/matchday.html", "owner-site");
  assert.equal(classifyUseSource(f.use_check.source, f.owner.name), "register-mirror",
    "the fixture's host is no longer on the mirror list — this arm is measuring nothing");
  joinEvidenceStatus([f], new Map());
  assert.equal(f.meters.use._useSourceClass, "register-mirror",
    "an attestation that can only STRENGTHEN the evidence overrode the host-detected mirror");
  assert.equal(f.meters.use._status, "not-checked", "a mirror is never evidence of use — the demotion survives");
});

test("an attested register-mirror still demotes a host the list misses — the old rule's one good half survives", () => {
  const f = finding("SOMEONE", "https://obscure-national-register.example/entry/1", "register-mirror");
  joinEvidenceStatus([f], new Map());
  assert.equal(f.meters.use._useSourceClass, "register-mirror");
  assert.equal(f.meters.use._status, "not-checked");
});

test("no attestation → the heuristic is the fallback, in both of its directions", () => {
  const ownerSite = finding("MERIDIAN Sports LLC", "https://www.meridiansports.example/products/matchday", null);
  joinEvidenceStatus([ownerSite], new Map());
  assert.equal(ownerSite.meters.use._useSourceClass, "owner-site", "the heuristic still classifies when the seat said nothing");
  const indep = finding("ACMEDOCS, INC.", "https://somereview.example/article", null);
  joinEvidenceStatus([indep], new Map());
  assert.equal(indep.meters.use._useSourceClass, "independent");
});

test("an attested value outside the vocabulary is ignored, not written through", () => {
  const f = finding("ACMEDOCS, INC.", "https://somereview.example/article", "definitely-legit");
  joinEvidenceStatus([f], new Map());
  assert.equal(f.meters.use._useSourceClass, "independent",
    "an unknown attestation value must fall back to the heuristic, never land verbatim on a client field");
});
