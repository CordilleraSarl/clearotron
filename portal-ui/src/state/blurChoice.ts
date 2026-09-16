// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The screen-share blur, remembered in this browser.
//
// A reload during a screen share used to bring every name back, because the blur started off on every
// load. It is now stored the way the theme is: one localStorage key, every read and write wrapped,
// because localStorage throws outright in a null-origin or sandboxed document and a preference that
// cannot be remembered must still apply. It is kept per browser, never against the person, and never
// sent anywhere.
//
// IN A `.ts` FILE, NOT IN THE SHELL, so the three stored states and the refusing browser can be driven
// by a test; this package's runner cannot import a `.tsx`.

export const BLUR_KEY = 'cordillera-blur-names'

/** The part of `Storage` the choice needs, so a test can hand in one that refuses. */
export type ChoiceStore = Pick<Storage, 'getItem' | 'setItem'>

/**
 * Whether the page opens blurred.
 *
 * The store is REACHED inside the try, which is why it arrives as a function: in a null-origin document
 * reading the `localStorage` global is itself what throws. Nothing stored, a value this never writes, and
 * a store that refuses all read as off — a blur is turned on by a person, never by a guess.
 */
export function readBlurChoice(store: () => ChoiceStore): boolean {
  try {
    return store().getItem(BLUR_KEY) === 'on'
  } catch {
    return false
  }
}

/** Remember the choice. A store that refuses leaves the blur applied for as long as the page is open. */
export function writeBlurChoice(store: () => ChoiceStore, on: boolean): void {
  try {
    store().setItem(BLUR_KEY, on ? 'on' : 'off')
  } catch {
    /* private mode, or a sandboxed frame — the blur still applies until the page is closed */
  }
}
