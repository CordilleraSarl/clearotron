#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// How the risk ramp's companion values were derived — kept so the next ramp change is a re-run, not a
// re-guess, and so the numbers in brand.mjs are auditable rather than magic.
//
// The designer supplies FIVE base hexes (light theme only). brand.mjs needs sixteen values: five light
// bases, five dark bases, and three soft/text pairs per theme. The eleven that were not supplied are
// derived here by a rule, and the rule is validated by re-deriving the PREVIOUS pairs from the PREVIOUS
// bases and checking it lands on what shipped. That check is the point of this file: a rule that
// reproduces the old pairs is a rule that expresses the designer's original intent.
//
//   node shared/tools/derive-band-pairs.mjs
//
// Nothing imports this — it is a working note with a runtime. The values it prints are pasted into
// brand.mjs and pinned by driver/test/brand.test.mjs, which is what actually holds them.

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();

function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
const hsl = (h) => rgb2hsl(hex2rgb(h));
const fmt = ([h, s, l]) => `H${h.toFixed(0).padStart(3)} S${(s * 100).toFixed(0).padStart(3)}% L${(l * 100).toFixed(0).padStart(3)}%`;

// WCAG relative luminance + contrast
const lum = (h) => {
  const c = hex2rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// ── the rule ────────────────────────────────────────────────────────────────
// soft (light theme): base hue, saturation pulled toward a warm pastel, lightness ~.895
// tx   (light theme): base hue, saturation raised, lightness ~.275  (dark ink on the soft chip)
// soft (dark theme):  base hue, saturation ~.48, lightness ~.145
// tx   (dark theme):  base hue, saturation ~.72, lightness ~.70
const softLight = ([h, s, l]) => rgb2hex(hsl2rgb([h, Math.min(0.62, s * 0.78), 0.895]));
const txLight = ([h, s, l]) => rgb2hex(hsl2rgb([h, Math.min(0.92, s * 1.12), 0.275]));
const softDark = ([h, s, l]) => rgb2hex(hsl2rgb([h, Math.min(0.50, s * 0.62), 0.145]));
const txDark = ([h, s, l]) => rgb2hex(hsl2rgb([h, Math.min(0.75, s * 0.92), 0.70]));

const SHIPPED = {
  med: { base: '#C2851A', soft: '#F4E7CB', tx: '#8A5B06', dsoft: '#3A2E14', dtx: '#E8C073', dbase: '#D69F3C' },
  clear: { base: '#4F7A55', soft: '#E4EDDD', tx: '#3C6042', dsoft: '#1E2A1F', dtx: '#9CC6A0', dbase: '#6F9E75' },
  high: { base: '#860F09', soft: '#F3DBD7', tx: '#7A0D08', dsoft: '#3A1512', dtx: '#F0A89F', dbase: '#860F09' },
};

const NEW = { med: '#C8871B', clear: '#5F8A64', high: '#B23A2E' };
// New dark bases (lightened for the dark ramp, same relationship the shipped dark ramp uses)
const NEW_DARK = { med: '#DDA13E', clear: '#7EA382', high: '#CA594E' };

console.log('=== RULE CHECK: derive from the SHIPPED base, compare to the SHIPPED pair ===\n');
for (const [k, v] of Object.entries(SHIPPED)) {
  const b = hsl(v.base), db = hsl(v.dbase);
  console.log(`${k.padEnd(6)} base ${v.base} ${fmt(b)}`);
  console.log(`   soft  shipped ${v.soft}  derived ${softLight(b)}   Δcontrast-on-soft shipped ${contrast(v.tx, v.soft).toFixed(2)}`);
  console.log(`   tx    shipped ${v.tx}  derived ${txLight(b)}   derived-pair contrast ${contrast(txLight(b), softLight(b)).toFixed(2)}`);
  console.log(`   dsoft shipped ${v.dsoft}  derived ${softDark(db)}`);
  console.log(`   dtx   shipped ${v.dtx}  derived ${txDark(db)}   derived-pair contrast ${contrast(txDark(db), softDark(db)).toFixed(2)}`);
  console.log('');
}

console.log('=== APPLY to the NEW designer bases ===\n');
for (const [k, base] of Object.entries(NEW)) {
  const b = hsl(base), db = hsl(NEW_DARK[k]);
  const sl = softLight(b), tl = txLight(b), sd = softDark(db), td = txDark(db);
  console.log(`${k.padEnd(6)} light base ${base} ${fmt(b)}   dark base ${NEW_DARK[k]}`);
  console.log(`   --${k}-soft:${sl}  --${k}-tx:${tl}   contrast ${contrast(tl, sl).toFixed(2)}`);
  console.log(`   dark --${k}-soft:${sd}  --${k}-tx:${td}   contrast ${contrast(td, sd).toFixed(2)}`);
  console.log('');
}

console.log('=== base-on-page contrast (light page #f5f0e8 / #FFFDF9 card; dark #1b1714) ===');
for (const [k, base] of Object.entries(NEW)) {
  console.log(`${k.padEnd(6)} ${base} on #FFFDF9 = ${contrast(base, '#FFFDF9').toFixed(2)}   dark ${NEW_DARK[k]} on #1b1714 = ${contrast(NEW_DARK[k], '#1b1714').toFixed(2)}`);
}
const OLD_HIGH = '#860F09';
console.log(`\naccent-collision check: old --high ${OLD_HIGH} vs --accent #860F09 -> contrast ${contrast(OLD_HIGH, '#860F09').toFixed(2)} (identical)`);
console.log(`                       new --high ${NEW.high} vs --accent #860F09 -> contrast ${contrast(NEW.high, '#860F09').toFixed(2)}`);
