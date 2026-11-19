// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// BAND PILLS AND GREY LABELS PASS CONTRAST, in both themes and in print.
//
// A band pill printed white on every band: 3.03:1 on Medium, 3.29 on Low and 3.96 on Clear, where 4.5 is needed for
// text of its size. Every grey label was --faint, at 2.66 to 3.22. Each band now names its own text colour
// (--clear-on … --severe-on), every pill on both report pages takes the colour of the band it sits on, and grey text
// is --slate. The ratios are WCAG 2.x relative luminance over the tokens as shipped; dark High clears 4.5 by 0.01, so
// a change to the ramp fails here before it reaches a page. The Knockout framework and names are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPORT_ROOT, REPORT_ROOT_DARK_EXPLICIT } from "../../shared/brand.mjs";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { parseFindingsJson } from "../findings-model.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const AA = 4.5;
const BANDS = ["clear", "low", "med", "high", "severe"];

const tokens = (css) => Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map((m) => [m[1], m[2]]));
const LIGHT = tokens(REPORT_ROOT);
const DARK = { ...LIGHT, ...tokens(REPORT_ROOT_DARK_EXPLICIT) };
const hex6 = (h) => (h.length === 4 ? `#${[...h.slice(1)].map((c) => c + c).join("")}` : h);
const lum = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex6(h).slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("each band's text colour reads at 4.5:1 on its band, in light, in dark and in print", () => {
  // Print re-asserts the light tokens, so the light pairs are the print pairs.
  for (const [theme, t] of [["light", LIGHT], ["dark", DARK]]) {
    for (const b of BANDS) {
      assert.ok(t[b] && t[`${b}-on`], `${theme}: --${b} or --${b}-on is missing`);
      const r = ratio(t[`${b}-on`], t[b]);
      assert.ok(r >= AA, `${theme}: --${b}-on ${t[`${b}-on`]} on --${b} ${t[b]} is ${r.toFixed(2)}:1`);
    }
  }
});

test("grey text reads at 4.5:1 on the page, the second ground, a card and print white", () => {
  for (const [theme, t] of [["light", LIGHT], ["dark", DARK]]) {
    for (const ground of ["bg", "bg2", "card"]) {
      const r = ratio(t.slate, t[ground]);
      assert.ok(r >= AA, `${theme}: --slate on --${ground} is ${r.toFixed(2)}:1`);
    }
  }
  assert.ok(ratio(LIGHT.slate, "#ffffff") >= AA, "--slate on print white");
});

test("no stylesheet or renderer sets text in --faint, and no band pill keeps white text", () => {
  const read = (p) => readFileSync(join(HERE, "..", "publish", p), "utf8");
  for (const p of ["templates/report.css", "templates/knockout.css", "render.mjs", "render-knockout.mjs"]) {
    assert.doesNotMatch(read(p), /(^|[;{\s"])color:\s*var\(--faint\b/m, `${p} still sets text in --faint`);
  }
  for (const [p, sel] of [["templates/report.css", ".tb-risk{"], ["templates/report.css", ".marker .pill{"], ["templates/knockout.css", ".ko-band{"],
    ["templates/knockout.css", ".ko-findband{"], ["templates/knockout.css", ".kpill{"]]) {
    const css = read(p), at = css.indexOf(sel);
    assert.ok(at >= 0, `${p}: ${sel} is gone`);
    assert.doesNotMatch(css.slice(at, css.indexOf("}", at)), /color:#fff/, `${p}: ${sel} still prints white`);
  }
});

// Every pill a page draws on a band names that band's text colour beside its background.
const PILL = /class="(pill|tb-risk|ko-band|ko-findband|kpill)" style="background:var\((--[\w-]+)\)(;color:var\((--[\w-]+)\))?"/g;
const everyPillTakesItsBandsText = (html, name) => {
  const pills = [...html.matchAll(PILL)];
  assert.ok(pills.length >= 2, `${name}: the page draws band pills`);
  for (const [, cls, bg, , fg] of pills) assert.equal(fg, `${bg}-on`, `${name}: a .${cls} on ${bg} has text ${fg ?? "unset"}`);
  return new Set(pills.map((m) => m[1]));
};

test("on a clearance page, the headline pill and the top bar's take their band's text", () => {
  const run = join(HERE, "..", "..", "demo", "multi-country-focus-search", "run");
  const v = parseFindingsJson(readFileSync(join(run, "findings.json"), "utf8"));
  const html = renderHtml(parseReport(join(run, "report.md")), v.findings, v.coverage,
    { runId: "demo", contextNotes: v.contextNotes || [], markAssessment: v.markAssessment });
  const kinds = everyPillTakesItsBandsText(html, "clearance");
  assert.ok(kinds.has("pill") && kinds.has("tb-risk"), `clearance: drew ${[...kinds]}`);
});

test("on a Knockout page, the band chip, the finding's chip and the scale's pill take their band's text", () => {
  const MANIFEST = parseFrameworkManifest({
    schema_version: 1, framework_key: "contrast-test", title: "Invented test framework", source_deck: "none", entity_label: "the company",
    bands: [{ label: "Severe", tone: "severe" }, { label: "Serious", tone: "high" }, { label: "Notable", tone: "medium" }, { label: "Slight", tone: "low" }],
    structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
  });
  const html = renderKnockoutHtml({ batch: { overall: "Notable", executiveSummary: "summary" },
    marks: [{ name: "TARNELLO", rating: "Notable", classesSearched: [9], classesDriving: [9], basis: "Close to a known property.",
      factors: ["An observation."], counterFactors: ["What holds it."], mitigation: "", bullets: ["A bullet."], purpleNotes: [],
      findings: [{ ordinal: 1, name: "TARNELLO LABS", owner: "Tarnello Srl", band: "Serious", type: "Active Business",
        net: "Tarnello Srl's use is likely to block the applicant.", evidence: ["https://example.invalid/shop/tarnello"], basis: "Retail listings." }] }],
  }, MANIFEST, { runId: "r1", overall: "Notable" });
  const kinds = everyPillTakesItsBandsText(html, "knockout");
  for (const k of ["ko-band", "ko-findband", "kpill"]) assert.ok(kinds.has(k), `knockout: no .${k} drawn (drew ${[...kinds]})`);
});
