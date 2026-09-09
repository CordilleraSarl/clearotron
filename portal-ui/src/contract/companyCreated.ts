// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What was just decided for you, carried from the page that decided it to the page you land on.
//
// A confirmation PAGE was drawn for this and turned down: it is easier to make unmissable and it
// interrupts the one thing the person came to do. So the facts ride to New clearance and appear as a
// strip above it. The framework is the reason that page existed at all, and the strip still names it.
//
// IN MEMORY, AND ON PURPOSE. A reload should not replay it: the strip reports something that just
// happened, and a page refreshed an hour later announcing it again is furniture. Browser storage would
// survive exactly that long. Navigation here is a pushState within one document, so a module holds it
// for precisely the right span — from the create to the next screen, and no further.
//
// READ ONCE. Taking it clears it, so a person who navigates away and comes back does not meet the
// announcement a second time.

import type { CreatedCompany } from './api.ts'

let pending: CreatedCompany | null = null

/** Record what was just created, for the screen about to render. */
export function handOff(created: CreatedCompany): void {
  pending = created
}

/** Take it, if there is one. Clears it — a strip is shown once. */
export function takeCreated(): CreatedCompany | null {
  const out = pending
  pending = null
  return out
}

/**
 * The strip's words.
 *
 * The rating and the marketplace count each say whether they were CHOSEN or DEFAULTED, which is the
 * whole reason for saying them: "the general framework" is a fact somebody may want to change, and "the
 * framework you named" is not.
 */
export function createdStrip(created: CreatedCompany): {
  readonly line: string
  readonly warning: string | null
} {
  const rating = created.framework.defaulted ? 'General default rating' : 'Its own rating framework'
  const stores = created.marketplaces.defaulted
    ? `${created.marketplaces.count} marketplaces by default`
    : `${created.marketplaces.count} marketplaces`
  return {
    line: `${created.name} added. ${rating} · ${stores}`,
    // WRITTEN AND RECORDED ARE TWO EVENTS. The company is live the instant its file lands; the commit
    // that records it can fail on its own. Reporting that as a failure would tell somebody nothing
    // happened about a company that already governs their searches — so it is said as what it is.
    warning: created.commitError
      ? 'The company is live and you can search under it now. Recording it in the configuration '
        + 'history failed, so it is not in that history yet — tell an administrator.'
      : null,
  }
}
