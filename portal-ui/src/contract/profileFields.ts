// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Editing a brand owner's configuration.
//
// The rules here are the ones that make a settings page safe to point at a legal product. Two of them
// have already caused real incidents in this codebase, and both are the same shape: a form that sends
// what it knows about, silently discarding what it does not.
//
//   OMISSION IS NOT CONSENT. A page that renders eleven fields and POSTs eleven fields will erase the
//   twelfth the day someone adds one to the engine. The draft is therefore seeded from the SERVER's
//   object and edited in place — unknown keys ride along untouched rather than being reconstructed
//   from what the UI happens to have inputs for.
//
//   PLATFORMS IS A FLOOR. A project may ADD marketplaces to its customer's list and may never revoke
//   one. A project overlay that silently deleted a client-mandated marketplace is a documented past
//   defect; the additive-only helper below is the fix expressed as code rather than as care.

import { isKnownTerritory } from './composerProduct.ts'

/** Fields the UI must never send. The server strips them too — this is the near wall, not the only one. */
export const CODE_OWNED = ['frameworkPath', 'workedExamplesPath', 'allowedRecipes', 'jxPolicy', 'runCaps'] as const

/**
 * Code-owned fields whose VALUE is a path inside the engine.
 *
 * These render as `skills/prelim-search/risk-framework-aurora.md` — the internal directory layout,
 * the naming convention, and a customer key embedded in a filename, which together let a reader guess
 * the path of another client's framework. Not catastrophic, and not a client's business either.
 *
 * Named as a set rather than tested inline so that a sixth code-owned field forces a decision about
 * which side of the line it falls on.
 */
export const PATH_FIELDS: ReadonlySet<string> = new Set(['frameworkPath', 'workedExamplesPath'])

/**
 * Which read-only rows this reader may see.
 *
 * A client loses nothing: the framework's human title is rendered from the manifest either way, and it
 * is the thing they were actually asking about. The path only ever answered "where does Cordillera keep
 * that file". Staff keep the paths, because they are the ones who go and open the file.
 */
export function visibleReadOnlyFields(
  readOnly: Readonly<Record<string, unknown>>,
  staff: boolean,
): readonly string[] {
  return CODE_OWNED.filter((k) => readOnly[k] !== undefined && (staff || !PATH_FIELDS.has(k)))
}

/**
 * How each editable field is rendered and parsed. Anything not listed round-trips untouched.
 *
 * `boolean` is a choice in the UI and a real boolean on the wire. It exists as its own kind rather than
 * as a 'choice' over "yes"/"no" because the engine's validator is strict about the type — a delivery
 * object carrying the STRING "yes" is rejected outright (driver/profiles.mjs: "delivery.privileged must
 * be a boolean"), so the string↔boolean coercion has to happen somewhere and this is where.
 */
/**
 * `prose` is a multi-line STRING — a paragraph, not a list.
 *
 * It exists as its own kind because `lines` is the only other multi-line control and it parses to an
 * ARRAY: rendering risk appetite as `lines` would shred a paragraph into one array element per sentence
 * the moment someone pressed Return. And rendering it as `text` — which is what the rebuild did — gives a
 * single-line input for a field the engine's validator requires to be prose. Ridgeform's risk appetite is
 * a 400-character paragraph being edited through a one-line box today.
 *
 * Parsing is deliberately identical to `text` (trim, store the string); only the control differs. The
 * trim keeps leading/trailing whitespace out of a git-committed file while leaving internal newlines —
 * the paragraph breaks — untouched.
 */
export type FieldKind = 'text' | 'prose' | 'lines' | 'numbers' | 'choice' | 'boolean'

/**
 * Visual grouping. Not a data distinction — every field in both groups is written the same way — but
 * this page is a flat list about to grow past the length where a flat list is readable.
 *
 * "Set by Cordillera" is deliberately NOT a group here: it is the read-only block, which is a different
 * kind of thing (rendered as text, never sent) and lives in its own component.
 */
export const FIELD_GROUPS = [
  { id: 'identity', label: 'Identity' },
  { id: 'defaults', label: 'Search defaults' },
] as const

export type FieldGroup = (typeof FIELD_GROUPS)[number]['id']

export type FieldSpec = {
  readonly key: string
  readonly label: string
  readonly kind: FieldKind
  readonly group: FieldGroup
  readonly hint?: string
  /** Fixed options for a `choice` field. Omitted when the options are loaded at render time. */
  readonly choices?: readonly { readonly value: string; readonly label: string }[]
  /**
   * Where the value lives, when it is not `draft[key]`.
   *
   * `delivery` is an object on disk, not a scalar, and its sub-keys are what a person actually edits.
   * A spec with a path reads and writes through it, spreading the existing sub-object rather than
   * replacing it — a whole-object write here would drop a profile's on-disk `style`/`template`, which
   * is the file-header rule one level down.
   */
  readonly path?: readonly string[]
  /**
   * What an emptied box WRITES, instead of deleting the key.
   *
   * Only for fields whose server distinguishes three states. `defaultProduct` is the one:
   * driver/profile-service.mjs normalizeProduct reads absent ⇒ preserve whatever is on disk,
   * `""` ⇒ unset back to the Generic default, a value ⇒ set. Deleting the key on clear would therefore
   * mean "leave it exactly as it was" — the precise opposite of what the user just asked for.
   */
  readonly clearWith?: string
  /**
   * Customer-level only: excluded from the project overlay form.
   *
   * Not the same question as PROJECT_EDITABLE, which is about what the ENGINE accepts in an overlay.
   * This is about what the UI can offer honestly. See projectFields().
   */
  readonly customerOnly?: boolean
  /**
   * For a `lines` field: is a comma ALSO an item separator?
   *
   * PER FIELD, because the answer differs and getting it wrong loses data silently. Domains and
   * jurisdictions never contain a comma, so splitting on one is pure convenience — the owner's ask,
   * verbatim: people should not have to "wonder should they put a comma or new line". Trading names and
   * marketplaces CAN contain one ("Smith, Jones & Co"), and splitting there would quietly turn one
   * entry into two. So this is opt-in and the hint says which, rather than a global rule with an
   * exception nobody reads.
   */
  readonly commaSeparated?: boolean
  /**
   * For a `lines` field: the shape each entry must have, and how to name it when one does not.
   *
   * Declared rather than tested by key, so a second field needing a shape declares one instead of
   * growing a branch in the notice builder.
   */
  readonly item?: { readonly ok: (entry: string) => boolean; readonly expected: string }
  /**
   * Offer a picker beside the box, and WHICH KIND — because the two are not the same control.
   *
   * `classes` is EXCLUSIVE: Nice classes are 1–45 and nothing else, so a picker offering all 45 takes
   * nothing away.
   *
   * `territories` is ASSISTIVE, and that asymmetry is the design rather than an inconsistency. The
   * engine deliberately carries a territory name it does not recognise — `scope-rules.mjs` canonicalises
   * the account's list and an unknown name KEEPS its uppercased original, and `products.mjs` CLAMPS an
   * oversized entry rather than refusing it. An exclusive picker here would narrow what a client can
   * express on the setting that applies when a request does not name territories, which is the case with
   * no second chance to correct it. So the picker suggests and normalises; the box still accepts anything.
   * Do not "make these consistent" by tightening the second one — that is a client-outcome change and
   * it is the owner's to make.
   */
  readonly picker?: 'classes' | 'territories'
  /**
   * What the CLEARED option in this field's dropdown is called, when "no value" is a named thing rather
   * than the absence of one.
   *
   * PER FIELD, and the reason is a collision between two owner rulings that a single shared label cannot
   * satisfy. Every picker renders one cleared option, and its words are the generic default's — now
   * "Generic default". For `delivery.privileged` that is wrong and quietly
   * dangerous: the cleared state there is not an absence a user should read as "unset", it is the report
   * carrying its confidentiality marking, and the owner named it "Privileged & Confidential" (tracker
   * issue 1983). A sweep that renamed the shared label would have silently overwritten that ruling with
   * the generic one.
   *
   * So the pair a user reads is "Privileged & Confidential" / "No marking", which stands on its own —
   * which was the whole point of the ruling, the interim having left "The house default" against "No".
   * The WIRE is untouched: cleared still means absent, and absent still means marked.
   */
  readonly clearedLabel?: string
  /**
   * An input value the ENGINE no longer acts on, shown as the cleared state instead of as itself.
   *
   * Not a display nicety: `delivery.privileged: true` is retired and `normalizeDelivery` deletes it
   * before anything renders, so `true` and absent produce an identical report. Offering it as a choice
   * was a control that could not be taken, and simply removing the option would
   * leave a stored `true` — `driver/profiles/aurora.json` holds one — selecting nothing at all in the
   * dropdown. Folding it to the cleared state shows what the value MEANS to the engine rather than what
   * the file happens to say.
   *
   * It is the INPUT-form value (what `toInput` produces), because that is what the control is holding.
   */
  readonly retiredValue?: string
}

/** The root profile key a spec writes into — the object for a nested spec, the key itself otherwise. */
export const rootKey = (spec: FieldSpec): string => spec.path?.[0] ?? spec.key

/** Read a spec's value out of a draft, following `path` when it has one. */
export function readField(draft: Record<string, unknown>, spec: FieldSpec): unknown {
  if (!spec.path) return draft[spec.key]
  let cur: unknown = draft
  for (const seg of spec.path) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/** Is this spec's value actually SET in this draft (as opposed to inherited/absent)? */
export function isSet(draft: Record<string, unknown>, spec: FieldSpec): boolean {
  return readField(draft, spec) !== undefined
}

/**
 * The fields this page knows how to render, in the order a person would want to read them.
 *
 * Not every profile key appears. That is deliberate and safe BECAUSE of the seed-and-edit rule above:
 * an unrendered key is preserved, not dropped. Adding a row here is how a field becomes editable; it is
 * never required to keep a field alive.
 */
/**
 * What a cleared picker says when the field has no name of its own for it.
 *
 * "Generic default" is the owner's term, replacing "house default" everywhere it was
 * user-facing. Named here rather than written into each screen so the two call sites in Profile.tsx and
 * any future picker cannot drift — which is how the old wording ended up in two places saying it twice.
 */
export const CLEARED_LABEL = 'Generic default'

export const PROFILE_FIELDS: readonly FieldSpec[] = [
  // ── who the brand owner is ──
  { key: 'name', label: 'Legal name', kind: 'text', group: 'identity',
    hint: 'Used so a search does not flag the client against their own marks. Should be the registered owner name.' },
  { key: 'matchDomains', label: 'Domains', kind: 'lines', group: 'identity',
    commaSeparated: true,
    // A hostname, not a URL: at least one dot, no scheme, no path, no spaces. Deliberately loose — this
    // refuses "http://example.com/x" and "not a domain", and does not attempt to know which suffixes
    // exist. A validator that rejects a real domain is worse than one that admits a fake one, because
    // only the first stops someone recording something true.
    item: { ok: (e) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(e),
            expected: 'a domain like example.com' },
    hint: 'Common law domains, e.g. example.com, one per line or comma-separated. Used to recognise the client.' },
  { key: 'selfExclusionOwners', label: 'Own trading names', kind: 'lines', group: 'identity',
    hint: 'One per line. Marks held by the client that should never be reported as a conflict with themselves.' },

  // ── what a clearance does when the request does not say ──
  // `industry` moved down out of the identity run: it scopes what a search LOOKS AT, which is a default,
  // not a fact about who the client is.
  // It had no hint at all, which left the first row of the project form an unlabelled box.
  { key: 'industry', label: 'Industry', kind: 'text', group: 'defaults',
    hint: 'The trade this name sits in. Sets the sector a matter is read against.' },
  { key: 'defaultClasses', label: 'Default classes', kind: 'numbers', group: 'defaults', picker: 'classes', hint: 'Default Nice classes, 1-45, always changeable at search time. Commas, spaces or new lines all work.' },
  { key: 'defaultJurisdictions', label: 'Default jurisdictions', kind: 'lines', group: 'defaults', commaSeparated: true,
    picker: 'territories',
    // ASSISTIVE, NOT STRICT ( item 7). The engine deliberately carries a territory it
    // does not recognise, so this must never refuse — it says so and stores it. What it replaces is
    // SILENCE: the field had no `item` at all, so `fieldNotices` returned nothing for anything, and the
    // owner's own example typed into the live page — "USFrance" — produced no notice whatsoever. That is
    // the whole of "the Check button appears to check nothing": the mechanism was present and unarmed on
    // the two fields he actually tested.
    //
    // The vocabulary is the composer's own, not a second list. A picker that suggests a territory the box
    // then flags as unknown would be two controls disagreeing under one label.
    item: { ok: isKnownTerritory, expected: 'a territory from the picker below' },
    hint: 'One per line or comma-separated. Searched by default unless a clearance specifies otherwise.' },
  { key: 'platforms', label: 'Marketplaces', kind: 'lines', group: 'defaults',
    // MIRRORS THE SERVER'S RULE, and this is a COPY because portal-ui cannot import from driver/ — the
    // same constraint the `defaultProduct` note below describes. A copy drifts silently, so
    // driver/test/the-marketplace-rule-is-the-same-on-both-sides.test.mjs reads both sources and fails
    // if they diverge. That arm is the reason this copy is allowed to exist.
    //
    // `driver/profiles.mjs platformEntryErrors` requires a bare store domain and REFUSES anything else —
    // a broken profile bricks every run under it. Typing "Amazon" here was accepted in silence by the
    // page and refused by the server, which is what "validation is bollox" describes (
    // items 4 and 7). The notice is a `check` rather than a refusal because this file never refuses.
    item: { ok: (e) => { const d = e.trim().toLowerCase()
                         return d !== 'web' && !/\s/.test(d) && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d) },
            expected: 'a bare store domain like amazon.com' },
    hint: 'One per line. A project can add to this list; it can never remove one.' },
  { key: 'riskAppetite', label: 'Risk appetite', kind: 'prose', group: 'defaults',
    // Level-NEUTRAL wording, deliberately: this same spec renders on the project form, where "how this
    // BRAND OWNER wants risk communicated" was describing the wrong thing entirely. And the two clauses
    // that survive the cut are the two the server enforces — plain prose, and never a rating input.
    hint: 'How risk is put to this client: what to lead with, how cautious to be. Example: "Lead with the biggest risk. Flag anything that could be a problem, even if unlikely." Changes how the report reads, never what is rated.' },
  // MARKETPLACE LISTING SIZE HAS NO CONTROL, ON ANY SURFACE. Owner ruling, 2026-08-29:
  // "if it doesn't actually affect search why is it there — get rid of it completely. there is no such
  // thing as staff only." It was removed from this page AND from the staff editor in the same change.
  //
  // THE STORED FIELD SURVIVES AND MUST. `marketplaceDensity: "dense"` shrinks the grid cell budget from
  // 98 to 16 so a byte-heavy marketplace's verbatim stdout cannot overflow the worker output channel and
  // truncate the ledger mid-JSON — a measured incident, cited by name above profiles.mjs gridCellBudget.
  // Three shipped profiles carry it today. It is set in the config bundle at onboarding and read by the
  // engine; what went away is asking a lawyer to answer it.
  //
  // OMITTING IT HERE DOES NOT DELETE IT — that is this file's seed-and-edit rule at the top, the same
  // ruling as `delivery.email` below. The STAFF editor had no such protection: it builds its payload
  // field by field, so dropping its input would have posted a profile with the key missing and the
  // server would have written that. driver/profile-service.mjs preserves it from disk instead, and
  // driver/test/a-removed-control-does-not-delete-the-setting-behind-it.test.mjs is what proves it.
  // Options are NOT listed here. The levels are a registry in driver/search-policy.mjs, which portal-ui
  // cannot import (separate workspace, self-contained bundle); a literal copy would drift silently the
  // first time a level is added. Profile.tsx loads them from api.searches() instead, which is that same
  // registry served over the wire.
  { key: 'defaultProduct', label: 'Default search depth', kind: 'choice', group: 'defaults',
    clearWith: '', customerOnly: true,
    // "Availability is confirmed when a run starts, not here" survives a cut to a third of the length,
    // because it is the only load-bearing clause: this page cannot check whether a depth is switched on,
    // and without saying so a lawyer reads a saved default as a guarantee.
    hint: 'The depth used when a request does not ask for one. Whether it is available is settled when the run starts, not here.' },
  // Both delivery sub-keys are customerOnly for a reason that is NOT the defaultProduct reason, so
  // it is spelled out separately below rather than folded into that paragraph.
  // `delivery.email` IS NOT RENDERED, and its absence is the same ruling as `template` below rather than
  // an oversight. The choice is dead in the engine: driver/profiles.mjs refuses any value but "summary"
  // and normalizeDelivery folds the retired "table" back to it at the single point every caller reads,
  // so both options composed the same cover note. A dropdown that cannot change anything is worse than
  // no dropdown — the defect class the knockout's Export menu closed, where a menu offered commands the
  // document could not run.
  //
  // NOT DELETED FROM STORED PROFILES, and it must not be: an unrendered key rides along untouched by
  // this file's own seed-and-edit rule, so a profile carrying `email: "summary"` keeps it and keeps
  // validating. Removing the control removes the choice, never the data.
  // THE "YES" OPTION IS GONE, and the field is NOT two-state (, the interim).
  //
  // `true` is retired: normalizeDelivery deletes it, so it renders identically to absent and the option
  // claimed a distinction the output cannot carry — the same defect as the Report email control above.
  //
  // WHAT MUST NOT HAPPEN HERE: this field stays THREE-STATE on the wire. `false` is a customer
  // instructing us to strip the confidentiality line and is a real instruction; absent is no opinion and
  // gets the default marking. Collapsing those two answered both with silence and shipped a clearance
  // with no line at all. Do not "simplify" this to a boolean.
  //
  // THE PAIR IS NAMED, and the interim's known cost is paid: the owner ruled "Privileged & Confidential"
  // / "No marking" on 2026-08-28. The cleared option carries its own words via
  // `clearedLabel` rather than the shared generic one, which is what stops a sweep of that shared label
  // renaming a legal marking by accident.
  { key: 'delivery.privileged', label: 'Privileged & Confidential header', kind: 'boolean', group: 'defaults', path: ['delivery', 'privileged'],
    // The owner's two words, ruled 2026-08-28. They are a PAIR and read as one:
    // the cleared option names the marking the report carries, this one names its removal. Neither
    // needs the other to be understood, which "The house default" against "No" did.
    choices: [{ value: 'no', label: 'No marking' }],
    clearedLabel: 'Privileged & Confidential',
    retiredValue: 'yes',
    customerOnly: true,
    hint: 'Marks the report and its cover note as privileged legal advice.' },
  // delivery.style and delivery.template are deliberately absent. `style` is prose that passes a second,
  // separate validator (assertContextPackShape) and needs a considered editor, not a text box; `template`
  // has exactly one legal value today, and a dropdown with one option is not a control.
]

/** Only these may appear in a project overlay — the rest are whole-customer by construction. */
export const PROJECT_EDITABLE = new Set([
  'platforms', 'defaultClasses', 'defaultJurisdictions',
  // `marketplaceDensity` stays in this set and is NOT a leftover: this set mirrors what the ENGINE
  // accepts in an overlay (profiles.mjs PROJECT_KEYS), which is a different question from what a form
  // offers. It has no control on any surface — see the tombstone above — so projectFields() renders
  // nothing for it either way.
  'marketplaceDensity', 'delivery', 'riskAppetite', 'industry', 'defaultProduct',
])

/**
 * The project-level view of PROFILE_FIELDS: identity and rating authority are simply not offered.
 *
 * `defaultProduct` is in PROJECT_EDITABLE — the engine genuinely accepts it in an overlay — and is
 * STILL withheld here, which looks like a contradiction and is not. The overlay save path preserves the
 * prior value when the field is omitted and REJECTS `""` outright (driver/profile-service.mjs, and I ran
 * the validator: the sparse path has no `""` ⇒ delete branch, so it 400s). Both halves of the three-way
 * are therefore unavailable to a project form: it could set an override and could never take one off
 * again. Offering a control that can only ever be turned on is worse than offering none, so the customer
 * form owns this field until the server learns the clear branch. Do not "fix" this by deleting the
 * filter — fix profile-service first.
 *
 * `delivery.email` and `delivery.privileged` are withheld for a DIFFERENT and more dangerous reason:
 * the engine replaces `delivery` WHOLESALE on merge (driver/profiles.mjs — `profile[f] = overlay[f]`,
 * and the comment there blesses replace for delivery deliberately, because engagements differ rather
 * than accumulate). The project editor seeds its draft from the SPARSE overlay, so touching one
 * sub-key would write `{delivery:{privileged:false}}` and permanently drop the customer's `email`
 * format along with `style` and `template`, which this form does not even render. The form would
 * still show "Inherited — table" while the engine had stopped inheriting: a control that silently
 * destroys data it claims to be inheriting.
 *
 * A project-level delivery override is legitimate and may be worth having. It needs the draft seeded
 * from the MERGED profile, or a per-sub-key merge in the engine — not a filter removal here.
 */
export const projectFields = (): readonly FieldSpec[] =>
  PROFILE_FIELDS.filter((f) => PROJECT_EDITABLE.has(rootKey(f)) && !f.customerOnly)

/**
 * The human label for a stored value, or null when there isn't one.
 *
 * Stored values and display values are not the same vocabulary, and for `defaultProduct` the gap
 * matters: the stored value is a registry key — `prelim-jx`, `knockout-register` — and
 * driver/search-policy.mjs reserves the display face to `stageLabel`. Rendering the raw key puts
 * internal vocabulary in front of a client, which is the same class of leak as an engine path.
 *
 * Returns null rather than falling back to the raw value ON PURPOSE, so every caller has to decide
 * what to show when no label is known instead of defaulting to the thing we must not print.
 */
export const choiceLabel = (spec: FieldSpec, value: string): string | null =>
  spec.choices?.find((c) => c.value === value)?.label ?? null

// ── parsing and formatting ──────────────────────────────────────────────────────────────────────────

/**
 * A list field, one item per line. Blank lines are dropped; ORDER AND CASE ARE PRESERVED.
 *
 * `commaSeparated` comes from the spec, never from a guess about the text: see FieldSpec.commaSeparated
 * for why the answer is per field. A field that does not opt in splits on newlines only, so a comma
 * inside a trading name survives as part of that name.
 */
export function parseLines(raw: string, commaSeparated = false): readonly string[] {
  const parts = commaSeparated ? raw.split(/[\n,]/) : raw.split('\n')
  return parts.map((s) => s.trim()).filter(Boolean)
}

/**
 * Nice classes. Out-of-range values are dropped rather than sent to be rejected; duplicates collapse.
 *
 * THE DROP IS NOT THE PROBLEM; THE SILENCE WAS. `[99]` saves today and the server's whole check is "an
 * array when present", so a value that is nearly right is accepted and quietly lost — the user believes
 * they recorded class 99 and the profile holds nothing. `rejectedNumbers` below names exactly what this
 * discarded, and the form prints it. Same parse, same stored value, no longer silent.
 */
export function parseNumbers(raw: string): readonly number[] {
  const seen = new Set<number>()
  for (const part of raw.split(/[\s,]+/)) {
    const n = Number(part.trim())
    if (Number.isInteger(n) && n >= 1 && n <= 45) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

/** The tokens `parseNumbers` threw away, in the order they were typed. Empty when it kept everything. */
export function rejectedNumbers(raw: string): readonly string[] {
  const out: string[] = []
  for (const part of raw.split(/[\s,]+/)) {
    const t = part.trim()
    if (!t) continue
    const n = Number(t)
    if (!(Number.isInteger(n) && n >= 1 && n <= 45)) out.push(t)
  }
  return out
}

/** Render a stored value into its editing box. Unknown shapes fall back to JSON rather than "[object Object]". */
export function toInput(value: unknown, kind: FieldKind): string {
  if (value == null) return ''
  if (kind === 'lines') return Array.isArray(value) ? value.map(String).join('\n') : String(value)
  if (kind === 'numbers') return Array.isArray(value) ? value.join(', ') : String(value)
  // A real boolean on disk becomes the yes/no the dropdown speaks. Anything else falls through to the
  // generic rendering rather than being coerced — a surprising value should be visible, not laundered.
  if (kind === 'boolean' && typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'string') return value
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
}

/**
 * toInput, for a spec that may address a nested value. The form of the call every screen should use.
 *
 * A `retiredValue` folds to the cleared state here rather than in each screen: both forms call this, and
 * a fold written into one of them is the shape was raised about.
 */
export const fieldInput = (source: Record<string, unknown>, spec: FieldSpec): string => {
  const shown = toInput(readField(source, spec), spec.kind)
  return spec.retiredValue !== undefined && shown === spec.retiredValue ? '' : shown
}

/**
 * Apply one edited field to a draft.
 *
 * Returns a NEW object, seeded from the draft, so keys this page never rendered survive the round trip.
 * An emptied field DELETES the key rather than storing "" or []: absent and empty mean different things
 * to the engine's validators, and an empty array is a real instruction ("no marketplaces") that a user
 * clearing a box did not necessarily intend to give.
 */
export function applyField(draft: Record<string, unknown>, spec: FieldSpec, raw: string): Record<string, unknown> {
  const next = { ...draft }
  const trimmed = raw.trim()

  if (!trimmed) {
    // A field whose server reads three states writes the cleared sentinel rather than dropping the key.
    // See FieldSpec.clearWith: for defaultProduct, an ABSENT key means "preserve", so deleting it
    // would leave the old depth in force while the page showed an empty box.
    if (spec.clearWith !== undefined) {
      next[spec.key] = spec.clearWith
      return next
    }
    if (spec.path) return clearPath(next, spec.path)
    delete next[spec.key]
    return next
  }

  const value: unknown =
    spec.kind === 'lines' ? parseLines(raw, spec.commaSeparated)
      : spec.kind === 'numbers' ? parseNumbers(raw)
        : spec.kind === 'boolean' ? trimmed === 'yes'
          : trimmed

  if (spec.path) return writePath(next, spec.path, value)
  next[spec.key] = value
  return next
}

/**
 * The editing state of one profile form: the parsed draft the save path posts, and the RAW text of
 * every field the user has touched since the form loaded.
 *
 * WHY THE RAW TEXT HAS TO BE KEPT, because deleting `edits` looks like a simplification and is the
 * defect this type exists for. The box is a controlled input. If its value is
 * re-derived from the draft on every keystroke — `fieldInput(draft, spec)` — then every keystroke is
 * parse-then-format, and BOTH halves of that round trip discard characters the user is mid-way through
 * typing. `parseLines` trims each entry, so the space in "US France" is eaten the instant it is typed
 * and the next character lands against the previous word: the owner's screen showed "USFrance" and
 * accepted it. The same trim drops the empty entry a newline makes, so Enter does nothing, while the
 * field's own hint promises "One per line". A `prose` field is trimmed too, so it cannot hold a
 * trailing space either. One cause, every list field on both forms.
 *
 * IT ALSO RESTORES A CONTRACT THIS MODULE ALREADY DOCUMENTS. `fieldNotices` and `chosenEntries` both
 * say they read the RAW text the user typed — "because the whole question is what the gap between them
 * was". Handed a re-derived value there is no gap, by construction, so the notices had nothing to
 * report and the Check button looked like it checked nothing. It was checking laundered input.
 *
 * `edits` is per LOAD, not per session: seeding a fresh profile or saving one clears it, so the boxes
 * go back to rendering what the server actually holds rather than what someone typed at it.
 */
export interface FormEdit {
  readonly draft: Record<string, unknown>
  readonly edits: Readonly<Record<string, string>>
}

/**
 * What a field's box shows: what the user has typed into it since the form loaded, else the stored
 * value rendered for editing.
 *
 * Untouched fields still render from the draft, so a form that loads shows the server's values and a
 * field nobody has touched never shows stale keystrokes.
 */
export function boxValue(state: FormEdit, spec: FieldSpec): string {
  const typed = state.edits[spec.key]
  return typed !== undefined ? typed : fieldInput(state.draft, spec)
}

/**
 * One edit: keep the text exactly as typed, and parse it into the draft the save path reads.
 *
 * PURE, and the whole transition rather than half of it, so an arm can type a string one character at a
 * time through the same code the screen runs — the thing the suite could not do when this page shipped
 * green at 491 arms and failed real use in thirty seconds.
 */
export function typeField(state: FormEdit, spec: FieldSpec, raw: string): FormEdit {
  return { draft: applyField(state.draft, spec, raw), edits: { ...state.edits, [spec.key]: raw } }
}

/**
 * What this input does to the stored value, beyond storing it.
 *
 * THE RULE THIS EXISTS FOR, in the owner's words: it should be easy to add or remove things and not
 * "wonder should they put a comma or new line". A hint that promises a format is only half the promise;
 * the other half is the form saying what it did when the text was not in that format. Until now the
 * server's entire check was "an array when present", so a nearly-right value was accepted and lost
 * without a word.
 *
 * THREE TONES, BECAUSE THREE DIFFERENT THINGS HAPPEN and collapsing them would put the lie back in a
 * different place. `dropped` means part of the input is NOT in the value about to be saved — the case
 * that used to be silent. `reshaped` means everything was taken, in a shape the user did not type.
 * `check` means it was taken exactly as typed and does not look like what the field expects.
 *
 * A SUSPECT ENTRY IS SAVED, DELIBERATELY. Refusing an odd-looking domain would stop someone recording
 * something true, and this validator does not know which suffixes exist; saying so and storing it is
 * the honest half. Only `dropped` may claim data did not survive, and only `numbers` produces it,
 * because only `parseNumbers` actually discards.
 *
 * PURE, so both forms can call it and an arm can drive it without a DOM. It reports on the RAW text the
 * user has typed, not on the parsed value, because the whole question is what the gap between them was.
 */
export type FieldNotice = { readonly tone: 'dropped' | 'reshaped' | 'check'; readonly message: string }

export function fieldNotices(spec: FieldSpec, raw: string): readonly FieldNotice[] {
  const out: FieldNotice[] = []
  if (!raw.trim()) return out

  if (spec.kind === 'numbers') {
    const bad = rejectedNumbers(raw)
    if (bad.length) {
      out.push({ tone: 'dropped',
        message: `Not saved: ${bad.join(', ')}. Nice classes are whole numbers from 1 to 45.` })
    }
    return out
  }

  if (spec.kind !== 'lines') return out

  const items = parseLines(raw, spec.commaSeparated)
  if (spec.commaSeparated && raw.includes(',')) {
    out.push({ tone: 'reshaped',
      message: `Saved as ${items.length} ${items.length === 1 ? 'entry' : 'separate entries'}. Commas and new lines both separate them.` })
  }
  if (spec.item) {
    const bad = items.filter((e) => !spec.item!.ok(e))
    if (bad.length) {
      out.push({ tone: 'check',
        message: `Saved, but check ${bad.join(', ')} — each entry should be ${spec.item.expected}.` })
    }
  }
  return out
}

/**
 * The entries a picker should show as chosen, read from the RAW box text.
 *
 * Reading the raw text rather than the parsed draft is what keeps the picker and the box the same
 * control: a person can type `9, 12` and see those two light up, and a person can click them and see
 * the text appear. Two states that can disagree is two controls wearing one label.
 */
export function chosenEntries(spec: FieldSpec, raw: string): readonly string[] {
  if (spec.kind === 'numbers') return parseNumbers(raw).map(String)
  return parseLines(raw, spec.commaSeparated)
}

/**
 * Toggle one entry in a field's raw text, and hand back the text.
 *
 * THE PICKER EDITS THE SAME STRING THE BOX DOES. It does not write the draft, so `applyField` stays the
 * one write path, the parsers stay the one parse, and `fieldNotices` keeps reporting on exactly the text
 * the user is looking at. A picker with its own write path would be a second way to set the field and a
 * second thing to keep in step — and the notices would report on text nobody had typed.
 *
 * Case-insensitive on removal, because the vocabulary's spelling and a typed spelling are both real:
 * someone who typed `united states` and then clicks United States means to turn it OFF, not to end up
 * with both.
 */
export function toggleEntry(spec: FieldSpec, raw: string, entry: string): string {
  const norm = (x: string) => x.trim().toLowerCase()
  const current = chosenEntries(spec, raw)
  const without = current.filter((e) => norm(e) !== norm(entry))
  const next = without.length < current.length ? without : [...current, entry.trim()]

  // Written back in the field's OWN shape, so the box reads the way its hint says it does.
  if (spec.kind === 'numbers') {
    return [...new Set(next.map((n) => Number(n)))].filter((n) => Number.isInteger(n)).sort((a, b) => a - b).join(', ')
  }
  return next.join('\n')
}

/**
 * Write one leaf inside a nested object, SPREADING every level rather than replacing it.
 *
 * The whole point: `delivery` on disk may carry `style` and `template`, which this page does not render.
 * Assigning `{ email: v }` over it would delete both — a form silently discarding what it does not know
 * about, one level below where this file's header rule was written. The rule holds at every depth.
 */
function writePath(draft: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = path
  if (head === undefined) return draft
  if (!rest.length) return { ...draft, [head]: value }
  const child = draft[head]
  const base = typeof child === 'object' && child !== null && !Array.isArray(child) ? (child as Record<string, unknown>) : {}
  return { ...draft, [head]: writePath(base, rest, value) }
}

/**
 * Delete one leaf inside a nested object, and PRUNE any container it just emptied.
 *
 * Leaving `delivery: {}` behind would validate — I checked — but it is a gratuitous change to a file
 * that is git-committed and read in review. Clearing the last sub-key should leave no trace.
 */
function clearPath(draft: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  const [head, ...rest] = path
  if (head === undefined) return draft
  const next = { ...draft }
  if (!rest.length) {
    delete next[head]
    return next
  }
  const child = next[head]
  if (typeof child !== 'object' || child === null || Array.isArray(child)) return next
  const pruned = clearPath(child as Record<string, unknown>, rest)
  if (Object.keys(pruned).length === 0) delete next[head]
  else next[head] = pruned
  return next
}

/**
 * Merge a project's marketplaces additively against its customer's.
 *
 * THE RULE: a project adds, never revokes. A customer mandating a marketplace has usually mandated it
 * for a contractual reason, and a project overlay quietly dropping one is a silent scope reduction that
 * shows up as a thinner search nobody asked for.
 *
 * Case-insensitive on comparison, but the CUSTOMER's spelling wins for anything both hold — one
 * canonical spelling per marketplace, chosen at the level that mandated it.
 */
export function mergePlatforms(
  customer: readonly string[] | undefined,
  project: readonly string[] | undefined,
): readonly string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of [...(customer ?? []), ...(project ?? [])]) {
    const k = String(p).trim()
    if (!k) continue
    const norm = k.toLowerCase()
    if (seen.has(norm)) continue
    seen.add(norm)
    out.push(k)
  }
  return out
}

/**
 * Would saving this overlay remove a marketplace the customer mandates?
 *
 * Returns the ones that would be lost. The page refuses the save and names them — a warning a user can
 * act on beats a merge that silently restores them, because the second leaves the user believing they
 * removed something they did not.
 */
export function revokedPlatforms(
  customer: readonly string[] | undefined,
  project: readonly string[] | undefined,
): readonly string[] {
  if (!Array.isArray(project)) return []
  const kept = new Set((project ?? []).map((p) => String(p).trim().toLowerCase()))
  return (customer ?? []).filter((p) => !kept.has(String(p).trim().toLowerCase()))
}

/** Strip the code-owned fields from a draft before sending. The server strips them too. */
export function stripCodeOwned(draft: Record<string, unknown>): Record<string, unknown> {
  const out = { ...draft }
  for (const f of CODE_OWNED) delete out[f]
  return out
}
