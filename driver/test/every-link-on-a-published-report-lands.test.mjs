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
// on its page, with no id repeated. Links and ids are read from the page's parsed elements, never from the text of its
// script; the first test holds that reading to a document built to mislead it. render.test.mjs holds each shape on an
// invented page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { demoReportHtml } from "./snapshot/publish-compare.mjs";
import { pageElements, pageLinks } from "./helpers/page-links.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));

test("the page's links and ids are read from its elements, not from its script, style or comments", () => {
  const doc = [
    '<!doctype html><html><head><STYLE>a[href="#s"]{}</STYLE><title>A <b id="t"> page</title></head><body>',
    '<!-- <a href="#comment"> -->',
    '<div id="one" data-id="two"><a href="#one">1</a> <A HREF=\'#three\'>3</A> <a href=#four>4</a></div>',
    '<p id="three">x &lt; y</p><p id=four></p><a href="#&quot;q">q</a>',
    '<SCRIPT>var s = \'<a href="#script" id="script">\';</script ><Script>if (a < b) document.write("<p id=\'w\'>")</sCrIpT>',
    '<svg><a href="#one"><title>#1</title><circle r="1"/></a></svg><a>no target</a><a href="other.html#x">away</a>',
    '</body></html>',
  ].join("");
  assert.deepEqual(pageElements(doc).map((e) => e.tag), ["html", "head", "style", "title", "body", "div", "a", "a", "a", "p", "p", "a", "script",
    "script", "svg", "a", "title", "circle", "a", "a"]);
  assert.deepEqual(pageLinks(doc), {
    ids: ["one", "three", "four"],
    hrefs: ["one", "three", "four", '"q', "one"],
    dead: ['"q'],
    repeated: [],
  });
});

test("every in-page link on each published demo report lands on that page, and no id repeats", () => {
  const demos = demoReportHtml(repo);
  assert.equal(Object.keys(demos).length, 4, "expected the four demo runs, the Knockout included");
  for (const [sample, pages] of Object.entries(demos)) {
    assert.equal(Object.keys(pages).length, 1, `${sample} published ${Object.keys(pages).length} report pages, not one`);
    for (const html of Object.values(pages)) {
      const { ids, hrefs, dead, repeated } = pageLinks(html);
      assert.ok(hrefs.length > 0, `${sample}: the page draws in-page links`);
      // A clearance page links to its cards; the Knockout's links are to its sections.
      if (sample !== "knockout-search") assert.ok(hrefs.some((h) => /^c[0-9]+$/.test(h) && ids.includes(h)), `${sample}: a link to a card is read with its card's id`);
      assert.deepEqual(dead, [], `${sample}: links to targets the page does not carry`);
      assert.deepEqual(repeated, [], `${sample}: ids that repeat`);
    }
  }
});
