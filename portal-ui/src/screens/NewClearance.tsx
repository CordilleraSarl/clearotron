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
// Context card, entry modes, names, start point, levers, where, then the pinned footer.
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
// THE SCOPE FIELDS ARE GHOSTS, NOT BLANKS. Untouched means "use what the brand owner already has" — the
// context card shows what that is, tagged with where it came from — and the server's precedence ladder
// resolves it. An empty territory list is not a request to search nowhere; it is worldwide, in this
// screen and in the engine alike. The summary quotes the SERVER's scope and never echoes this form.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  Plan, Result, Searches, SavedSearchDetail, ProjectSummary, ProjectDetail, ProfileConfig, Usage,
  ReadCapability, Product,
} from '../contract/api.ts'
import { api, isOk, operatorName, notCommitted } from '../contract/api.ts'
import { parseNames, parseList } from '../contract/compose.ts'
import type { Draft as Pick, EffortInput } from '../contract/composerProduct.ts'
import {
  EMPTY_DRAFT, blockers, effortUnits, costBand, turnaround, checksSummary, runsNote, machineryFor,
  territoryMatches, addTerritory, removeTerritory, reachesTerritory, vocabularyFor, offerableFor,
  inherited, composeSaved, draftFromSaved, nameBudget,
  chooseProduct, geographyFor, geographyNote, nativeLanguageControl, toggleNativeLanguage,
} from '../contract/composerProduct.ts'
import { productMatrix, LEGEND } from '../contract/productMatrix.ts'
import { classLabel, classMatches, isClassNumber } from '../contract/niceClasses.ts'
import { sortOwners } from '../contract/ownerNames.ts'
import type { BriefRead, ReadTarget } from '../contract/composeRead.ts'
import { resolveRead, applyRead, appliedNotes } from '../contract/composeRead.ts'
import { Icon } from '../components/Icon.tsx'
import { useLoad } from '../state/useApi.ts'
import { useUnsaved } from '../state/useUnsaved.ts'
import type { ShellContext } from '../shell/AppShell.tsx'

/** Which way in. `null` until one is chosen — the two-card fork the design opens on. */
type Entry = null | 'describe' | 'manual'

/**
 * What a read did, in three separable parts, because they are three different kinds of claim.
 *
 * `applied` is derived from the diff — a fact about the screen. `doubts` is the model's own commentary
 * and is labelled as such. `dropped` is what this composer could not place, which is OUR limitation
 * and is owned rather than hidden: a territory silently discarded is a territory the user believes
 * they are paying to search.
 */
type Receipt = {
  readonly applied: readonly string[]
  readonly doubts: readonly string[]
  readonly dropped: readonly string[]
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
   * Null and [] are different statements. Null means "whatever the brand owner already has", which the
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
  // The brand owner's own defaults, for the context card and the effort model. A failure here is
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

  const [entry, setEntry] = useState<Entry>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [territoryQuery, setTerritoryQuery] = useState('')
  const [classQuery, setClassQuery] = useState('')
  const [showAllShops, setShowAllShops] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveText, setSaveText] = useState('')
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  /** A refusal from the RUN door, shown inside the dialog. Separate from `problem`, which belongs to
   *  the form and is read while composing — this one is read at the moment of pressing the button. */
  const [runFailure, setRunFailure] = useState<{ readonly title: string; readonly lines: readonly string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ readonly title: string; readonly lines: readonly string[] } | null>(null)
  const [submitted, setSubmitted] = useState<string | null>(null)

  // A composed-but-unsent clearance is unsaved work like any form's, and this is the screen where losing
  // it costs the most — it can be twenty names, a goods description and a set of levers. Compared against
  // EMPTY rather than a loaded baseline because a fresh composer HAS no baseline; once submitted there is
  // nothing left to lose, so the guard stands down and "Start another" stays one click.
  const composerDirty = useMemo(
    () => submitted == null && JSON.stringify(draft) !== JSON.stringify(EMPTY),
    [draft, submitted],
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
    setDraft((d) => ({
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
    setEntry('manual')
    setSaveOpen(true)
    setSaveName(typeof editing.recipe['label'] === 'string' ? editing.recipe['label'] : '')
    setSaveText(typeof editing.recipe['notes'] === 'string' ? editing.recipe['notes'] : '')
  }, [editing, editingPick])

  const names = useMemo(() => parseNames(draft.names), [draft.names])

  // The brand owner as a PERSON reads it. `profile.account` is the account key the server echoed back,
  // which is a slug — printing it here put "vantor" in the context card while the rail beside it
  // said "Vantor Labs". Resolved through the shell's one resolver so those two can never disagree.
  // The brand owner as a PERSON reads it. The fallback used to be `profile.account` — the account key
  // the server echoes back — so whenever no owner was in view this card printed "vantor" beside a
  // rail that said "Vantor Labs". A slug is never the answer to "who is this for"; when there is no
  // owner in view the honest answer is a phrase, not a key.
  const ownerLabel = account ? ctx.ownerName(account) : 'this brand owner'
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
  const geoNote = geographyNote(activeLevel)
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
    // on the wire (`bodyFor`), the engine runs a grid column for each, and checksPerName / effortUnits /
    // costBand / the footer would all have sat still while it did.
    platforms: marketplacesApply ? own.platforms.length + parseList(draft.platforms).length : 0,
    density: own.density,
  }

  // Any edit invalidates the preview. See the header note: the server would refuse the stale ticket
  // anyway, so the only question is whether the user finds out now or after pressing the money button.
  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setPlan(null)
    setProblem(null)
    setSaveNote(null)
  }
  const setPick = (next: Pick) => edit({ pick: next })

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
    // The diff is taken against the draft as it stands NOW, inside the setter, so a read that lands
    // after the user has carried on typing applies to what is on screen rather than to a stale copy.
    setDraft((d) => {
      const before: ReadTarget = { draft: d.pick, names: d.names, classes: d.classes, goods: d.goods, ref: d.ref, deadline: d.deadline }
      // The owner's own classes travel with it: a ghost list materialises FROM them, never from empty.
      // `worldwide` is the one instruction allowed to remove chips — a brief that says everywhere over
      // a draft naming France. It is stated in the receipt; see applyRead for why it is the exception.
      const after = applyRead(before, read, own.classes, { worldwide })
      setReceipt({ applied: appliedNotes(before, after, own.classes, levels), doubts: read.notes, dropped })
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
        return { title: 'Choose a brand owner', lines: ['Pick who this clearance is for, at the top left.'] }
      case 'notFound':
        return { title: 'That is not available to you', lines: ['Check the brand owner selected at the top left.'] }
      // SPLIT FROM `notFound`. They are different answers and only one of them has
      // anything to do with the selector. `notFound` may well BE the wrong brand owner, so that advice is
      // right there. `noAccess` is the door refusing the identity itself — reachable only for door checks,
      // never for anything tenant-scoped — and telling that person to check the selector sends them to the
      // one thing that is not wrong. Someone who signs in successfully and can do nothing should be told
      // why on the page, not in a boot log nobody reads.
      //
      // The words are the ones portal-service already logs at boot: on no staff domain, in no grants row.
      // Nothing here is tenant-scoped, so it leaks nothing the 404-never-403 rule protects — it is a fact
      // about the caller's own identity, and it is the only fact that helps them.
      case 'noAccess':
        return {
          title: 'This address has no access yet',
          lines: ['You are signed in, but this address is on no staff domain and in no grants row, so every page refuses it. Selecting a different brand owner cannot change that — an administrator needs to add it to one.'],
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
      // Owner ruling: pressing New clearance in a demo walks the real flow "and then lands on one of the
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
      setSaveNote('Pick one of the four searches above first — there is nothing to save yet.')
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
      // An EDIT came from Custom searches and belongs back there — the list is where the result of the
      // change is visible. A create stays put: the levers on screen are the search being started.
      if (editingSlug) { ctx.go('/portal/brand/searches'); return }
      setSaveOpen(false)
      setSaveName('')
      setSaveText('')
      // — live but uncommitted is a WARNING, not a failure: the change is on disk.
      const uncommitted = notCommitted(r)
      setSaveNote(uncommitted
        ? `Saved as “${label}”. ${uncommitted}`
        : `Saved as “${label}” — it is in your custom searches.`)
    } else if (r.kind === 'conflict') {
      setSaveNote('Someone else changed this custom search while you were editing. Reload and re-apply.')
    } else {
      setSaveNote('That could not be saved. Try a different name, or check it on Custom searches.')
    }
  }

  if (submitted) {
    return (
      <Submitted
        go={ctx.go}
        onAnother={() => { setSubmitted(null); setDraft(EMPTY); setEntry(null) }}
      />
    )
  }

  // Every shape the depth menu can arrive in is answered BEFORE the form is drawn. A refused `searches`
  // call leaves `levels` empty, which would render a composer whose footer prices a level that is not
  // there: a form that cannot be filled in and says nothing about why.
  if (needsOwner || searches?.kind === 'pickAccount') {
    return (
      <div className="screen">
        <div className="notice">
          <b>Choose a brand owner first</b>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            A clearance is filed for one brand owner. Pick one at the top left, then start the search.
          </p>
        </div>
      </div>
    )
  }

  // Nothing at all until the first answer lands. Drawing the form first would flash a priced footer
  // against no levels on every single load — indistinguishable, for that moment, from the failure below.
  if (!searches) return <div className="screen" />

  if (searches.kind !== 'ok') return <OptionsUnavailable kind={searches.kind} onRetry={retrySearches} />

  // The gates read the request that will be SENT. With a saved search chosen the picker is behind a
  // notice and the recipe decides the product, so both gates measure `activeLevel` — the product that
  // will actually run — rather than the one the picker is holding.
  const stops = blockers(draft.pick, activeLevel, names.length)
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
  const overBudget = budget != null
  const exhausted = usage?.capped === true && usage.dailyRuns != null && usage.today >= usage.dailyRuns
  // classes OR goods, which is what the schema accepts. Requiring both would refuse requests the engine
  // runs — and with the owner's own classes on screen in the card, demanding they be retyped is worse.
  const missing = !names.length || (!classes.length && !draft.goods.trim())
  const ready = !missing && !stops.length && !nameStops.length && !overBudget && !exhausted && activeLevel != null
  // WHAT THE FOOTER CALLS THIS SEARCH, and there is only one answer now. It used to be `tierLabel`,
  // which invented seven strings for distinctions "the registry has no word for" — "Deep dive — United
  // States", "Full clearance". The registry has the word: it is the product's own name, the same string
  // the delivered report prints at the top.
  const startedFrom = draft.savedSearch
    ? (savedRow?.label ?? 'a custom search')
    : (activeLevel?.name ?? 'no search picked yet')

  return (
    <div className="screen">
      <div className="eyebrow">{editingSlug ? 'Custom search' : 'New clearance'}</div>
      <h1 style={{ fontSize: 27, margin: '4px 0 14px', color: 'var(--text-strong)' }}>
        {editingSlug ? 'Edit a custom search' : 'New clearance'}
      </h1>

      {/* Editing a saved search happens ON this screen, because a saved search is these levers with a
          name on it. The heading changes and this line says what the levers below are — without it the
          user would be looking at a New clearance form mysteriously pre-filled with someone's set-up. */}
      {editingSlug ? (
        editingRes && editingRes.kind !== 'ok' ? (
          <div className="notice" style={{ borderColor: 'var(--tone-high)' }}>
            <b>That custom search could not be opened</b>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
              Nothing has been changed.{' '}
              <button type="button" className="link-btn" onClick={() => ctx.go('/portal/brand/searches')}>Back to Custom searches</button>
            </p>
          </div>
        ) : editing && !editingPick ? (
          // A record whose product this screen cannot state — `draftFromSaved` refuses rather than
          // approximates, because the nearest thing it CAN say is a different search from the one the
          // client bought. Saying so beats opening a form that would rewrite it on the next Save.
          <div className="notice" style={{ borderColor: 'var(--tone-medium)' }}>
            <b>This custom search cannot be edited here</b>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
              It was built on a search this screen has no setting for, so opening it would change what it
              does. It still runs exactly as it is. Ask {operatorName(ctx.me.brand)} to change it, or build a new one here.{' '}
              <button type="button" className="link-btn" onClick={() => ctx.go('/portal/brand/searches')}>Back to Custom searches</button>
            </p>
          </div>
        ) : (
          <div className="notice quiet">
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
              Change the levers below, then <b>Save changes</b> in the footer. Nothing runs, and the
              searches already run under this one are unaffected — a finished report carries its own set-up.
            </p>
          </div>
        )
      ) : null}

      <Allowance usage={usage} />

      {/* ── context: who this is for, and what they already carry ── */}
      <div className="ctx-card">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 190, flex: 1 }}>
            <div className="field-label">Brand owner</div>
            {ctx.me.accounts.length > 1 ? (
              // The same value the sidebar switcher sets — the shell's own filter, mirrored where the
              // decision is being made. It is NEVER a request field: the server stamps identity from the
              // verified sign-in, and a body that named an owner would be a tenancy hole.
              <select
                value={account ?? ''}
                onChange={(e) => ctx.setOwner(e.target.value || null)}
                className="ctx-select"
                aria-label="Brand owner"
                data-anon="mark"
              >
                <option value="">Choose a brand owner…</option>
                {/* Value stays the KEY — it is what every request is keyed by. Only the label is named.
                    Sorted by the LABEL, and through the same helper the rail's switcher uses: these are
                    two views of one control, and a client meeting the same list in two orders on one
                    screen has to work out whether they are the same list. */}
                {sortOwners(Object.fromEntries(ctx.me.accounts.map((a) => [a, ctx.ownerName(a)])), ctx.me.accounts)
                  .map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
              </select>
            ) : (
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)', padding: '9px 0' }} data-anon="mark">
                {ownerLabel}
              </div>
            )}
          </div>
          <div style={{ minWidth: 190, flex: 1 }}>
            <div className="field-label">Project</div>
            {projects.length ? (
              <select value={draft.project} onChange={(e) => edit({ project: e.target.value })} className="ctx-select" aria-label="Project">
                <option value="">No project</option>
                {projects.map((p) => <option key={p.key} value={p.key}>{p.name || p.key}</option>)}
              </select>
            ) : (
              <div style={{ fontSize: 14, color: 'var(--text-faint)', padding: '9px 0' }}>No project · none configured</div>
            )}
          </div>
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
                   brand owner's FULL inherited list. "None set" described the form, not the search that
                   would run. Clearing every class is simply not expressible on this wire; rather than
                   pretend otherwise, the screen now says what will actually happen. */
                <span style={{ fontSize: 12.5, color: 'var(--tone-medium)' }}>
                  {own.classes.length
                    ? `Cleared — this will search ${own.classesFrom || "the brand owner's classes"} again (${own.classes.join(', ')}). Add one to narrow it.`
                    : 'None set — add one, or describe the goods below.'}
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
            <div className="fld-medium" style={{ position: 'relative' }}>
              <input
                value={classQuery}
                onChange={(e) => setClassQuery(e.target.value)}
                placeholder="Add a class…"
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
                Use the brand owner’s classes instead
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
                    Every marketplace listed here is a forced deep dive inherited from Brand Owner and
                    then Project configuration. By default common law sweeps everything it can find on the
                    open web, but this ensures particular focus to important markets.
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
                        Brand profile
                      </button>
                      .
                    </p>
                  </div>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  None on file — the open web is searched regardless. Add shops on Brand profile, or name
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

      {/* ── the two ways in ── */}
      {entry === null ? (
        <>
          <div className="entry-grid">
            <button type="button" className="entry-card" onClick={() => setEntry('describe')}>
              <span className="entry-title"><Icon name="sparkles" size={17} />Describe it</span>
              <span className="entry-body">
                Type it, or paste the email you were sent — it is read for you and this form fills in.
                Every field stays editable.
              </span>
            </button>
            <button type="button" className="entry-card" onClick={() => setEntry('manual')}>
              <span className="entry-title"><Icon name="sliders" size={17} />Set it up myself</span>
              <span className="entry-body">Choose the names, where to look, and how deep.</span>
            </button>
          </div>
          {/* TWO GROUPS, TWO HEADINGS. These were one list under one heading that said "four" while
              rendering the four products AND however many searches this account had saved, so the
              heading's own count was wrong for anybody who had saved one. The only thing separating the
              two kinds was the dashed border on `.start-pill-saved` — a convention nobody has been told,
              which is to say no distinction at all to the person reading it.

              The heading is what carries the meaning now; the dash stays as reinforcement. The saved
              group is behind a length check for the same reason the composer's own list below is: an
              account with nothing saved must see the four products and no empty heading under them. */}
          <div style={{ marginTop: 18 }}>
            <div className="field-label">Or start from one of the four searches</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {levels.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="start-pill"
                  onClick={() => { edit({ pick: chooseProduct(draft.pick, t), savedSearch: '' }); setEntry('manual') }}
                >
                  {t.name}
                </button>
              ))}
            </div>
            {savedSearches.length ? (
              <>
                {/* Not "your saved searches": a staff member reads this screen over a client's account,
                    and the possessive would name the wrong owner. The composer's own group avoids it for
                    the same reason. */}
                <div className="field-label" style={{ margin: '16px 0 6px' }}>
                  Custom searches{' '}
                  <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· start from one you built</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {savedSearches.map((r) => (
                    <button
                      key={r.slug}
                      type="button"
                      className="start-pill start-pill-saved"
                      data-anon="mark"
                      onClick={() => { edit({ savedSearch: r.slug }); setEntry('manual') }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="segmented-entry" role="group" aria-label="How to set this up">
            <button type="button" aria-pressed={entry === 'describe'} onClick={() => setEntry('describe')}>Describe it</button>
            <button type="button" aria-pressed={entry === 'manual'} onClick={() => setEntry('manual')}>Set it up myself</button>
          </div>

          <div className="composer-col">
            {entry === 'describe' ? (
              <DescribeIt
                value={draft.brief}
                onChange={(brief) => edit({ brief })}
                can={readCan}
                reading={reading}
                error={readErr}
                receipt={receipt}
                onRead={() => { void doRead() }}
              />
            ) : null}

            {/* ── names ── */}
            <div>
              <div className="section-title">Names</div>
              <p className="section-hint">
                {activeLevel && activeLevel.maxNames > 1
                  ? `One per line — a ${activeLevel.name} reads up to ${activeLevel.maxNames}.`
                  : 'One name — a clearance reads one at a time.'}
              </p>
              <textarea
                value={draft.names}
                onChange={(e) => edit({ names: e.target.value })}
                placeholder="AQUAPLUS"
                aria-label="Names"
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
                  onScreenAll={() => { if (knockout) edit({ pick: chooseProduct(draft.pick, knockout) }) }}
                />
              ) : names.length > 1 ? (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 7 }}>{names.length} names, one search.</div>
              ) : null}
            </div>

            {/* ── WHICH SEARCH ── */}
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 4 }}>
                <span className="section-title" style={{ marginBottom: 0 }}>Which search</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {levels.map((t) => (
                  <PickRow
                    key={t.key}
                    selected={!draft.savedSearch && draft.pick.product === t.key}
                    // NOT DISABLED, and the reason is AT the row. A product this deployment cannot run
                    // still gets a row with its own sentence beside it: a control that vanishes leaves a
                    // client with no way to know the search exists, and a greyed one with no reason
                    // invites a click that answers nothing.
                    unavailableNote={t.available ? null : (t.unavailableNote ?? 'Not available just now.')}
                    // — orderable, WITH the limit stated at the point of choosing.
                    coverageNote={t.available ? t.coverageNote : null}
                    capabilityNote={t.available ? t.capabilityNote : null}
                    onPick={() => edit({ pick: chooseProduct(draft.pick, t), savedSearch: '' })}
                    title={t.name}
                    // BOTH FIGURES ARE THE SERVER'S. A hand-typed "up to 20 names" beside a wall that
                    // refuses at eight is what this row used to carry.
                    tagline={`${t.geography} · up to ${t.maxNames} name${t.maxNames === 1 ? '' : 's'}${t.baseTurnaround ? ` · from ${t.baseTurnaround}` : ''}`}
                    description={[
                      // — THE COUNTS ARE PART OF WHAT A KNOCKOUT IS, so the card says so. This row
                      // read "No register search", which was true of a tier the offering retired and
                      // false of the one it sells: every Knockout takes register filing counts. A client
                      // choosing between the four searches was being told this one does not touch a
                      // register, and then receiving a report whose second section is register figures.
                      t.pipeline === 'knockout'
                        ? 'Marketplace and common-law screen across many names at once, plus register filing counts for every name — identical, containing and close variations of it — scoped to the classes you name.'
                        : 'Trademark registers and the live marketplace, one name.',
                      t.caseLaw ? 'Reasoned against the case law and oppositions of that country.' : '',
                      t.nativeLanguage === 'automatic' ? 'The native language of that country is searched automatically.' : '',
                      t.nativeLanguage === 'offered' ? 'The native-language investigation is optional here.' : '',
                    ].filter(Boolean).join(' ')}
                  />
                ))}
              </div>

              {savedSearches.length ? (
                <>
                  <div className="field-label" style={{ margin: '16px 0 8px' }}>
                    Custom searches{' '}
                    <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· reuse one you built</span>
                  </div>
                  <div className="saved-list">
                    {savedSearches.map((r) => (
                      <div
                        key={r.slug}
                        className={draft.savedSearch === r.slug ? 'saved-row saved-row-on' : 'saved-row'}
                        onClick={() => edit({ savedSearch: r.slug })}
                        role="button"
                        tabIndex={0}
                        aria-pressed={draft.savedSearch === r.slug}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit({ savedSearch: r.slug }) } }}
                      >
                        <span className={draft.savedSearch === r.slug ? 'radio radio-on' : 'radio'} aria-hidden />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }} data-anon="mark">{r.label}</span>
                          <span style={{ fontSize: 11.5, color: 'var(--text-faint)', marginLeft: 8 }}>
                            {/* A picker, not a comparison: the row already leads with the client's own
                                label in strong text, so this faint second line says WHAT it is rather
                                than where it sits on our ladder. */}
                            {(() => { const l = levels.find((x) => x.key === r.base); return l ? (l.name || l.stageLabel) : 'no longer available' })()}
                          </span>
                        </span>
                        {/* RETIRE, not delete. A saved search that produced a report is part of that
                            report's record — the engine has no delete door, and inventing one here would
                            promise something the server refuses. Retiring lives on Custom searches, which
                            is where the list of them is; this is a shortcut to it, not a second control.
                            It pointed at /portal/settings/searches, which has not been a route since the
                            brand screens moved to the top level — so the one control on this screen that
                            claimed to manage a saved search landed on "That page does not exist". */}
                        <button
                          type="button"
                          title="Retire this custom search"
                          aria-label={`Retire ${r.label}`}
                          className="saved-retire"
                          onClick={(e) => { e.stopPropagation(); ctx.go('/portal/brand/searches') }}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            {/* ── the levers ── */}
            {draft.savedSearch ? (
              <div className="notice" style={{ margin: 0 }}>
                <b>This custom search carries its own set-up</b>
                {/* IT DECIDES THE DEPTH, NOT THE SCOPE. This said "and where it points", which is what
                    the record LOOKS like — a saved search stores a scope — but the saved territories do
                    not steer the run: the engine scopes off the request and the account's own defaults
                    (driver/jx-lanes.mjs). So the sentence invited an empty Where and then the one-country
                    blocker sent the user looking for a control the notice had told them not to touch. */}
                <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
                  It decides how deep the search goes. Where, below, is still yours to set — the custom
                  search does not fix it.{' '}
                  <button type="button" className="link-btn" onClick={() => edit({ savedSearch: '' })}>
                    Set the levers myself instead
                  </button>
                </p>
              </div>
            ) : (
              <>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 3 }}>
                  <span className="section-title" style={{ marginBottom: 0 }}>What this search includes</span>
                </div>
                {/* WHAT IT CARRIES, stated. Not controls: these are facts about the search that was
                    picked, and a switch beside a fact is an invitation to change something that is not
                    a setting. Case law in particular used to be a lever on every clearance; it is what
                    a Full country search IS. */}
                {/* ── §B — IN OR OUT, VISUALLY ────────────────────────────
                    The owner: "replace with obvious tick/cross markers so in-or-out is visual." The list
                    read as three sentences of equal weight, and whether an axis ran at all was buried in
                    the clause after the dash — on the one screen where a reader is deciding what they
                    are buying.
                    THE GLYPH IS DERIVED FROM THE SAME FIELD THE SENTENCE IS, never set beside it: a tick
                    over "not part of this search" is a worse defect than no tick at all. The word rides
                    for a reader who cannot see the glyph. */}
                <ul className="carries">
                  {/* "not searched; filing counts only" LED WITH THE ABSENCE and then contradicted it in
                      the same clause. What a Knockout buys at the register is a COUNT — three of them per
                      name, in the classes named — and what it does not buy is the reading of the filings
                      behind them. Say the thing that was bought first. */}
                  {[
                    { in: true, text: `Trademark registers — ${activePipeline === 'knockout' ? 'filing counts per name (identical · containing · close variations), scoped to your classes; the filings themselves are not analysed' : 'searched, across your classes'}` },
                    { in: true, text: `Marketplace & common-law use — ${activePipeline === 'knockout' ? 'one broad sweep per name' : 'the full grid, every shop term by term'}` },
                    { in: Boolean(activeLevel?.caseLaw), text: `Case law and oppositions — ${activeLevel?.caseLaw ? 'part of this search' : 'not part of this search'}` },
                  ].map((row) => (
                    <Carries key={row.text} included={row.in} label={row.text}>{row.text}</Carries>
                  ))}
                </ul>

                {/* THE ONE TOGGLE IN THE OFFERING, and it is drawn only where it is a choice. On a Full
                    country search it is automatic and the screen SAYS so rather than showing a switch
                    that cannot move; on the other two it is not sold, so there is nothing here at all —
                    never a greyed control, which invites a click and answers nothing. */}
                {nativeControl === 'toggle' ? (
                  <div className="sunken-block" style={{ marginTop: 12 }}>
                    <Lever
                      label="Native-language investigation"
                      hint="Native marketplaces and native registers in the language of the countries you named. A clearance already searches the mark transliterated into the scripts its territories register marks in — this is the deeper read."
                      on={draft.pick.nativeLanguage}
                      onToggle={() => setPick(toggleNativeLanguage(draft.pick, activeLevel))}
                    />
                  </div>
                ) : nativeControl === 'automatic' ? (
                  <p className="section-hint" style={{ marginTop: 10 }}>
                    The native language of that country is searched automatically — it is part of this
                    search, not something to switch on.
                  </p>
                ) : null}

                {/* THE FOUR SIDE BY SIDE. The delta view that used to sit here priced a LEVER MOVE, and
                    there are no levers: what a client asks now is "am I buying the right one of the
                    four", which is a comparison, which is a table. Every cell is read off the same
                    fetched payload the picker above is built from, so neither can drift from what the
                    engine will actually run. */}
              </div>
              {/* ── — THE OPT-OUT HAS TO BE A CHILD OF THE THING THAT CAPS IT ──
                  The owner has ruled this width three times, and the reason it survived two fixes is
                  that the second one was inert. `.composer-wide` was written to let this block take the
                  screen's measure, and it was applied to a GRANDCHILD of `.composer-col`. The cap is
                  `.composer-col > *`, which matches direct children only — so the block's own parent was
                  still 720px, and `max-width: none` cannot make a box wider than the one it lives in.
                  Measured before this change, at a 1280px window: wrapper 718px against a 760px table,
                  42px of overflow, FOUR of the five columns visible and the fifth reachable only by
                  side-scrolling, with 248px of the column's width unused beside it. Exactly the failing
                  signature he named — wraps AND side-scrolls.

                  So it is a sibling now rather than a descendant, and the fragment above exists for
                  that and nothing else. The rule it opts out of is unchanged: 720px is the right measure
                  for a COLUMN OF FIELDS, and a five-column comparison is not a form line. `.table-wrap`
                  keeps its scroll for a genuinely narrow viewport, where there is no room to give. */}
              {levels.length ? (
                /* No margin of its own any more. As a child of the wrapper it needed one; as a direct
                   child of `.composer-col` it inherits the column's 26px flex gap, and keeping the 14
                   on top put it 40px from the list it belongs to — further than two SECTIONS sit
                   apart, which reads as detached rather than as part of what is above it. */
                <div className="composer-wide">
                  <Details summary="Detailed search comparison table for information">
                    <ProductMatrix products={levels} currentKey={activeBase} />
                  </Details>
                </div>
              ) : null}
              </>
            )}

            {/* ── WHERE — a different control per product, and each says at the control what it takes ── */}
            <div>
              <div className="section-title">Where</div>
              {/* THE PRODUCT'S OWN SENTENCE, at the control, always. Not a tooltip and not a refusal
                  after the fact: the requester reads what this search accepts while they are choosing
                  where it points. */}
              {geoNote ? <p className="section-hint">{geoNote}</p> : null}

              {activeLevel?.geography === 'worldwide, and nothing else' ? (
                // NO PICKER AT ALL, and that is the design. Worldwide is not a choice on this search —
                // it IS this search — so a territory field here would be a control whose every use is
                // refused. The chip states the fact; the sentence above says why there is nothing to set.
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '9px 0 0' }}>
                  <span className="chip">Worldwide</span>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '9px 0 10px' }}>
                    {/* "WORLDWIDE" WAS ONLY TRUE FOR AN ACCOUNT WITH NO TERRITORIES OF ITS OWN. An empty
                        list used to mean "unset", and the engine's ladder resolved unset to the brand
                        owner's defaultJurisdictions — seven of them, for one demo account — so this chip
                        promised a worldwide clearance and the run searched seven countries. The request
                        now STATES its mode (`geographyFor`), so the two can no longer be confused; what
                        the screen still owes the reader is the account's own list, tagged with where it
                        came from, exactly as Classes does above. */}
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
                  <div className="fld-medium" style={{ position: 'relative' }}>
                    <input
                      value={territoryQuery}
                      onChange={(e) => setTerritoryQuery(e.target.value)}
                      // The PLACEHOLDER follows the product too: a Full country search offers no regions,
                      // so inviting one would be inviting a refusal.
                      placeholder={activeLevel?.geography === 'exactly one country' ? 'Type a country…' : 'Type a country or region…'}
                      autoComplete="off"
                      aria-label="Add a territory"
                      className="ctx-input"
                      disabled={!activeLevel}
                    />
                    {territoryMatches(territoryQuery, draft.pick.territories, activeLevel, 8, registerTerritories).length ? (
                      <div className="typeahead">
                        {territoryMatches(territoryQuery, draft.pick.territories, activeLevel, 8, registerTerritories).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => { setPick(addTerritory(draft.pick, t, activeLevel, registerTerritories)); setTerritoryQuery('') }}
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
                      {vocabularyFor(activeLevel, registerTerritories).length} of the{' '}
                      {offerableFor(activeLevel).length} territories you can name here:{' '}
                      {vocabularyFor(activeLevel, registerTerritories).join(', ')}. Anywhere else can
                      still be ordered — it is disclosed in the report as deferred coverage rather than
                      searched at the register.
                    </p>
                  ) : null}
                  {/* ONE COUNTRY REPLACES, it does not stack — so the note says what just happened rather
                      than leaving the reader to notice a chip disappear. */}
                  {activeLevel?.geography === 'exactly one country' && draft.pick.territories.length === 1 ? (
                    <div className="callout-accent">
                      {draft.pick.territories[0]} — naming another country replaces it, because this search
                      reads one at a time.
                    </div>
                  ) : null}
                </>
              )}
            </div>

            {/* ── goods ── */}
            <div>
              <div className="section-title">Goods or services description (optional)</div>
              <textarea
                value={draft.goods}
                onChange={(e) => edit({ goods: e.target.value })}
                rows={3}
                aria-label="Goods or services"
                placeholder="Downloadable software for fleet logistics; software as a service."
                className="ctx-input"
                style={{ resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>

            {/* ── §B — CONTEXT MOVES UP, AND IS ALWAYS OPEN ────────────────
                The owner: "not hidden under a collapse thing — it's important." It sat third inside a
                collapsible headed "References and dates", so the one field that changes how a hit is
                WEIGHED was behind a click, under a heading that does not describe it, below two fields
                about paperwork. It now sits directly under Goods or services — the field it qualifies —
                in the open, as its own section like every other thing that matters on this form.
                What is left in the collapsible is exactly what its summary already claims: a reference
                and a date. */}
            <div>
              <div className="section-title">Any context that might be relevant (optional).</div>
              <textarea
                value={draft.instructions}
                onChange={(e) => edit({ instructions: e.target.value })}
                rows={3}
                aria-label="Any context that might be relevant"
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

            {/* The marketplaces field MOVED OUT of here, up beside the chips it adds to. It sat in a
                collapsible with three unrelated fields, so the one control that answers "how do I add a
                shop" was two clicks from the list of shops. The context field moved out too (§B of
                ) and is above. What is left is a reference and a date, which is what
                this collapsible's summary says it holds. */}
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
                reason is exactly what this screen was rebuilt to stop doing. */}
            {stops.length || nameStops.length ? (
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

          {/* units/cost/duration below are the BROWSER's figures while composing — they have to be
              instant as the levers move, and this step makes no server call by design. Once a plan
              exists the SERVER's replace them in place: same footer, same layout, different source.
              They agree by construction (effortModelParity.test.ts pins the weights) except where a
              lever does not survive the wire — the script-lane count, which the server resolves from
              the jurisdictions and the composer can only guess at. That case is exactly why the server
              is preferred here rather than leaving a guess on screen beside the Start button.

              `tier` — ONE NAME, AND IT IS THE PRODUCT'S. The footer used to call a composed search
              "Full clearance" (a label the composer invented, because the registry had no word for it)
              and a saved one "Stage 1". Both now read the name the delivered report prints at the top. */}
          <Footer
            startedFrom={startedFrom}
            tier={activeLevel?.name || activeLevel?.stageLabel || (draft.savedSearch ? 'Custom search' : 'No search picked')}
            detail={[
              names.length ? `${names.length} name${names.length === 1 ? '' : 's'}` : 'no names yet',
              // Same correction as the Where chips: unset resolves to the account's territories, not to
              // the world. The footer is the running total someone watches while composing, so it is the
              // last place that should disagree with what will actually run.
              draft.pick.territories.length
                ? draft.pick.territories.join(', ')
                : own.territories.length
                  ? own.territories.join(', ')
                  : 'worldwide',
              checksSummary(effort),
            ].join(' · ')}
            units={plan?.effort?.units ?? effortUnits(effort)}
            cost={plan?.effort?.costBand ?? costBand(effort)}
            duration={plan?.effort?.turnaround || turnaround(effort)}
            runs={runsNote(effort)}
            ready={ready}
            busy={busy}
            // — DEMO ONLY, never unknown. `engineMode` is null when no configuration snapshot has
            // been written; that is "cannot answer", and answering it as demo would take the button away
            // from a working install because a file is missing.
            demoMode={ctx.me.engineMode === 'demo'}
            saveOpen={saveOpen}
            saveName={saveName}
            saveText={saveText}
            saveNote={saveNote}
            editing={editingSlug != null}
            canSave={!draft.savedSearch && !stops.length}
            onSaveOpen={() => { setSaveOpen(true); setSaveName(activeLevel ? `${activeLevel.name}` : 'Custom search') }}
            onSaveName={setSaveName}
            onSaveText={setSaveText}
            // An edit's save panel is the reason the screen is open, so cancelling it goes back to the
            // list rather than leaving the levers of someone else's saved search sitting on a form with
            // no way to tell what they belong to.
            onSaveCancel={() => {
              if (editingSlug) { ctx.go('/portal/brand/searches'); return }
              setSaveOpen(false); setSaveNote(null)
            }}
            onSave={doSave}
            onReview={doPlan}
          />

          {plan ? (
            <ReviewDialog
              plan={plan}
              busy={busy}
              owner={ownerLabel}
              project={projectLabel}
              names={names}
              onStart={doRun}
              onBack={() => { setPlan(null); setRunFailure(null) }}
              failure={runFailure}
              onReview={() => { setPlan(null); setRunFailure(null); void doPlan() }}
            />
          ) : null}
        </>
      )}
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
      <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--text-muted)' }}>
        A sentence is enough, or paste the whole thread.
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        aria-label="Describe the search"
        data-anon="mark"
        placeholder="Need a quick check on AQUAPLUS for energy drinks in the US before Friday — just the obvious blockers."
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

      {receipt ? (
        <div className="read-receipt" style={{ marginTop: 12 }}>
          {receipt.applied.length > 0 ? (
            <>
              <div className="read-receipt-head">What I read</div>
              <ul>{receipt.applied.map((n) => <li key={n}>{n}</li>)}</ul>
            </>
          ) : (
            // A read that changed nothing says so. The alternative — an empty box under a pressed
            // button — reads as a failure the user cannot see or retry deliberately.
            <div className="read-receipt-head">Nothing in that I could turn into a search — set it up below.</div>
          )}
          {receipt.doubts.length > 0 ? (
            <>
              <div className="read-receipt-head" style={{ marginTop: 10 }}>Not sure about</div>
              <ul>{receipt.doubts.map((n) => <li key={n}>{n}</li>)}</ul>
            </>
          ) : null}
          {receipt.dropped.length > 0 ? (
            <>
              <div className="read-receipt-head" style={{ marginTop: 10 }}>Left out — not a territory this search offers</div>
              <ul>{receipt.dropped.map((n) => <li key={n}>{n}</li>)}</ul>
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
 * than revealed once at the review step. Cost is five dots and NEVER a currency figure — there is no
 * price model, and inventing one on a client's screen would be a quote.
 *
 * "Starting from" leads, because a prefilled template that is invisible is the same as no template: the
 * user cannot tell what they picked, which is the gap this line closes.
 */
function Footer({
  startedFrom, tier, detail, units, cost, duration, runs, ready, busy, demoMode,
  saveOpen, saveName, saveText, saveNote, editing, canSave,
  onSaveOpen, onSaveName, onSaveText, onSaveCancel, onSave, onReview,
}: {
  readonly startedFrom: string
  readonly tier: string
  readonly detail: string
  readonly units: number
  readonly cost: number
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
  readonly saveOpen: boolean
  readonly saveName: string
  /** The saved search's note. Free text, for whoever picks it up next; the engine never reads it. */
  readonly saveText: string
  readonly saveNote: string | null
  /** True while this composer is open OVER an existing saved search, rather than composing a new one. */
  readonly editing: boolean
  readonly canSave: boolean
  readonly onSaveOpen: () => void
  readonly onSaveName: (v: string) => void
  readonly onSaveText: (v: string) => void
  readonly onSaveCancel: () => void
  readonly onSave: () => void
  readonly onReview: () => void
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 104 }}>
          <div style={{ display: 'flex', gap: 2, marginBottom: 4 }} aria-hidden>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
              <span key={i} className={i <= units ? 'bar bar-on' : 'bar'} />
            ))}
          </div>
          <div className="footer-eyebrow">Effort {units}/10</div>
        </div>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-strong)' }}>{duration}</div>
          <div className="footer-eyebrow">turnaround</div>
        </div>
        <div>
          <div style={{ display: 'inline-flex', gap: 3 }} aria-hidden>
            {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= cost ? 'dot dot-on' : 'dot'} />)}
          </div>
          <div className="footer-eyebrow" style={{ marginTop: 3 }}>cost</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none', flexWrap: 'wrap' }}>
        {canSave && !saveOpen ? (
          <button type="button" className="btn-ghost" onClick={onSaveOpen}>Save as search</button>
        ) : null}
        {canSave && saveOpen ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <input
              value={saveName}
              onChange={(e) => onSaveName(e.target.value)}
              placeholder="Name this search"
              aria-label="Name this search"
              className="ctx-input"
              data-anon="mark"
              style={{ width: 160, fontSize: 12.5, padding: '8px 10px' }}
            />
            {/* The note the retired editor carried. Kept because a saved search outlives whoever set it
                up, and "why is this one different" is the question its next user arrives with. It is
                never read by the engine — it is a message to a colleague. */}
            <input
              value={saveText}
              onChange={(e) => onSaveText(e.target.value)}
              placeholder="Note (optional)"
              aria-label="Note about this custom search"
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
        {demoMode ? (
          // NO DEAD BUTTON. Before this the button was live, the click was accepted, and the
          // refusal arrived as a 502 several seconds later — a user cannot tell that from a broken
          // product. The sentence says where they are and the one command that moves them, which is
          // the difference between "you are missing four things" and "you are here".
          <div className="footer-demo-note" role="status" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
            <strong>No search engine is attached to this install.</strong>{' '}
            Everything else works — the example report, its audit trail and the assistant connection are
            live right now. To start new searches, install a reasoning CLI and sign in, then run{' '}
            <code>npm run setup</code> again.
          </div>
        ) : (
          <button type="button" className="btn-primary" disabled={!ready || busy} onClick={onReview}>
            {busy ? 'Checking…' : 'Review clearance'}
            <Icon name="arrow-right" size={14} />
          </button>
        )}
      </div>
    </div>
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

/** A template row: radio dot, name, mono tagline, one line of what it buys. */
/**
 * ── §B — one line of "what this search includes", marked ────────────────────
 *
 * The tick and the cross come from ONE boolean, so a row cannot carry a marker that disagrees with its
 * own sentence. The glyph is decorative and the WORD is what a screen reader gets — "Included" /
 * "Not included" — because a bare ✓ read aloud is a check mark, not an answer.
 */
function Carries({ included, label, children }: {
  readonly included: boolean
  /** The row's own words, so the accessible name states the claim rather than reading a check mark. */
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    // The claim in words on the ROW, the glyph hidden — the same convention the comparison table below
    // uses for its markers, rather than a visually-hidden span this stylesheet does not have.
    <li className={included ? 'carries-in' : 'carries-out'} aria-label={`${included ? 'Included' : 'Not included'}: ${label}`}>
      <span className="carries-mark" aria-hidden>{included ? '✓' : '✕'}</span>
      <span aria-hidden>{children}</span>
    </li>
  )
}

function PickRow({
  selected, onPick, title, tagline, description, unavailableNote = null, coverageNote = null,
  capabilityNote = null,
}: {
  readonly selected: boolean
  readonly onPick: () => void
  readonly title: string
  readonly tagline: string
  readonly description: string
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
    <button
      type="button"
      onClick={off ? undefined : onPick}
      disabled={off}
      aria-pressed={selected}
      aria-describedby={undefined}
      className={`pick-row${selected ? ' pick-row-on' : ''}${off ? ' pick-row-off' : ''}`}
    >
      <span className={selected ? 'radio radio-on' : 'radio'} style={{ marginTop: 2 }} aria-hidden />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)' }}>{title}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.03em', color: 'var(--accent-quiet)' }}>{tagline}</span>
        </span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 2 }}>{description}</span>
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
  )
}

/**
 * The summary the user actually buys.
 *
 * Everything priced here comes from the SERVER's reading of the request, not from the draft — the point
 * of the step is to show what the request really is, and echoing the form back would show only what the
 * user already believes. The depth especially: the server resolves the customer's own default when none
 * was named, and that answer can differ from the levers that were set.
 *
 * The scope rows exist for the same reason. A form with a territory box and a summary that never
 * mentions territories asks someone to confirm a search whose most expensive dimension is invisible.
 * Each row states WHERE the value came from, because "the territories you named" and "your account's
 * usual territories" look identical once resolved.
 */
function ReviewDialog({
  plan, busy, owner, project, names, onStart, onBack, failure, onReview,
}: {
  readonly plan: Plan
  readonly busy: boolean
  readonly owner: string
  readonly project: string | null
  readonly names: readonly string[]
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

  const scope = plan.scope

  return (
    <div className="modal-scrim" onClick={onBack} role="dialog" aria-modal="true" aria-label="Review before you start">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-rule" aria-hidden />
          <span className="eyebrow" style={{ color: 'var(--accent-quiet)' }}>Review before you start</span>
          {/* THE NAME LEADS, and this is the site that most needed it: the last thing read before money
              is spent used to be the bare string "Stage 1". That names our own pricing ladder, and it
              collides with the Stage 1 / Stage 2 vocabulary the legal reasoning already uses for
              something else entirely. The stage still rides beside it (the numbering is honest about
              how much work a report represents), just never alone.
              `|| stageLabel` so an older server degrades to the old headline rather than a blank one. */}
          <h2 style={{ margin: '7px 0 3px', fontSize: 21, fontWeight: 700, letterSpacing: '-.02em', color: 'var(--text-strong)' }}>
            {plan.name || plan.stageLabel}
          </h2>
          {plan.stageLabel && plan.stageLabel !== (plan.name || plan.stageLabel) ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-faint)', marginBottom: 3 }}>{plan.stageLabel}</div>
          ) : null}
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
            Search configuration
          </p>
        </div>

        <div style={{ padding: '6px 24px' }}>
          <Row label="Brand owner"><span data-anon="mark">{owner}</span></Row>
          <Row label="Project">{project ?? 'No project'}</Row>
          <Row label="Names"><span data-anon="mark">{names.join(', ') || String(plan.marks)}</span></Row>
          {scope && scope.jurisdictions.length ? (
            <Row label="Where">{scope.jurisdictions.join(', ')} <Muted>— from {scope.jurisdictionsFrom}</Muted></Row>
          ) : <Row label="Where">Worldwide</Row>}
          {/* ── — THE COVERAGE LIMIT, WHERE THE TICKET IS SPENT ──────────────
              The ruling states the limit "at the point of choosing"; this is the other point, and it is
              the one that matters most. A worldwide search is orderable on a partial register now, so
              "you are buying a worldwide search that will not reach most of the world" belongs in front
              of the reader here rather than in the report they read afterwards. Directly under Where,
              because it qualifies that row and nothing else. */}
          {plan.coverage ? (
            <Row label="Register reach">
              {plan.coverage.reached.length} of {plan.coverage.reached.length + plan.coverage.missing.length}{' '}
              territories: {plan.coverage.reached.join(', ')}.{' '}
              <Muted>The rest are disclosed in the report as deferred coverage rather than searched at the register.</Muted>
            </Row>
          ) : null}
          {scope && scope.classes.length ? (
            <Row label="Classes">{scope.classes.join(', ')} <Muted>— from {scope.classesFrom}</Muted></Row>
          ) : null}
          {scope && scope.platforms.length ? (
            <Row label="Marketplaces">
              {scope.platforms.length} shop{scope.platforms.length === 1 ? '' : 's'}
              {scope.platformsAdded.length ? <Muted> ({scope.platformsAdded.join(', ')} added for this search)</Muted> : null}
            </Row>
          ) : null}
          {/* The SERVER's figure when it has one, the level's coarse hint otherwise. Same row, and the
              composer's own footer bar is unchanged: that one has to be instant while the levers move,
              and it is computed from the same weights (effortModelParity.test.ts pins them). This is the
              step where a resolved answer exists — the server knows which script lanes the jurisdictions
              actually buy, which the wire does not carry — so this is where it should be read from. */}
          {plan.effort?.turnaround || plan.turnaround
            ? <Row label="Turnaround">{plan.effort?.turnaround || plan.turnaround}</Row>
            : null}
          {/* EFFORT, where the stage number used to be the only answer to "how much am I buying".
              `plan.effort` has been on the wire all along and this step rendered only its turnaround —
              so the one figure that says how big a search is sat unread at the moment of deciding. Same
              bars and dots as the composer footer, on purpose: it is the same quantity, and a second
              visual language for it would invite the reader to work out whether it is the same one. */}
          {plan.effort ? (
            <Row label="Effort">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', gap: 2 }} aria-hidden>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                    <span key={i} className={i <= plan.effort!.units ? 'bar bar-on' : 'bar'} />
                  ))}
                </span>
                <Muted>{plan.effort.units}/10 for this brand owner</Muted>
                <span style={{ display: 'inline-flex', gap: 3 }} aria-hidden>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <span key={i} className={i <= plan.effort!.costBand ? 'dot dot-on' : 'dot'} />
                  ))}
                </span>
                <Muted>cost</Muted>
              </span>
            </Row>
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
          {failure ? (
            // The ticket is spent or stale either way, so there is nothing here that could retry. Review
            // again re-plans against what is on the form — honest about being a fresh start, not a retry.
            <button type="button" className="btn-primary" onClick={onReview}>Review again</button>
          ) : (
            <button type="button" className="btn-primary" disabled={busy} onClick={onStart}>
              {busy ? 'Starting…' : 'Start clearance'}
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onBack}>Back to edit</button>
          {/* NO COUNTDOWN. The confirmation ticket still expires after ten minutes server-side, and is
              still one-shot and still bound to this exact request — none of that changed. What is gone
              is the stopwatch: it put a clock on a person reading a legal summary, which is the one
              screen where being hurried is worst, and it advertised a deadline nobody needs to know
              about. If the ticket has lapsed by the time they press Start, the server says so in a
              sentence and the panel above shows it. Owner ruling 2026-07-22. */}
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
 * The daily allowance, stated quietly.
 *
 * Only for principals it BINDS. Staff are uncapped, and telling a staff member "2 of 3 used" would be
 * both wrong and alarming. A null cap means the server could not tell us the limit — that renders as
 * nothing at all rather than as zero or as unlimited, because inventing either would be a claim about
 * someone's contract.
 */
function Allowance({ usage }: { readonly usage: Usage | null }) {
  if (!usage || !usage.capped || usage.dailyRuns == null) return null
  const left = Math.max(0, usage.dailyRuns - usage.today)
  const none = left === 0
  return (
    <div className="notice" style={{ marginTop: 0, ...(none ? { borderColor: 'var(--tone-high)' } : {}) }}>
      <b>{none ? 'No searches left today' : `${usage.today} of ${usage.dailyRuns} searches used today`}</b>
      <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
        {none
          ? 'The allowance resets at midnight UTC. Your account contact can run one for you in the meantime.'
          : `${left} left. The allowance resets at midnight UTC.`}
      </p>
    </div>
  )
}

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
function Submitted({ go, onAnother }: { readonly go: (p: string) => void; readonly onAnother: () => void }) {
  return (
    <div className="screen">
      <div className="eyebrow">Queued</div>
      <h1 style={{ fontSize: 27, margin: '4px 0 14px', color: 'var(--text-strong)' }}>Clearance started</h1>
      <div className="notice prose">
        <b>It is in the queue</b>
        <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
          It will appear in Clearances, and the entry there tracks it the whole way — including if it
          stops early.
        </p>
        <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
          <button type="button" className="btn-primary" onClick={() => go('/portal/clearances')}>View in Clearances</button>
          <button type="button" className="btn-ghost" onClick={onAnother}>Start another</button>
        </div>
      </div>
    </div>
  )
}
