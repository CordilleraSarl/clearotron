// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Reads on one name.
//
// The design shows a strip of pills above a report — one per READ of the same mark — so a reader can
// move between a knockout screen and the preliminary that followed it without going back to the list.
//
// The honest position on the data is worth stating, because it decides how much this can promise.
//
// There is a designed lineage field, `parentRunId`. It is validated at intake, frozen into the run's
// sidecar, and carried through the pipeline — and it is populated on ZERO of the runs in the pool
// today, because nothing has ever set it. The composer will start setting it when "＋ Another read"
// exists (P3). Until then the only thing linking two reads of one mark is the mark string.
//
// The mark itself now arrives on the wire as `markName` — the name the user typed, copied out of the
// run's status.json at publish. That closed the worst of this: `meta.title` is model-authored front
// matter and a real run carries "AquaPlus — US Preliminary Trademark Clearance" as its title, which
// grouped and displayed as a headline rather than a name.
//
// It is still best-effort, for two reasons. Runs delivered BEFORE publish started copying it carry
// null and fall back to `title`, so they group on the headline until they are re-rendered. And
// normalisation is deliberately shallow: `AQUAPLUS` and `AquaPlus` group correctly; `AQUA PLUS`
// splits, and nothing can currently prevent that.
//
// So the strip is built to DEGRADE rather than to mislead: with one read it renders nothing at all,
// and a wrongly-split thread shows fewer reads rather than someone else's. When parentRunId starts
// flowing, `readsFor` gains a lineage branch and the heuristic becomes a fallback.

import type { Run } from './api.ts'

/**
 * The grouping key for a mark.
 *
 * Case and surrounding whitespace are normalised because a model writing `AQUAPLUS` on one run and
 * `AquaPlus` on the next is a real and observed variation. INTERNAL whitespace and punctuation are
 * deliberately NOT normalised — collapsing them would merge `AQUA PLUS` with `AQUAPLUS`, which are
 * different marks that a lawyer may well be clearing separately, and merging two marks is a worse
 * failure than splitting one.
 */
export function markKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * The name to SHOW for a run, and the name to group it by.
 *
 * ONE RULE, EVERY SHAPE: the mark the run is about. One mark is the mark; several are the first
 * plus a count. Never a run type — `title` is the report's headline, and a list of headlines is not a
 * list of names.
 *
 * Three sources, in order of how directly each states the mark:
 *
 *   1. `markName` — as the user typed it. The publisher's own answer.
 *   2. `marks[]` — the per-name summary a batch carries. This is what makes the rule work on runs
 *      ALREADY DELIVERED: a knockout batch published before  wrote no `markName`, and its meta is
 *      frozen, so without this every existing batch row would keep reading "Knockout review — N marks"
 *      until it was re-run. Deriving here fixes the rows on screen today.
 *   3. `title` — the last resort, and it is visibly worse on purpose. Three of the five runs in the pool
 *      predate `markName` entirely. A run reading "AquaPlus — US Preliminary Trademark Clearance" in a
 *      Name column is telling you it has not been re-rendered yet.
 *
 * NO PLACEHOLDER. A record that carries nothing gets its title, not an invented "(unnamed)": the issue
 * rules that a genuinely nameless clearance is a data question, and a placeholder is how a data question
 * stops being visible.
 */
export function displayName(run: Pick<Run, 'markName' | 'title' | 'marks'>): string {
  const typed = run.markName?.trim()
  if (typed) return typed
  const named = (run.marks ?? []).map((m) => m.name?.trim()).filter((n): n is string => !!n)
  if (named.length === 1) return named[0]!
  if (named.length > 1) return `${named[0]} +${named.length - 1} more`
  return run.title
}

/**
 * ── — A NAME GOING INTO A SENTENCE ──────────────────────────────────────────
 *
 * What the owner was actually shown when he pressed Retire, verbatim:
 *
 *   Retire I have a new product for bouncy bricks made of a composite from recycled material. It makes
 *   bricks that can be used to build a house that its bouncy so that it can flex in the wind.? The read
 *   stays in the pool …
 *
 * The dialog composed `Retire ${mark.name}?` and the name was 200 characters, so the question mark
 * landed after a paragraph and the sentence explaining what retiring does was unreadable — at the one
 * moment a reader is being asked to confirm something.
 *
 * THE DOOR NOW REFUSES A NAME THAT LONG, and this exists anyway, for two reasons
 * that outlive that fix. Runs ordered BEFORE it carry the paragraph in their record for ever, and a
 * name inside the budget is still 120 characters — long enough to bury the rest of a confirm. A dialog
 * that assumes its interpolations are short is the assumption, not the length.
 *
 * IT ELLIPSES, IT DOES NOT REFUSE, because a confirm is not a door: the reader has to recognise which
 * record this is, and the opening words are what does that.
 *
 * The default is 60 — long enough that no real mark is touched (`markKey` above works on trademarks, and
 * the longest in the demo set is nineteen characters) and short enough that the sentence after it is
 * still the thing your eye lands on.
 */
export function inSentence(name: string, max = 60): string {
  const one = String(name ?? '').replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  // Cut at a word boundary where there is one within reach, so the fragment reads as words rather than
  // as a severed token — and never below half the budget, or a single long word swallows the whole cut.
  const cut = one.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * Every read of the same mark, for the same brand owner, newest first.
 *
 * Scoped to the account as well as the mark, and that is not belt-and-braces: two different brand
 * owners can be clearing the same word at the same time, and a strip that grouped on the mark alone
 * would put one client's runs on another client's screen. The server already scopes what it returns,
 * so this is the second wall rather than the first.
 */
/**
 * Newest first, by the read's COMPLETION TIMESTAMP.
 *
 * ONE COMPARATOR, HERE, because there were two. This module's `readsFor` and grouping.ts's `marksOf`
 * each carried their own copy ordering on `date` — which is DAY precision, so two reads of one mark
 * delivered on the same day tied, and `Array.prototype.sort` is stable. Fixing one and not the other
 * would have left the Clearances list and the Result screen's reads strip disagreeing about which read
 * is current, which is the defect exists to remove, relocated rather than fixed.
 *
 * `date` remains the tie-break for a run published before `issuedAt` crossed the wire. A read with
 * NEITHER sorts last rather than first: an unknown time must never be treated as the newest.
 */
export const newestFirst = (a: Pick<Run, 'issuedAt' | 'date'>, b: Pick<Run, 'issuedAt' | 'date'>) =>
  String(b.issuedAt ?? '').localeCompare(String(a.issuedAt ?? '')) ||
  String(b.date ?? '').localeCompare(String(a.date ?? ''))

/**
 * The document a result URL opens, and whether it found one.
 *
 *   markSlug null            → the RUN's own document. Null on a batch, which has none: the screen
 *                              lists the names instead.
 *   markSlug naming a report → that name's document, out of the run's own list.
 *   markSlug naming nothing  → no document, and `missing` says the slug is the reason. A stale or
 *                              mistyped link must not fall through to the run: answering a question
 *                              about one name with another name's report is the defect
 *                              one-report-per-mark removed.
 *
 * THE ANSWER IS ALWAYS A DOCUMENT AND NEVER A ROUTE, which is the whole reason this is a function with
 * a test rather than two lines inside the screen. `report` is consumed as an IFRAME SOURCE. The repair
 * this belongs to points a batch's per-name LINKS at /portal/result/<run>/<slug> so they open
 * in the shell — and the obvious next step, pointing `reports[].path` at that route too, would feed the
 * route to the frame and load the portal inside its own frame. The two are different kinds. A slug is
 * matched against the run's OWN list and never used to build a path, the same rule the server applies
 * to /portal/report/<run>/<slug>.
 */
export function openDocument(
  run: Pick<Run, 'report' | 'reports'>,
  markSlug: string | null,
): { readonly doc: string | null; readonly mark: string | null; readonly missing: boolean } {
  if (markSlug === null) return { doc: run.report, mark: null, missing: false }
  const picked = run.reports.find((r) => r.slug === markSlug) ?? null
  return { doc: picked?.path ?? null, mark: picked?.mark ?? null, missing: picked === null }
}

/**
 * Whether this view should show the run's cross-mark assessment.
 *
 * NEVER THE SAME PARAGRAPH TWICE ON ONE SCREEN, which is the whole rule and the reason this is one
 * predicate rather than a condition written into the JSX. The server answers the assessment for any run
 * that has one — `report.md` is written on every run, and a route that 404'd for some of them would be
 * saying "there is none" about prose that exists. On a run whose document the screen FRAMES, that same
 * prose is already rendered inside the frame, so a panel above it would print it a second time.
 *
 * So: show it exactly when this view frames no document and the run has several. Derived from
 * `openDocument` rather than re-stated, because "does this view frame a document" already has an answer
 * and two spellings of it would drift.
 */
export function showsAssessment(run: Pick<Run, 'report' | 'reports'>, markSlug: string | null): boolean {
  const { doc, missing } = openDocument(run, markSlug)
  // `missing` is a slug naming nothing: the screen is telling the reader it does not have that name, and
  // an assessment panel under that message would read as the answer to the question they just asked.
  //
  // `> 0`, NOT `> 1`, and the difference is measured rather than argued. What this clause excludes is a
  // run that has published nothing at all — where there is no document to frame AND no assessment, and
  // the screen says "no report yet". It was written `> 1` to mean "a grouped run", which reads well and
  // cannot be tested: the wire never produces a run with one entry here and no run-level document (the
  // service sets `report` exactly when there is one document), so `> 1` and `> 0` are the same predicate
  // over every input that exists. Flipping it changed no test — which is how it was found.
  return doc === null && !missing && run.reports.length > 0
}

export function readsFor(runs: readonly Run[], current: Run): readonly Run[] {
  const key = markKey(displayName(current))
  return runs
    .filter((r) => r.account === current.account && markKey(displayName(r)) === key)
    .sort(newestFirst)
}

/**
 * Whether the strip is worth rendering at all.
 *
 * One read is not a thread. Showing a strip with a single pill implies there is somewhere else to go.
 */
export function hasThread(reads: readonly Run[]): boolean {
  return reads.length > 1
}

/**
 * The time of day a read finished, "HH:MM", or '' when it is not known.
 *
 * UTC and said so by the caller. The alternative — the reader's local zone — makes two people looking at
 * the same list disagree about which read is which, and the only thing this value has to do is tell two
 * reads of one day apart.
 */
export function readTime(run: Pick<Run, 'issuedAt'>): string {
  const t = run.issuedAt
  if (!t) return ''
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(t)
  return m ? `${m[1]}:${m[2]}` : ''
}

/**
 * The label for one pill: THE PRODUCT'S NAME and the date.
 *
 * READ OFF THE ROW, not mapped again here. This function used to join `run.product` against the
 * COMPOSER'S MENU — `api.searches()`, which is `productRows()`, and `product-rows.mjs` says in terms
 * that retired rows are not in it. So every archived run missed the join and fell through to
 * `run.stageLabel`, which on a retired row IS a Depth number: the same run whose card on Home read
 * "Knockout review" and whose report masthead read the same rendered "Depth 1 · 2026-08-07" here, on
 * two client-facing screens. Verified across all nine registry rows: the four orderable ones agreed,
 * all five retired ones disagreed.
 *
 * `productName` is resolved server-side by the ONE resolver the delivered report's masthead uses
 * (search-policy.mjs reportIdentityFor → `.identity`), and it answers for retired rows too, so a run's
 * pill, its card and its own document cannot disagree about what was bought. Joining a second time in
 * the browser is what created the disagreement; the join, the `levels` parameter and the `api.searches`
 * fetch the two screens made only to feed it are all deleted with it.
 *
 * `stageLabel` survives as ONE fallback and not as the general case: a run whose level the registry has
 * FORGOTTEN resolves no name at all (same `policyFor` miss on both fields), and there the frozen stamp
 * is the last thing anyone recorded about that search. A run older than the level registry has neither
 * and falls back to the date, which distinguishes the reads without inventing a search that was never
 * recorded. Never a recipe label: that is a different vocabulary.
 */
export function readLabel(run: Run): string {
  const head = run.productName || run.stageLabel
  if (head && run.date) return `${head} · ${run.date}`
  return head ?? run.date ?? run.runId.slice(0, 12)
}
