// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engineState.ts — what the two screens SAY about the engine program, decided in one place.
//
// ── WHY THIS IS NOT IN THE SCREENS ──────────────────────────────────────────────────────────────────
//
// The configuration page and the search screen answer different questions about the engine and once
// gave a reader opposite answers: a green row saying the engine was fine, beside a screen refusing to
// start a search. Both were right about their own question, neither said which question it was, and a
// user with a working install read the confident one and gave up.
//
// The fix put three states behind the search screen's notice and a remedy behind each. Which one
// renders decides what a blocked reader is told to DO, and the two remedies are not interchangeable:
// telling someone to install a program they already have is the advice that cost that user the product.
//
// A decision that consequential cannot live where nothing can drive it. `portal-ui/test` has no DOM, no
// jsdom and no React test renderer — Node cannot import a `.tsx` there at all — so logic inside a screen
// is reachable only by matching its source text, which goes on matching while the condition beside it
// changes. That is how the previous version of this defect survived its own tests. `readiness()` in
// composerProduct.ts moved for the same reason and for the same argument.
//
// The screens render what these functions return and decide nothing.

/** What the configuration page knows about the engine. The wire shape, narrowed to what is decided on. */
export type EngineFacts = {
  readonly id: string
  readonly vendor: string | null
  readonly known: boolean
  readonly binaryPresent: boolean
  readonly billing: { readonly apiBilled: boolean; readonly missing: readonly string[] }
  /** The program's name as a reader types it — never a resolved path. Null when this build cannot say. */
  readonly program: string | null
  /** The command that installs it. Same null rule. */
  readonly install: string | null
}

/**
 * Every fault the Engine row states, in the order it states them.
 *
 * THE ROW IS GREEN EXACTLY WHEN THIS IS EMPTY. That relation is the point of returning a list rather
 * than a boolean and a list: a condition added without a sentence cannot make the row red silently, and
 * a sentence added without a condition cannot appear under a green row.
 */
export function engineRowFaults(
  engine: EngineFacts,
  { programDisputed = false }: { readonly programDisputed?: boolean } = {},
): readonly string[] {
  return [
    ...(engine.known ? [] : [`This build does not ship an engine called ${engine.id}.`]),
    ...(engine.billing.missing.length
      ? [`Set to bill an API key, and ${engine.billing.missing.join(' and ')} is not set — a run is refused rather than billed to the subscription.`]
      : []),
    // NAMES THE PROGRAM AND THE COMMAND. This sentence used to end at "cannot be found or run on this
    // machine", which tells a reader they have a problem and not one thing to do about it — on the page
    // they opened to find out what to do. And the restart, which is the sentence that was missing
    // everywhere: installing the program does not change what the engine last recorded.
    //
    // Neither word available means an older service or an engine this build does not ship, which the
    // `known` fault above already names. The sentence that shipped before, unchanged, rather than one
    // reading "install it with null".
    ...(engine.binaryPresent
      ? []
      : engine.program && engine.install
        ? [`The engine program \`${engine.program}\` cannot be found or run on this machine. `
           + `Install it with \`${engine.install}\`, then restart this service so it re-reads its PATH.`]
        : ['The engine program cannot be found or run on this machine.']),
    // SELECTED IS NOT USABLE, and this row is where those two got drawn the same.
    //
    // THE `&& binaryPresent` IS DELIBERATE. A disagreement has two directions and only one needs a
    // sentence here. This machine sees the program and the engine did not: that is this line. The
    // mirror is already covered by the fault above, which fires on `!binaryPresent`. Dropping the
    // condition would print both at once and contradict itself.
    ...(programDisputed && engine.binaryPresent
      ? ['The engine program is on this machine, but the engine could not find it when it last started — '
         + 'so a new search will refuse. Restart the engine service, or install the CLI where the service can see it.']
      : []),
  ]
}

/**
 * The no-engine notice on the search screen: which state, and therefore which remedy.
 *
 * `programDisputed` is the live reading against what the engine recorded — true, false, or null for
 * "this could not be checked". Null takes the general advice, which is right whenever the two states
 * cannot be told apart; collapsing it into false would print the missing-program remedy at a reader
 * whose program is present, which is the original defect arriving by another road.
 */
export type EngineNotice = {
  /** `disputed` ⇒ the program is here and the engine cannot see it. `absent` ⇒ everything else. */
  readonly state: 'absent' | 'disputed'
  readonly headline: string
  /** The sentences between the headline and the setup command. */
  readonly before: string
  /** Whether the install command for this reader's route belongs after `before`. */
  readonly namesSetupCommand: boolean
  /** The sentences after the setup command. Empty when there are none. */
  readonly after: string
}

// WHO MAY OPEN THE CONFIGURATION PAGE IS NOT DECIDED HERE, and a field saying so was removed rather
// than documented. It read `linksToSettings: canOpenSettings` in both branches — always equal to its
// input, so the screen's `notice.linksToSettings && onSettings` was one condition written twice, not
// two gates. A contract field that always returns what it was handed occupies a slot without holding
// anything, and the next reader simplifies one side away believing the other still guards.
//
// The real gate is the call site, which passes no handler to a reader who cannot open that page. It is
// held by the navigation arm and driven in a browser, which is where a question about who sees a
// control belongs. Raised in review on this change.

export function engineNotice({ programDisputed }: { readonly programDisputed: boolean | null }): EngineNotice {
  if (programDisputed === true) {
    return {
      state: 'disputed',
      headline: 'The engine program is on this machine, but the engine could not find it when it last started.',
      before: 'So a new search will refuse. Restart the engine service, or install the CLI where the service '
        + 'can see it — installing it again where it already is will not change this.',
      // The setup wizard does not touch the PATH of a service that is already running, so naming it
      // here would be the third piece of advice that cannot work in this state.
      namesSetupCommand: false,
      after: '',
    }
  }
  return {
    state: 'absent',
    headline: 'No search engine is attached to this install.',
    before: 'Everything else works — the example report, its audit trail and the assistant connection are '
      + 'live right now. To start new searches, install a reasoning CLI and sign in, then run the setup '
      + 'wizard again',
    namesSetupCommand: true,
    // THE MISSING SENTENCE. This reading was taken when the engine last started and is never refreshed,
    // so a reader who installs the CLI and comes back sees exactly this notice again with nothing on the
    // page explaining why. That is the loop an outside user could not get out of.
    after: 'Then restart the service: this reading was taken when it started, and it will not notice a '
      + 'new install until it starts again.',
  }
}

/**
 * THE WHOLE ROW, not the faults alone — and that is the point of this function existing beside
 * `engineRowFaults`.
 *
 * The row is drawn green from `ok`, and while the screen computed `ok` itself from a list it also held,
 * a driven test of the list proved the list. It did not prove that the screen asked. That gap is the
 * defect this issue is about, one level up: a row drawn green while the data underneath said otherwise.
 *
 * So `ok` is derived HERE, from the faults this same call produced, and the screen spreads the result
 * into the row rather than assembling one. There is no longer a place in the screen where `ok` and the
 * faults can disagree, because there is no longer a second expression for either.
 */
export function engineRow(
  engine: EngineFacts,
  { programDisputed = false }: { readonly programDisputed?: boolean } = {},
): {
  readonly ok: boolean
  readonly name: string
  readonly mono: string
  readonly state: string
  readonly faults: readonly string[]
} {
  const faults = engineRowFaults(engine, { programDisputed })
  return {
    ok: faults.length === 0,
    name: engine.vendor ?? engine.id,
    mono: engine.id,
    // Believe `apiBilled`, not the mode word. They agree except in one state — set to bill an API key
    // that is not set — and that is the state worth showing, because the driver refuses a run in it.
    state: engine.billing.apiBilled ? 'API key' : 'Subscription',
    faults,
  }
}
