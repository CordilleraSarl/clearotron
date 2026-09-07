// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Guards the shared brand module (shared/brand.mjs): the locked Cordillera palette must be the SINGLE
// source of truth across surfaces. Asserts the report :root and the warm (index + staff) :root agree on
// every shared brand colour, carry no legacy blue-skin tokens, and that the report actually renders branded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PALETTE, FONT_LINK, WARM_ROOT, REPORT_ROOT,
  WARM_ROOT_DARK, WARM_ROOT_DARK_EXPLICIT, REPORT_ROOT_DARK, REPORT_ROOT_DARK_EXPLICIT,
  THEME_INIT, THEME_INIT_EXPLICIT, themeButton, THEME_BTN_CSS,
} from "../../shared/brand.mjs";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";

const BLUE_SKIN = /#3b4fd6|#11132a|#f5f6f9|#1a1a2e/i;
const tokens = (root) => {
  const body = root.match(/:root\s*\{([\s\S]*?)\}/)[1];
  const m = {};
  for (const pair of body.split(";")) {
    const s = pair.trim(); if (!s) continue;
    const i = s.indexOf(":");
    m[s.slice(0, i).trim()] = s.slice(i + 1).trim().toLowerCase();
  }
  return m;
};

test("the shared palette is the only strong-accent crimson and carries no blue skin", () => {
  assert.equal(PALETTE.crimson.toLowerCase(), "#860f09");
  assert.equal(PALETTE.cream.toLowerCase(), "#f5f0e8");
  assert.equal(PALETTE.ink.toLowerCase(), "#250902");
  assert.doesNotMatch(WARM_ROOT, BLUE_SKIN);
  assert.doesNotMatch(REPORT_ROOT, BLUE_SKIN);
  assert.match(FONT_LINK, /api\.fontshare\.com.*satoshi/i);
});

test("report and warm :root agree on every shared brand colour", () => {
  const r = tokens(REPORT_ROOT), w = tokens(WARM_ROOT);
  const p = (h) => h.toLowerCase();
  // shared brand colours, mapped to each surface's own token names
  assert.equal(r["--bg"], p(PALETTE.cream));        assert.equal(w["--bg"], p(PALETTE.cream));
  assert.equal(r["--ink"], p(PALETTE.ink));         assert.equal(w["--ink"], p(PALETTE.ink));
  assert.equal(r["--crimson"], p(PALETTE.crimson)); assert.equal(w["--crimson"], p(PALETTE.crimson));
  assert.equal(r["--maroon"], p(PALETTE.crimsonDeep));       // report name
  assert.equal(w["--crimson-deep"], p(PALETTE.crimsonDeep)); // warm name
  assert.equal(r["--rose"], p(PALETTE.crimsonMid));
  assert.equal(w["--crimson-mid"], p(PALETTE.crimsonMid));
  // warm health states come from the palette
  assert.equal(w["--h-green"], p(PALETTE.sage));
  assert.equal(w["--h-amber"], p(PALETTE.ochre));
  assert.equal(w["--h-grey"], p(PALETTE.warmGrey));
  // The risk ramp is NOT the palette. It aliased it until the 2026-07-19 portal recolor (--high was
  // #860F09 == --accent, so a High risk dot was pixel-identical to the primary button). The band family
  // is now independent, and this assertion exists to stop it drifting back.
  assert.notEqual(r["--high"], p(PALETTE.crimson), "--high must stay distinct from the accent");
  assert.notEqual(r["--severe"], p(PALETTE.crimsonDeep), "--severe must stay distinct from deep crimson");
});

// The ramp is a product decision (the designer's five hexes, owner-approved 2026-07-19), so it is pinned
// by value in both themes. Changing one of these is changing what a risk band LOOKS like on a delivered
// report — it should require editing this test, deliberately.
test("risk ramp: the designer's five bands, light and dark, in gauge order", () => {
  const r = tokens(REPORT_ROOT);
  assert.deepEqual(
    ["--clear", "--low", "--med", "--high", "--severe"].map((k) => r[k]),
    ["#5f8a64", "#8a9440", "#c8871b", "#b23a2e", "#7c1e15"],
  );
  assert.deepEqual(
    ["--clear-soft", "--clear-tx", "--med-soft", "--med-tx", "--high-soft", "--high-tx"].map((k) => r[k]),
    ["#e0e8e1", "#38553b", "#f4e8d4", "#82550a", "#f1dad8", "#742018"],
  );
  // Dark is the same family lifted for the dark page, NOT the light hexes reused. The lift is what makes
  // the last stop visible on the dark ramp — the property the previous dark --severe:#7a0c16 existed for.
  const dark = REPORT_ROOT_DARK.slice(REPORT_ROOT_DARK.indexOf('[data-theme="dark"]'));
  for (const [tok, hex] of [
    ["--clear", "#7EA382"], ["--low", "#A8B25A"], ["--med", "#DDA13E"],
    ["--high", "#CA594E"], ["--severe", "#A22D22"],
  ]) {
    assert.match(dark, new RegExp(`${tok}:${hex}`, "i"), `dark ${tok} is the lifted band, not the light hex`);
    assert.ok(!dark.includes(`${tok}:${r[tok]};`), `dark ${tok} must not reuse the light hex`);
  }
});

// The band ramp lives in TWO places: these tokens, and hexes hardcoded into render.mjs's quadrant panel
// (which stays a fixed LIGHT surface in dark mode, so it cannot use var(--med)/var(--clear)) plus the
// gauge marker's DECIMAL rgba() glow in report.css. A brand-only recolor ships a report whose scatter
// markers disagree with its own gauge. This test is the tripwire.
test("the ramp's out-of-band duplicates track the tokens", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const at = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  const r = tokens(REPORT_ROOT);
  const render = at("../publish/render.mjs"), css = at("../publish/templates/report.css");

  for (const tok of ["--med", "--clear"]) {
    const hex = r[tok];
    assert.ok(
      new RegExp(hex, "i").test(render),
      `render.mjs hardcodes ${tok} for the quadrant markers/legend/key badges — it still carries the OLD hex`,
    );
  }
  const [mr, mg, mb] = [1, 3, 5].map((i) => parseInt(r["--med"].slice(i, i + 2), 16));
  assert.match(css, new RegExp(`rgba\\(${mr}, ?${mg}, ?${mb},`), "the gauge marker glow is --med in decimal");

  // and the retired hexes are gone from both
  for (const old of ["#C2851A", "#4F7A55", "#7E8A38"]) {
    assert.ok(!new RegExp(old, "i").test(render), `render.mjs still carries retired band hex ${old}`);
    assert.ok(!new RegExp(old, "i").test(css), `report.css still carries retired band hex ${old}`);
  }
});

// ── dark theme (PR 4) ────────────────────────────────────────────────────────────────────────────────

test("dark exports: explicit [data-theme=dark] block, crimson kept for fills, no blue skin, lightened text only in dark", () => {
  for (const dark of [WARM_ROOT_DARK, WARM_ROOT_DARK_EXPLICIT, REPORT_ROOT_DARK, REPORT_ROOT_DARK_EXPLICIT]) {
    assert.match(dark, /:root\[data-theme="dark"\]\{/);
    assert.match(dark, /--crimson:#860F09/i, "crimson stays the RED-risk / badge FILL in dark");
    assert.match(dark, /--bg:#0f0e0c/i);
    assert.match(dark, /--ink:#f0e8d8/i);
    assert.doesNotMatch(dark, BLUE_SKIN);
    assert.match(dark, /#e0736b/i, "lightened crimson for TEXT uses lives inside the dark block");
  }
  // the light exports carry NO dark machinery and NO lightened crimson (dark-only recolor)
  for (const light of [WARM_ROOT, REPORT_ROOT]) {
    assert.doesNotMatch(light, /data-theme/);
    assert.doesNotMatch(light, /#e0736b/i);
    assert.doesNotMatch(light, /prefers-color-scheme/);
  }
});

test("dark gating: staff variants carry the @media auto-dark branch; explicit (client) variants carry NONE", () => {
  for (const staff of [WARM_ROOT_DARK, REPORT_ROOT_DARK]) {
    assert.match(staff, /@media \(prefers-color-scheme:dark\)/);
    assert.match(staff, /:root:not\(\[data-theme="light"\]\)/, "explicit light must beat OS dark");
  }
  for (const explicit of [WARM_ROOT_DARK_EXPLICIT, REPORT_ROOT_DARK_EXPLICIT])
    assert.doesNotMatch(explicit, /prefers-color-scheme/, "client surfaces must never auto-dark");
});

test("report dark block: sticky-header glass override + the quadrant SVG panel pinned to a light surface with dark legend text", () => {
  for (const dark of [REPORT_ROOT_DARK, REPORT_ROOT_DARK_EXPLICIT]) {
    assert.match(dark, /\.rep-stickyhead\{background:rgba\(15,14,12,\.82\)\}/);
    assert.match(dark, /\.panel\.land\{background:#FFFDF9\}/i);
    assert.match(dark, /\.panel\.land \.legend[\s\S]*?\{color:#250902\}/i);
  }
});

test("THEME_INIT: pre-paint localStorage read + .theme-toggle handler; the explicit variant never mentions the OS scheme", () => {
  for (const init of [THEME_INIT, THEME_INIT_EXPLICIT]) {
    assert.match(init, /^<script>/);
    assert.match(init, /localStorage\.getItem\('cordillera-theme'\)/);
    assert.match(init, /\.theme-toggle/);
    assert.match(init, /localStorage\.setItem\('cordillera-theme'/);
  }
  assert.match(THEME_INIT, /prefers-color-scheme/, "staff init flips away from the OS look on first press");
  assert.doesNotMatch(THEME_INIT_EXPLICIT, /prefers-color-scheme/, "client init: unset = light, first press = dark");
});

test("themeButton + THEME_BTN_CSS: toggle markup and its nav styling", () => {
  assert.match(themeButton(), /^<button type="button" class="theme-toggle" aria-pressed="false"/);
  assert.match(themeButton("tt-page"), /class="theme-toggle tt-page"/);
  assert.match(THEME_BTN_CSS, /\.theme-toggle\{/);
  assert.match(THEME_BTN_CSS, /\.theme-toggle\.tt-page\{/);
  assert.doesNotMatch(THEME_BTN_CSS, BLUE_SKIN);
});

test("a rendered report carries the brand :root + Satoshi and no blue skin", () => {
  const dir = mkdtempSync(join(tmpdir(), "brand-render-"));
  const path = join(dir, "f.report.md");
  writeFileSync(path, "---\ntype: prelim-clearance\nmatter: b1\ntitle: BRAND CHECK\noverall_label: LOW\noverall_badge: l2\nrun: 2026-06-14\n---\n# Summary\nx\n");
  try {
    const html = renderHtml(parseReport(path), [], [], { runId: "b1" });
    assert.match(html, /--crimson:#860F09/i);
    assert.match(html, /api\.fontshare\.com.*satoshi/i);
    assert.doesNotMatch(html, BLUE_SKIN);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});