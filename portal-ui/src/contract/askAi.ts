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
// NO ADDRESS ON A REPORT, EVER. Connecting happens once, on the Connect your AI page, and the address
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

/**
 * The day a report was issued, `YYYY-MM-DD`, in the firm's zone — or null.
 *
 * EUROPE/ZURICH, BECAUSE THE REPORT'S OWN STAMP IS. Its "Issued" line is composed at publish in that zone,
 * and a run's calendar date is a Zurich date too. `issuedAt` crosses the wire as an instant, so slicing its
 * first ten characters names the day before for a report issued late in the evening — in a header sitting
 * directly above the document that says otherwise. `en-CA` is what prints `YYYY-MM-DD`, as publish uses it.
 *
 * ONLY A DELIVERED READ HAS BEEN ISSUED. On a live run `issuedAt` is the last progress write and on a queued
 * one the time it was queued, so neither is labelled "issued". A stamp this cannot read yields null, and
 * the header then says nothing about the issue date rather than guessing one.
 */
export function issuedOn(run: { readonly state: string; readonly issuedAt: string | null }): string | null {
  if (run.state !== 'delivered') return null
  const raw = String(run.issuedAt ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return null
  const t = new Date(raw)
  if (Number.isNaN(t.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t)
}

/** What the report's own header calls this kind of read. */
export type RunKind = 'clearance' | 'knockout-batch'

/** What the questions are composed from: the run, and never the report's text. */
export type AskAiRun = {
  readonly markName: string | null
  readonly date: string | null
  readonly kind: RunKind
  /** The finding asked about from its own card, by the number the report prints on it. Absent: the report. */
  readonly finding?: number | null
}

/**
 * How every question names the report: the mark, the kind of read, and the day it ran.
 *
 * A PHRASE A PERSON COULD HAVE TYPED. The run code is gone, by the owner's ruling of 2026-09-15: it read as
 * something meant for a machine, and it was never needed to find the search. A single-report link pins its
 * run (`shared/scope.mjs` injects `runId` when a call omits it) and a signed-in account finds a search by
 * its mark. What the assistant needs is what tells two reads of the same mark apart, which is the date —
 * so the question names the search the way the header names it, mark then date.
 *
 * NOTHING MORE THAN THAT. Whether a question should also carry the product or the company is an open
 * decision, and until it is made the four questions identify the report exactly as the first always has.
 */
export function reportPhrase(
  mark: string | null | undefined,
  date: string | null | undefined,
  kind: RunKind = 'clearance',
  finding: number | null = null,
): string {
  const name = String(mark ?? '').trim() || 'this mark'
  const noun = kind === 'knockout-batch' ? 'knockout search' : 'clearance'
  const when = readableDate(date)
  const report = when ? `the ${name} ${noun} from ${when}` : `the ${name} ${noun}`
  // ASKED FROM A FINDING'S OWN BUTTON, the finding's number rides beside the mark and the date — the
  // number the report prints on that card — so the assistant is asked about that finding of this report.
  return finding === null ? report : `finding ${finding} of ${report}`
}

/**
 * The first question, and the one the control asked before there were four.
 *
 * ONE DEFINITION. The delivered report used to compose this too, and a parity test joined the two; the
 * report's band came out under the 2026-09-15 ruling, so this is the only place the sentence exists.
 */
export function askAiPrompt(
  mark: string | null | undefined,
  date: string | null | undefined,
  kind: RunKind = 'clearance',
): string {
  return `Brief me on ${reportPhrase(mark, date, kind)}.`
}

/** One thing a reader can ask: the words on its row, and the sentence it types into the assistant. */
export type AskAiQuestion = { readonly label: string; readonly compose: (report: string) => string }

/**
 * The four questions, in the order the panel lists them. The first is selected when the panel opens.
 *
 * THE ROW IS SHORT BECAUSE THE PANEL'S FIRST LINE NAMES THE REPORT; THE SENTENCE IS NOT, because the
 * assistant sees only the sentence. Each one names the report with `reportPhrase`, so an assistant that can
 * see several reads of one mark is asked about this one.
 */
export const ASK_AI_QUESTIONS: readonly AskAiQuestion[] = [
  { label: 'Brief me on this clearance', compose: (report) => `Brief me on ${report}.` },
  { label: 'Explain the main risks', compose: (report) => `Explain the main risks in ${report}.` },
  { label: 'What needs further investigation?', compose: (report) => `What needs further investigation in ${report}?` },
  {
    label: 'How would narrower goods change the assessment?',
    compose: (report) => `How would narrower goods change the assessment in ${report}?`,
  },
]

/** The sentence typed in for the question at `index` — the first question for an index that names none. */
export function askAiQuestion(index: number, run: AskAiRun): string {
  const q = ASK_AI_QUESTIONS[index] ?? ASK_AI_QUESTIONS[0]!
  return q.compose(reportPhrase(run.markName, run.date, run.kind, run.finding ?? null))
}

/**
 * Which finding a press inside the report names, as the Ask AI control should carry it.
 *
 * A clearance numbers its findings once across the document, so its number stands on its own. A knockout
 * restarts its numbers for each name, so a number is only a finding when the name is certain — the one
 * name's own document. On a whole batch the position the document sends cannot be matched to a name with
 * certainty here, and a question naming the wrong finding is worse than one naming the report, so that
 * press opens the control about the report. A card with no number does the same.
 */
export function findingAsked(
  asked: { readonly ordinal: number | null; readonly markIndex: number | null; readonly nonce: number } | null,
  kind: RunKind,
  pickedMark: string | null,
): { readonly ordinal: number | null; readonly markName: string | null; readonly nonce: number } | null {
  if (!asked) return null
  if (kind !== 'knockout-batch') return { ordinal: asked.ordinal, markName: null, nonce: asked.nonce }
  return pickedMark ? { ordinal: asked.ordinal, markName: pickedMark, nonce: asked.nonce } : { ordinal: null, markName: null, nonce: asked.nonce }
}

/** The panel's first line, in parts: the mark, the finding when asked from one, the product, the day it was searched. */
export type AskAiHeading = {
  readonly mark: string | null
  readonly finding: number | null
  readonly product: string | null
  readonly searched: string | null
}

/**
 * Which report the panel is about — "VENQORI · Full country search · searched 2026-09-03".
 *
 * A PART THE RUN DOES NOT CARRY IS LEFT OUT, never printed empty: an older run with no mark name, or a
 * product the registry has forgotten, shortens the line rather than leaving a separator with nothing
 * after it.
 */
export function askAiHeading(run: {
  readonly markName: string | null
  readonly productName: string | null
  readonly date: string | null
  readonly finding?: number | null
}): AskAiHeading {
  const text = (s: string | null) => String(s ?? '').trim() || null
  return { mark: text(run.markName), finding: run.finding ?? null, product: text(run.productName), searched: text(run.date) }
}

/** The same line as one string, the way a reader reads it. */
export const headingText = (h: AskAiHeading): string =>
  [h.mark, h.finding !== null ? `finding ${h.finding}` : null, h.product, h.searched ? `searched ${h.searched}` : null]
    .filter(Boolean).join(' · ')

/** Where a press sends the reader, with the question already in the box. */
export type Assistant = { readonly name: string; readonly href: (question: string) => string }

/**
 * The two assistants this control can open, and the links it opens them with.
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
  { name: 'Claude', href: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}` },
  { name: 'ChatGPT', href: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}` },
]

/**
 * The assistant the panel's one button opens.
 *
 * CLAUDE, BECAUSE NOTHING HERE KNOWS WHICH APP A READER CONNECTED. The design says the button names "the
 * assistant this reader connected", and the only evidence the product holds — the connector's access log —
 * records who called and how, never from which app. Following the reader's own app is an open decision.
 * Until it is made the button names the first assistant checked, and ChatGPT stays in the table as the
 * other link that was driven.
 */
export const ASK_AI_OPENS: Assistant = ASSISTANTS[0]!

/** The button's words. */
export const openLabel = (a: Assistant): string => `Open in ${a.name}`

/** Where the per-assistant setup instructions live. */
export const AI_SETUP_PATH = '/portal/ai'

/**
 * The same page, reached from a report's "Set it up".
 *
 * THE MARKER SAYS WHERE THE READER CAME FROM; THE BROWSER REMEMBERS WHICH REPORT. The page offers the way
 * back only when both hold, because a report remembered days ago is not the one a reader arriving from
 * the rail is thinking of. The marker stays in the address, so a reload — the reader coming back from
 * connecting in another tab — still knows where they came from.
 */
export const AI_SETUP_FROM_REPORT = `${AI_SETUP_PATH}?from=report`

/** Whether this address is the setup page reached from a report. */
export const reachedFromReport = (search: string): boolean => new URLSearchParams(search).get('from') === 'report'

/** The report a reader was on when they went to connect, as this browser remembers it. */
export type RememberedReport = { readonly runId: string; readonly markSlug: string | null; readonly mark: string | null }

const REMEMBERED_KEY = 'cordillera-ask-ai-report'

/** Where a browser keeps it — a getter, because reading `localStorage` itself throws in a null-origin frame. */
export type ReportStore = () => Pick<Storage, 'getItem' | 'setItem'>
const browserStore: ReportStore = () => window.localStorage

/**
 * Remember the report a reader pressed "Set it up" on, in this browser.
 *
 * EVERY READ AND WRITE IS WRAPPED. Storage throws outright in a null-origin context and in some private
 * modes, and a reader on the way to connecting must never be stopped by a place to keep a note. A write
 * that fails returns false, and the page then simply offers no way back.
 */
export function rememberReport(report: RememberedReport, store: ReportStore = browserStore): boolean {
  try {
    store().setItem(REMEMBERED_KEY, JSON.stringify({ runId: report.runId, markSlug: report.markSlug, mark: report.mark }))
    return true
  } catch {
    return false
  }
}

/**
 * The remembered report, or null — for nothing stored, storage that throws, or a value this does not
 * recognise. A value another version of the page wrote in a shape it cannot read is not a way back.
 */
export function rememberedReport(store: ReportStore = browserStore): RememberedReport | null {
  try {
    const raw = store().getItem(REMEMBERED_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null)
    const runId = text(o['runId'])
    return runId ? { runId, markSlug: text(o['markSlug']), mark: text(o['mark']) } : null
  } catch {
    return null
  }
}

/**
 * A report's address with the Ask AI panel asked open on arrival.
 *
 * ONE SIGNAL, WHOEVER SENDS THE READER. Connect your AI's "Continue with …" and a row on a list reach a
 * report the same way, and the report screen reads this and nothing else.
 */
export const withAskOpen = (path: string): string => `${path}${path.includes('?') ? '&' : '?'}ask=open`

/** Whether this address asks for the panel open. */
export const asksOpen = (search: string): boolean => new URLSearchParams(search).get('ask') === 'open'

/** The same address without the signal, so a reload or a Back does not open the panel a second time. */
export function withoutAskOpen(path: string, search: string): string {
  const q = new URLSearchParams(search)
  q.delete('ask')
  const rest = q.toString()
  return rest ? `${path}?${rest}` : path
}

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
  /** The sentence the first question types in. */
  readonly question: string
  /**
   * True only when this reader's assistant has been seen calling a connector here.
   *
   * NULL IS NOT FALSE, AND BOTH DRAW THE CONNECT PANEL. A null means the installation could not be asked —
   * no access log yet, or one that could not be read — and rendering that as "you have never connected"
   * would assert a measurement nobody took. It draws the connect panel anyway, because opening an
   * assistant for a reader with none recreates the dead end this control exists to end, and because the
   * panel carries its own way past it for anyone the log has not caught up with.
   */
  readonly connected: boolean
}

/** Compose the control's behaviour from the run and the deployment's answer. */
export function askAiOffer(
  run: AskAiRun,
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
