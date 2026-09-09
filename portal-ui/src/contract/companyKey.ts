// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The key a company gets from its name, as the engine derives it.
//
// A VERBATIM mirror of `companyKeyFrom` in driver/company-bundle.mjs, pinned by
// portal-ui/test/companyKeyParity.test.ts. The create form SHOWS the key before anything is written, and
// a preview that disagrees with what the server files is worse than no preview: the person reads one
// value, confirms it, and the company exists under another.
//
// The obvious way to write this is the slug line the project form already uses — lowercase, then replace
// everything that is not a letter or digit with a hyphen. That line gets "Zürich" wrong in a way nobody
// would notice on the screen it was written for: NFKD splits "ü" into a letter and a combining mark, and
// the mark becomes a hyphen, so the name files as `zu-rich`. Accented company names are the normal case
// in the languages this product works in, so the marks are DROPPED rather than separated.

/** The key a company gets from its name. Empty when a name yields nothing — the caller then asks. */
export function companyKeyFrom(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 39)
    .replace(/-+$/, '')
}
