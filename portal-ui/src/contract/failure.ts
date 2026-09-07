// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
/**
 * What a reader is told when a clearance did not finish.
 *
 * The Status cell used to render this, verbatim, on a page a client or a partner lands on:
 *
 *   Stopped at common-law-half:b. invalid_file:prelim-search/tmpe2er1-vibrante-frostplum/
 *   2026-08-02-fixture/common-law-findings.half-b.md:connotation_undisposed:VIBRANTE
 *   FROSTPLUM urban dictionary,FROSTPLUM meaning slang,FR
 *
 * A stage id, a temp directory, a run slug, a file path, an error enum and three search queries. It told
 * a reviewing lawyer nothing about what went wrong, told anyone else the shape of our filesystem and our
 * stage names, and cost the table half its width because Status was sized to hold it.
 *
 * ── WHAT IS MAPPABLE, AND WHAT IS NOT ───────────────────────────────────────────────────────────────
 *
 * The issue asks for a mapping that covers the failure modes the pipeline can actually produce, and says
 * to say so plainly if they cannot be enumerated. Both halves of the string turn out to be different:
 *
 * THE STAGE IS A CLOSED SET. `driver/stages.mjs` exports `STAGES`, and `STAGE_ORDER ∪
 * STAGE_ORDER_EXCLUDED` is asserted to be a closed partition of its keys in both directions
 * (progress.test.mjs). Nineteen stages, every one of them named below, and a test asserts the same
 * bijection over this table — so a stage added to the engine without a phrase here fails, rather than
 * leaking its id onto a client-facing page.
 *
 * THE OUTER FAIL TOKEN IS A CLOSED SET TOO, and it is written down: `driver/engine/CONTRACT.md` §1
 * enumerates `timeout | lane_wedge | embedded_fallback | nonzero_exit_<code> | unparseable_json |
 * status_<s> | missing_file:<f> | invalid_file:<f>:<reason>` and says the taxonomy is load-bearing and
 * MUST be preserved verbatim. So the shape of the failure is knowable.
 *
 * THE INNER `<reason>` IS OPEN BY CONSTRUCTION. It is minted at 61 separate `fail(...)` call sites in
 * `driver/verify.mjs` with no central constant — `connotation_undisposed`, `coverage_ledger_unparseable`,
 * `framediff_*`, and so on. There is no enumeration to map against, and inventing one here would rot the
 * first time a validator was added.
 *
 * Which is exactly the case the issue pre-authorises: a short mapped status, plus a Details disclosure
 * holding the raw value for the engineer, and structuring the failure record properly becomes its own
 * issue. Truncation with an ellipsis is rejected — it hides the problem rather than fixing it — and so is
 * a mapping that covers only the one observed string.
 */

/**
 * Every stage the engine can stop in, in words a reviewing lawyer can act on.
 *
 * Not a paraphrase of the stage's name — a statement of what was being done. "common-law-half" is a grid
 * half, which means nothing to a reader; "the common-law search" is where the work was.
 *
 * CLOSED, and asserted against `driver/stages.mjs` in both directions.
 */
export const STAGE_PHRASE: Readonly<Record<string, string>> = {
  'matter-frame': 'while framing the matter',
  'prelim-variants': 'while working out which variants to search',
  'blind-frame': 'while framing the matter',
  'common-law': 'during the common-law search',
  'common-law-half': 'during the common-law search',
  'register-unit': 'during the register search',
  'frame-diff': 'while reconciling what the searches found',
  'placement-inquiry': 'while placing what the searches found',
  'register-digest': 'while reading the register results',
  'skeptic': 'while checking its own reasoning',
  'synthesis': 'while forming the opinion',
  'case-law': 'during the case-law search',
  'narrative-refutation': 'while testing the opinion against the evidence',
  'report-overview': 'while writing the report',
  'report-card': 'while writing the report',
  'doubt-closure': 'while closing an open question',
  // — the three send stages had phrases here and are DELETED with them, deliberately and not by
  // the reasoning progress.mjs uses one directory over. There, a retired stage's step is KEPT because a
  // status row that resolves to no step renders as an unlabelled gap. Here the fallback is already
  // correct: an unmapped stage yields `Not finished. It cannot be resumed from here.` and never renders
  // the id, which is the whole job of this table. An archived run that failed in one of those stages
  // loses one clause of context and leaks nothing — and the bijection in failure.test.ts refuses a
  // phrase naming a stage the engine no longer has, which is the property worth keeping.
}

/**
 * The outer fail taxonomy from `driver/engine/CONTRACT.md` §1, in one sentence each.
 *
 * Ordered longest-prefix-first where two could both match, so `invalid_file:` is never read as a bare
 * token. Each says what happened and nothing about where — the path is the part that must not render.
 */
const FAIL_KINDS: readonly (readonly [RegExp, string])[] = [
  [/^timeout\b/, 'A step ran out of time.'],
  [/^lane_wedge\b/, 'A search lane stopped responding.'],
  [/^embedded_fallback\b/, 'A search returned a stand-in answer instead of a real one.'],
  [/^nonzero_exit_\d+\b/, 'A step exited with an error.'],
  [/^unparseable_json\b/, 'A step returned something the engine could not read.'],
  [/^status_/, 'A step reported an unexpected state.'],
  [/^missing_file:/, 'A step did not produce a result it was supposed to.'],
  [/^invalid_file:/, 'A step produced a result that did not pass its own checks.'],
]

export type ReadableFailure = {
  /** The one line a reader sees. Never contains a path, a stage id, an enum or a query. */
  readonly headline: string
  /** One further sentence when the fail token is recognised, else null. Also reader-safe. */
  readonly detail: string | null
  /** The engine's own words, for an engineer, behind a disclosure. Null when there were none. */
  readonly raw: string | null
}

/**
 * True when a string contains anything that must never render in a client-facing column.
 *
 * WIDENED THIS, because the string that prompted the issue walked straight through it:
 *
 *     merged half-grids failed the canonical validator (connotation_undisposed:KIN-ZY wikipedia, …)
 *
 * No FAIL_KINDS prefix matched (it opens with prose, not a taxonomy token), it carries no path and no
 * file extension, and at 124 characters it was inside the length floor — so `detail` below returned the
 * WHOLE engine string and the table rendered it. Two additions close it:
 *   · `[a-z]+_[a-z]+` — one underscore-joined pair, not two. `connotation_undisposed` is a validator
 *     enum; the old rule needed `a_b_c` and enums of two words are the common shape.
 *   · `\w:\S` — a `token:payload` pair, which is what every fail token in driver/engine/CONTRACT.md is,
 *     and what no English sentence contains (a colon in prose is followed by a space).
 * A plain sentence still passes: "the register provider returned no results for three retries".
 */
const LOOKS_INTERNAL = /[/\\]|\.(?:md|json|html|jsonl|xlsx)\b|^tmp|[a-z]+_[a-z]+|\w:\S|::/

/**
 * Turn a run's `failedStage` + `reason` into something a reviewing lawyer can act on.
 *
 * `reason` is the engine's raw string, and on a client session the server has already replaced it with a
 * fixed note (`portal-service.mjs` — clients never see the engine's words at all). So the ugly case is a
 * STAFF surface, and this is what staff see instead.
 */
export function readableFailure(failedStage: string | null | undefined, reason: string | null | undefined): ReadableFailure {
  // The axis suffix is an internal coordinate — `common-law-half:b` is a grid half, `report-card:1` a
  // finding ordinal. Neither is something a reader can act on, and both are stage-id shaped.
  const stage = String(failedStage ?? '').split(':')[0] ?? ''
  const phrase = STAGE_PHRASE[stage] ?? null

  const raw = typeof reason === 'string' && reason.trim() ? reason.trim() : null
  const kind = raw ? (FAIL_KINDS.find(([re]) => re.test(raw))?.[1] ?? null) : null

  // — THE OWNER'S ACTUAL REQUIREMENT: "today a user cannot tell whether to wait or act". A paused
  // run resumes on its own and a recovering one is already retrying; a FAILED run is neither, and the
  // card said nothing about that. The headline now states it, because it is the only thing on this card
  // a reader can act on.
  const headline = phrase
    ? `Not finished — stopped ${phrase}. It cannot be resumed from here.`
    : 'Not finished. It cannot be resumed from here.'

  // When the token is not one we know, fall back to the engine's words ONLY if they are safe to render.
  // A string carrying a path, a temp dir or a file extension goes behind the disclosure instead: the
  // rule is that no portal surface renders one, and an unrecognised token is not a reason to break it.
  const detail = kind ?? (raw && !LOOKS_INTERNAL.test(raw) && raw.length <= 140 ? raw : null)

  return { headline, detail, raw }
}
