// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The product lockup — the bracket mark and the wordmark.
//
// This is the LAUNCH SITE's project lockup, not a stand-in. The site header (clearotron.com-website,
// src/_includes/partials/header.njk) carries two lockups either side of a divider: the parent company
// logo, then `.brand-project` — a 20px bracket glyph followed by the wordmark. The portal takes the
// project half ONLY. The company logo and the Swiss flag do not travel: this is an open-source product
// called Clearotron, not a Swiss firm's internal tool, and the flag said the second thing.
//
// The type matches the site's `.wordmark` rule (mono family, medium weight, .02em tracking, nowrap)
// rather than being sized by eye. Note it is NOT uppercased: the site lowercases the brand string
// deliberately, and `textTransform` here would silently override that.
//
// Why the glyph is real JSX rather than an <img> or a pasted string: portal-ui may not use React's
// raw-HTML escape hatch (no-danger.test.ts keeps that class closed), and an <img> would need a second
// asset pipeline for a shape that is six rectangles. The geometry is transcribed from the site asset
// and IS now asserted — against shared/brand.mjs's copy, by driver/test/one-bracket-geometry.test.mjs.
//
// THAT SENTENCE USED TO END "see Logo.test.tsx", AND NO SUCH FILE HAS EVER EXISTED. `git log --all
// --diff-filter=AD -- '*Logo.test*'` is empty and lockup.test.ts pins the TYPE, not the shape — so the
// assertion was cited, believed, and absent. gave the shape a second reader (brand.mjs needs the
// same bracket for the favicon and the report lockup), and a second unguarded copy of an unguarded
// shape would have doubled the defect. The guard exists now and binds both.
//
// THE RIDGE MARK IS GONE, and with it the generator that fed it. retired the ridge from
// every surface this product renders — the favicon is the bracket and so is the report lockup — which
// left `RidgeMark` exported and read by nothing. An unread export is a shape somebody re-adopts.
//
// The ridge ASSETS stay in shared/brand/assets: they are the parent company's mark, and this product
// simply stops rendering it. What went is the chain that turned them into a component nobody drew.

/** The wordmark string. Lowercase is the brand reference's rule, not a typo. */
export const WORDMARK = 'clearotron'

/**
 * The bracket mark: a pair of square brackets around a centred block.
 *
 * Geometry is the site asset's, in its 24x24 viewBox. The brackets draw in `currentColor` so the caller
 * sets them; the centre block takes the accent so the mark reads at 20px, which is how the site does it
 * (it ships two colourways and swaps by theme — here one token does the same job).
 */
export function BracketMark({ size = 20 }: { readonly size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      {/* left bracket: stem, top arm, bottom arm */}
      <rect x="2" y="2.6" width="2" height="18.8" fill="currentColor" />
      <rect x="2" y="2.6" width="5.6" height="2" fill="currentColor" />
      <rect x="2" y="19.4" width="5.6" height="2" fill="currentColor" />
      {/* right bracket */}
      <rect x="20" y="2.6" width="2" height="18.8" fill="currentColor" />
      <rect x="16.4" y="2.6" width="5.6" height="2" fill="currentColor" />
      <rect x="16.4" y="19.4" width="5.6" height="2" fill="currentColor" />
      {/* the enclosed block — the one part that takes the accent */}
      <rect x="10" y="7.6" width="4" height="8.8" fill="var(--accent)" />
    </svg>
  )
}

/**
 * Mark + wordmark.
 *
 * `markOnly` is the collapsed-rail form: the bracket keeps its meaning at 20px where the wordmark
 * would just be clipped.
 */
export function Logo({ markOnly = false }: { readonly markOnly?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
      <span style={{ color: 'var(--text-strong)', display: 'block' }}>
        <BracketMark size={20} />
      </span>
      {markOnly ? null : (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 15,
            fontWeight: 500,
            letterSpacing: '.02em',
            color: 'var(--text-strong)',
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          {WORDMARK}
        </span>
      )}
    </span>
  )
}
