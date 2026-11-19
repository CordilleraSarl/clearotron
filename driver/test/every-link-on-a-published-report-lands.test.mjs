// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY IN-PAGE LINK ON A PUBLISHED REPORT LANDS ON THAT PAGE (2026-11-19).
//
// A report's key rows, chart dots, four-answers ordinals and common-law hint link to places on the same page. Measured
// on saved test-instance clearances, up to 13 of a page's links went nowhere: the findings they named were drawn as
// grouped rows or ruled-out cards with no id, the common-law section had lost its anchor with its heading, and an
// ordinal could cite a withdrawn finding the page does not draw. The demos carried the same shapes, 2 and 4 dead links.
// Each demo run is published as a client receives it, the Knockout included, and every `href="#…"` must name an id
// on its page, with no id repeated. render.test.mjs holds each shape on an invented page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { demoReportHtml } from "./snapshot/publish-compare.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));

test("every in-page link on each published demo report lands on that page, and no id repeats", () => {
  const demos = demoReportHtml(repo);
  assert.equal(Object.keys(demos).length, 4, "expected the four demo runs, the Knockout included");
  for (const [sample, pages] of Object.entries(demos)) {
    assert.equal(Object.keys(pages).length, 1, `${sample} published ${Object.keys(pages).length} report pages, not one`);
    for (const html of Object.values(pages)) {
      const markup = html.replace(/<script\b[\s\S]*?<\/script>/g, "").replace(/<style\b[\s\S]*?<\/style>/g, "");
      const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      const hrefs = [...markup.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
      assert.ok(hrefs.length > 0, `${sample}: the page draws in-page links`);
      assert.deepEqual(hrefs.filter((h) => !ids.includes(h)), [], `${sample}: links to targets the page does not carry`);
      assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), [], `${sample}: ids that repeat`);
    }
  }
});
