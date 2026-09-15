// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Driving one run from your own assistant, from inside the shell.
//
// THE DEFECT, as the owner watched it. A lawyer pressed Ask AI on a report, read what opened, dismissed
// it, and went to Claude to type a question by hand. The control handed over two monospace strings with
// a Copy link each — a question carrying a full run code, and a connector address — and said nothing
// about which one was needed or where it went. It taught setup to a reader who had already connected and
// handed a code string to one who had not.
//
// So the control does the thing instead of describing it: one press opens the reader's own assistant with
// the question already typed in. What is left here is the sentence, and the rule for who is offered it.
//
// NO ADDRESS ON A REPORT, EVER. Connecting happens once, on the Use your own AI page, and the address
// named the STAFF host — which is the whole reason the shell strips the report's own band. A control the
// shell draws itself that re-introduced it would defeat that strip rather than complete it.

/** Month names, indexed by the 1-based month of an ISO date. */
const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/**
 * `2026-09-14` → `14 September`, and anything else → null.
 *
 * FORMATTED FROM THE PARTS, NOT THROUGH A DATE. `new Date('2026-09-14')` is parsed as UTC midnight and
 * then printed in the reader's zone, so west of Greenwich this sentence would name the previous day —
 * about a report whose own header, one line above, names the right one. `toLocaleDateString` would also
 * put the reader's locale into a sentence the report is not written in. A run's date arrives as
 * `YYYY-MM-DD` and there is nothing to parse.
 *
 * A shape this does not recognise yields null rather than a guess: the question then simply does not
 * name a date, which is a true sentence, where a wrong date is not.
 */
export function readableDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim())
  if (!m) return null
  const month = MONTHS[Number(m[2])]
  const day = Number(m[3])
  if (!month || !(day >= 1 && day <= 31)) return null
  return `${day} ${month}`
}

/** What the report's own header calls this kind of read. */
export type RunKind = 'clearance' | 'knockout-batch'

/**
 * The sentence a reader says to their assistant.
 *
 * A SENTENCE A PERSON COULD HAVE TYPED. The run code is gone, by the owner's ruling of 2026-09-15: it
 * read as something meant for a machine, and it was never needed to find the search. A single-report
 * link pins its run (`shared/scope.mjs` injects `runId` when a call omits it) and a signed-in account
 * finds a search by its mark. What the assistant needs is what tells two reads of the same mark apart,
 * which is the date — so the question names the search the way the header names it, mark then date.
 *
 * ONE DEFINITION NOW. The delivered report used to compose this too, and a parity test joined the two;
 * the report's band came out under this same ruling, so this is the only place the sentence exists.
 */
export function askAiPrompt(
  mark: string | null | undefined,
  date: string | null | undefined,
  kind: RunKind = 'clearance',
): string {
  const name = String(mark ?? '').trim() || 'this mark'
  const noun = kind === 'knockout-batch' ? 'knockout search' : 'clearance'
  const when = readableDate(date)
  return when
    ? `Brief me on the ${name} ${noun} from ${when}.`
    : `Brief me on the ${name} ${noun}.`
}

/** Where a press sends the reader, with the question already in the box. */
export type Assistant = { readonly label: string; readonly href: (question: string) => string }

/**
 * The two assistants this control opens, and the links it opens them with.
 *
 * CHECKED BY HAND, 2026-09-15: both open a new chat in the browser with the text typed in and NOT sent,
 * which is what makes one press safe — the reader still reads the question before it goes. The desktop
 * scheme (`claude://…`) was turned down as the default because it does nothing on a computer without
 * the app installed, and there is no way for a web page to find out.
 *
 * NO COPY FALLBACK. If a vendor stops filling the question in, that is a new issue and a new decision,
 * not a reason to put a code string back on a report.
 */
export const ASSISTANTS: readonly Assistant[] = [
  { label: 'Ask Claude', href: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}` },
  { label: 'Ask ChatGPT', href: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}` },
]

/** Where the per-assistant setup instructions live. */
export const AI_SETUP_PATH = '/portal/ai'

/** What the Ask-AI control should do, given what this installation has wired and what this reader has done. */
export type AskAiOffer = {
  /**
   * Whether to draw the button at all.
   *
   * A BUTTON THAT CAN DO NOTHING IS NOT DRAWN. An installation with no published connector and no local
   * route has nothing for a reader to connect to, and a panel explaining that was turned down: it would
   * be an apology on every report on a deployment that is simply not wired for this.
   */
  readonly drawn: boolean
  /** The sentence to open the assistant with. */
  readonly question: string
  /**
   * True only when this reader's assistant has been seen calling a connector here.
   *
   * NULL IS NOT FALSE, AND BOTH DRAW THE PANEL. A null means the installation could not be asked — no
   * access log yet, or one that could not be read — and rendering that as "you have never connected"
   * would assert a measurement nobody took. It draws the panel anyway, because offering the menu to a
   * reader with no assistant recreates the dead end this control exists to end, and because the panel
   * carries its own way past it for anyone the log has not caught up with.
   */
  readonly connected: boolean
}

/** Compose the control's behaviour from the run and the deployment's answer. */
export function askAiOffer(
  run: { readonly markName: string | null; readonly date: string | null; readonly kind: RunKind },
  access: {
    readonly url: string | null
    readonly enabled: boolean
    readonly stdio?: unknown
    readonly aiConnected?: boolean | null
  } | null,
): AskAiOffer {
  return {
    // Null access is "the answer has not arrived yet", not "there is no connector": the button is not
    // drawn until the route has said something, so it never appears and then vanishes.
    drawn: !!access && (!!(access.enabled && access.url) || !!access.stdio),
    question: askAiPrompt(run.markName, run.date, run.kind),
    connected: access?.aiConnected === true,
  }
}
