// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY SURFACE DRAWS A BAND FROM THE REPORT'S RAMP. The report and the portal coloured a band on one five-stop
// ramp; the emails used an Office traffic light ("minimal" in blue), the staff index used health colours (High
// and Medium both amber), and the workbook's coverage states used Office fills. They now read one source,
// shared/brand.mjs's BAND_RAMP and the values beside it (2026-11-18). These tests hold each surface to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BAND_BY_TONE, BAND_RAMP, BAND_RAMP_DARK, BAND_ON, BAND_ON_DARK, BAND_TEXT, BAND_SOFT, WORKBOOK_COLOURS,
  REPORT_ROOT, REPORT_ROOT_DARK, WARM_ROOT, WARM_ROOT_DARK,
} from "../../shared/brand.mjs";
import { TONE_TIER, regenIndex } from "../publish/index.mjs";
import { bandTier } from "../publish/knockout.mjs";

const TONES = ["minimal", "low", "medium", "high", "severe"];
const lum = (hex) => {
  const c = hex.replace("#", "").padEnd(6, hex.slice(-1)).match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test("the report's own tokens are the ramp, light and dark", () => {
  for (const [stop, hex] of Object.entries(BAND_RAMP)) assert.ok(REPORT_ROOT.includes(`--${stop}:${hex};`), `REPORT_ROOT --${stop}`);
  for (const [stop, hex] of Object.entries(BAND_RAMP_DARK)) assert.ok(REPORT_ROOT_DARK.includes(`--${stop}:${hex};`), `REPORT_ROOT_DARK --${stop}`);
});

test("an email colours each tone's band from the ramp, and its word reads on white", () => {
  for (const tone of TONES) {
    const stop = BAND_BY_TONE[tone];
    assert.deepEqual({ bg: TONE_TIER[tone].bg, fg: TONE_TIER[tone].fg, txt: TONE_TIER[tone].txt },
      { bg: BAND_RAMP[stop], fg: BAND_ON[stop], txt: BAND_TEXT[stop] }, tone);
    assert.ok(contrast(BAND_TEXT[stop], "#FFFFFF") >= 4.5, `${tone}'s word reads ${contrast(BAND_TEXT[stop], "#FFFFFF").toFixed(2)}:1 on white`);
  }
  // The Knockout email resolves a band through the run's own ladder; "minimal" is no longer blue.
  const framework = { bands: [{ label: "Low", tone: "minimal" }, { label: "Very High", tone: "severe" }] };
  assert.equal(bandTier(framework, "Low").txt, BAND_TEXT.clear);
  assert.equal(bandTier(framework, "Very High").txt, BAND_TEXT.severe);
});

test("the staff index's pills carry the ramp and its on-colours, light and dark", () => {
  for (const stop of Object.keys(BAND_RAMP)) {
    assert.ok(WARM_ROOT.includes(`--${stop}:${BAND_RAMP[stop]};--${stop}-on:${BAND_ON[stop]}`), `WARM_ROOT --${stop}`);
    assert.ok(WARM_ROOT_DARK.includes(`--${stop}:${BAND_RAMP_DARK[stop]};--${stop}-on:${BAND_ON_DARK[stop]}`), `WARM_ROOT_DARK --${stop}`);
  }
});

test("an index row takes its band's stop from the run's own ladder, and an older row its badge's step", () => {
  const pool = mkdtempSync(join(tmpdir(), "ramp-index-"));
  try {
    const run = (id, meta) => { mkdirSync(join(pool, id)); writeFileSync(join(pool, id, "meta.json"), JSON.stringify({ runId: id, matter: "QZXV", title: "QZXV", client: "Invented", date: "2026-06-15", codename: id, ...meta })); };
    const ladder = { bands: [{ label: "Very High", tone: "severe" }, { label: "High", tone: "high" }, { label: "Low", tone: "minimal" }] };
    run("tmp1-severe", { overall: "Very High", badge: "l4", framework: ladder });
    run("tmp2-high", { overall: "High", badge: "l4", framework: ladder });
    run("tmp3-minimal", { overall: "Low", badge: "l2", framework: ladder });
    run("tmp4-old", { overall: "HIGH", badge: "l4" });
    regenIndex(pool);
    const html = readFileSync(join(pool, "index.html"), "utf8");
    const pill = (word) => html.match(new RegExp(`<span class="b (b-[a-z0-9]+)">${word}</span>`))?.[1];
    assert.equal(pill("Very High"), "b-severe", "a Very High run and a High run looked the same");
    assert.equal(pill("High"), "b-high");
    assert.equal(pill("Low"), "b-clear", "a minimal-tone band did not take the clear stop");
    assert.equal(pill("HIGH"), "b-l4", "a run with no recorded ladder lost its badge");
    assert.match(html, /\.b-high,\.b-l4\{background:var\(--high\);color:var\(--high-on\)\}/, "the old badge's step is not drawn on the ramp");
  } finally { rmSync(pool, { recursive: true, force: true }); }
});

test("the workbook's coverage states take the report's soft fills", () => {
  assert.equal(WORKBOOK_COLOURS.stateClean, BAND_SOFT.clear.slice(1));
  assert.equal(WORKBOOK_COLOURS.stateLimited, BAND_SOFT.med.slice(1));
  assert.equal(WORKBOOK_COLOURS.stateOpen, BAND_SOFT.med.slice(1));
});
