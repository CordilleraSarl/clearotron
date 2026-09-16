// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A repository, as a reader names it.

/**
 * "https://github.com/Owner/Repo" → "Owner/Repo".
 *
 * About's source link reads as the repository rather than as a ninety-character address wrapped over two
 * lines. The words come from the address the server states, so a fork's page names the fork. An address
 * that does not parse is shown whole rather than as nothing.
 */
export function repositoryName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/+|\/+$/g, '') || url
  } catch {
    return url
  }
}
