// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// installationSettings.ts — what each row of Installation settings says, decided in one place.
//
// ── ADMINISTRATOR DETAIL STOPS HERE, AND NOT EARLIER ────────────────────────────────────────────────
//
// The server's rows carry the detail an administrator fixes a row with: the variables to set, the file a
// one-time sign-in writes, the README that walks through it. That detail is right where it is read — the
// doctor prints the same rows to a terminal, and a run's case-law sources are built from them — so it is
// not stripped from the inventory. It is stripped from THIS PAGE, which is read in screen shares by people
// who cannot act on a variable name, and it lives in the setup guide a row's button opens.
//
// So nothing below copies a server string onto the page except the names of things. A row's note is
// chosen from what the row IS — a key missing, a sign-in not done, a source not in this build — and never
// read out of `missing` or `remedy`. That is what makes "no variable name, credential path or README
// reference on the page" true by construction rather than by a filter someone has to keep complete.
//
// The screen spreads each row whole, the way the Engine row spreads `engineRow`: there is no second
// expression in the screen for a row's colour, state or note.

import type { AuthState, ProviderState } from './api.ts'

/** Where a "Setup guide" button goes. Each is the document in the product's source that holds the detail. */
export type SetupGuide = 'register' | 'research' | 'case-law' | 'sign-in'

export const SETUP_GUIDES: Readonly<Record<SetupGuide, { readonly path: string; readonly anchor: string }>> = {
  register: { path: 'providers/README.md', anchor: 'choose-one-register' },
  research: { path: 'providers/README.md', anchor: 'research-and-support-sources' },
  'case-law': { path: 'providers/oauth-mcp-bridge/README.md', anchor: 'one-time-setup-per-remote-mcp-server' },
  'sign-in': { path: 'docs/PORTAL.md', anchor: 'putting-your-own-login-provider-in-front' },
}

/**
 * A guide's address in the repository the server names — never a literal one, because this portal may be
 * a fork, and another project's instructions describe a product the reader is not running.
 */
export const setupGuideUrl = (sourceRepo: string, guide: SetupGuide): string =>
  `${sourceRepo}/blob/main/${SETUP_GUIDES[guide].path}#${SETUP_GUIDES[guide].anchor}`

/** One row, as the screen draws it. `ok` false and `off` false is a row that needs action. */
export type SettingsRow = {
  readonly ok: boolean
  /** Nothing to fix on this box: drawn faint rather than red. */
  readonly off: boolean
  readonly name: string
  /** What the source covers — the middle cell. */
  readonly mono: string | null
  readonly state: string
  /** What needs doing, in a reader's words. Red. */
  readonly faults: readonly string[]
  /** A quiet line under the name. */
  readonly note: string | null
  /** A quiet monospaced line: the sign-in mode and issuer. */
  readonly detail: string | null
  /** The guide a row that needs action opens. */
  readonly guide: SetupGuide | null
}

export type ProviderCategory = {
  /** The server's category key, for a stable React key. */
  readonly key: string
  /** The category's own name, from the server's rows — said once, as the heading. */
  readonly label: string
  /** Said once under the heading, where the rows would otherwise each say it. */
  readonly note: string | null
  readonly rows: readonly SettingsRow[]
}

const row = (r: Partial<SettingsRow> & Pick<SettingsRow, 'name' | 'state'>): SettingsRow => ({
  ok: true, off: false, mono: null, faults: [], note: null, detail: null, guide: null, ...r,
})

export const KEY_NEEDED = 'A key is needed'
export const SIGN_IN_NEEDED = 'One-time sign-in needed'
export const CASE_LAW_GAP =
  'Until these are set up, a Full country search still runs and its report discloses the case-law gap instead of reporting no adverse case law.'

/**
 * Which reports say a source this build does not ship is missing. The note names the reports that
 * disclose the gap, so it is a fact about the source rather than its kind: the Boards of Appeal are read
 * for EU filings, and the server's own remedy for that row says a report covering the EU discloses them.
 * A source added to that list later gets the general sentence until its own is written here.
 */
const ABSENT_NOTES: Readonly<Record<string, string>> = {
  'euipo-boards-of-appeal': 'Reports covering the EU say so',
}
export const ABSENT_NOTE = 'Reports that need it say so'

/**
 * The sign-in row: one row, the mode and the issuer beneath it.
 *
 * THE MODE AND THE ISSUER, AND NOTHING ELSE. Not the audience, not a secret, not the token header, and not
 * local mode's single address — this page is read over shoulders and in screen shares.
 */
export function signInRow(auth: AuthState): SettingsRow {
  const fronted = auth.shape === 'fronted'
  const faults = [
    // Unreachable from a running portal, which refuses to start without an issuer. Said without naming
    // the two variables either one of which would do; the setup guide names them.
    ...(auth.missing.length ? ['No issuer is set'] : []),
    // Also unreachable: the service refuses to start in a mode it does not have, so a reader who sees this
    // is being served by something that is not that service, and saying so beats a blank row.
    ...(auth.shape === 'unrecognised'
      ? ['This service refuses to start in this mode, so this page should not be reachable. Treat it as suspect.']
      : []),
  ]
  return row({
    ok: faults.length === 0,
    name: fronted
      ? 'Through your organisation\'s sign-in service'
      : auth.shape === 'local'
        ? 'Local sign-in, one address, loopback only'
        : 'Not a sign-in method this service has',
    // "Default" is a fact worth one word: nobody typed this, and an operator who believes they chose it
    // will not go looking for the setting that would change it.
    state: auth.declared === null ? 'Default' : 'Configured',
    faults,
    detail: [auth.mode, fronted && auth.issuer ? `issuer ${auth.issuer}` : null].filter(Boolean).join(' · ') || null,
    guide: auth.missing.length ? 'sign-in' : null,
  })
}

/**
 * A source's name and what it covers, from the one label the server gives it.
 *
 * The server writes a source as "Name (what it covers)", sometimes with a web address inside the
 * parentheses and a note on how it is read after them. The name and the coverage are a row's first two
 * cells; the address and the note are the setup guide's business.
 */
export function splitSourceLabel(label: string): { readonly name: string; readonly covers: string | null } {
  const m = /^(.*?)\s*\(([^)]*)\)/.exec(label)
  if (!m) return { name: label, covers: null }
  const covers = (m[2] ?? '').split(',').map((s) => s.trim()).filter((s) => s && !/^[a-z]+:\/\//i.test(s)).join(', ')
  return { name: (m[1] ?? '').trim() || label, covers: covers || null }
}

/**
 * Whether a row is the engine's own capability rather than a provider this deployment configures.
 *
 * Read off what the server says about the row — built into the engine, in the open-web category — and not
 * off a source id, so a second capability the engine brings lands beside the first on the day it ships.
 */
export const isEngineCapability = (p: ProviderState): boolean => p.key === 'web' && p.enrolment === 'built-in'

/** The engine's own capabilities, drawn under Engine. */
export function engineCapabilityRows(providers: readonly ProviderState[]): readonly SettingsRow[] {
  return providers.filter(isEngineCapability).map((p) => row({
    ok: p.configured,
    // The typographic apostrophe, as the page's own words use it.
    name: splitSourceLabel(p.providerLabel ?? p.provider ?? '').name.replace(/'/g, '’'),
    mono: 'provided by the engine',
    state: p.configured ? 'Available' : 'Not available',
    note: 'The model searches the web itself during a run.',
  }))
}

/**
 * One provider row.
 *
 * EVERY SOURCE IS A ROW, configured or not — a page listing two providers is indistinguishable from a
 * page listing a complete set of two. What changes is the note, and the note is chosen from the row's
 * kind, never copied from its remedy.
 */
export function providerRow(p: ProviderState): SettingsRow {
  const { name, covers } = splitSourceLabel(p.providerLabel ?? p.provider ?? '')
  const guide: SetupGuide = p.key === 'register' ? 'register' : p.enrolment === 'oauth' ? 'case-law' : 'research'

  if (p.configured) {
    return row({ name, mono: covers, state: 'Configured', note: p.enrolment === 'built-in' ? 'Read by the engine itself' : null })
  }
  // A source this build does not ship, and nobody can switch on. Faint, because there is nothing to fix.
  if (p.enrolment === 'absent') {
    return row({ ok: false, off: true, name, mono: covers, state: 'Not in this build', note: ABSENT_NOTES[p.provider ?? ''] ?? ABSENT_NOTE })
  }
  // A register nobody has chosen yet: the thing to do is choose one, not find a key.
  if (p.key === 'register' && p.provider === null) {
    return row({ ok: false, name: 'No register selected', state: 'Missing', faults: ['A register is needed'], guide })
  }
  // An id the environment names and this build does not ship: a typo, not an unmade choice.
  if (!p.known) {
    return row({ ok: false, name, mono: covers, state: 'Not in this build', faults: [`This build does not ship a provider called ${name}.`], guide })
  }
  if (p.missing.length) {
    return row({ ok: false, name, mono: covers, state: 'Missing', faults: [KEY_NEEDED], guide })
  }
  // A one-time sign-in not done, or done and no longer usable — the same step either way. One that could not
  // be LOOKED AT is neither: telling the reader to sign in again would send them the wrong way.
  if (p.credential === 'unreadable') {
    return row({ ok: false, name, mono: covers, state: 'Unknown', faults: ['Could not be checked'], guide })
  }
  return row({ ok: false, name, mono: covers, state: 'Not set up', faults: [SIGN_IN_NEEDED], guide })
}

/**
 * The providers, one heading per category, in the order the server lists them.
 *
 * The heading is the category's own name from the server's rows, so no category is spelled here and none is
 * repeated on a row. The engine's own capabilities are not providers and are left for the Engine section.
 */
export function providerCategories(providers: readonly ProviderState[]): readonly ProviderCategory[] {
  const order: string[] = []
  const byKey = new Map<string, ProviderState[]>()
  for (const p of providers) {
    if (isEngineCapability(p)) continue
    if (!byKey.has(p.key)) { byKey.set(p.key, []); order.push(p.key) }
    byKey.get(p.key)?.push(p)
  }
  return order.map((key) => {
    const rows = byKey.get(key) ?? []
    // WHAT AN UNSET CASE-LAW SOURCE COSTS A SEARCH, said once under the category rather than on each row —
    // and only while a source here still needs its sign-in, because once they are set up it is not true.
    const unset = rows.some((p) => p.enrolment === 'oauth' && !p.configured)
    return {
      key,
      label: rows[0]?.label || key,
      note: key === 'caselaw' && unset ? CASE_LAW_GAP : null,
      rows: rows.map(providerRow),
    }
  })
}
