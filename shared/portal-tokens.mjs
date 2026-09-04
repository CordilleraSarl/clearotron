// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The bridge between the brand system and the portal's design vocabulary.
//
// The design pack names its colours in semantic terms (`--surface-raised`, `--text-muted`,
// `--accent-wash`). brand.mjs names the same colours in report terms (`--card`, `--slate`). Rather than
// re-typing hexes into a stylesheet — which is how two colour systems start drifting apart — this module
// READS brand.mjs's own token blocks and re-exports them under the portal's names. Change a colour in
// brand.mjs and the portal follows on the next `emit-tokens` run; there is no second source to remember.
//
// 20 of the 25 semantic tokens are exact brand reuse. The five that needed judgement are marked JUDGED
// below, and none of them invents a hue outside the locked palette.
//
// The risk bands are exported separately and keyed by TONE, never by label. Band labels are
// framework-scoped — the house-default ladder has four stops and says "Moderate" where house-triage says
// "Medium" — so a component that keys off a label is a component that mislabels somebody's report.

import { readFileSync } from "node:fs";
import { REPORT_ROOT, REPORT_ROOT_DARK_EXPLICIT, PALETTE } from "./brand.mjs";

// ── reading brand.mjs ────────────────────────────────────────────────────────────────────────────────
// Both blocks are CSS text. Parse rather than import a JS map because the CSS string IS the shipped
// artifact — parsing it means the portal cannot disagree with what a report actually renders.
const parseTokens = (css) => {
  const out = {};
  for (const [, k, v] of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+)/gi)) out[k] = v.trim();
  return out;
};

const LIGHT = parseTokens(REPORT_ROOT);
// The dark block is `[data-theme="dark"]{…}` plus scoped rules; take only the token declarations, which
// all sit in the first block. The EXPLICIT variant is the right one: the portal is a client-facing
// surface and must never auto-dark from the OS.
const DARK = parseTokens(REPORT_ROOT_DARK_EXPLICIT.slice(0, REPORT_ROOT_DARK_EXPLICIT.indexOf("}")));

const need = (map, key, where) => {
  const v = map[key];
  if (!v) throw new Error(`portal-tokens: brand.mjs no longer defines ${key} (${where}) — the bridge is stale`);
  return v;
};

// ── the 25 semantic tokens ───────────────────────────────────────────────────────────────────────────
// Each entry is [portal name, light value, dark value, note]. `note` is emitted as a CSS comment so the
// generated stylesheet explains itself to whoever opens it in devtools.
const semantic = () => {
  const L = (k) => need(LIGHT, k, "light");
  const D = (k) => need(DARK, k, "dark");

  return [
    // surfaces
    ["--surface-page", L("--bg"), D("--bg"), "brand --bg"],
    ["--surface-raised", L("--card"), D("--card"), "brand --card"],
    ["--surface-sunken", L("--bg2"), D("--bg2"), "brand --bg2"],
    // --surface-high is NOT redefined here. brand.mjs ships it (CHROME_CSS) and shared/site-nav.mjs
    // consumes it; redefining it would restyle the floating nav on every report. The design pack uses
    // the name for its popover surface, so that meaning gets its own token:
    ["--surface-float", L("--card"), "#25201b",
      "JUDGED: popover/dropdown/toast. Light has nowhere above --card to go (it is already 99% white), so "
      + "elevation is carried by --shadow-lg + --border-strong; dark reuses brand's lifted --surface-high"],

    // text — brand ships three steps, the design wants four; font-weight carries the fourth
    ["--text-strong", L("--ink"), D("--ink"), "brand --ink"],
    ["--text-body", L("--ink"), D("--ink"),
      "JUDGED: aliases --text-strong. The design's body/strong split is a WEIGHT difference, not a hue one"],
    ["--text-muted", L("--slate"), D("--slate"), "brand --slate"],
    ["--text-faint", L("--faint"), D("--faint"), "brand --faint"],
    ["--text-accent", L("--crimson"), "#e0736b",
      "crimson as TEXT; dark uses the lightened crimson brand.mjs already applies to links in dark"],
    ["--text-on-accent", L("--mark"), L("--mark"),
      "parchment on a crimson fill. The design pack calls this --cord-cream-100 (its bundle's palette "
      + "step); it is brand --mark, and it does not flip with the theme because the fill under it does not"],

    // accent
    ["--accent", L("--crimson"), L("--crimson"), "brand --crimson; a FILL, so it does not lighten in dark"],
    ["--accent-hover", L("--maroon"), L("--maroon"), "brand --maroon (deep crimson)"],
    ["--accent-ink", L("--maroon"), L("--maroon"), "brand --maroon — the oxblood the design calls accent-ink"],
    ["--accent-deep", L("--maroon"), L("--maroon"), "brand --maroon"],
    ["--accent-quiet", L("--rose"), D("--rose"), "brand --rose (mid crimson)"],
    ["--accent-wash", "rgba(134,15,9,.08)", "rgba(134,15,9,.16)",
      "JUDGED: alpha only, never a mixed hex — it layers over both the page and raised surfaces, and a "
      + "flat hex would be wrong on one of them. 134,15,9 is --accent in decimal"],
    ["--accent-gradient",
      `linear-gradient(90deg, ${PALETTE.crimson}, ${PALETTE.crimsonDeep}, ${PALETTE.crimsonMid})`,
      `linear-gradient(90deg, ${PALETTE.crimson}, ${PALETTE.crimsonDeep}, ${PALETTE.crimsonMid})`,
      "JUDGED: composed from the three locked palette crimsons — no new hue"],

    // borders + focus
    ["--border-hairline", L("--line"), D("--line"), "brand --line"],
    ["--border-strong", L("--line2"), D("--line2"), "brand --line2"],
    ["--focus-ring", L("--crimson"), L("--crimson"), "brand --crimson"],

    // type, shadow, motion
    ["--font-body", L("--font"), L("--font"), "brand --font"],
    ["--font-mono", L("--mono"), L("--mono"), "brand --mono"],
    ["--shadow-lg", L("--shadow"), D("--shadow"), "brand --shadow"],
    ["--ease-out", "cubic-bezier(.25,.72,.3,1)", "cubic-bezier(.25,.72,.3,1)",
      "JUDGED: specified by the design pack itself (README:235) — not a colour, no brand source exists"],
  ];
};

// ── risk bands, keyed by TONE ────────────────────────────────────────────────────────────────────────
// The engine's tone vocabulary. brand.mjs names the same five in report terms; this is the only place the
// two vocabularies are allowed to meet.
export const TONES = ["minimal", "low", "medium", "high", "severe"];
const TONE_TO_BRAND = { minimal: "--clear", low: "--low", medium: "--med", high: "--high", severe: "--severe" };
// Only three tones have a soft/text chip pair in the brand system. That is not an oversight to fill in —
// low and severe have never had one, and inventing them here would put two unreviewed colours on a client
// surface. A chip for those tones falls back to the base at reduced alpha.
const TONE_PAIRS = { minimal: "clear", medium: "med", high: "high" };

const bands = () => {
  const rows = [];
  for (const tone of TONES) {
    const b = TONE_TO_BRAND[tone];
    rows.push([`--tone-${tone}`, need(LIGHT, b, "light band"), need(DARK, b, "dark band"), `brand ${b}`]);
  }
  for (const [tone, p] of Object.entries(TONE_PAIRS)) {
    rows.push([`--tone-${tone}-soft`, need(LIGHT, `--${p}-soft`, "light"), need(DARK, `--${p}-soft`, "dark"), `brand --${p}-soft`]);
    rows.push([`--tone-${tone}-tx`, need(LIGHT, `--${p}-tx`, "light"), need(DARK, `--${p}-tx`, "dark"), `brand --${p}-tx`]);
  }
  return rows;
};

/** Every token the portal ships, as [name, light, dark, note] rows. */
export const PORTAL_TOKENS = [...semantic(), ...bands()];

// TONES_WITH_CHIP (Object.keys(TONE_PAIRS)) was DELETED 2026-08-03 with no consumer tree-wide.
// TONE_PAIRS itself is live — it drives the chip rows in bands() above.

// ── emission ─────────────────────────────────────────────────────────────────────────────────────────

const block = (selector, index, rows) =>
  `${selector} {\n` + rows.map((r) => `  ${r[0]}: ${r[index]};${r[3] ? `  /* ${r[3]} */` : ""}`).join("\n") + "\n}\n";

/**
 * The portal's token stylesheet. Dark ships ONLY as `:root[data-theme="dark"]` — never as an
 * `@media (prefers-color-scheme: dark)` block. The rule is that client surfaces must not auto-dark, not
 * that they must not be dark: a visitor who chose dark on a report lands in dark here, because both read
 * the same `cordillera-theme` localStorage key.
 *
 * WHAT THE CI CHECK CAN AND CANNOT. It greps the BUILT BUNDLE. Server-rendered HTML is
 * outside its domain and always was — which is how the portal's own sign-in and refusal pages shipped an
 * OS-preference media query for as long as they existed, under a rule that forbids it, with the check
 * green throughout. They are held now by `driver/test/door-pages-take-their-colours-from-brand.test.mjs`,
 * which asserts over the rendered bytes instead. EVERY server-rendered surface is held now, by
 * `driver/test/no-client-surface-follows-the-os.test.mjs`: it renders each client-facing document and
 * refuses an OS-preference rule, and it walks every module that emits a document so a new renderer is
 * either under that arm or declared non-client with a reason.
 *
 * That widening was not tidiness. While the rule was enforced over the bundle plus two named pages, the
 * CLEARANCE report — the most client-facing artefact this product has — emitted the AUTO dark pair and
 * went dark on a dark-mode laptop, delivered and framed alike. Nothing was looking: this grep reads the
 * built SPA bundle and cannot see a rendered report at all.
 *
 * The rule also needs a mechanism wherever it is applied. A surface that drops the media query and reads
 * nothing is not obeying the doctrine — it is permanently light. On the doors that mechanism is
 * `DOOR_THEME_INIT`; here it is `PRE_PAINT_SCRIPT` below.
 */
export const portalTokensCss = () =>
  "/* GENERATED by shared/tools/emit-tokens.mjs from shared/portal-tokens.mjs — do not edit by hand.\n"
  + "   Values come from shared/brand.mjs. To change a colour, change it there and re-run the tool.\n"
  + "   Dark ships as [data-theme] ONLY — client surfaces must never follow the OS colour preference.\n"
  + "   (That rule is enforced by a CI grep over the BUILT bundle for the OS-preference media feature,\n"
  + "    which is why this comment does not spell the feature's name: the check stays a dumb string\n"
  + "    search that nothing can talk its way past.) */\n\n"
  + block(":root", 1, PORTAL_TOKENS)
  + "\n"
  + block(':root[data-theme="dark"]', 2, PORTAL_TOKENS);

/**
 * The pre-paint theme script, as a classic (non-module) inline script for index.html.
 *
 * It must run before first paint or a user who chose dark gets a white flash. It is inline for that
 * reason, which means the SPA's CSP cannot simply say `script-src 'self'` — the emitter hashes this exact
 * string and portal-service serves `'sha256-…'`, so the one inline script is allowed by identity rather
 * than by opening `'unsafe-inline'` to everything.
 *
 * Deliberately NOT brand.mjs's THEME_INIT: that one also installs a delegated click handler for
 * `.theme-toggle` buttons, which React owns here. This does one thing — apply the saved choice.
 */
export const PRE_PAINT_SCRIPT =
  `(function(){try{var t=localStorage.getItem('cordillera-theme');`
  + `if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

// ── the logo lockup, as data the SPA can render ─────────────────────────────────────────────────────
//
// portal-ui may not use dangerouslySetInnerHTML (portal-ui/test/no-danger.test.ts keeps that class
// closed), so it cannot inline the vendored SVG as a string the way the report renderer does. It needs
// real JSX, which means it needs the path data as values.
//
// GENERATED rather than copied, for the reason every other brand value is: shared/brand/assets is the
// single source, and emit-tokens.mjs --check already fails CI when a generated file drifts from it. A
// hand-copied path would be a second source of truth for the company's own mark, silently diverging the
// first time the site's logo is redrawn.
// THE RIDGE READERS AND `brandArtTs` WERE HERE, and went with the component they fed.
// shared/brand/assets/ridge-mark.svg stays — it is the parent company's mark — but nothing in
// this product renders it, so nothing generates a module from it either.
