// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PORTAL STRIPS THE CHROME A REPORT MARKS AS ITS OWN. The portal removed a report's sticky header and
// theme toggle by matching their classes, so a re-skin that renamed a class stopped the strip without a
// sound. Both renderers now mark each piece of chrome with `data-report-chrome`, and the portal strips by
// that marker, balanced by the element's own tag. The class rules stay, because a stored report rendered
// before the marker carries only the classes. Invented markup throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareReportForEmbed } from "../portal-report.mjs";

const doc = (body) => `<!doctype html><html><head><title>t</title></head><body>${body}<main><p>An invented finding.</p></main></body></html>`;

test("a marked header goes whatever its class is called, with everything inside it", () => {
  const { html, unbalanced } = prepareReportForEmbed(doc(
    `<div class="masthead-renamed" data-report-chrome><div class="row"><span>QZXV · issued 2026-11-18</span></div><div class="row"><a href="#">Export</a></div></div>`));
  assert.doesNotMatch(html, /masthead-renamed|QZXV · issued|>Export</, "the marked header, or part of it, was served");
  assert.match(html, /An invented finding\./, "the report itself was cut");
  assert.deepEqual(unbalanced, []);
});

test("two marked roots of different tags each go, each balanced by its own tag", () => {
  const { html } = prepareReportForEmbed(doc(
    `<header class="top" data-report-chrome><div><div>Row one</div></div><div>Row two</div></header>`
    + `<p>Between the two.</p>`
    + `<div class="toggle-renamed" data-report-chrome="theme"><div><button type="button">Theme</button></div></div>`));
  assert.doesNotMatch(html, /Row one|Row two|toggle-renamed|>Theme</, "a marked root, or its subtree, was served");
  assert.match(html, /Between the two\./, "a balanced strip ran past its element");
});

test("a report rendered before the marker still loses its header and toggle by their classes", () => {
  const { html } = prepareReportForEmbed(doc(
    `<div class="rep-stickyhead"><div class="topbar">QZXV · Tier 2</div></div><div class="fab-stack"><button type="button">Theme</button></div>`));
  assert.doesNotMatch(html, /rep-stickyhead|QZXV · Tier 2|fab-stack/, "a class rule a stored report needs was lost");
});

test("a marked element with no close is left in place and named, never cut to the end of the report", () => {
  const { html, unbalanced } = prepareReportForEmbed(doc(`<section class="head" data-report-chrome><p>Unclosed header</p>`));
  assert.match(html, /An invented finding\./, "the report was truncated to remove its header");
  assert.ok(unbalanced.includes("section"), `the unbalanced element was not named: ${JSON.stringify(unbalanced)}`);
});
