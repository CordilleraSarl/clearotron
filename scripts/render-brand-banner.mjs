#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The README banner — the bracket mark and the wordmark, as a light/dark SVG pair.
//
// WHY THIS IS GENERATED AND NOT A DRAWN ASSET. The bracket geometry already exists twice — as data in
// `shared/brand.mjs` and as JSX rects in `portal-ui/src/components/Logo.tsx` — and the only reason a
// second copy is safe is that `driver/test/one-bracket-geometry.test.mjs` binds them. A hand-drawn
// banner would be a THIRD copy with nothing binding it, which is the defect refused to double.
// So the banner reads the constant, and `--check` fails CI if the committed SVGs drift from it.
//
// NOT THE RIDGE. `shared/brand/assets/logo-full-*.svg` is the parent company's mark; /
// retired it from every surface this product renders. Fronting the README with it would put a Swiss
// firm's logo on an open-source product — the exact thing that retirement was about.
//
// The wordmark renders LOWERCASE (owner ruling 2026-08-21) while the name in prose does not, and it
// renders as SVG <text> in a GENERIC monospace stack: GitHub serves a README image sandboxed, so a
// webfont would not load and a named family the reader lacks would fall back to something unrelated.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BRACKET_VIEWBOX, BRACKET_RECTS, BRACKET_BLOCK, PALETTE, PALETTE_DARK } from '../shared/brand.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORDMARK = 'clearotron';
const TAGLINE = 'Trademark clearance that shows its work';
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace";

// The mark is drawn in its own 24-unit box and placed by transform, so the rects stay the constant's
// numbers rather than being pre-multiplied into the banner's coordinate space.
const mark = (x, y, size, fill, accent) => {
  const s = size / 24;
  const r = (b, f) => `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${f}"/>`;
  return `<g transform="translate(${x} ${y}) scale(${s})">`
    + BRACKET_RECTS.map((b) => r(b, fill)).join('')
    + r(BRACKET_BLOCK, accent)
    + `</g>`;
};

// One banner. `ground` is the plate, `ink` the brackets and wordmark, `accent` the enclosed block.
const banner = ({ ground, ink, accent, muted }) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300" viewBox="0 0 1200 300" role="img" aria-label="Clearotron — ${TAGLINE}">
  <rect width="1200" height="300" fill="${ground}"/>
  ${mark(316, 93, 88, ink, accent)}
  <text x="428" y="164" font-family="${MONO}" font-size="76" font-weight="500" letter-spacing="1.5" fill="${ink}">${WORDMARK}</text>
  <text x="428" y="208" font-family="${MONO}" font-size="21" letter-spacing="0.6" fill="${muted}">${TAGLINE}</text>
</svg>
`;

const FILES = {
  'docs/assets/clearotron-banner-light.svg': banner({
    ground: PALETTE.cream, ink: PALETTE.ink, accent: PALETTE.crimson, muted: PALETTE.muted,
  }),
  'docs/assets/clearotron-banner-dark.svg': banner({
    ground: PALETTE_DARK.ground, ink: PALETTE_DARK.ink, accent: PALETTE.crimson, muted: PALETTE_DARK.muted,
  }),
};

const check = process.argv.includes('--check');
let drift = 0;
for (const [rel, want] of Object.entries(FILES)) {
  const path = join(ROOT, rel);
  if (!check) { writeFileSync(path, want); console.log(`wrote ${rel}`); continue; }
  // An unreadable file is drift, not a pass — the banner being absent is the failure this catches.
  let got = null;
  try { got = readFileSync(path, 'utf8'); } catch { got = null; }
  if (got !== want) { drift += 1; console.error(`DRIFT ${rel} — ${got === null ? 'missing or unreadable' : 'differs from shared/brand.mjs'}`); }
}
if (check) {
  if (drift) { console.error(`\n${drift} banner file(s) do not match the brand constant. Run: npm run brand:banner`); process.exit(1); }
  console.log(`brand banner: ${Object.keys(FILES).length} file(s) match shared/brand.mjs`);
}
