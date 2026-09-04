// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A DEMO REPORT DECLARES ITSELF —.
//
// ── WHAT KEPT THE OLD ONE HONEST, AND WHY NONE OF IT TRAVELS ────────────────────────────────────────
//
// A demo report was indistinguishable from a client deliverable except by three accidents of one frozen
// run: a disclaimer printed to the CONSOLE (absent from any PDF or forwarded link), an `overall_caption`
// a model happened to open with "This is a sample clearance report...", and a matter code reading
// `SAMPLE` because that capture was named `sample-capture`. Replace the run and all three go.
//
// This is the only artefact in the thread that leaves the machine. It is forwarded, printed and shown in
// meetings, and it carries real EUIPO records and a real risk band.
//
// ── THE TWO WAYS THIS CHANGE FAILS SILENTLY, BOTH GUARDED BELOW ─────────────────────────────────────
//
// 1. A MARKING THAT NEEDS A STYLESHEET. Already-published reports carry FROZEN CSS — render.mjs says so
//    at three separate sites — so a banner styled by class renders on fresh reports and is INVISIBLE on
//    every re-rendered older one. It would look landed and do nothing, in the one document that travels.
//    That is this issue's own hazard, reproduced by its fix.
//
// 2. A MARKING ON EVERY REPORT. A client deliverable that gains a demo banner is a worse defect than the
//    one being fixed, so the negative case is asserted as hard as the positive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { demoBannerHtml } from "../publish/render.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("2013 a demo-marked run declares itself, and says BOTH halves", () => {
  const html = demoBannerHtml(true);
  assert.ok(html, "a demo run must be marked on the report's own face");
  // Each half alone misleads in a different direction: "invented" alone reads as a toy and throws away
  // the report's value as a specimen of real work; "real data" alone reads as advice about a real
  // dispute. Both, or the marking is a different kind of wrong.
  assert.match(html, /invented/i, "the mark is fiction, and it says so");
  assert.match(html, /real/i, "and the register records behind it are real, which is what keeps it useful");
});

test("2013 a normal report gains NOTHING — no banner, no class, no attribute", () => {
  // The negative is the one that protects clients. Asserted on the exact falsey shapes a caller can
  // produce, because `opts.demoData` is absent on every legacy call site in the tree.
  for (const v of [false, undefined, null, 0, ""]) {
    assert.equal(demoBannerHtml(v), "", `demoBannerHtml(${JSON.stringify(v)}) must render nothing`);
  }
});

test("2013 the banner is INLINE-STYLED, so it survives a frozen stylesheet", () => {
  // THE LOAD-BEARING ARM. A class-styled banner passes every other assertion in this file and is
  // invisible on exactly the reports that matter: the ones already published, whose CSS was frozen
  // before this marking existed. `homeButton` in the same file is inline for the same reason and says so.
  const html = demoBannerHtml(true);
  assert.match(html, /style="[^"]*background:/, "the banner carries its own background inline");
  assert.match(html, /style="[^"]*border/, "and its own border");
  assert.match(html, /print-color-adjust:exact/,
    "and asks the browser to keep its colour when printed — a marking that prints white on white is not "
    + "a marking, and the printed page is the surface this issue exists for");
  assert.doesNotMatch(html, /class=/,
    "the banner names a CSS class. Already-published reports carry frozen CSS that never knew it, so it "
    + "would render on fresh reports and vanish on re-rendered ones — landed-looking and inert.");
});

test("2013 the marking is NOT `no-print` — the console and the topbar are not surfaces", () => {
  // The old disclaimer was a console line. The topbar is `no-print` and absent from every exported PDF.
  // A report is forwarded and printed, so the marking has to be in the document body.
  assert.doesNotMatch(demoBannerHtml(true), /no-print/,
    "a marking hidden from print is the console disclaimer again, in a different place");
  const src = readFileSync(join(ROOT, "driver", "publish", "render.mjs"), "utf8");
  const hero = src.slice(src.indexOf('<header class="hero">'), src.indexOf('<header class="hero">') + 400);
  assert.match(hero, /demoBannerHtml/, "it renders inside the hero, which is the first thing on screen and on paper");
});

test("2013 the publisher resolves it from the roster, so a REPUBLISH picks it up", () => {
  // Criterion 5, and the reason it departs from the frozen-sidecar rule beside it: every report already
  // in a pool has a sidecar with no marker, because the marker did not exist when it was written. A
  // sidecar-only read would mark nothing that already exists — which is every demo report in the world
  // right now.
  // MOVED THE RESOLUTION, and did not change this property. It lived inline in the
  // clearance publisher; the knockout publisher never asked the question at all and shipped an unmarked
  // demo report as a result. It is now `driver/publish/demo-marking.mjs`, imported by both — so this arm
  // reads it where it lives, and in doing so covers EVERY publisher rather than the one that happened to
  // have the code. The assertions below are the same three facts, not weaker ones.
  const resolver = readFileSync(join(ROOT, "driver", "publish", "demo-marking.mjs"), "utf8");
  assert.match(resolver, /loadRoster\(\)\.get\(String\(customerKey\)\)\?\.demoData === true/,
    "the roster is consulted, so re-publishing an existing run under a marked account marks it");
  assert.match(resolver, /fp\?\.demoData === true/,
    "and a frozen sidecar that carries the marker still marks — either source marks, neither un-marks");

  // …AND THE CLEARANCE PUBLISHER STILL ASKS. A resolver nobody calls marks nothing, which is exactly how
  // the knockout side failed: the banner existed and was correct, and one renderer never asked for it.
  const src = readFileSync(join(ROOT, "driver", "publish", "index.mjs"), "utf8");
  assert.match(src, /resolveDemoData\(\{ runDir, customerKey \}\)/,
    "the clearance publisher asks the shared resolver");
  assert.match(src, /renderHtml\(parsed, findings, coverage, \{ demoData,/,
    "and it reaches the renderer through the opts the publisher already builds, not a new parameter "
    + "threaded through the call chain");
});
