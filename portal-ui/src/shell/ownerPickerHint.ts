// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// One sentence telling a reader where to choose a brand owner, true in both sidebar states.
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────────
//
// Four screens refuse to render without a brand owner selected, and each told the reader to "pick one at
// the top left". With the sidebar collapsed to icons there is no top left: the switcher is not on screen
// at all. An outside user read that sentence, looked where it pointed, found nothing, and stopped.
//
// ── WHY IT IS HERE AND NOT IN THE SCREENS ───────────────────────────────────────────────────────────
//
// It was written out four times, which is how the four copies were able to be wrong together and how a
// fifth screen would inherit it. The subject clause stays with each screen — "A profile belongs to one
// brand owner", "Projects belong to one brand owner" — because that part genuinely differs. Only the
// directive is shared, because only the directive is a claim about the shell.
//
// A standalone module rather than an export from AppShell: the screens import AppShell for its
// ShellContext TYPE, which erases at build time. Importing a value from it would make that a real edge,
// and AppShell renders these screens.

/**
 * Where to choose a brand owner, given whether the sidebar is currently collapsed.
 *
 * Both sentences name a control the reader can actually see from where they are standing. Expanded, the
 * switcher is visible and its position is the fastest way to find it. Collapsed, the position is useless
 * and the first step is opening the menu — so that is what the sentence asks for.
 */
export function ownerPickerHint(sidebarCollapsed: boolean): string {
  return sidebarCollapsed
    ? 'Open the menu on the left to pick one.'
    : 'Pick one at the top left.'
}
