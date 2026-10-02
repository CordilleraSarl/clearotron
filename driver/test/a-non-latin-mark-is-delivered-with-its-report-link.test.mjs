// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A MARK WRITTEN IN ANOTHER SCRIPT IS DELIVERED WITH ITS REPORT LINK.
//
// The run id is `<slug>-<date>-<codename>`, and the slug carried the mark through `kebab`, which keeps every
// Unicode letter. The route builders accept only an ASCII path segment, so a mark written in Greek,
// Cyrillic or Han, or with a letter such as Ł, gave a run id they refuse, and every link of the delivery
// came out null. Measured on a delivered knockout on the test box: nine links of nine null. The names
// below are invented, written in each script.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSlug, kebab } from "../phase0.mjs";
import { kebab as markSlug } from "../search-policy.mjs";
import { reportRouteFor, auditRouteFor, markReportRouteFor } from "../publish/index.mjs";

const ORIGIN = "https://reports.example.test";
const runIdFor = (job) => `${deriveSlug(job)}-2026-10-02-zz-arm`;

const NON_LATIN = ["ΒΕΛΤΡΙΝ", "ВЕЛТРИН", "维尔特林", "ŁUVEN", "VELTRIN 维尔", "Βέλτριν Café"];

test("a mark in another script gets a run id every route accepts, and so a link on every surface", () => {
  for (const name of NON_LATIN) {
    for (const job of [{ id: "job-1", ref: "TMP1234", markName: name }, { id: "job-2", markName: name }]) {
      const runId = runIdFor(job);
      assert.match(runId, /^[a-z0-9][a-z0-9-]*$/, `"${name}" gives a run id outside the route's character set: ${runId}`);
      assert.ok(reportRouteFor(ORIGIN, runId), `"${name}": the report link is null`);
      assert.ok(auditRouteFor(ORIGIN, runId), `"${name}": the workbook link is null`);
      assert.ok(markReportRouteFor(ORIGIN, runId, markSlug(name)), `"${name}": the per-name link is null`);
    }
  }
});

test("the readable part keeps what is ASCII, and a name with nothing ASCII left reads `mark`", () => {
  assert.equal(deriveSlug({ id: "j", ref: "TMP1234", markName: "VELTRIN 维尔" }), "tmp1234-veltrin");
  assert.equal(deriveSlug({ id: "j", ref: "TMP1234", markName: "维尔特林" }), "tmp1234-mark");
  assert.equal(deriveSlug({ id: "j", ref: "TMP1234", markName: "Βέλτριν Café" }), "tmp1234-cafe");
  // The reference and the hash still separate two runs whose names both fold to nothing.
  assert.notEqual(deriveSlug({ id: "job-a", markName: "维尔特林" }), deriveSlug({ id: "job-b", markName: "ВЕЛТРИН" }));
});

test("every name whose slug was already ASCII keeps its run id byte for byte", () => {
  // THE CONTROL. Run directories, archives, resumes and every link already sent were computed from the old
  // derivation, so a name it served must derive exactly what it did: `tmp<ref>-<kebab>` and
  // `noref<hash>-<kebab>`, accented Latin and the combining-mark hyphen included.
  for (const name of ["VELTRIN", "Café Veltrin", "Müller & Söhne", "MOTO-X 3000", "½ moon™"]) {
    const k = kebab(name);
    assert.match(k, /^[a-z0-9-]+$/, `premise: "${name}" kebabs to ASCII`);
    assert.equal(deriveSlug({ id: "job-1", ref: "TMP1234", markName: name }), `tmp1234-${k}`);
    const noref = deriveSlug({ id: "job-1", markName: name });
    assert.match(noref, new RegExp(`^noref[0-9a-f]{6}-${k}$`), `"${name}": the refless slug moved`);
  }
});
