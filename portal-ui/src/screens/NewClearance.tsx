// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// New clearance — the only screen in the portal that can spend money.
//
// It is deliberately three states, not one form with a submit button:
//
//   COMPOSE  → what you want. Nothing has been sent.
//   REVIEW   → what the server says that actually IS. Still nothing spent; the server has handed back a
//              one-shot ticket good for ten minutes.
//   SUBMITTED→ queued. From here the Clearances list owns the story.
//
// The split exists because a clearance costs real money and takes real time, and a single button that
// does "validate, price and run" gives a user no moment at which they can see what they are about to buy.
// The plan call is free by construction — it mints a token and touches nothing else.
//
// THE RULE THAT SHAPES THE REST: the token is bound to the exact request that was previewed. Edit a
// class, a word of the goods, or a mark after previewing, and the ticket no longer matches. Rather than
// let the user discover that as a 409 at the last step, editing anything drops us back to COMPOSE and
// the ticket is discarded. The gate is still the wall — this just means honest users never meet it.
//
// ── YOU PICK A SEARCH, AND THE FORM CHECKS IT AGAINST WHAT THAT SEARCH IS ───────────────────────────
//
// There are four searches and a client buys one of them (contract/composerProduct.ts, over the engine's
// driver/products.mjs). This screen names the one being ordered and states what it accepts — the
// geography, the name count, whether the native-language investigation is offered or automatic — so the
// contradiction is visible while it is being made rather than at the review step.
//
// ── THE LAYOUT ──────────────────────────────────────────────────────────────────────────────────────
//
// One form, top to bottom: the company, Describe it, Names to clear, Where, Goods or services, Context,
// the company card, Which search with its two folds, then the pinned footer. No fork and no steps.
//
// THE FOOTER IS A CHILD OF `.screen`, NOT of the 720px column, and its negative margins bleed it to the
// full content width (`.composer-footer` in base.css). Sticky is defeated by any ancestor whose overflow
// is not visible, which is why it cannot live inside a measured column that might one day gain one.
//
// ── TWO VOCABULARIES, KEPT APART ────────────────────────────────────────────────────────────────────
//
// THE PRODUCT is which machinery runs. SCOPE is where it points: territories, classes, marketplaces.
// They are separate because they are priced separately, and because for a clearance the scope is also
// what DECIDES the product — one country is a Full country search, a region or two-or-more a
// Multi-country focus search. Exactly ONE selector goes on the wire, `product` or `recipeKey` (the
// engine refuses both), which is why picking a saved search suppresses the product picker.
//
// THE SCOPE FIELDS ARE GHOSTS, NOT BLANKS. Untouched means "use what the company already has" — the
// context card shows what that is, tagged with where it came from — and the server's precedence ladder
// resolves it. An empty territory list is not a request to search nowhere; it is worldwide, in this
// screen and in the engine alike. The summary quotes the SERVER's scope and never echoes this form.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  Plan, Result, Searches, SavedSearchDetail, ProjectSummary, ProjectDetail, ProfileConfig, Usage,
  ReadCapability, Product,
} from '../contract/api.ts'
import { api, isOk, operatorName, notCommitted } from '../contract/api.ts'
import { engineNotice } from '../contract/engineState.ts'
import { parseNames, parseList } from '../contract/compose.ts'
import type { Draft as Pick, EffortInput } from '../contract/composerProduct.ts'
import {
  EMPTY_DRAFT, blockers, runCount, turnaround, turnaroundInWords, checksSummary, runsNote, machineryFor,
  territoryMatches, addTerritory, removeTerritory, reachesTerritory, vocabularyFor, offerableFor,
  inherited, composeSaved, draftFromSaved, nameBudget, missingPieces, readiness,
  chooseProduct, geographyFor, geographyNote, nativeLanguageControl, toggleNativeLanguage,
  recommendSearch, templateLine, territoryCode, joinAnd, nativeLanguageLine, firstAndMore,
} from '../contract/composerProduct.ts'
import { productMatrix, LEGEND } from '../contract/productMatrix.ts'
import { classLabel, classMatches, isClassNumber } from '../contract/niceClasses.ts'
import { sortOwners } from '../contract/ownerNames.ts'
import { sortSavedSearches, displayLabel } from '../contract/savedSearches.ts'
import type { BriefRead, ReadTarget } from '../contract/composeRead.ts'
import { resolveRead, applyRead, appliedNotes, defaultNotes, unsureNotes } from '../contract/composeRead.ts'
import { Icon } from '../components/Icon.tsx'
import { useLoad } from '../state/useApi.ts'
import { useUnsaved, unsavedChanges } from '../state/useUnsaved.ts'
import type { ShellContext } from '../shell/AppShell.tsx'
import { CompanyGate } from '../shell/CompanyPicker.tsx'
import { takeCreated, createdStrip } from '../contract/companyCreated.ts'
import type { CreatedCompany } from '../contract/api.ts'
import { seesEverything } from '../shell/permissions.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { allowanceLine, searchesLeft } from '../contract/allowance.ts'

/**
 * What a read did, in three separable parts, because they are three different kinds of claim.
 *
 * `read` is derived from the diff — a fact about the screen, what the read PUT on the form. `defaults`
 * is what the search will use that the text did not say: the company's own classes. `unsure` is the
 * model's own commentary, labelled as such, and what this composer could not place — OUR limitation,
 * owned rather than hidden: a territory silently discarded is a territory the user believes they are
 * paying to search.
 */
type Receipt = {
  readonly read: readonly string[]
  readonly defaults: readonly string[]
  readonly unsure: readonly string[]
}

/**
 * A failed read, as a sentence.
 *
 * The server already writes the sentence for everything it knows about (`error` carries prose on this
 * service, never a code), so this exists for the transport-level cases where there is no server
 * opinion to quote.
 */
function readProblem(r: Result<BriefRead>): string {
  switch (r.kind) {
    case 'reject': case 'collision': case 'clarify':
      return ('errors' in r ? r.errors : r.questions).join(' ')
    case 'gate': case 'conflict': case 'upstream':
      return r.message
    case 'rateLimited':
      return 'That is a lot of reading in one hour — set this one up below.'
    case 'tooLarge':
      return 'That brief is too long to send — paste the part that matters.'
    default:
      // pickAccount / noAccess / notFound on a route that takes no account: not reachable, and a
      // sentence beats a blank box if it ever becomes so.
      return 'That could not be read — set the search up below.'
  }
}

type Draft = {
  /** WHICH PRODUCT and WHERE — the two things that decide what this search is. */
  readonly pick: Pick
  /** A saved search slug. Set ⇒ it supplies the product and none is sent alongside it. */
  readonly savedSearch: string
  readonly project: string
  readonly names: string
  /**
   * The class OVERRIDE, and null while untouched.
   *
   * Null and [] are different statements. Null means "whatever the company already has", which the
   * card shows and the server resolves; [] means the user cleared every class, which the composer sends
   * as no class list at all rather than silently reinterpreting.
   */
  readonly classes: readonly number[] | null
  readonly goods: string
  readonly platforms: string
  readonly ref: string
  readonly deadline: string
  readonly instructions: string
  readonly brief: string
}

const EMPTY: Draft = {
  pick: EMPTY_DRAFT, savedSearch: '', project: '', names: '', classes: null, goods: '',
  platforms: '', ref: '', deadline: '', instructions: '', brief: '',
}

export function NewClearance({ ctx }: { readonly ctx: ShellContext }) {
  // Who this is FOR. A staff member must say; a single-account client has it resolved server-side.
  const account = ctx.owner
  const needsOwner = ctx.me.allAccounts && account === null

  // `reload` is wired to a retry button below. A composer that cannot fetch its own depth menu has
  // nothing to poll for and nothing to recover on its own, so the user needs a way to ask again.
  const { result: searches, reload: retrySearches } = useLoad(() => api.searches(account), [account])
  // The company's own defaults, for the context card and the effort model. A failure here is
  // survivable — the card falls back to plain words — so it never gates the form.
  const { result: profileRes } = useLoad(() => api.profile(account), [account])
  const { result: projectsRes } = useLoad(() => api.projects(account), [account])
  const { result: usageRes } = useLoad(() => api.usage(account), [account])

  const levels = searches?.kind === 'ok' ? searches.value.products : []
  // §B — the depth ladder, derived from the payload's own effort figures rather
  // than written here, so it agrees with the comparison table's column order by construction.
  // — which territories the wired register can search. UNDEFINED when the server did not say and
  // NULL when the register declares no restriction; both leave the picker offering everything, and only
  // an array narrows it. Threaded rather than read inside the contract functions so those stay pure.
  const registerTerritories = searches?.kind === 'ok' ? searches.value.registerTerritories : undefined
  const savedSearches = searches?.kind === 'ok' ? searches.value.recipes : []
  // Unavailable until a loaded payload says otherwise — the same fail-dark rule the decoder applies,
  // repeated here so a screen drawn before the fetch lands cannot briefly offer a live button.
  const readCan: ReadCapability = searches?.kind === 'ok'
    ? searches.value.read
    : { available: false, maxBrief: 12000, note: null }
  // ARCHIVED PROJECTS ARE NOT OFFERED. Archiving one means "this engagement is over"; still listing it
  // where a new clearance is set up is the one thing it must stop doing. The wire carries archived rows
  // now — for both roles, so that the Projects screen can show them greyed and bring them back — which
  // makes filtering here load-bearing rather than belt and braces. Selecting an archived project was
  // already possible for staff before that change; this closes it for everyone.
  const projects: readonly ProjectSummary[] = (projectsRes?.kind === 'ok' ? projectsRes.value : [])
    .filter((p) => !p.archived)
  const profile: ProfileConfig | null = profileRes?.kind === 'ok' ? profileRes.value : null
  const usage: Usage | null = usageRes?.kind === 'ok' ? usageRes.value : null

  const [draft, setDraft] = useState<Draft>(EMPTY)
  /**
   * Whether the reader has chosen a search themselves — a row, a template, the name wall's way through,
   * or a brief that asked for one. Until they have, the search that fits what they entered is selected
   * for them; once they have, nothing moves it but them.
   */
  const [pickedByHand, setPickedByHand] = useState(false)
  const [territoryQuery, setTerritoryQuery] = useState('')
  const [classQuery, setClassQuery] = useState('')
  const [showAllShops, setShowAllShops] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveText, setSaveText] = useState('')
  const [saveNote, setSaveNote] = useState<string | null>(null)
  /**
   * The name a save just wrote, held so the footer can confirm it where the button was.
   *
   * Separate from `saveNote`, which is the full sentence including the warning a live-but-uncommitted
   * write carries. This is the acknowledgement — short enough to sit in the action row, and cleared the
   * moment the form changes again, because a tick beside edited work is a lie about what is on disk.
   */
  const [saveDone, setSaveDone] = useState<string | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  /** A refusal from the RUN door, shown inside the dialog. Separate from `problem`, which belongs to
   *  the form and is read while composing — this one is read at the moment of pressing the button. */
  const [runFailure, setRunFailure] = useState<{ readonly title: string; readonly lines: readonly string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ readonly title: string; readonly lines: readonly string[] } | null>(null)
  const [submitted, setSubmitted] = useState<string | null>(null)

  /**
   * WHAT THE FORM LOOKED LIKE WHEN IT WAS LAST WRITTEN DOWN, serialised. Null until something is.
   *
   * The unsaved-changes guard had no such baseline: it compared the draft against EMPTY and nothing
   * ever reset it, so a form that had just been saved still counted as unsaved work. Someone saved a
   * search, was warned on the way out that they would lose it, came back, and found it had been there
   * all along. The warning was false and the save looked like it had failed — one missing term causing
   * both halves of what they reported.
   */
  const [savedDraft, setSavedDraft] = useState<string | null>(null)

  // WHERE A SAVE LEAVES FOR, AND IT LEAVES AFTER THE RENDER THAT MAKES THIS PAGE CLEAN. The unsaved guard
  // reads its flag through a ref written during render and asks at the moment of navigation, so a `go`
  // straight after `setSavedDraft` asked it before React had re-rendered: saving an edited template was
  // answered with "Leave this page? You have changes here that have not been saved" about the save that
  // had just landed. The create-company form learned the same thing, the same way.
  const [leaveTo, setLeaveTo] = useState<string | null>(null)
  useEffect(() => {
    if (leaveTo) ctx.go(leaveTo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveTo])

  // A composed-but-unsent clearance is unsaved work like any form's, and this is the screen where losing
  // it costs the most — it can be twenty names, a goods description and a set of levers. EMPTY is the
  // baseline a fresh composer has, `savedDraft` the one it earns; once submitted there is nothing left
  // to lose, so the guard stands down and "Start another" stays one click.
  const composerDirty = useMemo(
    () => unsavedChanges({
      current: JSON.stringify(draft),
      empty: JSON.stringify(EMPTY),
      saved: savedDraft,
      submitted: submitted != null,
    }),
    [draft, submitted, savedDraft],
  )
  useUnsaved(composerDirty)

  // The project's own resolved configuration, which is what makes the card's `from <project>` tag true
  // rather than a guess. Fetched only when one is selected.
  const { result: projectRes } = useLoad<ProjectDetail | null>(
    () => (draft.project
      ? api.project(account, draft.project)
      : Promise.resolve({ kind: 'ok', value: null } as Result<ProjectDetail | null>)),
    [account, draft.project],
  )
  const projectDetail = projectRes && projectRes.kind === 'ok' ? projectRes.value : null

  // ── EDITING A SAVED SEARCH ─────────────────────────────────────────────────────────────────────
  //
  // `/portal/new?search=<slug>` opens this screen over an existing saved search. It is the same screen
  // doing the same thing — a saved search IS a set of levers with a name on it — which is why the
  // standalone editor that used to duplicate this form could be retired rather than kept in step with
  // it. Custom searches links here; nothing else does.
  //
  // Read once from the URL rather than held in state: the address bar is what makes this linkable, and
  // a second copy of the answer is a second thing to keep true.
  const editingSlug = useMemo(
    () => new URLSearchParams(window.location.search).get('search') || null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const { result: editingRes } = useLoad(
    () => (editingSlug
      ? api.savedSearch(account, editingSlug)
      : Promise.resolve({ kind: 'ok', value: null } as Result<SavedSearchDetail | null>)),
    [account, editingSlug],
  )
  const editing = editingRes?.kind === 'ok' ? editingRes.value : null
  /** Null ⇒ the composer cannot express this record. See `draftFromSaved` — it refuses rather than approximates. */
  const editingPick = useMemo(() => (editing ? draftFromSaved(editing.recipe, levels) : null), [editing, levels])

  // Hydrate ONCE per record. Keyed on the sha so a reload of the same record does not stamp over edits
  // the user has made since it arrived — the sha is the record's identity, and it is already fetched.
  const hydrated = useRef<string | null>(null)
  useEffect(() => {
    if (!editing || !editingPick) return
    if (hydrated.current === editing.sha) return
    hydrated.current = editing.sha
    const scope = (editing.recipe['scope'] ?? {}) as Record<string, unknown>
    const classes = Array.isArray(scope['classes']) ? (scope['classes'] as unknown[]).filter((c): c is number => typeof c === 'number') : []
    const platforms = Array.isArray(scope['platforms']) ? (scope['platforms'] as unknown[]).filter((p): p is string => typeof p === 'string') : []
    writeDraft((d) => ({
      ...d,
      pick: editingPick,
      // NOT `savedSearch`: that key means "run this saved search as-is", which hides the picker. Editing
      // is the opposite — the product and its geography ARE the thing being edited, so they are set
      // directly.
      savedSearch: '',
      // [] and null are different statements here (see Draft.classes). A saved search that names no
      // class is inheriting, so it hydrates as null, not as "the user cleared every class".
      classes: classes.length ? classes : null,
      platforms: platforms.join(', '),
    }))
    setSaveOpen(true)
    setSaveName(typeof editing.recipe['label'] === 'string' ? editing.recipe['label'] : '')
    setSaveText(typeof editing.recipe['notes'] === 'string' ? editing.recipe['notes'] : '')
  }, [editing, editingPick])

  const names = useMemo(() => parseNames(draft.names), [draft.names])

  // The company as a PERSON reads it. `profile.account` is the account key the server echoed back,
  // which is a slug — printing it here put "vantor" in the context card while the rail beside it
  // said "Vantor Labs". Resolved through the shell's one resolver so those two can never disagree.
  // The company as a PERSON reads it. The fallback used to be `profile.account` — the account key
  // the server echoes back — so whenever no owner was in view this card printed "vantor" beside a
  // rail that said "Vantor Labs". A slug is never the answer to "who is this for"; when there is no
  // owner in view the honest answer is a phrase, not a key.
  const ownerLabel = account ? ctx.ownerName(account) : 'this company'
  const projectLabel = projects.find((p) => p.key === draft.project)?.name || draft.project || null

  const own = useMemo(
    () => inherited({
      profile: profile?.profile ?? null,
      projectEffective: projectDetail?.effective ?? null,
      projectOrigins: projectDetail?.origins ?? null,
      ownerLabel,
      projectLabel,
    }),
    [profile, projectDetail, ownerLabel, projectLabel],
  )

  // What this search will be scoped to: the override if the user set one, else what is inherited.
  const classes = draft.classes ?? own.classes


  // The row this draft is running, when it is running one. Looked up ONCE: the depth, the gates and the
  // "Start point" line all have to be answering about the same record, and three separate finds is
  // three chances for them to stop doing so.
  const savedRow = draft.savedSearch
    ? (savedSearches.find((r) => r.slug === draft.savedSearch) ?? null)
    : null

  // WHICH PRODUCT is in play. A saved search carries its own, so the pick is not the answer when one is
  // chosen. One lookup: the geography panel, the name limit, the effort bar and the footer all have to
  // be answering about the same product, and four separate finds is four chances for them to stop.
  const activeBase = draft.savedSearch ? (savedRow?.base ?? draft.pick.product) : draft.pick.product
  const activeLevel = useMemo(() => levels.find((l) => l.key === activeBase) ?? null, [levels, activeBase])
  const activePipeline = activeLevel?.pipeline ?? null
  // A quick screen has no marketplace grid for a shop to be swept in, so the engine refuses the
  // combination. Offering the control anyway would be an invitation to a refusal.
  //
  // FALSE ONLY FOR A KNOCKOUT, never for "nothing picked yet". The account's own shops are a fact about
  // the account and they are swept by every clearance, so the card that shows them belongs on screen
  // before a product is chosen — reading `=== 'clearance'` blanked it at rest, which is the one moment
  // it is doing its whole job: telling somebody what they already carry, before they choose.
  const marketplacesApply = activePipeline !== 'knockout'
  // Which geography control this product gets, and what it says at that control. Both come off the
  // OFFERING rather than being decided here, so the screen cannot offer a shape the wall refuses.
  // WHICH SEARCH THE WHERE PANEL FITS ITSELF TO. A search the reader chose — a row, a brief that asked for
  // one, a template, the record being edited — shapes the picker. One the form PRESELECTED does not: it
  // follows the places, so it must not narrow them. A preselected one-country search would replace the
  // first country with the second, and the recommendation could then never reach the search that reads
  // both — the reader would be steered by their own first keystroke.
  const whereLevel = pickedByHand || draft.savedSearch || editingSlug ? activeLevel : null
  const geoNote = geographyNote(whereLevel)
  const nativeControl = nativeLanguageControl(activeLevel)
  const machinery = machineryFor(draft.pick, activeLevel)
  // THE WAY THROUGH THE NAME WALL, found in the offering rather than named here: whichever product reads
  // the most names. If a deployment offers none that reads more than one, the wall says so and offers
  // nothing — which is honest, where a dead button pointing at a product that is not there is not.
  const knockout = useMemo(
    () => levels.filter((l) => l.available && l.maxNames > 1).sort((a, b) => b.maxNames - a.maxNames)[0] ?? null,
    [levels],
  )

  const effort: EffortInput = {
    levers: machinery,
    names: names.length,
    classes: classes.length,
    // The account's shops PLUS any typed for this search. Without the second half, promoting the add
    // control above would have made it a control that changes the search and reports nothing: extras go
    // on the wire (`bodyFor`), the engine runs a grid column for each, and checksPerName / runCount /
    // the footer would all have sat still while it did.
    platforms: marketplacesApply ? own.platforms.length + parseList(draft.platforms).length : 0,
    density: own.density,
  }

  /**
   * THE ONE WRITER OF THE DRAFT — and the reason it exists is the acknowledgement.
   *
   * A tick reading "Saved as X" beside a form that has changed since is a false statement about what is
   * on disk, and a worse defect than the silence it replaced. Clearing it in `edit` covers the levers
   * and the fields; it does NOT cover the brief reader, which writes the draft directly and would have
   * left the tick standing over a form it had just rewritten — the same claim, on the one path most
   * likely to change everything at once.
   *
   * So every write goes through here and `setDraft` is called in exactly one place. That is a property
   * a test can check by counting, which is what `newClearanceStructure.test.ts` does: the next writer is
   * covered because there is nowhere else to write.
   *
   * The unsaved-changes baseline is deliberately untouched. That comparison is what NOTICES the edit,
   * and resetting it here would put the guard back where it started.
   */
  const writeDraft: typeof setDraft = (next) => {
    setSaveDone(null)
    setDraft(next)
  }

  // Any edit invalidates the preview. See the header note: the server would refuse the stale ticket
  // anyway, so the only question is whether the user finds out now or after pressing the money button.
  const edit = (patch: Partial<Draft>) => {
    writeDraft((d) => ({ ...d, ...patch }))
    setPlan(null)
    setProblem(null)
    setSaveNote(null)
  }
  const setPick = (next: Pick) => edit({ pick: next })

  // ── THE SEARCH THAT FITS WHAT WAS ENTERED ─────────────────────────────────────────────────────────
  //
  // The rows tag it, and until the reader chooses a search themselves it is the one selected. Nothing is
  // selected on an untouched form — `recommendSearch` answers null until a name or a place is entered —
  // and nothing moves a search the reader picked, a template, or a record being edited.
  const recommendation = useMemo(
    () => recommendSearch(levels, names.length, draft.pick.territories),
    [levels, names.length, draft.pick.territories],
  )
  useEffect(() => {
    if (pickedByHand || draft.savedSearch || editingSlug || !recommendation) return
    if (draft.pick.product === recommendation.product.key) return
    // Through `chooseProduct`, like every other product change, so nothing is left set-but-hidden. It
    // cannot take a place away here: the recommendation is read off these same places.
    edit({ pick: chooseProduct(draft.pick, recommendation.product) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendation?.product.key, pickedByHand, draft.savedSearch, editingSlug])

  // ── reading a brief ───────────────────────────────────────────────────────────────────────────────
  //
  // The receipt lives beside the button rather than replacing the brief: the paragraph the user pasted
  // stays exactly where it was, because a form filler that eats its own input leaves nothing to correct
  // from if it read badly. The brief itself is NOT sent with the request — see `bodyFor` and DescribeIt.
  const [reading, setReading] = useState(false)
  const [readErr, setReadErr] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  const doRead = async () => {
    setReading(true)
    setReadErr(null)
    setReceipt(null)
    const r = await api.composeRead(draft.brief)
    setReading(false)
    if (!isOk(r)) {
      setReadErr(readProblem(r))
      return
    }
    const { read, dropped, worldwide } = resolveRead(r.value)
    // A brief that ASKS for a search has chosen one, exactly as pressing its row would.
    if (read.product != null) setPickedByHand(true)
    // The diff is taken against the draft as it stands NOW, inside the setter, so a read that lands
    // after the user has carried on typing applies to what is on screen rather than to a stale copy.
    writeDraft((d) => {
      const before: ReadTarget = { draft: d.pick, names: d.names, classes: d.classes, goods: d.goods, ref: d.ref, deadline: d.deadline }
      // The owner's own classes travel with it: a ghost list materialises FROM them, never from empty.
      // `worldwide` is the one instruction allowed to remove chips — a brief that says everywhere over
      // a draft naming France. It is stated in the receipt; see applyRead for why it is the exception.
      let after = applyRead(before, read, own.classes, { worldwide })
      // A BRIEF THAT NAMES NO SEARCH gets the one that fits what it filled in — the same one the rows
      // tag — applied in this same write, so the receipt's Search line says which, and why. Never over
      // a search the reader chose, and never over a template, which carries its own.
      const fits = recommendSearch(levels, parseNames(after.names).length, after.draft.territories)
      if (read.product == null && !pickedByHand && !d.savedSearch && fits) {
        after = { ...after, draft: chooseProduct(after.draft, fits.product) }
      }
      const reason = fits && after.draft.product === fits.product.key ? fits.reason : null
      setReceipt({
        read: appliedNotes(before, after, own.classes, levels, reason),
        defaults: defaultNotes(read, after, own.classes),
        unsure: unsureNotes(read.notes, dropped),
      })
      // NAMED, not spread wholesale. `ReadTarget` calls the product-and-geography half `draft` and this
      // component calls it `pick`, so `{ ...d, ...after }` quietly wrote a `draft` key nobody reads and
      // left `pick` exactly as it was — a brief that said "everywhere" cleared nothing, silently, which
      // is the one failure the worldwide path exists to remove.
      const { draft: pick, ...rest } = after
      return { ...d, ...rest, pick }
    })
    setPlan(null)
    setProblem(null)
    setSaveNote(null)
  }

  const bodyFor = () => ({
    ...(names.length > 1 ? { marks: names.map((n) => ({ name: n })) } : { markName: names[0] ?? '' }),
    // Only an explicit override travels. Untouched leaves the field off the wire entirely, so the
    // server's ladder resolves it and the review step reports what it actually resolved.
    ...(draft.classes && draft.classes.length ? { classes: [...draft.classes] } : {}),
    goods: draft.goods.trim(),
    // EXACTLY ONE selector. The engine clarifies when both are set, and it is right to — a saved search
    // already carries a product, so naming one alongside it is a contradiction, not an override.
    ...(draft.savedSearch ? { recipeKey: draft.savedSearch } : draft.pick.product ? { product: draft.pick.product } : {}),
    ...(draft.project ? { projectKey: draft.project } : {}),
    // GEOGRAPHY, STATED. The territory list alone could not tell "everywhere" from "I said nothing", and
    // the engine's ladder resolves the second to the account's own territories — so a screen that
    // promised worldwide ran seven countries and no field anywhere disagreed. The stamp says which.
    ...(draft.pick.territories.length ? { jurisdictions: [...draft.pick.territories] } : {}),
    geography: { mode: geographyFor(draft.pick).mode },
    ...(marketplacesApply && parseList(draft.platforms).length ? { platforms: parseList(draft.platforms) } : {}),
    // The ONE toggle in the offering, and only TRUE travels: it can add the native-language
    // investigation and can never take one away, so an explicit false would imply a suppression that
    // does not exist. Sent only where the product OFFERS it — on a Full country search it is automatic
    // and the request must not claim to have bought it, and on the other two it is refused.
    //
    // A SAVED SEARCH CARRIES ITS OWN. The toggle is behind the notice while a recipe is selected, so a
    // flag sent from there is one the user cannot see, cannot switch off, and did not choose.
    ...(!draft.savedSearch && nativeControl === 'toggle' && draft.pick.nativeLanguage ? { nativeLanguage: true } : {}),
    ...(draft.ref.trim() ? { ref: draft.ref.trim() } : {}),
    ...(draft.deadline.trim() ? { deadline: draft.deadline.trim() } : {}),
    ...(draft.instructions.trim() ? { upfrontInstructions: draft.instructions.trim() } : {}),
  })

  const explain = (r: Exclude<Awaited<ReturnType<typeof api.plan>>, { kind: 'ok' }>) => {
    switch (r.kind) {
      case 'clarify':
        return { title: 'A few things need answering first', lines: r.questions }
      case 'reject':
      case 'collision':
        return { title: 'That cannot be searched as written', lines: r.errors }
      case 'gate':
        // Verbatim: these seven strings are written to be read by a human and say precisely what to do.
        return { title: 'The request changed', lines: [r.message] }
      case 'rateLimited':
        return { title: 'Too many requests just now', lines: ['Wait a moment and try again.'] }
      case 'pickAccount':
        return { title: 'Choose a company', lines: ['Pick the company this clearance is for, then start the search.'] }
      case 'notFound':
        return { title: 'That is not available to you', lines: ['Check which company is selected.'] }
      // SPLIT FROM `notFound`. They are different answers and only one of them has
      // anything to do with the selector. `notFound` may well BE the wrong company, so that advice is
      // right there. `noAccess` is the door refusing the identity itself — reachable only for door checks,
      // never for anything tenant-scoped — and telling that person to check the selector sends them to the
      // one thing that is not wrong. Someone who signs in successfully and can do nothing should be told
      // why on the page, not in a boot log nobody reads.
      //
      // The words are the door's own: the page it serves an address with no access says the same thing.
      // Nothing here is tenant-scoped, so it leaks nothing the 404-never-403 rule protects — it is a fact
      // about the caller's own identity, and it is the only fact that helps them.
      case 'noAccess':
        return {
          title: 'This address has no access yet',
          lines: ['You are signed in, but this address has not been given access to the portal, so every page refuses it. Selecting a different company cannot change that — someone who can add people here needs to add it.'],
        }
      case 'tooLarge':
        return { title: 'That is too much to send at once', lines: ['Shorten the goods description, or split the names across two searches.'] }
      case 'conflict':
        return { title: 'That was changed elsewhere', lines: [r.message] }
      case 'upstream':
        // A 502 from the run door means the request never reached the engine. The server's message
        // already says nothing was started and nothing was charged — which is the only thing a user
        // actually needs — so it is rendered as-is under a title that does not read as a crash.
        return { title: 'The search was not started', lines: [r.message] }
      default:
        return { title: 'Something went wrong', lines: ['Try again shortly.'] }
    }
  }

  const doPlan = async () => {
    setBusy(true)
    setProblem(null)
    const r = await api.plan(account, bodyFor())
    setBusy(false)
    if (isOk(r)) {
      setPlan(r.value)
    } else {
      setPlan(null)
      setProblem(explain(r))
    }
  }

  const doRun = async () => {
    if (!plan) return
    setBusy(true)
    setProblem(null)
    const r = await api.run(account, { ...bodyFor(), confirmationToken: plan.confirmationToken })
    setBusy(false)
    if (isOk(r)) {
      // ── — A DEMO LANDS ON THE REPORT, it does not report a start ───────────
      //
      // Ruling: pressing New clearance in a demo walks the real flow "and then lands on one of the
      // four preloaded finished runs … the visitor sees the ordering experience end to end and reads a
      // real report at the end of it, which is the whole demo in one press."
      //
      // Decided by the SERVER's answer, never by the client's idea of whether it is in a demo: a browser
      // that inferred it would open a report instead of starting a clearance the day that inference went
      // wrong, on the one screen that spends money. `landedOn` is null on every real order.
      //
      // AND IT MUST NOT SAY THE RUN IS NEW. `Submitted` is the "your clearance has started" panel; going
      // there and then to the report would tell the visitor a run began that never did. Straight to the
      // report, which is dated as it is and says on its own face that it is an example.
      if (r.value.landedOn) {
        setPlan(null)
        setRunFailure(null)
        ctx.go(`/portal/result/${encodeURIComponent(r.value.landedOn)}`)
        return
      }
      setSubmitted(r.value.id)
      setPlan(null)
      setRunFailure(null)
    } else {
      // THE REFUSAL STAYS WHERE THE EYE IS.
      //
      // This used to close the dialog and write the reason into a banner near the bottom of a form
      // that is several screens tall, just above the sticky footer. Press Start while scrolled
      // anywhere else and the entire visible result was: the dialog vanishes. Nothing else. Which is
      // exactly what was reported on 2026-07-22 — "clicked go, and then... nothing" — for a run the
      // server had refused with a perfectly clear sentence nobody could see.
      //
      // So the dialog stays open and shows it. The ticket is spent or stale either way, so the Start
      // button is replaced by "Review again", which re-plans rather than pretending it can retry.
      setRunFailure(explain(r))
    }
  }

  /**
   * Save these levers as a reusable search — creating one, or updating the one being edited.
   *
   * Composed by `composeSaved`, which stores the DERIVED level — so the saved search runs the product the
   * footer just named — and only the scope the user explicitly set, never today's resolved ghosts.
   *
   * THE SLUG IS THE RECORD'S IDENTITY, so an edit keeps the one it arrived with. Re-deriving it from the
   * label would turn every rename into a new saved search beside the old one, which is not what renaming
   * something means. A create has no slug yet and derives one from the name, as it always has.
   */
  const doSave = async () => {
    // Cleared FIRST. Every branch below either replaces it or reports a failure, and a tick from an
    // earlier save sitting beside "that could not be saved" is the same false claim in its worst place.
    setSaveDone(null)
    const label = saveName.trim()
    const slug = editingSlug ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 39)
    if (slug.length < 2) {
      setSaveNote('That name needs at least two letters or numbers in it.')
      return
    }
    const record = composeSaved({
      label,
      draft: draft.pick,
      classes: draft.classes ?? [],
      platforms: marketplacesApply ? parseList(draft.platforms) : [],
      notes: saveText,
      // A save REPLACES the record, and this screen cannot express everything one may hold (extras, a
      // component with no lever, the retired flag). On an update the previous record is passed so those
      // survive; on a create there is nothing to survive.
      ...(editing ? { prior: editing.recipe } : {}),
    })
    // NULL means no product is picked, and composeSaved refuses to pick one. `canSave` is gated on
    // blockers() so the button is not even rendered in that state — this is the wall behind it, and it
    // says the same thing the blocker says rather than saving a different search than the one on screen.
    if (!record) {
      setSaveNote('Pick one of the four searches first — there is nothing to save yet.')
      return
    }
    setBusy(true)
    const r = await api.saveSavedSearch(account, slug, 'save', {
      recipe: record,
      // Optimistic concurrency, but only where there is a version to name: a create has none, and
      // claiming one would be inventing a fact about a record that does not exist yet.
      ...(editing && typeof editing.recipe['version'] === 'number' ? { expectedVersion: editing.recipe['version'] } : {}),
    })
    setBusy(false)
    if (isOk(r)) {
      // ── THE BASELINE THE UNSAVED GUARD COMPARES AGAINST ─────────────────────────────────────────
      //
      // Without it the form stays "dirty" forever and warns the reader they are about to lose work that
      // is already on disk — which is what shipped, and which made the save look as though it had done
      // nothing at all.
      //
      // WHAT IS RECORDED IS WHAT THE SAVE WROTE, NOT WHAT IS ON SCREEN, and the difference is the whole
      // correctness of this. `composeSaved` carries the levers, the classes and the marketplaces;
      // `draftFromSaved` restores exactly those. The mark names, the goods text, the reference and the
      // deadline belong to the run being composed and reach no file. Snapshotting the draft WHOLE would
      // mark those clean too — so somebody who typed twenty names, pressed Save and left would lose
      // them with no warning at all, which is a worse failure than the false alarm being fixed here and
      // silent where that one was merely wrong.
      //
      // So the un-persisted fields are recorded at their EMPTY values: the form reads clean when the
      // only thing that has changed is what was written down, and still warns while anything the save
      // could not carry is sitting in it.
      setSavedDraft(JSON.stringify({
        ...EMPTY, pick: draft.pick, classes: draft.classes, platforms: draft.platforms,
      }))
      // An EDIT came from Search templates and belongs back there — the list is where the result of the
      // change is visible. A create stays put: the form on screen is the search being started.
      if (editingSlug) { setLeaveTo('/portal/brand/searches'); return }
      setSaveOpen(false)
      setSaveName('')
      setSaveText('')
      // — live but uncommitted is a WARNING, not a failure: the change is on disk.
      const uncommitted = notCommitted(r)
      setSaveNote(uncommitted
        ? `Saved as “${label}”. ${uncommitted}`
        : `Saved as “${label}” — it is in your search templates.`)
      // ── SAID WHERE THE READER IS LOOKING, AT THE MOMENT IT HAPPENS ──────────────────────────────
      //
      // `saveNote` alone was not a confirmation. It renders in the footer's far LEFT column, under the
      // running total, at 12px — while this same branch closes the panel, so the only thing that
      // changes under the reader's cursor is that the button they pressed disappears. An outside user
      // pressed Save, reported "Nothing!", and went looking for the feature somewhere else. The note
      // stays where it is for the record; this puts the answer beside the control that was pressed.
      setSaveDone(label)
    } else if (r.kind === 'conflict') {
      setSaveNote('Someone else changed this template while you were editing. Reload and re-apply.')
    } else {
      setSaveNote('That could not be saved. Try a different name, or check it on Search templates.')
    }
  }

  if (submitted) {
    return (
      <Submitted
        go={ctx.go}
        onAnother={() => { setSubmitted(null); writeDraft(EMPTY); setPickedByHand(false); setReceipt(null) }}
        name={names[0] ?? ''}
        duration={turnaroundInWords(turnaround(effort))}
      />
    )
  }

  // Every shape the depth menu can arrive in is answered BEFORE the form is drawn. A refused `searches`
  // call leaves `levels` empty, which would render a composer whose footer prices a level that is not
  // there: a form that cannot be filled in and says nothing about why.
  if (needsOwner || searches?.kind === 'pickAccount') {
    return (
      <CompanyGate ctx={ctx} heading="New clearance"
        line="Pick a company to run this clearance on." />
    )
  }

  // Nothing at all until the first answer lands. Drawing the form first would flash a priced footer
  // against no levels on every single load — indistinguishable, for that moment, from the failure below.
  if (!searches) return <div className="screen" />

  if (searches.kind !== 'ok') return <OptionsUnavailable kind={searches.kind} onRetry={retrySearches} />

  // The gates read the request that will be SENT. With a saved search chosen the picker is behind a
  // notice and the recipe decides the product, so both gates measure `activeLevel` — the product that
  // will actually run — rather than the one the picker is holding.
  // `own.territories` is the SAME list the Where panel draws when the draft is empty, so the stop and
  // the chips cannot disagree about what this run will search.
  const stops = blockers(draft.pick, activeLevel, names.length, own.territories)
  // ── — A MARK IS A SHORT STRING, SAID BEFORE THE ORDER IS PRICED ──────────
  //
  // The owner typed a product description into this field. It was accepted, priced, confirmed, run, and
  // it became the runId, the run directory and part of every report link. The intake refuses it now at
  // every door — but a refusal met after confirming is a round trip the reader should not have paid
  // for, and this screen is where they can still fix it.
  //
  // A STOP, not a disabled field: the file's own rule is that nothing is greyed out without the reason
  // visible at the control, and `stops` is where those sentences already live. The number comes from
  // the server, so the screen and the door cannot drift; when the server sends none the screen states
  // no limit and lets the door refuse, which is the honest reading of a server that does not know.
  //
  // Named rather than counted: with twenty names in the box, "one name is too long" is not actionable.
  const overlong = searches.value.maxMarkName == null
    ? []
    : names.filter((n) => n.length > (searches.value.maxMarkName ?? Infinity))
  const markLimit = searches.value.maxMarkName
  const nameStops = overlong.map((n) =>
    `“${n.slice(0, 30)}…” is ${n.length} characters. A mark name may be at most ${markLimit} — it becomes `
    + `this run's name and part of every report link, so it cannot carry a description. Put the goods `
    + `and the description in their own fields below.`)
  // A clearance reads ONE name. Said as a sentence with a way out rather than as an error telling
  // somebody to delete their own work — see NameWall. ONE predicate, shared with blockers(); the
  // component needs the numbers to offer that way out, which is why it returns them.
  const budget = nameBudget(activeLevel, names.length)
  // ONE DEFINITION OF "SPENT", shared with the line that warns before it. `searchesLeft` answers null
  // for an uncapped account and for an unreadable usage file, and null is not zero — so neither is
  // refused here, which is the behaviour this screen already had and the one that matters.
  const exhausted = searchesLeft(usage) === 0
  // classes OR goods, which is what the schema accepts. Requiring both would refuse requests the engine
  // runs — and with the owner's own classes on screen in the card, demanding they be retyped is worse.
  // THE SENTENCES ARE THE PREDICATE. This used to be a bare boolean with no render site anywhere on the
  // screen: every other term in `ready` puts a sentence in front of the reader and this one greyed the
  // primary action out in silence. Asking whether the list is empty, rather than re-deriving the
  // condition beside it, is what stops the reason going missing again — there is nothing left to forget
  // to render.
  const gaps = missingPieces(names, classes, draft.goods)
  // ONE CALL, both answers. `ready` and the sentence under the button come out of the same ordered list
  // in contract/composerProduct.ts, so `ready === (blockedBy === null)` holds by construction rather
  // than by two chains in two files staying in step. Adding a condition without its sentence is no
  // longer a thing this screen can do.
  // NOTHING TOUCHED YET. Compared the same way `composerDirty` compares, and without its saved and
  // submitted terms: this asks only whether the form still looks as it arrived.
  const untouched = JSON.stringify(draft) === JSON.stringify(EMPTY)
  const { ready, blockedBy } = readiness({
    gaps, stops, nameStops, budget, exhausted, hasProduct: activeLevel != null, untouched,
  })
  // WHAT THE FOOTER CALLS THIS SEARCH, and there is only one answer now. It used to be `tierLabel`,
  // which invented seven strings for distinctions "the registry has no word for" — "Deep dive — United
  // States", "Full clearance". The registry has the word: it is the product's own name, the same string
  // the delivered report prints at the top.
  const startedFrom = draft.savedSearch
    ? (savedRow ? displayLabel(savedRow) : 'a search template')
    : (activeLevel?.name ?? 'no search picked yet')
  // WHETHER THE NATIVE-LANGUAGE INVESTIGATION RUNS, as the review states it: automatic where the search
  // includes it, and otherwise what was chosen — on the form, or in the template, which carries its own.
  const nativeOn = activeLevel?.nativeLanguage === 'automatic'
    || (nativeControl === 'toggle' && (draft.savedSearch ? savedRow?.nativeLanguage === true : draft.pick.nativeLanguage))

  return (
    <div className="screen">
      {/* WHAT WAS JUST DECIDED FOR YOU, on the page you came here to use. A confirmation page of its own
          was drawn and turned down: easier to make unmissable, and it interrupts the one thing the person
          came to do. The framework was the only reason that page existed, and this still names it.
          IT SITS ABOVE THE HEADER rather than between two of them: the eyebrow that used to open this
          screen said "New clearance" over a heading saying "New clearance". */}
      <CreatedStrip />
      <PageHeader title={editingSlug ? 'Edit a search template' : 'New clearance'} />
      {/* ONE QUIET LINE, and only when the number is close enough to change what a reader does. No
          band, no heading and no colour: this is a fact about the account, not a warning about the
          form. It is silent above five left, which is the state most readers are in most of the time.
          The same sentence, from the same composer, is on Clearances. */}
      {allowanceLine(usage ?? null, ctx.me.brand)
        ? <p className="nc-allowance">{allowanceLine(usage ?? null, ctx.me.brand)}</p>
        : null}

      {/* Editing a template happens ON this screen, because a template is these choices with a name on
          it. The heading changes and this line says what the form below is — without it the user would
          be looking at a New clearance form mysteriously pre-filled with someone's set-up. */}
      {editingSlug ? (
        editingRes && editingRes.kind !== 'ok' ? (
          <div className="notice" style={{ borderColor: 'var(--tone-high)' }}>
            <b>That search template could not be opened</b>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
              Nothing has been changed.{' '}
              <button type="button" className="link-btn" onClick={() => ctx.go('/portal/brand/searches')}>Back to Search templates</button>
            </p>
          </div>
        ) : editing && !editingPick ? (
          // A record whose product this screen cannot state — `draftFromSaved` refuses rather than
          // approximates, because the nearest thing it CAN say is a different search from the one the
          // client bought. Saying so beats opening a form that would rewrite it on the next Save.
          <div className="notice" style={{ borderColor: 'var(--tone-medium)' }}>
            <b>This search template cannot be edited here</b>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
              It was built on a search this screen has no setting for, so opening it would change what it
              does. It still runs exactly as it is. Ask {operatorName(ctx.me.brand)} to change it, or build a new one here.{' '}
              <button type="button" className="link-btn" onClick={() => ctx.go('/portal/brand/searches')}>Back to Search templates</button>
            </p>
          </div>
        ) : (
          <div className="notice quiet">
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
              Change the form below, then <b>Save changes</b> in the footer. Nothing runs, and the
              searches already run under this one are unaffected — a finished report carries its own set-up.
            </p>
          </div>
        )
      ) : null}

      {/* ── ONE FORM, TOP TO BOTTOM ──────────────────────────────────────────────────────────────────
          No fork, no wizard and no steps. The screen used to open on two cards — "Describe it" and "Set it
          up myself" — and hid the form behind whichever was pressed, with a toggle to switch between two
          halves of one form. Describing it is now the form's first, optional section.

          THE ORDER IS WHAT A READER KNOWS FIRST: who it is for, what it is, where, for what goods, and
          anything else worth knowing — then what the company already carries, and only then which of
          the four searches, because that choice is read off everything above it. */}
      <div className="composer-col">
        {/* ── the company ── */}
        <div>
          <div className="field-label">Company</div>
          {ctx.me.accounts.length > 1 ? (
            // The same value the sidebar switcher sets — the shell's own filter, mirrored where the
            // decision is being made. It is NEVER a request field: the server stamps identity from the
            // verified sign-in, and a body that named an owner would be a tenancy hole.
            <select
              value={account ?? ''}
              onChange={(e) => ctx.setOwner(e.target.value || null)}
              className="ctx-select nc-company"
              aria-label="Company"
              data-anon="mark"
            >
              <option value="">Choose a company…</option>
              {/* Value stays the KEY — it is what every request is keyed by. Only the label is named.
                  Sorted by the LABEL, and through the same helper the rail's switcher uses: these are
                  two views of one control, and a client meeting the same list in two orders on one
                  screen has to work out whether they are the same list. */}
              {sortOwners(Object.fromEntries(ctx.me.accounts.map((a) => [a, ctx.ownerName(a)])), ctx.me.accounts)
                .map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
            </select>
          ) : (
            <div className="nc-company-name" data-anon="mark">{ownerLabel}</div>
          )}
        </div>

        <DescribeIt
          value={draft.brief}
          onChange={(brief) => edit({ brief })}
          can={readCan}
          reading={reading}
          error={readErr}
          receipt={receipt}
          onRead={() => { void doRead() }}
        />

        {/* ── names to clear ── */}
        <div>
          <div className="section-title">Names to clear</div>
          <p className="section-hint">One per line</p>
          <textarea
            value={draft.names}
            onChange={(e) => edit({ names: e.target.value })}
            placeholder="Example: AQUAPLUS"
            aria-label="Names to clear"
            data-anon="mark"
            className="names-box"
          />
          {budget ? (
            <NameWall
              count={names.length}
              allowed={budget.allowed}
              first={names[0] ?? ''}
              canScreen={!draft.savedSearch && knockout != null}
              screenName={knockout?.name ?? 'Knockout search'}
              onScreenAll={() => { if (knockout) { setPickedByHand(true); edit({ pick: chooseProduct(draft.pick, knockout) }) } }}
            />
          ) : names.length > 1 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 7 }}>{names.length} names, one search.</div>
          ) : null}
        </div>

        {/* ── WHERE — a different control per product, and each says at the control what it takes ── */}
        <div>
          <div className="section-title">Where</div>
          {/* THE PRODUCT'S OWN SENTENCE, at the control, always. Not a tooltip and not a refusal
              after the fact: the requester reads what this search accepts while they are choosing
              where it points. */}
          {geoNote ? <p className="section-hint">{geoNote}</p> : null}

          {whereLevel?.geography === 'worldwide, and nothing else' ? (
            // NO PICKER AT ALL, and that is the design. Worldwide is not a choice on this search —
            // it IS this search — so a territory field here would be a control whose every use is
            // refused. The chip states the fact; the sentence above says why there is nothing to set.
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '9px 0 0' }}>
              <span className="chip">Worldwide</span>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '9px 0 12px' }}>
                {/* "WORLDWIDE" WAS ONLY TRUE FOR AN ACCOUNT WITH NO TERRITORIES OF ITS OWN. An empty
                    list used to mean "unset", and the engine's ladder resolved unset to the brand
                    owner's defaultJurisdictions — seven of them, for one demo account — so this chip
                    promised a worldwide clearance and the run searched seven countries. The request
                    now STATES its mode (`geographyFor`), so the two can no longer be confused; what
                    the screen still owes the reader is the account's own list, tagged with where it
                    came from, exactly as Classes does below. */}
                {draft.pick.territories.length === 0 ? (
                  own.territories.length ? (
                    <>
                      {own.territories.map((t) => (
                        <span key={t} className="chip" data-anon="mark">{t}</span>
                      ))}
                      <span style={{ fontSize: 11, color: 'var(--text-faint)', alignSelf: 'center' }}>
                        {own.territoriesFrom}
                      </span>
                    </>
                  ) : (
                    <span className="chip">Worldwide</span>
                  )
                ) : draft.pick.territories.map((t) => (
                  /* — a chosen territory the register cannot reach keeps its
                     chip and says so. It is ordered, and disclosed as deferred coverage rather than
                     searched; removing it from the list would be the silent narrowing this issue is
                     about, one step later. */
                  <span key={t} className={reachesTerritory(t, registerTerritories) ? 'chip chip-own' : 'chip chip-own chip-deferred'}
                    title={reachesTerritory(t, registerTerritories) ? undefined : 'The register wired to this deployment does not reach this territory — it is disclosed in the report as deferred coverage rather than searched.'}>
                    {t}{reachesTerritory(t, registerTerritories) ? '' : ' · register deferred'}
                    <button
                      type="button"
                      aria-label={`Remove ${t}`}
                      className="chip-x"
                      onClick={() => setPick(removeTerritory(draft.pick, t))}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </span>
                ))}
              </div>
              {/* The LABEL follows the product: a Full country search offers no regions, so inviting
                  one would be inviting a refusal. */}
              <div className="field-label">
                {whereLevel?.geography === 'exactly one country' ? 'Add a country' : 'Add a country or region'}
              </div>
              <div className="fld-medium" style={{ position: 'relative' }}>
                <input
                  value={territoryQuery}
                  onChange={(e) => setTerritoryQuery(e.target.value)}
                  autoComplete="off"
                  aria-label="Add a territory"
                  className="ctx-input"
                />
                {territoryMatches(territoryQuery, draft.pick.territories, whereLevel, 8, registerTerritories).length ? (
                  <div className="typeahead">
                    {territoryMatches(territoryQuery, draft.pick.territories, whereLevel, 8, registerTerritories).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => { setPick(addTerritory(draft.pick, t, whereLevel, registerTerritories)); setTerritoryQuery('') }}
                      >
                        {t}
                        {/* — SHOWN AND SELECTABLE, with the reason at the
                            control. It used to be absent, which teaches a reader nothing: they
                            cannot tell an unsupported territory from one they mistyped. */}
                        {reachesTerritory(t, registerTerritories) ? null : (
                          <span className="typeahead-note">register deferred</span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {/* ── — STATED ONCE, ON THE SCREEN THAT CHOOSES AGAINST IT ──
                  "A reader choosing territories is choosing against a coverage map they cannot
                  currently see." This is that map, in one line and in the reader's own vocabulary.
                  Rendered only where there is something to say: a register that declares no
                  restriction, or a server that has not told us, has no coverage map to state, and a
                  line saying so would be noise on every deployment. It names no vendor — one
                  register, never a baked-in provider name — because what a reader can act on is the
                  reach, not the brand. */}
              {Array.isArray(registerTerritories) ? (
                // BOTH FIGURES ARE SCOPED TO THE PRODUCT, which is what `registerTerritories.length`
                // alone would get wrong: a Full country search can name no regions, so a region the
                // register covers is not one of "the territories you can name here".
                <p className="section-hint" style={{ marginTop: 10 }}>
                  The trademark register wired to this deployment reaches{' '}
                  {vocabularyFor(whereLevel, registerTerritories).length} of the{' '}
                  {offerableFor(whereLevel).length} territories you can name here:{' '}
                  {vocabularyFor(whereLevel, registerTerritories).join(', ')}. Anywhere else can
                  still be ordered — it is disclosed in the report as deferred coverage rather than
                  searched at the register.
                </p>
              ) : null}
              {/* ONE COUNTRY REPLACES, it does not stack — so the note says what just happened rather
                  than leaving the reader to notice a chip disappear. */}
              {whereLevel?.geography === 'exactly one country' && draft.pick.territories.length === 1 ? (
                <div className="callout-accent">
                  {draft.pick.territories[0]} — naming another country replaces it, because this search
                  reads one at a time.
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* ── goods or services ── */}
        <div>
          <div className="section-title">Goods or services</div>
          {/* EITHER THIS OR THE CLASSES, and the helper says which one is used when this is left empty.
              The request takes classes or a description (`missingPieces`), and the classes it names are
              the company's own, on the card below. */}
          <p className="section-hint">
            Optional. Say what the name is for, to focus the search. Without it, the classes below are used.
          </p>
          <textarea
            value={draft.goods}
            onChange={(e) => edit({ goods: e.target.value })}
            rows={3}
            aria-label="Goods or services"
            placeholder="Example: energy drinks; dietary supplements"
            className="ctx-input"
            style={{ resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* ── §B — CONTEXT, ALWAYS OPEN ────────────────────────────────────────────────────────────────
            The owner: "not hidden under a collapse thing — it's important." It sat third inside a
            collapsible headed "References and dates", so the one field that changes how a hit is
            WEIGHED was behind a click, under a heading that does not describe it, below two fields
            about paperwork. It sits directly under Goods or services — the field it qualifies — in the
            open, as its own section like every other thing that matters on this form. What is left in
            the collapsible is exactly what its summary already claims: a reference and a date. */}
        <div>
          <div className="section-title">Context (optional)</div>
          <textarea
            value={draft.instructions}
            onChange={(e) => edit({ instructions: e.target.value })}
            rows={3}
            aria-label="Context (optional)"
            // THE PLACEHOLDER IS A WORKED EXAMPLE, labelled as one. The old placeholder was a
            // well-formed sentence and taught nothing about what KIND of thing belongs here — a
            // reader who has nothing that reads like it writes nothing at all. Naming the shapes
            // (a launch page, a post) is what tells them they have something to paste.
            placeholder={'Example: we already own the mark in the US and this is about the EU launch. '
              + 'Our launch page is https://example.com/press/aquaplus-launch, and there is a LinkedIn '
              + 'post announcing it from 3 June.'}
            className="ctx-input"
            style={{ resize: 'vertical', lineHeight: 1.5 }}
          />
          {/* The connector is a second way this field gets filled, and nothing on the screen said so.
              A search started by an agent through the connector can cite what the agent can already
              read, so a reader working that way does not have to paste any of it by hand. */}
          <p className="section-hint" style={{ margin: '7px 0 0' }}>
            A search started by an agent through the connector can reference emails or documents it
            can already read, so there is nothing to paste in that case.
          </p>
        </div>

        {/* ── the company card: what this company already carries ── */}
        <div className="ctx-card">
          <div className="field-label">Project</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {projects.length ? (
              <select value={draft.project} onChange={(e) => edit({ project: e.target.value })} className="ctx-select nc-project" aria-label="Project">
                <option value="">No project</option>
                {projects.map((p) => <option key={p.key} value={p.key}>{p.name || p.key}</option>)}
              </select>
            ) : (
              <div style={{ fontSize: 14, color: 'var(--text-faint)', padding: '9px 0' }}>No project · none configured</div>
            )}
            <button type="button" className="chip-btn" onClick={() => ctx.go('/portal/brand/projects')}>Manage projects</button>
          </div>

          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-hairline)', display: 'flex', gap: 26, flexWrap: 'wrap' }}>
            {/* Classes, resolved and tagged. Selecting a project narrows them on purpose; the tag is what
                makes that explicit rather than surprising. */}
            <div style={{ minWidth: 230, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <span className="field-label" style={{ marginBottom: 0 }}>Classes</span>
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                  {draft.classes ? 'set for this search' : own.classes.length ? own.classesFrom : ''}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 9 }}>
                {!classes.length ? (
                  /* AN EMPTY LIST IS NOT "NO CLASSES", AND SAYING SO WOULD BE THE LIE.
                     The composer sends no `classes` key when the list is empty, and the scope resolver's
                     nonEmpty() collapses undefined, null and [] into one branch — so it hands back the
                     company's FULL inherited list. "None set" described the form, not the search that
                     would run. Clearing every class is simply not expressible on this wire; rather than
                     pretend otherwise, the screen now says what will actually happen. */
                  <span style={{ fontSize: 12.5, color: 'var(--tone-medium)' }}>
                    {own.classes.length
                      ? `Cleared — this will search ${own.classesFrom || "the company's classes"} again (${own.classes.join(', ')}). Add one to narrow it.`
                      : 'None set — add one, or describe the goods above.'}
                  </span>
                ) : classes.map((c) => (
                  /* REMOVAL PROMOTES, EXACTLY AS ADDITION ALREADY DID.
                     The × used to render only once `draft.classes` was non-null, so while inheriting, every
                     chip was inert — no affordance anywhere said a class could be dropped. The capability
                     was already there and already correct on the wire: a narrower non-empty list wins at the
                     scope resolver. The only way to reach it was to add a class you did not want (which
                     promotes the inherited list into an explicit one), delete it, and then delete the ones
                     you meant to. Nobody who had not read the source could find that.
                     `classes` is already `draft.classes ?? own.classes`, so filtering it promotes and
                     removes in one step — the same move the typeahead makes on the first addition. */
                  <span key={c} className={draft.classes ? 'chip chip-own' : 'chip'}>
                    {classLabel(c)}
                    <button
                      type="button"
                      aria-label={`Remove class ${c}`}
                      className="chip-x"
                      onClick={() => edit({ classes: classes.filter((x) => x !== c) })}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="field-label">Add a class</div>
              <div style={{ position: 'relative' }}>
                <input
                  value={classQuery}
                  onChange={(e) => setClassQuery(e.target.value)}
                  autoComplete="off"
                  aria-label="Add a Nice class"
                  className="ctx-input"
                />
                {classMatches(classQuery, classes).length ? (
                  <div className="typeahead">
                    {classMatches(classQuery, classes).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          // The first addition PROMOTES what was inherited into an explicit list, so the
                          // owner's own classes are kept rather than replaced by the one just chosen.
                          edit({ classes: [...classes, c].filter(isClassNumber).sort((a, b) => a - b) })
                          setClassQuery('')
                        }}
                      >
                        {classLabel(c)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {draft.classes ? (
                <button type="button" className="link-btn" style={{ marginTop: 7 }} onClick={() => edit({ classes: null })}>
                  Use the company’s classes instead
                </button>
              ) : null}
            </div>

            {/* Marketplaces: a FLOOR. A project unions more in and can never remove one, so these are shown
                and never offered as removable — a chip with an × on it would be a control the engine undoes. */}
            <div style={{ minWidth: 230, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <span className="field-label" style={{ marginBottom: 0 }}>Marketplaces</span>
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{own.platforms.length} on file</span>
              </div>
              {marketplacesApply ? (
                own.platforms.length ? (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(showAllShops ? own.platforms : own.platforms.slice(0, 6)).map((p) => (
                        <span key={p} className="chip chip-mono" data-anon="mark">{p}</span>
                      ))}
                      {own.platforms.length > 6 ? (
                        <button type="button" className="chip chip-more" onClick={() => setShowAllShops((v) => !v)}>
                          {showAllShops ? 'Show less' : `Show all ${own.platforms.length}`}
                        </button>
                      ) : null}
                    </div>
                    {/* 12.5px and --text-muted, the treatment the Classes column's own explanatory line
                        gets 16px to the left — the same weight, because it answers the same question a
                        reader asks of both. (The footnote treatment it replaced put the answer to "why can
                        I not remove these" at 11px beside class chips that all carry an ×.) */}
                    <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      Every marketplace listed here is a forced deep dive inherited from the company and
                      then the project. By default common law sweeps everything it can find on the open web,
                      but this ensures particular focus to important markets.
                    </p>
                    <div style={{ marginTop: 10 }}>
                      <div className="field-label">Add more for this search</div>
                      <input
                        value={draft.platforms}
                        onChange={(e) => edit({ platforms: e.target.value })}
                        placeholder="gnc.com, iherb.com"
                        aria-label="Extra marketplaces for this search"
                        className="ctx-input"
                      />
                      <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.45 }}>
                        To edit the default list see{' '}
                        <button type="button" className="link-btn" onClick={() => ctx.go('/portal/brand/profile')}>
                          Profile
                        </button>
                        .
                      </p>
                    </div>
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    None on file — the open web is searched regardless. Add shops on Profile, or name
                    extra ones for this search below.
                  </p>
                )
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {activePipeline === 'knockout'
                    ? 'A knockout search sweeps these shops and the open web as one broad question per name. '
                      + 'The structured grid — every shop checked term by term, with a coverage ledger — runs '
                      + 'on a clearance.'
                    : 'These shops are swept on every search we run.'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── WHICH SEARCH ── */}
        <div>
          <div className="nc-which-head">
            <span className="section-title" style={{ marginBottom: 0 }}>Which search</span>
            {/* TEMPLATES ARE THEIR OWN CONTROL, never rows among the four. They were once a second list
                under the products, and before that pills in one row with them under a heading that
                counted four — so the heading was wrong for every company that had saved anything, and
                the one thing telling the two kinds apart was a dashed border. A dropdown with its own
                label cannot be mistaken for one of the searches it applies to. Drawn only for a company
                that has one: an empty dropdown is a control with nothing to choose. */}
            {savedSearches.length ? (
              <span className="nc-templates">
                <label>
                  <span className="field-label">Search templates</span>
                  <select
                    value={draft.savedSearch}
                    onChange={(e) => { setPickedByHand(true); edit({ savedSearch: e.target.value }) }}
                    className="ctx-select"
                    aria-label="Search templates"
                    data-anon="mark"
                  >
                    <option value="">None</option>
                    {sortSavedSearches(savedSearches).map((r) => (
                      <option key={r.slug} value={r.slug}>{displayLabel(r)}</option>
                    ))}
                  </select>
                </label>
                {/* RETIRE, not delete, and it lives with the list. A template that produced a report is
                    part of that report's record — the engine has no delete door — so this is the way to
                    the page that retires and brings back, not a second control for it. */}
                <button type="button" className="chip-btn" onClick={() => ctx.go('/portal/brand/searches')}>Manage</button>
              </span>
            ) : null}
          </div>

          {/* A TEMPLATE DECIDES THE SEARCH AND ITS DEPTH, NOT THE SCOPE. An earlier notice said it
              decided "where it points", which is what the record LOOKS like — a template stores a scope —
              but the saved territories do not steer the run: the engine scopes off the request and the
              company's own defaults (driver/jx-lanes.mjs). So that sentence invited an empty Where, and
              then the one-country blocker sent the reader looking for a control the notice had told them
              not to touch. `templateLine` says what stays theirs, true for the search it sets. */}
          {draft.savedSearch ? (
            <p className="nc-template-line">
              {templateLine(savedRow ? displayLabel(savedRow) : 'This template', activeLevel)}{' '}
              <button type="button" className="chip-btn" onClick={() => edit({ savedSearch: '' })}>Clear template</button>
            </p>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {levels.map((t) => (
              <PickRow
                key={t.key}
                // The TEMPLATE's search is the selected row while one is applied, because that is the
                // search that will run — a picker showing nothing selected over a template that sets one
                // would be two answers to "which search is this".
                selected={activeBase === t.key}
                // NOT DISABLED, and the reason is AT the row. A product this deployment cannot run
                // still gets a row with its own sentence beside it: a control that vanishes leaves a
                // client with no way to know the search exists, and a greyed one with no reason
                // invites a click that answers nothing.
                unavailableNote={t.available ? null : (t.unavailableNote ?? 'Not available just now.')}
                // — orderable, WITH the limit stated at the point of choosing.
                coverageNote={t.available ? t.coverageNote : null}
                capabilityNote={t.available ? t.capabilityNote : null}
                onPick={() => { setPickedByHand(true); edit({ pick: chooseProduct(draft.pick, t), savedSearch: '' }) }}
                title={t.name}
                // BOTH FIGURES ARE THE SERVER'S. A hand-typed "up to 20 names" beside a wall that
                // refuses at eight is what this row used to carry.
                tagline={`${t.geography} · up to ${t.maxNames} name${t.maxNames === 1 ? '' : 's'}${t.baseTurnaround ? ` · from ${turnaroundInWords(t.baseTurnaround)}` : ''}`}
                recommended={recommendation?.product.key === t.key ? recommendation.reason : null}
                description={
                  // — THE COUNTS ARE PART OF WHAT A KNOCKOUT IS, so the row says so first. It read "No
                  // register search", which was true of a tier the offering retired and false of the one
                  // it sells: every Knockout takes register filing counts. A client choosing between the
                  // four was told this one does not touch a register, and then received a report whose
                  // second section is register figures.
                  t.pipeline === 'knockout'
                    ? 'Quick register count for identical, containing and close variants, plus a marketplace and common-law screen, across many names.'
                    : t.caseLaw
                      ? 'Trademark registers, the live marketplace, and that country’s case law and oppositions.'
                      : `Trademark registers and the live marketplace, one name.${t.nativeLanguage === 'offered' ? ' Native-language search optional.' : ''}`
                }
                // WHAT IT CARRIES, stated as facts about the search, never as switches: a switch beside a
                // fact is an invitation to change something that is not a setting. Case law in
                // particular used to be a lever on every clearance; it is what a Full country search IS.
                // THE MARK AND THE WORDS COME OFF ONE FIELD, so a tick can never sit over a search that
                // does not carry the thing it ticks.
                chips={[
                  { in: t.pipeline !== 'knockout' || t.components.includes('registerProbe'), text: t.pipeline === 'knockout' ? 'Registers, quick count' : 'Registers, full search' },
                  { in: true, text: 'Marketplaces' },
                  { in: Boolean(t.caseLaw), text: 'Case law' },
                ]}
              >
                {/* THE ONE TOGGLE IN THE OFFERING, inside the search it belongs to, and drawn only where it
                    is a choice. On a Full country search it is automatic and the row SAYS so rather than
                    showing a switch that cannot move; on the other two it is not sold, so there is nothing
                    here at all — never a greyed control, which invites a click and answers nothing. A
                    template carries its own, so nothing is drawn under one. */}
                {activeBase === t.key && !draft.savedSearch ? (
                  nativeControl === 'toggle' ? (
                    <Lever
                      label="Native-language investigation"
                      hint="Native registers and marketplaces in the languages of the countries you named"
                      on={draft.pick.nativeLanguage}
                      onToggle={() => setPick(toggleNativeLanguage(draft.pick, activeLevel))}
                    />
                  ) : nativeControl === 'automatic' ? (
                    <p className="section-hint" style={{ margin: 0 }}>
                      The native language of that country is searched automatically — it is part of this
                      search, not something to switch on.
                    </p>
                  ) : null
                ) : null}
              </PickRow>
            ))}
          </div>
        </div>

        {/* THE FOUR SIDE BY SIDE. A client choosing between them is asking "am I buying the right one",
            which is a comparison, which is a table. Every cell is read off the same fetched payload the
            rows above are built from, so neither can drift from what the engine will actually run. */}
        {/* ── — THE OPT-OUT HAS TO BE A CHILD OF THE THING THAT CAPS IT ──
            The owner has ruled this width three times, and the reason it survived two fixes is that the
            second one was inert. `.composer-wide` was written to let this block take the screen's
            measure, and it was applied to a GRANDCHILD of `.composer-col`. The cap is
            `.composer-col > *`, which matches direct children only — so the block's own parent was
            still 720px, and `max-width: none` cannot make a box wider than the one it lives in.
            Measured at a 1280px window: wrapper 718px against a 760px table, 42px of overflow, FOUR of
            the five columns visible and the fifth reachable only by side-scrolling. So it is a direct
            child. The rule it opts out of is unchanged: 720px is the right measure for a COLUMN OF
            FIELDS, and a five-column comparison is not a form line. `.table-wrap` keeps its scroll for
            a genuinely narrow viewport, where there is no room to give. */}
        {levels.length ? (
          <div className="composer-wide">
            <Details summary="Detailed search comparison table">
              <ProductMatrix products={levels} currentKey={activeBase} />
            </Details>
          </div>
        ) : null}

        {/* The marketplaces field MOVED OUT of here, up beside the chips it adds to, and the context field
            is its own section above. What is left is a reference and a date, which is what this
            collapsible's summary says it holds. */}
        <Details summary="References and dates (optional)">
          <Field label="Your reference" hint="Appears in report and file name">
            <input value={draft.ref} onChange={(e) => edit({ ref: e.target.value })} placeholder="TMP1234" className="ctx-input" />
          </Field>
          <Field label="Deadline" hint="Date may have a bearing on report synthesis">
            <input
              type="date"
              value={draft.deadline}
              onChange={(e) => edit({ deadline: e.target.value })}
              className="ctx-input fld-narrow"
            />
          </Field>
        </Details>

        {/* Everything standing in the way, each as its own fixable sentence. A disabled button with no
            reason is exactly what this screen was rebuilt to stop doing.

            `gaps` JOINS THE LIST. It was the one term in `ready` with no sentence anywhere, and the
            two headings are different claims on purpose: a form nobody has finished filling in is
            not the same thing as a search that is set up wrongly, and telling someone their work is
            "not runnable" when all they have done so far is type a name reads as a fault. */}
        {/* NOT BEFORE THE READER HAS TOUCHED ANYTHING. Both panels are about a form being filled in, and
            on arrival both are true of every field at once — so the screen opened with two warning
            blocks and a footer repeating one of them, about work nobody had started. The footer says
            the one thing there is to say until then, and every panel returns on the first edit. */}
        {!untouched && gaps.length ? (
          <div className="notice" style={{ borderColor: 'var(--tone-medium)', margin: 0 }}>
            <b>{gaps.length === 1 ? 'One thing left to fill in' : 'A couple of things left to fill in'}</b>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-muted)' }}>
              {gaps.map((g, i) => <li key={`g${i}`} style={{ marginBottom: 3 }}>{g}</li>)}
            </ul>
          </div>
        ) : null}

        {!untouched && (stops.length || nameStops.length) ? (
          <div className="notice" style={{ borderColor: 'var(--tone-medium)', margin: 0 }}>
            <b>Not runnable as set</b>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-muted)' }}>
              {/* The mark-name sentences lead: a name that cannot run makes every other stop below
                  it moot, and it is the one the reader can fix in the field just above. */}
              {nameStops.map((s, i) => <li key={`n${i}`} style={{ marginBottom: 3 }}>{s}</li>)}
              {stops.map((s, i) => <li key={i} style={{ marginBottom: 3 }}>{s}</li>)}
            </ul>
          </div>
        ) : null}

        {problem ? (
          <div className="notice" style={{ borderColor: 'var(--tone-high)', margin: 0 }}>
            <b>{problem.title}</b>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-muted)' }}>
              {problem.lines.map((l, i) => <li key={i} style={{ marginBottom: 3 }}>{l}</li>)}
            </ul>
          </div>
        ) : null}
      </div>

      {/* The footer's figures are the BROWSER's while composing — they have to be instant as the form
          moves, and this step makes no server call by design. Once a plan exists the SERVER's replace
          them in place: same footer, same layout, different source. They agree by construction
          (effortModelParity.test.ts pins the weights) except where a choice does not survive the wire —
          the script-lane count, which the server resolves from the jurisdictions and the composer can only
          guess at. That case is exactly why the server is preferred here rather than leaving a guess on
          screen beside the button.

          `tier` — ONE NAME, AND IT IS THE PRODUCT'S. The footer used to call a composed search
          "Full clearance" (a label the composer invented, because the registry had no word for it)
          and a saved one "Stage 1". Both now read the name the delivered report prints at the top. */}
      <Footer
        startedFrom={startedFrom}
        tier={activeLevel?.name || activeLevel?.stageLabel || (draft.savedSearch ? 'Search template' : 'No search picked')}
        detail={[
          names.length ? `${names.length} name${names.length === 1 ? '' : 's'}` : 'no names yet',
          // Same correction as the Where chips: unset resolves to the account's territories, not to
          // the world. The footer is the running total someone watches while composing, so it is the
          // last place that should disagree with what will actually run. CODES here and only here: a
          // bar one line tall has no room for place names, and every other surface spells them out.
          draft.pick.territories.length
            ? draft.pick.territories.map(territoryCode).join(', ')
            : own.territories.length
              ? own.territories.map(territoryCode).join(', ')
              : 'worldwide',
          // Checks PER NAME, said once there is a name and a search to count them for.
          names.length && activeLevel ? checksSummary(effort) : '',
        ].filter(Boolean).join(' · ')}
        uses={runCount(effort)}
        // NOT SET until a search is picked: the quote is keyed on the pipeline, and a figure for a
        // search nobody has chosen is a figure for the wrong one half the time.
        duration={activeLevel ? turnaroundInWords(plan?.effort?.turnaround || turnaround(effort)) : 'Not set'}
        runs={runsNote(effort)}
        ready={ready}
        busy={busy}
        // — DEMO ONLY, never unknown. `engineMode` is null when no configuration snapshot has
        // been written; that is "cannot answer", and answering it as demo would take the button away
        // from a working install because a file is missing.
        demoMode={ctx.me.engineMode === 'demo'}
        setupRoute={ctx.me.setupRoute}
        programDisputed={ctx.me.engineProgramDisputed}
        // ONE CLICK TO THE PAGE THAT EXPLAINS IT, and only for a reader who can open it. Global
        // config is served only to someone who sees everything, so this asks the fact the avatar
        // menu asks: Manage alone would link a manager of one organisation to a dead end.
        // Null is the honest shape for "there is nowhere to send this reader", not a dead button.
        onSettings={seesEverything(ctx.me) ? () => ctx.go('/portal/admin/config') : null}
        saveOpen={saveOpen}
        saveName={saveName}
        saveText={saveText}
        saveNote={saveNote}
        saveDone={saveDone}
        editing={editingSlug != null}
        canSave={!draft.savedSearch && !stops.length}
        // THE FIRST REASON, AT THE BUTTON. The full list is a notice further up the page, and the
        // footer is sticky — so on a long form the greyed button and its explanation are routinely
        // not on screen together. One sentence rather than the list: the reader fixes them one at a
        // time anyway, and a paragraph in a footer bar is not read. Ordered the way the notices are.
        blockedBy={blockedBy}
        onSaveOpen={() => { setSaveOpen(true); setSaveName(activeLevel ? `${activeLevel.name}` : 'Search template') }}
        onSaveName={setSaveName}
        onSaveText={setSaveText}
        // An edit's save panel is the reason the screen is open, so cancelling it goes back to the
        // list rather than leaving someone else's template sitting on a form with no way to tell what
        // it belongs to.
        onSaveCancel={() => {
          if (editingSlug) { ctx.go('/portal/brand/searches'); return }
          setSaveOpen(false); setSaveNote(null)
        }}
        onSave={doSave}
        onReview={doPlan}
        onSeeSaved={() => ctx.go('/portal/brand/searches')}
      />

      {plan ? (
        <ReviewDialog
          uses={runCount(effort)}
          left={searchesLeft(usage)}
          plan={plan}
          busy={busy}
          owner={ownerLabel}
          project={projectLabel}
          names={names}
          goods={draft.goods.trim()}
          nativeOn={nativeOn}
          onStart={doRun}
          onBack={() => { setPlan(null); setRunFailure(null) }}
          failure={runFailure}
          onReview={() => { setPlan(null); setRunFailure(null); void doPlan() }}
        />
      ) : null}
    </div>
  )
}

/**
 * The brief box, and the read.
 *
 * THE BRIEF IS NEVER CONSUMED. It stays in the box after a read because a filler that swallows its own
 * input leaves nothing to correct from if it read badly. What appears is a receipt beside it, not a
 * replacement for it.
 *
 * IT DOES NOT TRAVEL WITH THE REQUEST. This comment used to say it rode along as the user's
 * instructions, and `bodyFor` has never sent it — `upfrontInstructions` comes from the "Anything we
 * should know?" field, which is a different box the user fills in deliberately. A brief is a paragraph
 * someone pasted to be READ, and what reaches the engine is the fields it produced, every one of them
 * visible and editable first. Sending the brief itself as instructions is a product-owner decision, and it is
 * deliberately not taken here.
 *
 * When the deployment cannot read, the button is disabled under the server's own sentence rather than
 * hidden — the same rule an unavailable search level follows. A client cannot ask for what they cannot
 * see, and this is the half of the screen most people reach for first.
 */
function DescribeIt({ value, onChange, can, reading, error, receipt, onRead }: {
  readonly value: string
  readonly onChange: (v: string) => void
  readonly can: ReadCapability
  readonly reading: boolean
  readonly error: string | null
  readonly receipt: Receipt | null
  readonly onRead: () => void
}) {
  const tooLong = value.length > can.maxBrief
  return (
    <div style={{ paddingBottom: 22, borderBottom: '1px solid var(--border-hairline)' }}>
      {/* THE EXAMPLE IS INSIDE THE BOX, and nothing above it restates what the box is for: the heading
          names the section and the placeholder shows the kind of thing that goes in it. */}
      <div className="nc-describe-head">
        <span className="section-title" style={{ marginBottom: 0 }}>Describe it</span>
        <span className="nc-optional">optional</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        aria-label="Describe the search"
        data-anon="mark"
        placeholder="Example: AQUAPLUS for an energy drink in the EU and Switzerland, launch in November"
        className="ctx-input"
        style={{ resize: 'vertical', lineHeight: 1.5 }}
      />
      <div style={{ display: 'flex', gap: 9, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn-primary"
          disabled={!can.available || reading || value.trim() === '' || tooLong}
          onClick={onRead}
          title={can.available ? undefined : can.note ?? undefined}
        >
          <Icon name="sparkles" size={14} />{reading ? 'Reading…' : 'Fill it in for me'}
        </button>
        <span className="fld-wide" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {!can.available
            ? can.note ?? 'Reading a brief is not switched on here yet — set the search up below.'
            : tooLong
              ? `That is ${value.length.toLocaleString('en-GB')} characters — paste up to ${can.maxBrief.toLocaleString('en-GB')}, or set the search up below.`
              : 'Sets the search up below, ready to edit.'}
        </span>
      </div>

      {error ? <p className="callout-accent" style={{ marginTop: 12 }}>{error}</p> : null}

      {/* THREE GROUPS, AND THE PANEL LISTS RATHER THAN EXPLAINS: what the read put on the form, what the
          search will use that the text did not say, and what it could not settle. */}
      {receipt ? (
        <div className="read-receipt" style={{ marginTop: 12 }}>
          {receipt.read.length > 0 ? (
            <>
              <div className="read-receipt-head">What I read</div>
              <ul>{receipt.read.map((n) => <li key={n}>{n}</li>)}</ul>
            </>
          ) : (
            // A read that changed nothing says so. The alternative — an empty box under a pressed
            // button — reads as a failure the user cannot see or retry deliberately.
            <div className="read-receipt-head">Nothing in that I could turn into a search — set it up below.</div>
          )}
          {receipt.defaults.length > 0 ? (
            <>
              <div className="read-receipt-head" style={{ marginTop: 10 }}>Taken from company defaults</div>
              <ul>{receipt.defaults.map((n) => <li key={n}>{n}</li>)}</ul>
            </>
          ) : null}
          {receipt.unsure.length > 0 ? (
            <>
              <div className="read-receipt-head" style={{ marginTop: 10 }}>Not sure about</div>
              <ul>{receipt.unsure.map((n) => <li key={n}>{n}</li>)}</ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Three names on a clearance.
 *
 * The old composer answered this with "this search takes at most 1. Remove 2." — an instruction to delete
 * your own work, with no mention of the product that does take more. Enforcement without an invitation.
 * The wall itself is real (the offering's own `maxNames`, which the server refuses over and never
 * truncates) and stays; what changes is that the way through it is on screen and one click away.
 */
function NameWall({
  count, allowed, first, canScreen, screenName, onScreenAll,
}: {
  readonly count: number
  readonly allowed: number
  readonly first: string
  readonly canScreen: boolean
  /** The product the way out leads to, NAMED — a button that says "a knockout" and lands somewhere else
   *  is a button that has to be pressed to be understood. */
  readonly screenName: string
  readonly onScreenAll: () => void
}) {
  return (
    <div className="callout-accent" style={{ marginTop: 11 }}>
      <div>
        {allowed === 1
          ? `A clearance reads one name at a time — you have ${count}.`
          : `This search takes ${allowed} names — you have ${count}.`}
        {canScreen ? ` Screen them all together on a ${screenName}, or clear the first one now.` : ''}
      </div>
      {canScreen ? (
        <div style={{ marginTop: 9, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn-ghost" onClick={onScreenAll}>Screen all {count} together</button>
          {first ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }} data-anon="mark">or leave {first} on its own</span> : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The running total, pinned across the bottom of the screen.
 *
 * The point of the rebuild: what you are buying is on screen the whole time you are choosing it, rather
 * than revealed once at the review step. It is two plain figures — how many of the day's searches this
 * spends, and how long it takes. There is still NO currency figure anywhere and there cannot be: there
 * is no price model, and inventing one on a client's screen would be a quote.
 *
 * "Starting from" leads, because a prefilled template that is invisible is the same as no template: the
 * user cannot tell what they picked, which is the gap this line closes.
 */
function Footer({
  startedFrom, tier, detail, uses, duration, runs, ready, busy, demoMode, setupRoute,
  programDisputed, onSettings,
  saveOpen, saveName, saveText, saveNote, saveDone, editing, canSave, blockedBy,
  onSaveOpen, onSaveName, onSaveText, onSaveCancel, onSave, onReview, onSeeSaved,
}: {
  readonly startedFrom: string
  readonly tier: string
  readonly detail: string
  /** How many of the day's searches this request spends. The allowance counts searches; no unit exists. */
  readonly uses: number
  readonly duration: string
  readonly runs: string
  readonly ready: boolean
  readonly busy: boolean
  /**
   *  — this install has no engine, so a NEW search cannot start. A product state, not a fault.
   *
   * ONLY `me.engineMode === 'demo'` sets this. Unknown (null) is NOT demo: it means no configuration
   * snapshot has been written yet, and inferring a limited install from an absent file is how a
   * first-time visitor gets told their working install is broken.
   */
  readonly demoMode: boolean
  /**
   * HOW THIS INSTALL ARRIVED, so the no-engine notice names a command this reader can type.
   *
   * Null means the server did not say — an older portal-service — and the notice then names both
   * routes and which is which. That is worse copy than one command and better than a coin flip: the
   * shipped sentence named `npm run setup`, which does not exist for anybody who installed the package,
   * and a reader who cannot run the one command they are given has been told nothing.
   */
  readonly setupRoute: 'packaged' | 'checkout' | null
  /**
   * WHETHER THE PROGRAM IS ON THIS BOX WHILE THE ENGINE CANNOT SEE IT — and therefore which of two
   * remedies this notice gives. They are not interchangeable: telling someone to install a program
   * they already have is the advice that made an outside user give up on a working machine.
   *
   * Null is "could not check", and it prints the general advice — the sentence that shipped before
   * this distinction existed, which is right whenever the state cannot be told apart.
   */
  readonly programDisputed: boolean | null
  /** Open the page that shows what is and is not ready, or null when this reader cannot open it. */
  readonly onSettings: (() => void) | null
  /**
   * THE REASON THE PRIMARY ACTION IS NOT AVAILABLE, in one line, or null when it is available.
   *
   * The footer is sticky and the list of reasons is not: someone reading the bottom of the screen can
   * have the explanation scrolled off above them. This is the same sentence, at the control.
   */
  readonly blockedBy: string | null
  readonly saveOpen: boolean
  readonly saveName: string
  /** The saved search's note. Free text, for whoever picks it up next; the engine never reads it. */
  readonly saveText: string
  readonly saveNote: string | null
  /** The name a save just wrote, or null. Acknowledged beside the button that was pressed. */
  readonly saveDone: string | null
  /** True while this composer is open OVER an existing saved search, rather than composing a new one. */
  readonly editing: boolean
  readonly canSave: boolean
  readonly onSaveOpen: () => void
  readonly onSaveName: (v: string) => void
  readonly onSaveText: (v: string) => void
  readonly onSaveCancel: () => void
  readonly onSave: () => void
  readonly onReview: () => void
  /** Where the thing that was just saved now lives. */
  readonly onSeeSaved: () => void
}) {
  return (
    <div className="composer-footer">
      <div style={{ minWidth: 210, flex: 1 }}>
        <div className="footer-eyebrow">Starting from · {startedFrom}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginTop: 3 }}>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--text-strong)' }}>{tier}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{detail}</span>
        </div>
        {runs ? <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{runs}</div> : null}
        {saveNote ? <div style={{ fontSize: 12, color: 'var(--text-accent)', marginTop: 3 }}>{saveNote}</div> : null}
      </div>

      {/* ── TWO PLAIN FIGURES, AND THE TWO PICTURES ARE GONE ────────────────────────────────────────
          The Effort bars answered a question nobody asked — ten notches of a number with no unit, next
          to five dots of a "cost" that was never a price and could not become one. What a reader is
          deciding is how many of today's searches this spends and how long it takes, and both of those
          are figures the product already knows.

          THE WORD IS "SEARCHES", EVERYWHERE. The allowance counts searches per day per company; no
          unit exists in the engine, and the bars were the last screen that implied one. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-strong)' }}>
            {uses} search{uses === 1 ? '' : 'es'}
          </div>
          <div className="footer-eyebrow">uses</div>
        </div>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-strong)' }}>{duration}</div>
          <div className="footer-eyebrow">turnaround</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none', flexWrap: 'wrap' }}>
        {canSave && !saveOpen ? (
          <button type="button" className="btn-ghost" onClick={onSaveOpen}>Save as template</button>
        ) : null}
        {canSave && saveOpen ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <input
              value={saveName}
              onChange={(e) => onSaveName(e.target.value)}
              placeholder="Name this template"
              aria-label="Name this template"
              className="ctx-input"
              data-anon="mark"
              style={{ width: 160, fontSize: 12.5, padding: '8px 10px' }}
            />
            {/* The note the retired editor carried. Kept because a template outlives whoever set it up,
                and "why is this one different" is the question its next user arrives with. It is never
                read by the engine — it is a message to a colleague. */}
            <input
              value={saveText}
              onChange={(e) => onSaveText(e.target.value)}
              placeholder="Note (optional)"
              aria-label="Note about this template"
              className="ctx-input"
              // A note about a saved search names the work it is for — "SEAHORSE relaunch team" is as
              // disclosing as the mark itself, so it blurs with everything else on a shared screen.
              data-anon="mark"
              style={{ width: 150, fontSize: 12.5, padding: '8px 10px' }}
            />
            <button type="button" className="btn-primary" style={{ padding: '8px 12px', fontSize: 12.5 }} disabled={busy} onClick={onSave}>
              {editing ? 'Save changes' : 'Save'}
            </button>
            <button type="button" className="btn-ghost" style={{ padding: '8px 10px' }} onClick={onSaveCancel} aria-label={editing ? 'Stop editing' : 'Cancel saving'}>×</button>
          </span>
        ) : null}
        {/* SAID AT THE CONTROL THAT WAS PRESSED. `saveNote` still carries the full sentence in the
            left column; this is the acknowledgement, in the place the cursor already is, and it names
            what was written and where it went. Without it the only visible effect of a successful save
            was the panel closing, which reads as the click having been swallowed. */}
        {saveDone ? (
          <span className="save-done" role="status">
            <Icon name="check" size={13} />
            Saved as “{saveDone}”
            <button type="button" className="link-btn" onClick={onSeeSaved}>See it</button>
          </span>
        ) : null}
        {demoMode ? (
          // NO DEAD BUTTON. Before this the button was live, the click was accepted, and the
          // refusal arrived as a 502 several seconds later — a user cannot tell that from a broken
          // product. The sentence says where they are and the one command that moves them, which is
          // the difference between "you are missing four things" and "you are here".
          //
          // AND THE COMMAND IS THE READER'S OWN NOW. It was one hard-coded spelling, and it was the
          // wrong one for anybody who installed the package rather than cloning the source: they have
          // no npm scripts, so the single fix this notice offered was a command that does not exist on
          // their machine. The server says which route it is; when it cannot, both are named.
          // THE STATE, AND THEREFORE THE REMEDY, IS DECIDED IN THE CONTRACT LAYER. It used to be a
          // ternary here, where nothing in this suite could drive it — no jsdom, no test renderer, and
          // Node cannot import a `.tsx` at all — so the choice between "install the program" and
          // "restart the service" was reachable only by matching this file's source text. Telling a
          // reader to install a program they already have is the advice that cost an outside user the
          // product, and it is not a decision to leave where nothing can check it.
          (() => {
            const n = engineNotice({ programDisputed })
            return (
              <div className="footer-demo-note" role="status" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                <strong>{n.headline}</strong>{' '}
                {n.before}
                {n.namesSetupCommand ? <>{' '}<SetupCommand route={setupRoute} /></> : null}
                {n.after ? <>{' '}{n.after}</> : null}
                {onSettings ? (
                  <>
                    {' '}
                    <button type="button" className="link-btn" onClick={onSettings}>
                      See what this install has
                    </button>
                  </>
                ) : null}
              </div>
            )
          })()
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* THE VERB NAMES THE STEP IT OPENS, AND THE LINE BESIDE IT SAYS WHAT COMES AFTER. This said
                "Review clearance", which read as looking at a clearance that already exists: an outside
                user with a fully configured install found no action that promised to run anything, and
                stopped. It became "Start a search", a verb for the reader's purpose on a door that
                opens onto one more step. The design ruling of 2026-09-16 names that step — "Review
                search" — and what fixes the old failure is kept: it says SEARCH, not a clearance that
                might already exist, it is the primary button, and the sentence beside it says the
                coverage and the cost come before anything runs. */}
            <button type="button" className="btn-primary" disabled={!ready || busy} onClick={onReview}>
              {busy ? 'Checking…' : 'Review search'}
              <Icon name="arrow-right" size={14} />
            </button>
            <span className="footer-hint">
              {blockedBy ?? 'You will see the coverage and what it costs before anything runs.'}
            </span>
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The setup wizard, named the way this reader can type it.
 *
 * ONE WIZARD, TWO SPELLINGS, AND EACH ONE IS UNRUNNABLE ON THE OTHER ROUTE. A package install has no
 * npm scripts; a source checkout has no `clearotron` linked for itself. The screen cannot work this out
 * for itself and does not try — the server derives it from where its own code sits and sends a word.
 *
 * NULL IS ANSWERED BY NAMING BOTH, not by picking the likelier one. An older server that does not send
 * the field leaves this genuinely unknown, and a reader who is told which of two commands applies to
 * them can act; a reader given the wrong one cannot, and has no way to tell that is what happened.
 */
function SetupCommand({ route }: { readonly route: 'packaged' | 'checkout' | null }) {
  if (route === 'packaged') return <><code>npx clearotron install</code>.</>
  if (route === 'checkout') return <><code>npm run setup</code>.</>
  return (
    <>
      — <code>npx clearotron install</code> if you installed the package, or <code>npm run setup</code>{' '}
      from a copy of the source.
    </>
  )
}

/** One lever. `coming` renders it inert rather than hiding it — a client cannot ask for what they cannot see. */
function Lever({
  label, hint, on, onToggle, coming,
}: {
  readonly label: string
  readonly hint: string
  readonly on: boolean
  readonly onToggle?: () => void
  readonly coming?: boolean
}) {
  return (
    <button
      type="button"
      onClick={coming ? undefined : onToggle}
      disabled={coming}
      aria-pressed={on}
      className={`lever${on ? ' lever-on' : ''}${coming ? ' lever-coming' : ''}`}
    >
      <span className={on ? 'lever-box lever-box-on' : 'lever-box'} aria-hidden />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.4 }}>{hint}</span>
      </span>
      {coming ? <span className="coming">Coming</span> : null}
    </button>
  )
}

/**
 * ── §B — one thing a search carries, marked in or out ────────────────────────
 *
 * The tick and the cross come from ONE boolean, so a chip cannot carry a marker that disagrees with its
 * own words. The glyph is decorative and the WORD is what a screen reader gets — "Included" /
 * "Not included" — because a bare ✓ read aloud is a check mark, not an answer.
 *
 * A span, not a list item: it sits inside the row's button, and a button holds phrasing content only.
 */
function Carries({ included, label, children }: {
  readonly included: boolean
  /** The chip's own words, so the accessible name states the claim rather than reading a check mark. */
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    // The claim in words on the CHIP, the glyph hidden — the same convention the comparison table below
    // uses for its markers, rather than a visually-hidden span this stylesheet does not have.
    <span className={included ? 'carries-in' : 'carries-out'} aria-label={`${included ? 'Included' : 'Not included'}: ${label}`}>
      <span className="carries-mark" aria-hidden>{included ? '✓' : '✕'}</span>
      <span aria-hidden>{children}</span>
    </span>
  )
}

/**
 * One of the four searches: radio, name, what it accepts, why it fits, what it carries.
 *
 * THE CARD IS A DIV AND THE PICK IS ITS BUTTON, because the selected search holds a control of its own —
 * the native-language option — and a button cannot hold a button. `children` render under the button,
 * inside the card, so the option reads as part of the search it belongs to.
 */
function PickRow({
  selected, onPick, title, tagline, description, chips, recommended = null, children = null,
  unavailableNote = null, coverageNote = null, capabilityNote = null,
}: {
  readonly selected: boolean
  readonly onPick: () => void
  readonly title: string
  readonly tagline: string
  readonly description: string
  /** What the search carries, each marked in or out off the product row's own fields. */
  readonly chips: readonly { readonly in: boolean; readonly text: string }[]
  /** Why this is the search that fits what was entered, or null when it is not that search. */
  readonly recommended?: string | null
  readonly children?: ReactNode
  /**
   * Why this one cannot be picked here, IN the row.
   *
   * The owner's rule: nothing is greyed out without the reason visible at the control. A disabled row
   * with no sentence is the oldest complaint about this screen — the reader cannot tell a product that
   * does not exist from one their account is not entitled to from a bug.
   */
  readonly unavailableNote?: string | null
  /**
   *  — what this deployment's register reaches, on a row that CAN be picked.
   * Never set at the same time as `unavailableNote`: one explains a dead control, the other qualifies a
   * live one, and rendering them the same way is what made the first invisible.
   */
  readonly coverageNote?: string | null
  /**
   *  — a lane this search declares it needs and this deployment does not have.
   * Rendered like the coverage note and for the same reason: the product is orderable, and this is what
   * the report will not contain.
   */
  readonly capabilityNote?: string | null
}) {
  const off = unavailableNote != null
  return (
    <div className={`pick-row pick-row-stack${selected ? ' pick-row-on' : ''}${off ? ' pick-row-off' : ''}`}>
      <button
        type="button"
        onClick={off ? undefined : onPick}
        disabled={off}
        aria-pressed={selected}
        className="pick-row-hit"
      >
        <span className={selected ? 'radio radio-on' : 'radio'} style={{ marginTop: 2 }} aria-hidden />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)' }}>{title}</span>
            {recommended ? <span className="pick-tag">Recommended for what you entered</span> : null}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.03em', color: 'var(--accent-quiet)' }}>{tagline}</span>
          </span>
          {recommended ? <span className="pick-row-reason">{recommended}</span> : null}
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 2 }}>{description}</span>
          <span className="pick-chips">
            {chips.map((c) => <Carries key={c.text} included={c.in} label={c.text}>{c.text}</Carries>)}
          </span>
          {/* ── — THE REASON HAS TO WIN, because the control it explains is dead ──
              This rendered at fontSize 12 in `--text-faint`, the faintest token in the palette, under a
              description already set in `--text-muted`, on a row that is itself disabled. The owner looked
              straight at it and reported no message at all: "it doesnt appear disabled, no message etc".
              A reason nobody can read is the state the rule was written to prevent, so this is now the
              most legible thing in the row — the strong ink, the row's own weight, and its own band. */}
          {off ? (
            <span className="pick-row-why">
              <b>Not available here</b> — {unavailableNote}
            </span>
          ) : null}
          {/* The coverage disclosure sits on a LIVE row and is deliberately quieter than the refusal above
              — it qualifies a choice rather than blocking one — but it is still normal reading contrast,
              never the faint token. */}
          {!off && coverageNote ? (
            <span className="pick-row-coverage">{coverageNote}</span>
          ) : null}
          {/* — the lane this search declares it needs, and this box does not have.
              Louder than the coverage note: coverage narrows what a report covers, this removes a whole
              section of the reasoning a reader is buying. */}
          {!off && capabilityNote ? (
            <span className="pick-row-capability">{capabilityNote}</span>
          ) : null}
        </span>
      </button>
      {children ? <div className="pick-row-inside">{children}</div> : null}
    </div>
  )
}

/**
 * The summary the user actually buys.
 *
 * Everything priced here comes from the SERVER's reading of the request, not from the draft — the point
 * of the step is to show what the request really is, and echoing the form back would show only what the
 * user already believes. The scope especially: the server resolves the company's own defaults when none
 * were named, and that answer can differ from what the form showed.
 *
 * The scope rows exist for the same reason. A form with a territory box and a summary that never
 * mentions territories asks someone to confirm a search whose most expensive dimension is invisible.
 * Where and Classes state WHERE the value came from, because "the territories you named" and "your
 * company's usual territories" look identical once resolved.
 */
function ReviewDialog({
  plan, busy, owner, project, names, goods, nativeOn, onStart, onBack, failure, onReview, uses, left,
}: {
  readonly plan: Plan
  readonly busy: boolean
  /** How many of the day's searches this request spends. */
  readonly uses: number
  /** How many are left before it, or null when the account is uncapped or the usage could not be read. */
  readonly left: number | null
  readonly owner: string
  readonly project: string | null
  readonly names: readonly string[]
  /** The goods and services description as it was typed, or empty. */
  readonly goods: string
  /** Whether the native-language investigation runs on this search. */
  readonly nativeOn: boolean
  readonly onStart: () => void
  readonly onBack: () => void
  readonly failure: { readonly title: string; readonly lines: readonly string[] } | null
  readonly onReview: () => void
}) {
  // Escape closes it. A modal that traps someone on the one screen that spends money is a bad modal.
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack() }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onBack])
  const [allShops, setAllShops] = useState(false)

  const scope = plan.scope
  const places = scope ? scope.jurisdictions : []
  const mark = names.join(', ') || String(plan.marks)

  return (
    <div className="modal-scrim" onClick={onBack} role="dialog" aria-modal="true" aria-label="Review before you start">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-rule" aria-hidden />
          <span className="eyebrow" style={{ color: 'var(--accent-quiet)' }}>Review before you start</span>
          {/* THE MARK LEADS: it is what the reader is about to clear, and the one fact they would notice
              was wrong at a glance. The search is named in its own row below — by NAME, never by the
              rung on a pricing ladder, which is what "Stage 1" at the top of this dialog used to be. */}
          <h2 style={{ margin: '7px 0 0', fontSize: 21, fontWeight: 700, letterSpacing: '-.02em', color: 'var(--text-strong)' }} data-anon="mark">
            {mark}
          </h2>
        </div>

        <div style={{ padding: '6px 24px' }}>
          <Row label="Company"><span data-anon="mark">{owner}</span></Row>
          {/* Drawn only when one is chosen: a project narrows the classes and adds marketplaces, so it is
              part of what runs, and "No project" is not. */}
          {project ? <Row label="Project">{project}</Row> : null}
          <Row label="Names"><span data-anon="mark">{mark}</span></Row>
          {/* `|| stageLabel` so an older server degrades to its old headline rather than a blank row. The
              rung rides beside the name only where it differs from it. */}
          <Row label="Search">
            {plan.name || plan.stageLabel}
            {plan.stageLabel && plan.stageLabel !== (plan.name || plan.stageLabel) ? <Muted> · {plan.stageLabel}</Muted> : null}
          </Row>
          {places.length ? (
            <Row label="Where">{places.join(', ')} <Muted>— from {scope?.jurisdictionsFrom}</Muted></Row>
          ) : <Row label="Where">Worldwide</Row>}
          {/* ── REGISTERS TO SEARCH — what the search WILL ask, never what it found ─────────────────
              Not "searched in full": the search has not run. And the coverage limit belongs here, where
              the ticket is spent. A worldwide search is orderable on a partial register, so "you are
              buying a search the wired register will not fully reach" is said in front of the reader
              rather than in the report they read afterwards. */}
          <Row label="Registers to search">
            {plan.coverage ? (
              <>
                {plan.coverage.reached.length ? joinAnd(plan.coverage.reached) : 'None'}
                {plan.coverage.missing.length ? (
                  <Muted>
                    . {joinAnd(plan.coverage.missing)} {plan.coverage.missing.length === 1 ? 'is' : 'are'} not
                    reached by the register wired here, and will be disclosed in the report as deferred
                    coverage rather than searched.
                  </Muted>
                ) : null}
              </>
            ) : places.length ? joinAnd(places) : 'Worldwide'}
          </Row>
          {scope && scope.classes.length ? (
            <Row label="Classes">{scope.classes.map(classLabel).join(', ')} <Muted>— from {scope.classesFrom}</Muted></Row>
          ) : null}
          <Row label="Goods or services">{goods ? <span data-anon="mark">{goods}</span> : <Muted>None — the classes are used</Muted>}</Row>
          {scope && scope.platforms.length ? (
            <Row label="Marketplaces">
              <span data-anon="mark">{allShops ? scope.platforms.join(', ') : firstAndMore(scope.platforms)}</span>
              {scope.platforms.length > 3 ? (
                <>
                  {' '}
                  <button type="button" className="chip-btn" onClick={() => setAllShops((v) => !v)}>
                    {allShops ? 'Show less' : `Show all ${scope.platforms.length}`}
                  </button>
                </>
              ) : null}
              {scope.platformsAdded.length ? <Muted> ({scope.platformsAdded.join(', ')} added for this search)</Muted> : null}
            </Row>
          ) : null}
          {/* COVERAGE AND ON OR OFF, and nothing else: the time and the count live in their own rows. */}
          <Row label="Native language">{nativeLanguageLine(nativeOn, places)}</Row>
          {/* The SERVER's figure when it has one, the level's coarse hint otherwise. Same row, and the
              composer's own footer bar is unchanged: that one has to be instant while the form moves,
              and it is computed from the same table (effortModelParity.test.ts pins it). Spelled as a
              reader says it — "1.5 to 2.5 hours" — through the one door every quote on this screen
              passes. */}
          {plan.effort?.turnaround || plan.turnaround
            ? <Row label="Turnaround">{turnaroundInWords(plan.effort?.turnaround || plan.turnaround || '')}</Row>
            : null}
          {/* USES AND LEFT TODAY, where the Effort bars and the Cost dots used to be. Ten notches of a
              number with no unit, beside five dots of a "cost" that was never a price, answered a
              question nobody had. What a reader is deciding at this moment is how many of today's
              searches this spends and how many that leaves — both of which the product already counts,
              in the one word it uses everywhere: searches.

              LEFT TODAY SAYS BOTH NUMBERS. "9 left" makes a reader do the subtraction the screen
              already did; the count now and the count after this one is the fact they are weighing. */}
          <Row label="Uses">{uses} search{uses === 1 ? '' : 'es'}</Row>
          {left != null ? (
            <Row label="Left today">{left} now, {Math.max(0, left - uses)} after this search</Row>
          ) : null}

          {plan.warnings.length ? (
            <ul style={{ margin: '12px 0 0', paddingLeft: 18, color: 'var(--text-muted)', fontSize: 13 }}>
              {plan.warnings.map((w, i) => <li key={i} style={{ marginBottom: 3 }}>{w}</li>)}
            </ul>
          ) : null}

          {/* Verbatim. This is a legal qualification on what the answer will mean, not UI copy. */}
          {/* GATED, because the server stopped sending one. `caveat` decodes to ''
              when absent, and an ungated <p> then renders an empty italic paragraph with a 12px top
              margin — a blank gap under the price that reads as something failing to load. A field that
              is gone must render as nothing, not as an empty box. */}
          {plan.caveat ? (
            <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>{plan.caveat}</p>
          ) : null}

          {failure ? (
            <div className="notice" style={{ borderColor: 'var(--tone-high)', margin: '14px 0 0' }}>
              <b>{failure.title}</b>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-muted)', fontSize: 12.5 }}>
                {failure.lines.map((l, i) => <li key={i} style={{ marginBottom: 3 }}>{l}</li>)}
              </ul>
              <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
                Nothing was started and nothing was used from your allowance.
              </p>
            </div>
          ) : null}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-ghost" onClick={onBack}>Back</button>
          {failure ? (
            // The ticket is spent or stale either way, so there is nothing here that could retry. Review
            // again re-plans against what is on the form — honest about being a fresh start, not a retry.
            <button type="button" className="btn-primary" onClick={onReview}>Review again</button>
          ) : (
            <button type="button" className="btn-primary" disabled={busy} onClick={onStart}>
              {busy ? 'Starting…' : 'Start search'}
            </button>
          )}
          {/* NO COUNTDOWN. The confirmation ticket still expires after ten minutes server-side, and is
              still one-shot and still bound to this exact request — none of that changed. What is gone
              is the stopwatch: it put a clock on a person reading a legal summary, which is the one
              screen where being hurried is worst, and it advertised a deadline nobody needs to know
              about. If the ticket has lapsed by the time they press Start, the server says so in a
              sentence and the panel above shows it. Ruling 2026-07-22. */}
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="modal-row">
      <span className="field-label" style={{ marginBottom: 0, letterSpacing: '.1em', fontSize: 11 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text-body)', textAlign: 'right' }}>{children}</span>
    </div>
  )
}

const Muted = ({ children }: { readonly children: React.ReactNode }) => (
  <span style={{ color: 'var(--text-muted)' }}>{children}</span>
)

/**
 * What each depth includes, side by side.
 *
 * NO NEW VISUAL VOCABULARY. `.table-wrap` + `table.data` are the table the Clearances and Custom
 * searches lists already use, `.section-hint` is this screen's own quiet line, and the one emphasis is
 * the `<b>` + `--text-strong` idiom the saved-search rows use. Nothing here adds a rule, a colour or a
 * size.
 *
 * `table.data` has a 760px min-width and this column is capped at 720px, so the table scrolls inside
 * its wrapper at every viewport. That is `.table-wrap` doing its job — the wide thing scrolls, the page
 * never does — and it is why the cap is load-bearing rather than incidental.
 *
 * Every string is `productMatrix`'s, read off the fetched payload: names as the server writes them,
 * never a key, a component name or a cost. A search this deployment cannot run keeps its column and
 * gains the server's own sentence underneath — a client cannot ask for what they cannot see, and the
 * same rule already governs the picker itself.
 */
function ProductMatrix({ products, currentKey }: { readonly products: readonly Product[]; readonly currentKey: string | null }) {
  const { columns, rows } = productMatrix(products, currentKey)
  if (!columns.length) return null
  const off = columns.filter((c) => !c.available && c.unavailableNote)
  return (
    <>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th />
              {/* Name over stage. The stage STAYS here: this table's whole job is comparison across
                  the ladder, and the number is the only thing that orders five columns. Inline styles
                  rather than a class — screenCopy.test.ts pins which classNames may appear in here. */}
              {columns.map((c) => (
                <th
                  key={c.key}
                  aria-current={c.current ? 'true' : undefined}
                  // `table.data th` is `white-space: nowrap`, which was free when this header read
                  // "STAGE 0" and is not now that it reads the product's full name: five unbreakable
                  // headers pushed the table so far past its wrapper that barely two columns were
                  // visible and the highlighted one was cut in half. Overridden HERE rather than in
                  // base.css because nowrap is right for every other data table on the site — this is
                  // the only one whose headers are sentences.
                  style={{ whiteSpace: 'normal', ...(c.current ? { background: 'var(--accent-wash)' } : {}) }}
                >
                  {/* THE NAME, AND ONLY THE NAME. There used to be a second line under it carrying the
                      rung on our own pricing ladder, because the header could not be read without that
                      ladder beside it. There is no ladder: the columns are ordered by effort and the
                      name is what the thing is called, here and at the top of the delivered report. */}
                  <span style={{ display: 'block' }}>{c.name}</span>
                  {c.current ? (
                    <span style={{ display: 'block', fontWeight: 400, color: 'var(--text-accent)' }}>you are here</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td><b style={{ color: 'var(--text-strong)' }}>{r.label}</b></td>
                {r.cells.map((cell, i) => (
                  <td
                    key={columns[i]?.key ?? String(i)}
                    // The glyph is decoration for a reader who can see it and nothing for one who
                    // cannot, so the CELL carries the claim in words. No visually-hidden span: this
                    // component may use only the three classes screenCopy pins, and inventing a fourth
                    // to hide text is a design decision taken in a component.
                    aria-label={cell.srLabel ? cell.srLabel + ': ' + cell.text : undefined}
                    style={columns[i]?.current ? { background: 'var(--accent-wash)' } : undefined}
                  >
                    {cell.marker ? (
                      <span aria-hidden style={{ marginRight: 6, color: 'var(--text-faint)' }}>{cell.glyph}</span>
                    ) : null}
                    {cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* THE LEGEND. Settings expresses state in words ("Inherited — …") and a list reads like settings —
          which is why the delta view above uses none of these. A dense five-column grid is the one place
          a symbol earns its keep, and a symbol with no key is a puzzle. */}
      <p className="section-hint" style={{ margin: '8px 0 0' }}>
        {/* Concatenated rather than interpolated: screenCopy greps this function for currency symbols,
            and a template literal's interpolation marker trips that guard. The guard is right to be as
            blunt as it is, so the copy bends instead. */}
        {LEGEND.map((m) => m.glyph + ' ' + m.name).join('   ·   ')}
      </p>
      {off.map((c) => (
        <p key={c.key} className="section-hint" style={{ margin: '8px 0 0' }}>
          {/* Name only: the column head two inches above already carries the stage. */}
          {c.name} — {c.unavailableNote}
        </p>
      ))}
    </>
  )
}

/** A collapsible group for the fields most requests leave alone. */
function Details({ summary, children }: { readonly summary: string; readonly children: React.ReactNode }) {
  return (
    <details>
      <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--text-strong)', fontSize: 14 }}>{summary}</summary>
      <div style={{ paddingLeft: 2 }}>{children}</div>
    </details>
  )
}

function Field({
  label, hint, children,
}: {
  readonly label: string
  readonly hint?: string
  readonly children: React.ReactNode
}) {
  return (
    <label style={{ display: 'block', marginTop: 18 }}>
      <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 13.5 }}>{label}</div>
      {hint ? <div style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '2px 0 7px' }}>{hint}</div> : <div style={{ height: 7 }} />}
      {children}
    </label>
  )
}

/**
 * The depth menu could not be fetched, so there is no form to draw.
 *
 * THE ONE THING THIS HAS TO SAY is that no money moved. This is the only screen in the portal that can
 * spend, the failure happens on the request that draws it, and a user who sees a clearance screen break
 * has no way to know whether it broke before or after something was started. So it says so outright, in
 * the wording portal-service already uses when the run door refuses ("Nothing was started, and nothing
 * was charged") — one product, one sentence for the same fact.
 *
 * THE SERVER'S OWN MESSAGE IS NOT ECHOED HERE, which is the opposite of what `explain` does for the
 * plan and run calls, and the difference is deliberate. Those messages are written by portal-service
 * for a client to read. The `upstream` shape on THIS call can also be minted in the browser, from a
 * request that never left: api.ts's `call` catches that and hands back `e.message`, which is whatever
 * this browser happens to call a dropped connection, in whatever language it was built in. That is not
 * copy anyone wrote for a client to read, and fixed wording is the only kind that can be reviewed.
 *
 * Rate limiting is separated because it is not a fault and it clears by itself. It does NOT promise an
 * automatic retry: this screen has no poll (unlike Clearances, which does and says so) — the retry here
 * is the button.
 */
function OptionsUnavailable({
  kind,
  onRetry,
}: {
  readonly kind: Exclude<Result<Searches>, { kind: 'ok' }>['kind']
  readonly onRetry: () => void
}) {
  const limited = kind === 'rateLimited'
  return (
    <div className="screen">
      <div className="notice prose" style={{ borderColor: 'var(--tone-high)' }}>
        <b>{limited ? 'Too many requests just now' : 'The search options could not be loaded'}</b>
        <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
          {limited
            ? 'The portal is pacing requests, so the depths you can choose from have not been fetched. '
              + 'Nothing has been started and nothing has been charged. Try again in a minute.'
            : 'The depths you can choose from could not be fetched, so there is nothing here to fill in '
              + 'yet. Nothing has been started and nothing has been charged — a search only begins when '
              + 'you review it and start it yourself.'}
        </p>
        <div style={{ marginTop: 14 }}>
          <button type="button" className="btn-ghost" onClick={onRetry}>Try again</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Queued.
 *
 * Deliberately says "queued", not "started". A 200 from the run door means the request was accepted, not
 * that a search is running — the engine can still refuse it, and when it does the Clearances list is
 * where that shows up. Promising more than was promised is how a failed run becomes a support ticket.
 */
function Submitted({ go, onAnother, name, duration }: {
  readonly go: (p: string) => void
  readonly onAnother: () => void
  /** The name that was queued, as the reader typed it. */
  readonly name: string
  /** The quote for its pipeline, as the footer showed it at the moment of starting. */
  readonly duration: string
}) {
  return (
    <div className="screen">
      {/* "QUEUED", NOT "STARTED". It has not started: it is waiting for a slot, and a title saying
          otherwise is the first thing a reader would have to un-learn when the Home band shows it
          under "queued". The sentence says the two facts the product has — that it is waiting, and how
          long it takes once it runs — and promises nothing it cannot keep. In particular it does not
          say anyone will be told when it finishes: nothing in the portal or the contract sends that. */}
      <PageHeader title="Clearance queued" />
      <div className="notice prose">
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>
          <span data-anon="mark">{name}</span> is waiting for a slot. It runs {duration} once it starts.
        </p>
        <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
          <button type="button" className="btn-primary" onClick={() => go('/portal/clearances')}>View in Clearances</button>
          <button type="button" className="btn-ghost" onClick={onAnother}>Start another</button>
        </div>
      </div>
    </div>
  )
}

/**
 * The strip a person meets straight after making a company.
 *
 * TAKEN ONCE, in an effect rather than during render: taking it is a write, and a render that mutates
 * module state runs twice under React's development double-render and the second read finds nothing.
 * The strip would then appear on some machines and not others, which is the worst way for a message to
 * be unreliable.
 *
 * Dismissable, because it is an announcement and not a decision.
 */
function CreatedStrip() {
  const [created, setCreated] = useState<CreatedCompany | null>(null)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => { setCreated(takeCreated()) }, [])

  if (!created || dismissed) return null
  const { line, warning } = createdStrip(created)
  return (
    <div className="empty" style={{ textAlign: 'left', margin: '4px 0 14px' }} role="status">
      <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
        <p style={{ margin: 0, flex: 1, color: 'var(--text-strong)' }}>{line}</p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit',
                   color: 'var(--text-muted)', cursor: 'pointer' }}
        >
          Dismiss
        </button>
      </div>
      {warning ? <p style={{ margin: '6px 0 0', color: 'var(--tone-high)', fontSize: 13 }}>{warning}</p> : null}
    </div>
  )
}
