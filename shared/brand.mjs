// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// brand.mjs — single source of truth for the locked Cordillera brand palette, shared by every
// internal HTML surface so the colour/font story lives in ONE place:
//   • the clearance report  (templates/report.css, composed in publish/render.mjs)
//   • the pool index        (publish/index.mjs)
//   • the Run status page  (writer retired with the quality subsystem in)
//
// Built on the Cordillera brand package (v3, legacy — the values below are the record): limestone-cream + crimson,
// Satoshi. Crimson is the ONLY strong accent; warm health/risk tones replace traffic-light colours.
// Hex values are canonical here; CSS is case-insensitive, so casing in any rendered :root is irrelevant.
//
// Two ready-made :root blocks are exported because the two surface families use different token names:
//   - WARM_ROOT   → index + Run status (shared, near-identical token set: bg/card/ink/muted/line + crimson
//                   family + warm h-green/h-amber/h-red/h-grey health states)
//   - REPORT_ROOT → the report (richer: 5-stop risk gauge, soft badge bg+text pairs, report neutrals).
// Both draw their shared brand colours from PALETTE, so a brand change is a one-line edit here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));

// ── Tenant brand identity ───────────────────────────────────────────────────────────────────────
// The name/tagline/product stamped into every EMITTED artifact (report HTML title + watermark, pool
// index header, nav brand, Excel metadata, connector instructions). Env-overridable per deployment —
// branding is tenant config, not code. Read once at import (deployment-static, like the systemd env).
//
// CASING: THE VALUE IS PROSE, SO IT IS CAPITALISED (, superseding ruling 2026-08-20). The rule is
// Clearotron in prose and UI, `clearotron` in config values, commands, binary names and identifiers.
// This DEFAULT is prose in every place it lands — report and portal <title>, the pool index header,
// Excel `creator`, the connector steps, "You reached X" — so it takes the capital. The VARIABLE that
// overrides it keeps its own spelling; a name and a knob are not the same kind of string.
//
// THE DEFAULTS ARE THE PRODUCT, NOT A FIRM. They used to be one deployment's firm name and
// tagline, so every installer who set nothing published reports branded with somebody else's practice —
// while TRADEMARKS.md told that same installer the licence grants no rights to the name and that
// deploying under a name that is not yours "is the exact problem it exists to detect". A deployment
// that configures nothing now says only what the software is.
//
// TAGLINE DEFAULTS TO EMPTY, AND EMPTY MEANS ABSENT. There is no neutral tagline — a firm's strapline
// is the one field nothing generic can stand in for — so the honest default is to render no strapline
// at all. Every consumer drops the element on empty rather than emitting a blank one; `logoLockup`
// below is the single place that decision is made for the lockup surfaces.
//
// BOTH SPELLINGS ARE READ HERE, EXPLICITLY, and the duplication is the point rather than an
// oversight. Every other renamed variable gets its CLEAROTRON_* spelling for free, because
// `warnRetiredEnv()` copies the new name onto the old one before anything looks and every other reader
// looks later — inside a function, on demand. THIS module reads `process.env` at IMPORT time, and an ES
// module graph evaluates a dependency's body before the importing module's body runs. So whether the
// translation had happened yet depended on HOW each entry applied it, which was measured, not assumed:
//
//   · `runner.mjs` and `pipeline.mjs` open with `import "../shared/env-local.mjs"`, whose own body ends
//     in `warnRetiredEnv()`. A side-effecting import placed FIRST runs first — these worked.
//   · `portal-service.mjs` must never read a repo `.env`, so it is deliberately off CLI_ENTRIES and
//     takes a NAMED import of `applyEnvAliases`, calling it in its own body — which runs AFTER this
//     module is already evaluated. There, `CLEAROTRON_BRAND_NAME` reached nothing: the report carried
//     the operator's name and the portal carried the default. A variable that brands one surface and
//     not another is worse than one that brands neither, because it reads as configured.
//
// REJECTED, WHEN THERE WAS A PAIR TO RESOLVE: routing the two spellings through the alias table's own
// resolver, which would have left no second copy. deleted the pair, so the choice is moot and
// the reasoning is kept only because the property it protects is not. It reads the name as a STRING LITERAL rather than as `process.env.NAME`, and
// `env-audit`'s READ_RE — the evidence behind ADR-0002's rule that every name shipping code reads must
// declare an effect class — matches only the `env`-adjacent forms. All three names would have gone
// INVISIBLE to that audit: off the backlog by disappearing rather than by being answered, which is the
// failure -12's own message names ("an exemption for a name that does not exist exempts nothing
// and hides how big the real backlog is"). The accessor family is filed as and is a gap the audit
// deliberately does not grow. ADR-0004 dislikes the second copy; ADR-0002 has a mechanism, so it wins.
// These are three 1:1 pairs in the one file that must be edited anyway when the old spelling is
// deleted, so there is no mapping here that can drift out from under the table.
//
// DO NOT "SIMPLIFY" EITHER HALF AWAY. Dropping the CLEAROTRON_ name un-renames the variable; dropping
// the CLEAROTRON_ name closes the compat window early and breaks every install that has not migrated.
export const BRAND = {
  name: process.env.CLEAROTRON_BRAND_NAME || "Clearotron",
  tagline: process.env.CLEAROTRON_BRAND_TAGLINE || "",
  product: process.env.CLEAROTRON_BRAND_PRODUCT || "Trademark clearance",
};

/**
 * THE CONFIDENTIALITY POSTURE ON A DELIVERED DOCUMENT — one rule, both report templates.
 *
 * It lives here because the alternative is what the issue is about. render.mjs printed the extended
 * marking only when a profile asked; render-knockout.mjs printed the short one unconditionally, in a
 * hand-rolled array join. Two copies of one firm-wide document marking, and they had already drifted on
 * BOTH the wording and the condition. `shared/brand.mjs` is the module both renderers already import and
 * is explicitly NOT frozen (driver/test/render-frozen.test.mjs:16), so the rule has one home and the
 * frozen renderer pays no extra hash for it.
 *
 * TWO STATES SINCE, and the surviving distinction is still the whole point:
 *
 *   privileged === false  → ""            an instruction to leave it OFF; the caller drops the row
 *   absent / null / true  → "Privileged & Confidential"        no opinion ⇒ the plain default
 *
 * ABSENT IS NOT FALSE. The plain confidentiality line claims nothing and is what any legal deliverable
 * carries; collapsing absent into false is precisely the coercion that shipped House-default clearances
 * with no marking at all. That is 's property and it is untouched.
 *
 * `true` USED TO SELECT A LONGER LINE — the plain marking plus a legal characterisation of the document
 * — and the owner dropped that wording on 2026-08-20. It renders as the default here rather than being
 * rejected, because a caller can still hand this function a profile loaded before the fold in
 * driver/profiles.mjs normalizeDelivery ran. Retired at the door, harmless at the renderer.
 *
 * Returns the STRING, entity-escaped, and composes no row. Each template joins it to its own product
 * name with its own `esc` — the knockout's also escapes `"` — and each drops the whole row when the
 * result is empty. That split is deliberate: the RULE is shared because it drifted; the escaping is not,
 * because unifying two `esc`s that differ would move a frozen template's bytes for no reason.
 */
// — ONE MARKING ON EVERY REPORT TYPE. `CONF_PRIVILEGED` carried
// 'Privileged &amp; Confidential · Attorney Work Product' and is deleted: owner's call, 2026-08-20, the
// suffix is dropped everywhere and the plain line is what every report carries.
//
// THE THREE-STATE FIELD BECOMES TWO-STATE, AND THAT IS A DECISION THE ISSUE ASKED FOR RATHER THAN
// ANSWERED. `delivery.privileged` was true = extended marking, false = a deliberate OFF, absent = no
// opinion. With the suffix gone, true and absent produce the SAME string — so a stored `true` claims a
// distinction that no longer exists. The issue offered two readings and I took the second: the field
// RETIRES to on/off, and `true` folds to absent at load (driver/profiles.mjs normalizeDelivery), the
// way that function already folds the retired `email: "table"`.
//
// Not the first reading ("true becomes a no-op") because that leaves a value which validates, is
// stored, and decides nothing — the exact shape deleted a delivery mode for and item 8
// deleted four switches for, both this week, both under ADR-0002.
//
// `false` IS UNTOUCHED and stays meaningful: it is a customer instructing us to strip the marking, and
// exists because collapsing absent into false once shipped House-default clearances with no line
// at all. Absent still means the default, never nothing.
export const CONF_DEFAULT = 'Privileged &amp; Confidential';

export function confPosture(delivery) {
  const p = delivery == null ? null : delivery.privileged;
  return p === false ? '' : CONF_DEFAULT;
}

export const PALETTE = {
  cream:       '#f5f0e8',          // limestone-cream — page background
  ink:         '#250902',          // near-black-warm — body text
  crimson:     '#860F09',          // the one strong accent (links, primary, RED risk)
  crimsonDeep: '#4E030F',          // deep crimson — headers, the home pill (report token: --maroon)
                                   // NOT --severe any more: the risk ramp de-aliased on 2026-07-19
  crimsonMid:  '#AE5B58',          // mid crimson — labels / hover      (report token: --rose)
  cardWarm:    '#fffaf0',          // warm-white card (index + staff pages)
  muted:       '#6b5d50',          // warm muted text (index + staff pages)
  line:        'rgba(37,9,2,.14)', // hairline border (index + staff pages)
  sage:        '#5b7a52',          // warm GREEN health state (--h-green)
  ochre:       '#c08a2e',          // warm AMBER health state (--h-amber)
  warmGrey:    '#9a8c7a',          // warm GREY  health state (--h-grey)
  // — the door pages' non-brand values, named here because they were literals in a page renderer.
  // The error INK is crimsonDeep; it is not repeated as an entry of its own.
  errBg:       '#f4e3e0',          // error panel ground  (the sign-in refusal note)
  errLine:     '#dcc0ba',          // error panel hairline
  codeBg:      'rgba(37,9,2,.06)', // inline <code> ground — ink at 6%
};

// — THE DARK COUNTERPART. Until this landed, every dark value in the product was a literal typed
// into whichever block needed it, and the two server-rendered door pages (sign-in, refusal) had guessed
// their own set — a THIRD ground, #17150f, against the brand pack's #0f0e0c.
//
// The two entries the brand pack fixes are marked; the rest have no pack entry and are the values the
// warm surfaces already shipped, kept as-is. `cream` has no dark twin by name because a dark ground is
// not a cream: the light ground is PALETTE.cream, the dark ground is PALETTE_DARK.ground, and the two
// meet under one CSS token name (--bg on the warm surfaces, --cream on the doors).
export const PALETTE_DARK = {
  ground:     '#0f0e0c',              // brand pack §01 "Dark BG" — near-black. Supersedes the doors' #17150f
  ink:        '#f0e8d8',              // brand pack §01 "Parchment" — dark text / mark. Supersedes #ece5d8
  // The three locked crimsons, lifted for the dark ground. `crimson` itself is NOT here: it is a FILL
  // (badges, the accent) and keeps #860F09 in both schemes. Crimson as TEXT is what needs lifting, and
  // that is `crimsonText` — the value the warm and report dark blocks already applied to links.
  crimsonDeep: '#6a0a13',
  crimsonMid:  '#c47f7a',
  crimsonText: '#e0736b',
  cardWarm:   '#1b1714',              // the raised card on that ground
  muted:      '#a89a86',
  line:       'rgba(240,232,216,.12)',
  lineStrong: '#443c2e',              // buttons and inputs — --line is too faint to read as a control edge
  errBg:      '#33201c',              // error panel, dark
  errLine:    '#5b3229',
  errInk:     '#e8b6ab',              // crimson is a FILL in dark; error TEXT lightens instead
  codeBg:     'rgba(236,229,216,.08)',// parchment at 8%
};

// Satoshi via Fontshare. Used by index + staff pages (the report head loads its own weights incl. 900 inline).
export const FONT_LINK = `<link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap" rel="stylesheet">`;

// The canonical Cordillera ridge mark — the exact path from the v3 brand package (legacy; this constant IS the record now),
// — THE RIDGE IS GONE FROM EVERY SURFACE THIS PRODUCT RENDERS, and the constants went with it.
// `RIDGE_PATH` + `ridgeMark()` drew the parent company's mountain silhouette in the report topbar and
// the favicon; `WATERMARK_SVG`/`WATERMARK_URI` masked the same shape behind every report and the pool
// index. Owner's call, 2026-08-20: the mark is the bracket, and the watermark is REMOVED rather than
// redrawn. Deleted rather than left exported — an unread export is a shape somebody re-adopts.
//
// This reverses half of deliberately: `ba233a79` landed the bracket header AND the ridge favicon
// in one commit, so nothing here was half-applied. The ridge assets under brand/ stay on disk; they are
// the parent company's mark and this product simply stops rendering it.

// ── — THE BRACKET, AND WHY ITS GEOMETRY IS A CONSTANT HERE ─────────────────────────────────
//
// The product is Clearotron and the mark is the bracket. It already existed, ONCE, as JSX rectangles in
// `portal-ui/src/components/Logo.tsx` — six rects transcribed from the launch site's asset, plus the
// enclosed block that takes the accent. This module needs the same shape for the favicon and the
// lockup, so the shape is now written down as data and both surfaces read it.
//
// A SECOND TRANSCRIPTION WOULD HAVE BEEN THE DEFECT. Logo.tsx claims the geometry "is asserted against
// [the site asset] — see Logo.test.tsx". That file has never existed at any commit (`git log --all
// --diff-filter=AD -- '*Logo.test*'` is empty) and `lockup.test.ts` binds the TYPE, not the shape. So
// the one copy was guarded by nothing, and adding a second unguarded copy would have doubled a defect
// instead of fixing it. `driver/test/one-bracket-geometry.test.mjs` now binds the two.
//
// Not an asset file: the shape is six rectangles, and `_asset()` reads the ridge SVGs whose paths are
// thousands of characters. Six rects as data cost less than a file plus a reader.
export const BRACKET_VIEWBOX = '0 0 24 24';
export const BRACKET_RECTS = Object.freeze([
  { x: 2, y: 2.6, width: 2, height: 18.8 },        // left bracket: stem
  { x: 2, y: 2.6, width: 5.6, height: 2 },         //               top arm
  { x: 2, y: 19.4, width: 5.6, height: 2 },        //               bottom arm
  { x: 20, y: 2.6, width: 2, height: 18.8 },       // right bracket: stem
  { x: 16.4, y: 2.6, width: 5.6, height: 2 },      //                top arm
  { x: 16.4, y: 19.4, width: 5.6, height: 2 },     //                bottom arm
]);
/** The enclosed block — the ONE part that takes the accent, exactly as the site draws it. */
export const BRACKET_BLOCK = Object.freeze({ x: 10, y: 7.6, width: 4, height: 8.8 });

const rects = (fill, accent) =>
  BRACKET_RECTS.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${fill}"/>`).join('')
  + `<rect x="${BRACKET_BLOCK.x}" y="${BRACKET_BLOCK.y}" width="${BRACKET_BLOCK.width}" height="${BRACKET_BLOCK.height}" fill="${accent}"/>`;

// Inline SVG mark at a given pixel size + fill. Used beside the wordmark in the site nav
// (parchment on the crimson bar) and the report topbar. aria-hidden — the adjacent wordmark is the label.
// `fill` colours the brackets; the enclosed block always takes the accent, which is what makes the mark
// read at 20px (the site ships two colourways and swaps by theme; one token does the same job here).
export const bracketMark = (px = 20, fill = '#f0e8d8', accent = PALETTE.crimson) =>
  `<svg class="bracket" width="${px}" height="${px}" viewBox="${BRACKET_VIEWBOX}" aria-hidden="true" focusable="false" style="flex:none">${rects(fill, accent)}</svg>`;

// Favicon: the bracket as a self-contained data-URI (no external asset, no Caddy route). URL-encoded so
// the reserved chars (#, <, >, quotes) are safe in every browser. Injected into each page <head>.
// CONCRETE COLOURS, not currentColor: a favicon has no CSS context to inherit from.
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BRACKET_VIEWBOX}">${rects(PALETTE.ink, PALETTE.crimson)}</svg>`;
export const FAVICON_LINK = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}">`;

const P = PALETTE;
const D = PALETTE_DARK;

// :root for the two warm-palette surfaces (pool index + Run status). Superset that satisfies both:
// the index references --crimson directly (so --accent/--h-red are inert extras for it); status uses them.
// Identical to the previous staff-page :root; the index gains two harmless unused vars.
export const WARM_ROOT =
  `:root{--bg:${P.cream};--card:${P.cardWarm};--ink:${P.ink};--muted:${P.muted};--line:${P.line};` +
  `--crimson:${P.crimson};--crimson-deep:${P.crimsonDeep};--crimson-mid:${P.crimsonMid};--accent:${P.crimson};` +
  `--h-green:${P.sage};--h-amber:${P.ochre};--h-red:${P.crimson};--h-grey:${P.warmGrey}}`;

// :root for the clearance report (templates/report.css). Shared brand colours come from PALETTE;
// report-specific values (risk scale, soft pairs, neutrals, shadow, mono) are literals. Kept in
// token-name + order parity with the previous report.css :root so the rendered <style> is equivalent
// (modulo hex case, which CSS ignores). The risk ramp used to alias the palette (--high == crimson,
// --severe == crimson-deep); since the 2026-07-19 recolor it is an independent five-hex band family.
export const REPORT_ROOT =
  `:root{` +
  `--bg:${P.cream}; --bg2:#EFE7DA; --card:#FFFDF9; --ink:${P.ink}; --slate:#6B5D52; --faint:#9A8C7E;` +
  `--line:#E4DACA; --line2:#D8CCB8;` +
  `--crimson:${P.crimson}; --maroon:${P.crimsonDeep}; --rose:${P.crimsonMid}; --rose2:#B36866; --tan:#C8B89A; --mark:#F0E8D8;` +
  `--crimson-deep:${P.crimsonDeep}; --crimson-mid:${P.crimsonMid};` +   // canonical names the shared site-nav (NAV_CSS) binds to — same values as --maroon/--rose, aliased so the floating nav renders on the report surface too

  // Risk ramp — the designer's ramp from the portal redesign. It is a BAND family
  // of its own: --high is deliberately NOT --accent any more (the shipped --high was byte-identical to
  // #860F09, so a High risk dot read as a Start button and needed a ring workaround). --accent /
  // --crimson / --maroon above are untouched. The gauge's stop order is clear→low→med→high→severe.
  `--clear:#5F8A64; --low:#8A9440; --med:#C8871B; --high:#B23A2E; --severe:#7C1E15;` +
  // Soft/text pairs: re-derived from the five bases by the rule in shared/tools/derive-band-pairs.mjs (same
  // hue, soft at L .895 / S×.78, text at L .275 / S×1.12). Every pair clears WCAG AA on its own chip.
  `--med-soft:#F4E8D4; --med-tx:#82550A; --clear-soft:#E0E8E1; --clear-tx:#38553B; --high-soft:#F1DAD8; --high-tx:#742018;` +
  `--taupe:#A99A82;` +
  // The mark-itself disclosure toggles. A DEDICATED token: --crimson has no dark variant, and
  // reusing it left the toggles barely legible on the dark ground.
  `--ma-toggle:#860F09;` +
  `--font:'Satoshi','Helvetica Neue',system-ui,sans-serif;` +
  `--mono:'Fira Code',ui-monospace,monospace;` +
  `--shadow:0 1px 2px rgba(37,9,2,.05), 0 10px 30px rgba(37,9,2,.07);` +
  `}`;

// ══ Dark theme (brand pack §01 dark mode: near-black #0f0e0c + parchment #f0e8d8) ══════════════════════
// The light exports above stay BYTE-IDENTICAL (brand.test's tokens() parses the FIRST `:root{` block and
// the light render must not change). Dark ships as an APPENDED block per surface, in two gatings:
//   • WARM_ROOT_DARK / REPORT_ROOT_DARK          — explicit `[data-theme="dark"]` block PLUS the same rules
//     repeated under `@media (prefers-color-scheme:dark)` scoped `:not([data-theme="light"])` — STAFF
//     surfaces: OS-dark applies for first-time visitors, an explicit choice (localStorage) always wins.
//   • *_EXPLICIT variants                         — the `[data-theme="dark"]` block ONLY, no `@media` —
//     CUSTOMER-facing surfaces (the per-customer index): first view is ALWAYS light; dark only by
//     the visitor's explicit toggle. The @media string must never appear in client output (tests pin this).
// Crimson discipline: `--crimson`/`--h-red` KEEP #860F09 in dark — they are FILLS (badges, the accent)
// where white-on-crimson stays high-contrast. `--high` used to be in that list because it WAS #860F09;
// since the 2026-07-19 ramp recolor it is a band token (#B23A2E) and lightens with the rest of the band
// family. Crimson TEXT uses (links, summaries, the wordmark)
// are recolored to a lightened #e0736b by SCOPED rules inside the dark block only — zero light-side edits.
// Every dark hex avoids the BLUE_SKIN regex /#3b4fd6|#11132a|#f5f6f9|#1a1a2e/i (note #1b1714 ≠ #1a1a2e).
//
// Inside the @media branch, override RULES are prefixed `html:not([data-theme="light"])` (not `:root:not`)
// on purpose: `:root` would add a full class-level of specificity and out-rank sibling base rules like
// `.pips.l3 i:nth-child(-n+3)` that must keep winning over the dark `.pips i` track recolor.
const darkBlock = (tokens, rules, { auto = true } = {}) => {
  const scoped = (prefix) =>
    rules.map(([sel, body]) => sel.split(',').map((s) => `${prefix} ${s.trim()}`).join(',') + `{${body}}`).join('\n');
  let css = `\n:root[data-theme="dark"]{${tokens}}\n` + scoped('[data-theme="dark"]');
  if (auto)
    css += `\n@media (prefers-color-scheme:dark){\n:root:not([data-theme="light"]){${tokens}}\n` + scoped('html:not([data-theme="light"])') + `\n}`;
  return css + '\n';
};

// Warm-surface dark tokens (index / status / profiles). --crimson-deep lifts to #6a0a13 so
// the header/nav/th crimson bar reads off #0f0e0c (the hardcoded #f0e8d8/#d8cbb6 bar text stays legible);
// --crimson-mid lifts to #c47f7a for labels. color-scheme:dark flips UA form controls + scrollbars.
const WARM_DARK_TOKENS =
  `color-scheme:dark;--bg:${D.ground};--card:${D.cardWarm};--ink:${D.ink};--muted:${D.muted};--line:${D.line};` +
  `--crimson:${P.crimson};--crimson-deep:${D.crimsonDeep};--crimson-mid:${D.crimsonMid};--accent:${P.crimson};` +
  `--h-green:#6f9463;--h-amber:#d6a24a;--h-red:${P.crimson};--h-grey:#9a8c7a;--web-glow:rgba(94,7,14,.5);--surface-high:#25201b`;

// Scoped warm-surface overrides — a SUPERSET across the warm pages (like WARM_ROOT itself): crimson-TEXT
// recolors + the hardcoded light-background islands (#fff/#efe6d8/#faf5ec chips, tracks, forms) that would
// go illegible under parchment text. Selectors unused on a given page are inert.
const WARM_DARK_RULES = [
  ['.lockup .lk-mark', `color:${D.crimsonMid}`],
  ['a,.btn,details.drill>summary,details.triagebox>summary,.st-new', `color:${D.crimsonText}`],
  ['.btn:hover', 'background:#241f1a'],
  ['.btn-primary', 'color:#f0e8d8'],
  // staff pages: report-link buttons + the stale-regression amber
  ['.pill,.actbtn', 'background:#2a2620'],
  ['.actbtn:hover', 'background:#332d24'],
  ['.regd.stale .reglab', 'color:#d6a24a'],
  // status page: paused card, progress track, day-row + kind chips
  ['.rcard.paused', 'background:#2a2214'],
  ['.paused-tag', 'color:#d6a24a!important'],
  ['.rcard .bar', 'background:#2a2620'],
  ['.kchip,.recent .dayrow td', 'background:#2a2620'],
  // triage page: the inline triage form + sentiment/skill chips + the overnight card
  ['.tform,.overnight', 'background:#221d17'],
  ['.tform select,.tform input', 'background:#1b1714'],
  ['.kind.pos', 'background:#1e2a1f'],
  ['.kind.neg', 'background:#3a1512;color:#f0a89f'],
  ['.chip.skill,.chip.corpus', 'background:#2a2620'],
];

// Report dark tokens (token-for-token against REPORT_ROOT; --font/--mono unchanged). --crimson keeps
// #860F09 (it is the accent FILL). The risk BANDS are their own family since the 2026-07-19 recolor and
// are free to lighten: each is its light base at +11 lightness (severe +10), saturation ×.92 — the same
// relationship the previous dark ramp used. That relationship is what makes the last stop visible on the
// dark ramp, and it does so better than before: dark --severe reads 2.70:1 on the page (was 1.74) and
// dark --high 4.64:1 (was 1.92). The soft badge PAIRS flip together (dark soft bg + lightened text) so
// every badge stays self-consistent.
const REPORT_DARK_TOKENS =
  `color-scheme:dark;` +
  `--bg:${D.ground};--bg2:#16130f;--card:${D.cardWarm};--ink:${D.ink};--slate:#b7ab99;--faint:#9c8f7e;` +
  `--line:#322c24;--line2:#3d362c;` +
  `--crimson:${P.crimson};--maroon:${D.crimsonDeep};--rose:${D.crimsonMid};--rose2:#cf8681;--tan:#c8b89a;--mark:${D.ink};` +
  `--crimson-deep:${D.crimsonDeep};--crimson-mid:${D.crimsonMid};` +
  `--clear:#7EA382;--low:#A8B25A;--med:#DDA13E;--high:#CA594E;--severe:#A22D22;` +
  `--med-soft:#352915;--med-tx:#E4BF81;--clear-soft:#212922;--clear-tx:#A7BEA9;--high-soft:#311B19;--high-tx:#D8938D;` +
  `--taupe:#8f8570;` +
  `--ma-toggle:#E8A87C;` +
  `--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.55);--web-glow:rgba(94,7,14,.5);--surface-high:#25201b`;

// Report rule overrides — the non-tokenized hardcodes in templates/report.css + rendered markup:
//   .topbar glass bg; the conflict-landscape/quadrant SVG panel STAYS a fixed light surface (its point
//   fills / #6B5D52 axis text / #E4DACA grid are hardcoded in the SVG markup) with its legend text forced
//   dark; the near-white islands (.covcell.warn / .firstUp / .cm-mark / .ccl) flip to dark equivalents.
const REPORT_DARK_RULES = [
  ['.lockup .lk-mark', `color:${D.crimsonMid}`],
  ['a,.wm', `color:${D.crimsonText}`],
  ['.wm .ridge path', `fill:${D.crimsonText}`],
  ['.tbbtn:hover,.util:hover,.tb-back:hover,.theme-toggle.tt-page:hover', `color:${D.crimsonText};border-color:${D.crimsonText}`],
  ['.rep-stickyhead', 'background:rgba(15,14,12,.82)'],
  ['.panel.land', 'background:#FFFDF9'],
  ['.panel.land .legend,.panel.land .legend *', 'color:#250902'],
  ['.covcell.warn', 'background:#2a2418;border-color:#4a3d22'],
  ['.firstUp', 'background:linear-gradient(180deg,#221c15,#2a2214);border-color:#4a3d22'],
  ['.cm-mark', 'background:#3a1512;color:#f0a89f'],
  ['.ccl', 'background:#2a2620'],
  ['.kc.off', 'background:#2a2620;color:#b7ab99'],
  ['.pips i', 'background:#3a332a'],
];

export const WARM_ROOT_DARK = darkBlock(WARM_DARK_TOKENS, WARM_DARK_RULES);
export const WARM_ROOT_DARK_EXPLICIT = darkBlock(WARM_DARK_TOKENS, WARM_DARK_RULES, { auto: false });
export const REPORT_ROOT_DARK = darkBlock(REPORT_DARK_TOKENS, REPORT_DARK_RULES);
export const REPORT_ROOT_DARK_EXPLICIT = darkBlock(REPORT_DARK_TOKENS, REPORT_DARK_RULES, { auto: false });

// ══ — THE DOOR PAGES (sign-in, refusal) ═══════════════════════════════════════════════════════
// A THIRD surface family, for the same reason the first two are separate: it uses its own token names.
// The doors spell the page ground `--cream` where the warm surfaces spell it `--bg`; every other light
// value is byte-identical to WARM_ROOT's, so this is one mechanical rename away from being the warm
// family if brand ever wants them merged.
//
// WHY IT IS A FAMILY AND NOT A PAGE'S BUSINESS. Both doors are server-rendered by driver/portal-service
// and each carried its own copy of this block — including a hand-picked dark set that had drifted from
// the pack (#17150f ground, #ece5d8 text) and error colours with no home at all. Two copies of a palette
// is how the light palettes drifted before PALETTE existed.
//
// THE GATING IS `[data-theme]` ONLY (, correcting what shipped). The portal's doctrine is
// that a CLIENT surface never follows the OS colour preference: first view is always light, and dark
// arrives only from a choice the visitor made themselves. kept the media query on the argument
// that these pages have no toggle, so removing it would leave a first-time visitor no route to dark —
// but that IS the doctrine's intent, not a gap it failed to notice. The route for everyone else is the
// shared `cordillera-theme` key, which is why `DOOR_THEME_INIT` ships with this block and is not
// optional: the two together are the whole mechanism, and either one alone is a regression.
export const DOOR_ROOT =
  `:root{color-scheme:light dark;` +
  `--cream:${P.cream};--ink:${P.ink};--crimson:${P.crimson};--card:${P.cardWarm};--muted:${P.muted};--line:${P.line};` +
  // the control edge (buttons, inputs). In light the hairline is enough; in dark it is not.
  `--line-strong:${P.line};` +
  // the primary button / link-button fill, and the text that sits on it
  `--accent-fill:${P.crimson};--accent-ink:${P.cardWarm};` +
  // crimson as TEXT (links). Lifts in dark; the fill above does not.
  `--link:${P.crimson};` +
  `--err-bg:${P.errBg};--err-line:${P.errLine};--err-ink:${P.crimsonDeep};` +
  `--code-bg:${P.codeBg};` +
  // The doors' own font stack, not brand's: they must render with no bundle and no webfont, so the
  // fallbacks are the platform's rather than Helvetica Neue / Fira Code.
  `--font:"Satoshi",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;` +
  `--mono:ui-monospace,SFMono-Regular,Menlo,monospace}`;

// Same token names, dark values. Nothing here is a scoped rule override: every value the dark scheme
// changes is a token, so a page reads ONE vocabulary and the dark block cannot restyle a selector the
// light block never mentioned.
export const DOOR_ROOT_DARK =
  `:root[data-theme="dark"]{` +
  `--cream:${D.ground};--ink:${D.ink};--card:${D.cardWarm};--muted:${D.muted};--line:${D.line};` +
  `--line-strong:${D.lineStrong};` +
  `--accent-fill:${D.crimsonMid};--accent-ink:${D.ground};` +
  `--link:${D.crimsonText};` +
  `--err-bg:${D.errBg};--err-line:${D.errLine};--err-ink:${D.errInk};` +
  `--code-bg:${D.codeBg}}`;

// Pre-paint theme init — inline in <head> BEFORE the stylesheet so a saved choice applies before first
// paint (no light flash), plus ONE delegated click handler for every .theme-toggle on the page.
// localStorage key `cordillera-theme` is shared by every surface (staff + client) → cross-page persistence.
// osAware=true (staff): with no saved choice the page follows the OS (@media auto-dark), so the first
// toggle press flips AWAY from the OS look. osAware=false (client surfaces, which ship NO @media block —
// the string 'prefers-color-scheme' must not appear in client output): unset means light, first press = dark.
// The apply-saved-choice half, alone. Split out for: the door pages need exactly this and nothing
// else — they ship no toggle, so the handler below would be a listener that can never fire. Split rather
// than re-typed, because a second copy of the storage key and the attribute name is how two surfaces
// start disagreeing about what "dark" is stored as.
const APPLY_SAVED_THEME =
  `var d=document.documentElement;try{var t=localStorage.getItem('cordillera-theme');if(t==='dark'||t==='light')d.setAttribute('data-theme',t);}catch(e){}`;

const themeInit = (osAware) => `<script>(function(){${APPLY_SAVED_THEME}
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.theme-toggle');if(!b)return;
var c=d.getAttribute('data-theme');
var n=c?(c==='dark'?'light':'dark'):(${osAware ? "(window.matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches)?'light':'dark'" : "'dark'"});
d.setAttribute('data-theme',n);try{localStorage.setItem('cordillera-theme',n);}catch(e){}
b.setAttribute('aria-pressed',String(n==='dark'));});})();</script>`;
export const THEME_INIT = themeInit(true);
export const THEME_INIT_EXPLICIT = themeInit(false);

// — the DOORS' pre-paint script. Applies a choice made on any other surface and stops there.
// It must sit in <head> BEFORE the stylesheet or a returning visitor gets a light flash.
//
// WHY THE DOORS NEED THIS AT ALL, stated because deleting it looks harmless: the doors carry no theme
// toggle, so with the media query gone this script is the ONLY thing that can ever put them in dark.
// Ship `DOOR_ROOT_DARK` without it and both pages are permanently light for everyone, including the
// visitor who chose dark on their report a minute earlier — which is the case the shared
// `cordillera-theme` key exists to serve.
export const DOOR_THEME_INIT = `<script>(function(){${APPLY_SAVED_THEME}})();</script>`;

// The toggle button. Default skin matches the crimson nav bar (parchment outline, same idiom as the
// privacy toggle); pass 'tt-page' for light-page chrome (the client report topbar) — var-driven so it
// reads in both themes. aria-pressed is updated by the THEME_INIT click handler.
export const themeButton = (extra = '') =>
  `<button type="button" class="theme-toggle${extra ? ` ${extra}` : ''}" aria-pressed="false" title="Switch light / dark theme"><span class="tt-ic" aria-hidden="true">◐</span><span class="tt-lbl">Theme</span></button>`;

export const THEME_BTN_CSS = `
.theme-toggle{appearance:none;-webkit-appearance:none;cursor:pointer;font:inherit;font-size:12px;font-weight:700;letter-spacing:.02em;display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:8px;border:1px solid rgba(240,232,216,.34);background:rgba(240,232,216,.10);color:#f0e8d8;line-height:1.1;margin-left:6px}
.theme-toggle:hover{background:rgba(240,232,216,.2)}
.theme-toggle .tt-ic{font-size:13px;line-height:1}
header.rep .theme-toggle{float:right;margin-left:12px}
.theme-toggle.tt-page{border:1px solid var(--line2,var(--line));background:var(--card);color:var(--ink);border-radius:30px}
.theme-toggle.tt-page:hover{border-color:var(--crimson);color:var(--crimson);background:var(--card)}
@media (max-width:760px){.theme-toggle .tt-lbl{display:none}}`;

// ══ Website design-system chrome ═══════════════════════════════════════════════════════════════
// Vendored assets live in shared/brand/assets. Inlined so every page stays self-contained (no Caddy
// asset route), consistent with bracketMark()/FAVICON_LINK above.
//
// — `RIDGE_FULL` and the `WATERMARK_*` pair read `ridge-mark.svg` and are DELETED with the mark
// they drew. The lockup takes the bracket; the watermark is removed rather than redrawn. One
// consequence worth recording because it closes a defect rather than merely moving it: that asset
// carries `aria-label="Cordillera"`, and the watermark URL-encoded it into the CHROME_CSS of every
// emitted page — including reports published by deployments with no connection to that firm (
// measured it on the demo pool index, twice on one page). Stripping the label was the fix then;
// removing the watermark removes the surface.
// THE SWISS FLAG IS GONE, and it is 's ruling rather than a new one. The portal's lockup
// dropped it when the product was renamed — portal-ui/src/components/Logo.tsx states the reason and
// portal-ui/test/lockup.test.ts pins its ABSENCE so a well-meaning restore fails there:
//
//     "The company logo and the Swiss flag do not travel: this is an open-source product called
//      Clearotron, not a Swiss firm's internal tool, and the flag said the second thing."
//
// This is the OTHER lockup, and it never got the ruling. Two implementations of one mark — Logo.tsx for
// the portal shell, this one for the report footer and topbar, the pool index and the staff pages — so
// the fix landed on one and the delivered report kept flying a national flag next to whatever name the
// deployment configured. Measured on the demo before this change: the published report carried
// `#DA291C` twice and the pool index once, on an installation that had set nothing.
//
// THE RIDGE ASSETS STAY ON DISK and nothing renders them. That sentence used to read "the ridge mark
// stays, Logo.tsx keeps it exported — it is the favicon and this renderer's mark", and made every
// clause of it false: the favicon is the bracket and so is the report lockup. finished the job and
// deleted the component, the generated module and the generator, because an unread export is a shape
// somebody re-adopts. The assets are the parent company's mark; this product simply stops drawing it.

// The lockup = ridge mark + wordmark (BRAND.name — tenant config, default "Clearotron") + tag —
// the website's project lockup, ported to the tool's tokens so it themes light/dark. mark = px size of
// the ridge; tag = sub-label ('' hides it).
//
// `tag` DEFAULTS TO THE CONFIGURED TAGLINE, not to a literal. It used to default to one firm's
// strapline, which no deployment could configure away because it was an argument default rather than a
// setting: setting CLEAROTRON_BRAND_TAGLINE changed the report chrome and left the lockup saying the other
// thing. Reading BRAND.tagline makes the seam reach the lockup too, and an unset tagline renders no
// sub-label at all rather than an empty element or a stray separator.
export const logoLockup = ({ mark = 30, tag = BRAND.tagline, cls = "" } = {}) =>
  `<span class="lockup${cls ? ` ${cls}` : ""}">`
  + `<span class="lk-mark" style="width:${mark}px;height:${mark}px" aria-hidden="true">${bracketMark(mark, "currentColor")}</span>`
  + `<span class="lk-text"><span class="lk-word">${BRAND.name}</span>`
  + (tag ? `<span class="lk-tag">${tag}</span>` : "")
  + `</span></span>`;

// Shared chrome CSS: the lockup, the deck's crimson corner glow, the ridge watermark. Light token defaults
// live here (:root); the per-surface dark blocks (WARM/REPORT_ROOT_DARK) override in dark, so glow/watermark
// inherit the SAME staff-auto / client-explicit gating as every other token. `isolation:isolate` + z-index:-1
// keeps the wash/mark behind content without having to raise every child.
//
// THE WORDMARK RENDERS LOWERCASE, AND THE NAME IN PROSE DOES NOT. Owner ruling 2026-08-21, and it is
// the THIRD casing ruling on this name — read the distinction before changing either half:
//
//   `.lk-word` (here)   the BRAND MARK. Lowercase — "in the UI, clearotron is lowercase as a brand".
//   BRAND.name          PROSE — titles, chrome, Excel metadata. Stays "Clearotron", whose
//                       pin in driver/test/shipped-brand-is-the-product.test.mjs exists precisely
//                       because an earlier ruling said lowercase-EVERYWHERE and a sweep under it
//                       would land back there.
//
// The two are not in conflict and the previous state matched NEITHER: this rule was
// `text-transform:uppercase`, so the lockup rendered CLEAROTRON while every ruling in play asked for
// one of `clearotron` or `Clearotron`. Nothing pinned it, which is how it survived two rulings.
//
// `.lk-tag` below stays uppercase on purpose — it is the strapline, not the name, and no ruling
// touches it.
export const CHROME_CSS = `
:root{--web-glow:rgba(134,15,9,.13);--surface-high:#e3dac6}
.lockup{display:inline-flex;align-items:center;gap:12px;text-decoration:none;white-space:nowrap;color:var(--ink)}
.lockup .lk-mark{display:block;flex:none;color:var(--crimson)}
.lockup .lk-mark svg{display:block;width:100%;height:100%}
.lockup .lk-text{display:flex;flex-direction:column;line-height:1}
.lockup .lk-word{display:inline-flex;align-items:center;gap:8px;font-size:15px;font-weight:700;letter-spacing:.18em;text-transform:lowercase;color:var(--ink)}
.lockup .lk-tag{margin-top:5px;font-size:7.5px;font-weight:500;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
.has-glow{position:relative;isolation:isolate}
.has-glow::before{content:"";position:absolute;top:0;left:0;width:min(92vw,1100px);aspect-ratio:1.5;background:radial-gradient(farthest-side at 0% 0%,var(--web-glow),transparent 72%);pointer-events:none;z-index:-1}
/* #1431 — the .watermark rule and its ::after are GONE. They masked the parent company's ridge behind
   every report and the pool index; the owner's call is removal, not a bracket version of the same
   thing. The three body elements that carried the class drop it too, and --wm-alpha goes with them:
   a token nothing reads is a knob somebody re-wires.
   NOTE FOR ANY FUTURE DECORATION ON body: the rule here pinned right:0 and never a negative inset,
   because right:-2% put 26px of horizontal scrollbar on a 1280px report (#485) and pointer-events:none
   does not exempt a box from scrollable overflow. That is a property of the position, not of this
   rule, and scripts/report-overflow-check.mjs still measures it. */
/* Floating settings stack (theme + privacy) — pinned bottom-right, OUT of the nav bar. Icon-only: the toggle keeps its .tt-lbl/.anon-lbl text for screen readers but clips it visually.
   Buttons keep their .theme-toggle/.anon-toggle classes so the existing delegated JS handlers still bind. */
.fab-stack{position:fixed;right:16px;bottom:16px;z-index:200;display:flex;gap:8px}
.fab-stack .theme-toggle,.fab-stack .anon-toggle{width:36px;height:36px;min-width:36px;padding:0;margin:0;gap:0;justify-content:center;border-radius:9px;border:1px solid var(--line);background:color-mix(in srgb,var(--card) 80%,transparent);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);color:var(--muted);box-shadow:var(--shadow,0 6px 20px rgba(37,9,2,.12))}
.fab-stack .theme-toggle:hover,.fab-stack .anon-toggle:hover{color:var(--ink);border-color:var(--crimson-mid);background:var(--card)}
.fab-stack .anon-toggle.anon-active{background:var(--crimson);border-color:var(--crimson);color:#f0e8d8}
.fab-stack .tt-ic,.fab-stack .anon-eye{font-size:15px}
.fab-stack .tt-lbl,.fab-stack .anon-lbl{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media print{.has-glow::before,.watermark::after,.fab-stack{display:none!important}}`;