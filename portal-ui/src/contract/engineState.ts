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

/**
 * Why every search is refused over how this machine is set to pay, as the driver classifies it
 * (`billingRefusalReason` in driver/config-inventory.mjs, which lists the kinds). Names only: settings,
 * and clouds by the name a reader knows them by. Never the value of a setting.
 *
 * `kind` IS A STRING, NOT A UNION, ON PURPOSE. A kind this build does not know is a refusal all the same,
 * and narrowing it away would draw a green row over a machine whose every search is refused.
 */
export type BillingRefusal = {
  readonly kind: string
  /** subscription, api-key or cloud; null for a word that is not a mode, which is never sent. */
  readonly mode: string | null
  /** The billing setting is blank, so `mode` is the default rather than a word anybody wrote. */
  readonly defaulted?: boolean
  /** The billing setting, by name. */
  readonly setting: string
  readonly clouds: readonly { readonly name: string; readonly setting: string }[]
  /** The modes this engine takes, for a word that is not one. */
  readonly modes: readonly string[]
  /** The gateway's setting, where one is a choice. */
  readonly gateway: string | null
  /** The engine setting, where changing the engine is a choice. */
  readonly engineSetting: string | null
  /** The engine that setting would be set to, by its id. */
  readonly engineChoice: string | null
}

/** What the configuration page knows about the engine. The wire shape, narrowed to what is decided on. */
export type EngineFacts = {
  readonly id: string
  readonly vendor: string | null
  readonly known: boolean
  readonly binaryPresent: boolean
  readonly billing: {
    readonly apiBilled: boolean
    readonly missing: readonly string[]
    // OPTIONAL, because an older service sends none of the three, and the row then reads exactly as it did.
    readonly cloudName?: string | null
    readonly reason?: BillingRefusal | null
  }
  /** The program's name as a reader types it — never a resolved path. Null when this build cannot say. */
  readonly program: string | null
  /** The command that installs it. Same null rule. */
  readonly install: string | null
  /** The setting that names the program's full path. Null or absent from an older service. */
  readonly programSetting?: string | null
  /** Which setup command this install can run. Null or absent ⇒ both are named. */
  readonly setupRoute?: 'packaged' | 'checkout' | null
}

/** The setup wizard as this reader can run it. Both spellings when the service did not say which. */
// ONE COMMAND FOR EVERY READER. This page cannot know how its reader installed, and `npm run setup` exists
// only in a source checkout, so the row names the command every install can run. The search screen's
// notice is the one place that picks by route (one-name-per-command.test.mjs names it).
const SETUP_COMMAND = '`npx clearotron install`'

/** "a", "a and b", "a, b and c". */
const listed = (xs: readonly string[], and = 'and'): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ${and} ${xs[xs.length - 1]}`

/** How each billing mode reads inside "payment is set to …". Looked up by own key only (`paidBy`). */
const PAID_BY: Readonly<Record<string, string>> = { subscription: 'subscription', 'api-key': 'an API key', cloud: 'a cloud account' }
// OWN KEYS ONLY: `PAID_BY['constructor']` is a function, and a mode of that name would print its source.
const paidBy = (mode: string | null): string =>
  mode !== null && Object.hasOwn(PAID_BY, mode) ? (PAID_BY[mode] as string) : (mode ?? 'a way of paying')
const COUNT = ['no', 'one', 'two', 'three', 'four']
/** The kinds whose sentence is built from the clouds; with none sent, it could name none. */
const NAMES_CLOUDS = new Set(['switch-beside-mode', 'two-clouds', 'no-cloud'])

/**
 * THE ONE SENTENCE A REFUSED BILLING SETTING PUTS ON THE ROW: that searches will be refused, why, and the
 * setting an administrator changes. Composed from the driver's reason, never from the resolver's own
 * sentence, which is written for a terminal and names the refusal the way the code sees it.
 *
 * A KIND THIS BUILD DOES NOT NAME still gets a sentence, the last branch, so the row is red whenever the
 * driver says searches are refused, whatever it calls the reason.
 */
export function billingRefusalSentence(r: BillingRefusal): string {
  const setting = r.setting || 'the billing setting'
  const generic = `Searches will be refused over how this machine is set to pay. Check ${setting} and the settings beside it.`
  // A CLOUD SENTENCE WITH NO CLOUD IN IT reads "the  switches ()". A reason that names none, from a cloud
  // this build has no name for, takes the sentence that names no cloud.
  if (NAMES_CLOUDS.has(r.kind) && r.clouds.length === 0) return generic
  // BLANK IS NOT A WORD ANYBODY WROTE. "Payment is set to subscription" sends a reader to a line their
  // settings file does not have, when the subscription is only the default for a blank setting.
  const paid = r.defaulted ? `${paidBy(r.mode)}, the default while ${setting} is not set`
    : `set to ${paidBy(r.mode)}`
  switch (r.kind) {
    case 'switch-beside-mode': {
      const one = r.clouds.length === 1
      const names = listed(r.clouds.map((c) => c.name))
      const switches = listed(r.clouds.map((c) => c.setting))
      const keep = r.mode === 'api-key' ? 'to pay with the API key' : 'to pay by subscription'
      return `Searches will be refused: payment is ${r.defaulted ? 'by ' : ''}${paid}, but the ${names} ${one ? 'switch' : 'switches'} `
        + `(${switches}) ${one ? 'is' : 'are'} also on. `
        + (one
          ? `Turn ${switches} off ${keep}, or set ${setting} to cloud to pay through ${names}.`
          : `Turn them off ${keep}, or set ${setting} to cloud and leave one on.`)
    }
    case 'two-clouds':
      return `Searches will be refused: payment is set to a cloud account, but ${COUNT[r.clouds.length] ?? r.clouds.length} `
        + `clouds are switched on, ${listed(r.clouds.map((c) => `${c.name} (${c.setting})`))}. `
        + 'Turn off all but the one you pay through.'
    // BOTH WAYS OUT, as the run door gives them: choose a cloud, or go back to the subscription. A switch
    // alone does not reach a cloud, which also needs its project, resource or region, so the sentence says so.
    case 'no-cloud':
      return 'Searches will be refused: payment is set to a cloud account, but no cloud is chosen. '
        + `Turn on your cloud's switch (${listed(r.clouds.map((c) => `${c.setting} for ${c.name}`), 'or')}) `
        + 'with the settings that cloud needs'
        + (r.gateway ? `, set ${r.gateway} for a gateway,` : ',')
        + ` or set ${setting} to subscription.`
    case 'not-a-mode':
      return `Searches will be refused: ${setting} is set to a word Clearotron does not know. `
        + `Set it to ${listed(r.modes, 'or')}.`
    case 'cloud-on-codex':
      return 'Searches will be refused: payment is set to a cloud account, which pays only for Claude, and this '
        + `machine runs the Codex engine. Set ${setting} to ${listed(r.modes, 'or')}`
        + (r.engineSetting && r.engineChoice
          ? `, or set ${r.engineSetting} to ${r.engineChoice} to pay for Claude through your cloud.`
          : '.')
    default:
      return generic
  }
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
  const reason = engine.billing.reason ?? null
  return [
    ...(engine.known ? [] : [`This build does not ship an engine called ${engine.id}.`]),
    // WITHOUT THE VARIABLE'S NAME. This row is on Installation settings, which is read in screen shares by
    // people who cannot act on one; the setup guide and the doctor name it.
    ...(engine.billing.missing.length
      ? ['Set to bill an API key, and no key is set — a run is refused rather than billed to the subscription.']
      : []),
    // ONE BILLING SENTENCE, NEVER TWO. The driver sends a missing key and a reason apart (a key that is
    // missing is named first, as the run door names it), and the `!missing.length` here holds that on the
    // row too, whatever a service sends.
    ...(reason && !engine.billing.missing.length ? [billingRefusalSentence(reason)] : []),
    // NAMES THE PROGRAM AND THE WAY TO GET IT. This sentence used to end at "cannot be found or run on
    // this machine", which tells a reader they have a problem and not one thing to do about it. It then
    // named a hand install and a restart "so it re-reads its PATH"; setup installs the program now, into a
    // folder a run finds without PATH, so it names setup. The restart stays for what it is still for: the
    // services look for the program when they start, and the search screen reads what they found then.
    // It does not say setup asks how the program is paid for: setup writes Clearotron's settings file, and
    // services running in the background read another, so that half would be true only on some machines,
    // and it is not what this fault is about.
    //
    // No program name means an older service or an engine this build does not ship, which the `known`
    // fault above already names. The sentence that shipped before, unchanged, rather than one naming null.
    ...(engine.binaryPresent
      ? []
      : engine.program
        ? [`The engine program \`${engine.program}\` cannot be found or run on this machine. `
           + `Run the setup wizard, ${SETUP_COMMAND}: it offers to install the program `
           + 'and proves it with one turn. '
           + "Then restart Clearotron's services, which look for the program when they start."]
        : ['The engine program cannot be found or run on this machine.']),
    // SELECTED IS NOT USABLE, and this row is where those two got drawn the same.
    //
    // THE `&& binaryPresent` IS DELIBERATE. A disagreement has two directions and only one needs a
    // sentence here. This machine sees the program and the engine did not: that is this line. The
    // mirror is already covered by the fault above, which fires on `!binaryPresent`. Dropping the
    // condition would print both at once and contradict itself.
    //
    // A PROGRAM THIS MACHINE FINDS AND THE SERVICE DOES NOT is off the PATH the service runs with, and
    // installing another copy is not the remedy; naming the program's full path in the file it reads is.
    ...(programDisputed && engine.binaryPresent
      ? ['The engine program is on this machine, but the engine could not find it when it last started — '
         + 'so a new search will refuse. Restart the engine service so it looks again. If it still cannot find it, '
         + `set ${engine.programSetting ?? "the engine's program setting"} to the program's full path in the `
         + 'settings file the service reads, then restart it again.']
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
      before: 'So a new search will refuse. Restart the engine service so it looks again. If it still cannot find '
        + "it, set the engine's program setting to the program's full path in the settings file the service "
        + 'reads — installing it again where it already is will not change this.',
      // The setup wizard does not touch the PATH of a service that is already running, so naming it
      // here would be the third piece of advice that cannot work in this state.
      namesSetupCommand: false,
      after: '',
    }
  }
  return {
    state: 'absent',
    headline: 'No search engine is attached to this install.',
    // SETUP INSTALLS THE PROGRAM NOW. This said "install a reasoning CLI and sign in, then run the setup
    // wizard again", from before setup offered the install itself; it now names setup as the one step.
    before: 'Everything else works — the example report, its audit trail and the assistant connection are '
      + 'live right now. The setup wizard offers to install a reasoning CLI if this machine has none, and asks '
      + 'how it is paid for. To start new searches, run the setup wizard',
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
    // WHAT PAYS, OR THAT NOTHING WILL. A row whose searches are refused reads "Refused", beside the sentence
    // saying why: any payer named there would be one that is not paying, and "Subscription" beside "payment
    // is set to a cloud account" contradicted the sentence next to it. Otherwise a cloud account by the name
    // the driver sends for it ("Microsoft Azure", "Gateway"), and then `apiBilled`, not the mode word. A
    // cloud account used to read "API key" here, because it bills per use and nothing named the cloud.
    state: engine.billing.missing.length || engine.billing.reason
      ? 'Refused'
      : engine.billing.cloudName ?? (engine.billing.apiBilled ? 'API key' : 'Subscription'),
    faults,
  }
}
