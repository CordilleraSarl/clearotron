// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The channel between the portal and the report it is showing.
//
// A delivered report is embedded in an iframe with NO allow-same-origin, which is what retires the
// stored-XSS class for every report ever delivered (see Result.tsx). The price of that boundary is that
// the portal can neither MEASURE the document — `contentDocument` throws — nor CALL into it, so the two
// things the frame needs from it have to arrive as messages: how tall it is, and an acknowledgement that
// a command was received. The document's half of this lives in driver/portal-report.mjs, injected at
// serve time so it reaches reports that were frozen long before any of this existed.
//
// The validation below is a pure function on purpose. It is the whole trust boundary for anything the
// page accepts from inside that frame, and a trust boundary that can only be exercised by mounting React
// in a browser is a trust boundary that does not get tested.

/** Both ends tag their messages with this, so anything else on the page is ignored rather than obeyed. */
export const FRAME_TAG = 'cordillera-report'

/** Tall enough not to show a sliver before the first measurement, short enough not to leave a void. */
export const FIRST_PAINT = 1400

/**
 * A runaway guard, not a real limit. The longest delivered report measures a few thousand pixels; a
 * number far outside this range means a broken document or a hostile one, and either way the answer is
 * to clamp rather than to hand the layout an absurd height.
 */
export const MIN_FRAME = 320
export const MAX_FRAME = 200_000

export type FrameCommand = 'exportPDF' | 'pickAll' | 'openAll'

/**
 * `section` and `theme` are not among those. The three above are verbs the DOCUMENT defines and the Export
 * menu offers; these two are the shell's own, answered by the injected bridge: `section` is a jump, done
 * the way the document's own anchors do it, and `theme` sets the attribute the report's dark rules key on,
 * as its own Theme control would. Keeping both out of `FrameCommand` is what stops either appearing as a
 * menu row: `exportMenu` and `readFrameControls` are both closed over that type.
 */
export type FrameVerb = FrameCommand | 'section' | 'theme'

/** The two themes the portal and the report both draw. Dark is an explicit choice on both, never the OS's. */
export type FrameTheme = 'light' | 'dark'

/** One entry of the report's section breadcrumb: the anchor's id and the word the reader sees. */
// `top` is where the section starts in the document, in CSS pixels from its top. Absent from a document
// that did not say, and then no progress is shown past it.
export type FrameSection = { readonly id: string; readonly label: string; readonly top?: number }

/** A header is a header, not a table of contents; and a hostile document does not get to fill the page. */
export const MAX_SECTIONS = 12
export const MAX_SECTION_LABEL = 40

/**
 * Decide whether a `message` event carries a height for us, and what that height is.
 *
 * `sameSource` is the caller's answer to "did this come from the frame I am showing?", which it gets by
 * comparing `event.source` to the iframe's `contentWindow`. That comparison — identity, not origin — is
 * the load-bearing one, and it is the caller's to make because only the caller holds the ref.
 *
 * Origin is deliberately NOT consulted anywhere. A null-origin frame reports its origin as the STRING
 * "null", so an origin check either accepts every sandboxed frame on the internet or rejects this one.
 * It looks like a security check and is not one.
 *
 * Returns the clamped height, or null when the message is not ours — never throws, and never returns
 * NaN: a layout fed NaN collapses to nothing, which is indistinguishable from a report that failed to
 * load.
 */
/** One row of the Export menu. `download` is a plain link to a service route, never a bridge command. */
export type ExportItem =
  | { readonly kind: 'command'; readonly label: string; readonly command: FrameCommand; readonly value: boolean | null }
  | { readonly kind: 'download' }
  | { readonly kind: 'separator' }
  | { readonly kind: 'note'; readonly text: string }

/**
 * THE EXPORT MENU, COMPOSED FROM WHAT THE DOCUMENT SAYS IT HAS.
 *
 * Every row that sends a bridge command is drawn only when the framed document defines that command.
 * The menu used to be a fixed list of five, and the knockout template defined none of the three verbs —
 * so every one of them failed with "this report has no exportPDF", and the footer described a tick
 * control that exists nowhere on the page.
 *
 * THE LABEL FOLLOWS THE VERBS TOO. "(ticked findings)" describes the tick filter, so it appears only
 * where there are ticks to filter. And the footer explaining the ticks goes where the ticks go.
 *
 * `download` is always present: it is a link to a route this service serves, not a command into the
 * document, so it is the one row that never depended on the renderer.
 *
 * Given no commands at all, this returns the download alone — and the screen draws no menu for it,
 * because a menu with one download in it is a button pretending to be a menu.
 */
export function exportMenu(offered: readonly FrameCommand[]): readonly ExportItem[] {
  const has = (c: FrameCommand) => offered.includes(c)
  const rows: ExportItem[] = []
  if (has('exportPDF')) {
    rows.push({ kind: 'command', command: 'exportPDF', value: null,
      label: has('pickAll') ? 'Export PDF (ticked findings)' : 'Export PDF' })
  }
  rows.push({ kind: 'download' })
  if (has('pickAll') || has('openAll')) rows.push({ kind: 'separator' })
  if (has('pickAll')) {
    rows.push({ kind: 'command', command: 'pickAll', value: true, label: 'Select all findings' })
    rows.push({ kind: 'command', command: 'pickAll', value: false, label: 'Select none' })
  }
  if (has('openAll')) {
    rows.push({ kind: 'command', command: 'openAll', value: true, label: 'Expand all' })
    rows.push({ kind: 'command', command: 'openAll', value: false, label: 'Collapse all' })
  }
  if (has('pickAll')) {
    rows.push({ kind: 'note', text: 'Tick a finding in the report to keep it in the exported PDF; untick to drop it.' })
  }
  return rows
}

/**
 * WHAT THE HEADER DRAWS, given what the document has announced.
 *
 * `'menu'` when the document announced at least one verb; `'download'` otherwise — never "nothing".
 *
 * THE WORKBOOK IS A RUN-LEVEL FILE. It is served by this portal's own audit route and the report's own
 * .xlsx link is STRIPPED on the way into the frame, so the shell's link is the only route to it. Gating
 * the whole menu on the announced verbs therefore took the workbook away from every document that
 * announces none — which is every knockout published before this change, the exact population this
 * issue is about. `exportMenu` kept returning the download row throughout and its arm kept passing; the
 * screen discarded it one layer up, which is why this decision is a function here rather than a
 * condition in the JSX.
 *
 * A null announcement (not heard from yet) and an empty one (heard, nothing to offer) still differ for
 * the COMMAND rows — neither produces any — and neither withholds the workbook.
 */
export function exportAffordance(controls: readonly FrameCommand[] | null): 'menu' | 'download' {
  return exportMenu(controls ?? []).some((r) => r.kind === 'command') ? 'menu' : 'download'
}

/**
 * WHICH CONTROLS THE FRAMED DOCUMENT ACTUALLY HAS.
 *
 * The document announces the verbs it defines, on load, and the shell draws only those. The bridge has
 * always replied "this report has no <verb>" for a verb that is not there — honest, and too late: the
 * item was already drawn and already pressed, and what the reader learns is that the product is broken.
 * That is what every Export-menu item did on every knockout ever published.
 *
 * ASKED OF THE DOCUMENT, NOT DERIVED FROM THE RUN'S KIND. A kind is a second table that must be updated
 * whenever a renderer gains or loses a control, and nothing fails when it is not — which is how this
 * shipped. A document cannot disagree with itself about which functions it defines.
 *
 * Returns null when the message is not ours, so "not announced yet" and "announced nothing" stay
 * different: the first is unknown and draws no menu, the second is a document with no controls, which
 * also draws no menu but for a reason the shell can state.
 *
 * Unknown verb names are dropped rather than passed through — the command vocabulary is closed at the
 * bridge, so a name outside it could only ever produce a menu item that cannot work.
 */
export function readFrameControls(data: unknown, sameSource: boolean): FrameCommand[] | null {
  if (!sameSource) return null
  if (typeof data !== 'object' || data === null) return null
  const msg = data as { source?: unknown; type?: unknown; commands?: unknown }
  if (msg.source !== FRAME_TAG || msg.type !== 'controls') return null
  const commands: readonly unknown[] = Array.isArray(msg.commands) ? msg.commands : []
  if (!Array.isArray(msg.commands)) return null
  const known: readonly FrameCommand[] = ['exportPDF', 'pickAll', 'openAll']
  return known.filter((v) => commands.includes(v))
}

export function readFrameHeight(data: unknown, sameSource: boolean): number | null {
  if (!sameSource) return null
  if (typeof data !== 'object' || data === null) return null
  const msg = data as { source?: unknown; type?: unknown; height?: unknown }
  if (msg.source !== FRAME_TAG || msg.type !== 'height') return null
  // Strings are rejected rather than coerced. `Number('')` is 0 and `Number(' 12 ')` is 12, so coercing
  // would let an empty or padded value through as a plausible-looking number.
  if (typeof msg.height !== 'number' || !Number.isFinite(msg.height)) return null
  return Math.min(Math.max(msg.height, MIN_FRAME), MAX_FRAME)
}

/**
 * An in-page anchor jump, delegated outward (B2, 2026-07-30).
 *
 * The frame is sized to its content, so its own scrollport has nowhere to go, and scrollIntoView does
 * not cross the null-origin boundary — measured in a real browser: a click on a rights-holder row
 * moved nothing. The injected bridge posts the target's document-relative top instead, and the PAGE —
 * the only party holding a scrollbar — performs the jump, offset for its own sticky chrome so the
 * target lands visibly below the header rather than under it.
 *
 * Returns the clamped offset, or null when the message is not ours. Same trust model as the height:
 * source identity, never origin, and strings are rejected rather than coerced.
 */
export function readFrameScroll(data: unknown, sameSource: boolean): number | null {
  if (!sameSource) return null
  if (typeof data !== 'object' || data === null) return null
  const msg = data as { source?: unknown; type?: unknown; top?: unknown }
  if (msg.source !== FRAME_TAG || msg.type !== 'scrollTo') return null
  if (typeof msg.top !== 'number' || !Number.isFinite(msg.top)) return null
  return Math.min(Math.max(msg.top, 0), MAX_FRAME)
}

/**
 * A command the document could not carry out.
 *
 * The injected handler used to swallow exceptions, which meant a menu item could do nothing at all and
 * say nothing at all — the state Export was in for a whole round of testing without anyone noticing.
 * Returns the message when this is a genuine failure report from OUR frame, null otherwise.
 */
export function readCommandFailure(data: unknown, sameSource: boolean): { command: string; message: string } | null {
  if (!sameSource) return null
  if (typeof data !== 'object' || data === null) return null
  const m = data as { source?: unknown; type?: unknown; command?: unknown; message?: unknown }
  if (m.source !== FRAME_TAG || m.type !== 'commandFailed') return null
  if (typeof m.command !== 'string') return null
  return { command: m.command, message: typeof m.message === 'string' ? m.message : 'it did not say why' }
}

/**
 * A finding's own Ask AI, pressed inside the document and answered outside it.
 *
 * The document draws the button and the shell holds the control, so the press has to cross the
 * null-origin boundary like the height and the anchor jump above it. Same trust model: source identity,
 * never origin, and a string is rejected rather than coerced into a number.
 *
 * THE ORDINAL IS OPTIONAL BECAUSE SOME CARDS GENUINELY HAVE NONE. A clearance numbers its findings and
 * carries that number in the card's id, but the "Also considered" cards carry the same button and no
 * number — a record that was ruled out was never given an ordinal. Refusing the message in that case
 * would make the button work on most cards and silently do nothing on the rest, which is worse than not
 * drawing it: the reader cannot tell which cards are the dead ones. A null ordinal opens the control and
 * says the document could not name a finding, which is true.
 *
 * A KNOCKOUT RESTARTS ITS ORDINALS AT 1 FOR EACH MARK, so the number alone names a different finding on
 * every mark in a batch. `markIndex` is what tells them apart. It is null on a clearance, which numbers
 * its findings once across the whole document.
 */
export function readAskAi(data: unknown, sameSource: boolean): { ordinal: number | null; markIndex: number | null } | null {
  if (!sameSource) return null
  if (typeof data !== 'object' || data === null) return null
  const m = data as { source?: unknown; type?: unknown; ordinal?: unknown; markIndex?: unknown }
  if (m.source !== FRAME_TAG || m.type !== 'askAi') return null
  const whole = (v: unknown): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null
  return { ordinal: whole(m.ordinal), markIndex: whole(m.markIndex) }
}

/**
 * WHICH SECTIONS THE FRAMED DOCUMENT HOLDS.
 *
 * The renderers draw the breadcrumb inside the report's own sticky header, and `portal-report.mjs`
 * strips that header on the way in, because the portal draws its own. So the breadcrumb arrives as data
 * and the shell draws it in `.report-head`, where it stays on top — which is the whole point of it.
 * Inside the frame it could not: the frame is sized to its content, so a `position:sticky` bar in there
 * pins to nothing and scrolls away with the page.
 *
 * Same trust model as every reader above — source identity, never origin — and the same discipline
 * about what a document is allowed to say: entries without a string id and a non-empty label are
 * dropped, labels are trimmed to a header's worth of text, and the list is capped. A document that
 * announces nothing usable produces an empty list, and an empty list draws no breadcrumb.
 *
 * Returns null when the message is not ours, so "not announced yet" and "announced nothing" stay
 * different.
 */
export function readFrameSections(data: unknown, sameSource: boolean): FrameSection[] | null {
  if (!sameSource) return null
  if (typeof data !== 'object' || data === null) return null
  const msg = data as { source?: unknown; type?: unknown; sections?: unknown }
  if (msg.source !== FRAME_TAG || msg.type !== 'sections') return null
  if (!Array.isArray(msg.sections)) return null
  const out: FrameSection[] = []
  for (const raw of msg.sections) {
    if (typeof raw !== 'object' || raw === null) continue
    const { id, label, top } = raw as { id?: unknown; label?: unknown; top?: unknown }
    if (typeof id !== 'string' || typeof label !== 'string') continue
    const trimmed = label.trim().slice(0, MAX_SECTION_LABEL)
    if (!id.trim() || !trimmed) continue
    out.push(typeof top === 'number' && Number.isFinite(top) && top >= 0
      ? { id, label: trimmed, top: Math.round(top) }
      : { id, label: trimmed })
    if (out.length === MAX_SECTIONS) break
  }
  return out
}

/**
 * HOW FAR THE READER HAS GOT THROUGH ONE DOCUMENT (owner, 2026-09-19): the section strip shows progress,
 * not a set of pages. Every section reached so far is marked and the rest are not, so it reads as none at
 * the top, then the first, then the first two, and un-marks the same way on the way back up.
 *
 * `line` is the reading line, the bottom of the pinned header, measured in the document's own pixels. A
 * section is reached once its start has come up to that line. At the TOP of the page nothing is reached:
 * the first section starts a few pixels under the header, closer than any line could be drawn, and the
 * owner's rule is that the strip reads empty until the reader moves. At the FOOT nothing more can come up
 * to the line, so every section counts as reached. Sections arrive in document order, so the answer is a
 * count from the first; one with no known start ends the count rather than being guessed. PURE.
 */
export function sectionsReached(sections: readonly FrameSection[], line: number, where: { readonly atTop: boolean; readonly atFoot: boolean }): number {
  if (where.atTop) return 0
  if (where.atFoot) return sections.length
  let n = 0
  for (const s of sections) {
    if (typeof s.top !== 'number' || s.top > line) break
    n += 1
  }
  return n
}

/**
 * THE DOCUMENT HAS TAKEN THE PORTAL'S THEME (owner ruling, 2026-09-18: the embedded report follows the
 * portal). The report carries its own dark theme, switched by a control in the top bar that embedding
 * strips, and a sandboxed frame cannot read the portal's saved choice — so the shell sends the theme in,
 * the way it sends an export or a jump, and the bridge answers with the theme it applied. Only the two
 * values either side draws are read back; anything else is not ours.
 */
export function readFrameTheme(data: unknown, sameSource: boolean): FrameTheme | null {
  if (!sameSource) return null
  if (typeof data !== 'object' || data === null) return null
  const msg = data as { source?: unknown; type?: unknown; theme?: unknown }
  if (msg.source !== FRAME_TAG || msg.type !== 'theme') return null
  return msg.theme === 'dark' || msg.theme === 'light' ? msg.theme : null
}

/**
 * The message the portal sends inwards. Shaped here so both ends of the contract sit in one file.
 *
 * `value` is a boolean for the three document verbs and the target id for `section` — the bridge coerces
 * each to the shape its own branch needs, so neither can arrive as the other.
 */
export function frameCommand(command: FrameVerb, value?: boolean | string) {
  return { source: FRAME_TAG, type: 'command' as const, command, value }
}

/**
 * THE FLAG HALF OF THIS BRIDGE IS RETIRED (ruling 2026-08-20).
 *
 * `readFrameFeedback`, `frameFeedbackResult`, the `FrameFeedback` type and the `MAX_WHY` mirror lived
 * here and are deleted. They validated a `type: 'feedback'` message carrying a reader's verdict on one
 * finding out of the null-origin frame; nothing sends that message any more, because
 * `portal-service.mjs` no longer injects the control that raised it.
 *
 * A message of that shape now falls through every reader above and is ignored, which is the correct
 * outcome and not a silent one: the endpoint it would have driven answers 410 and files an outcome row.
 *
 * To bring it back: `git show <this commit>^:portal-ui/src/contract/reportFrame.ts`. The document-side
 * injection it paired with was never deleted — see portal-report.mjs's FEEDBACK_JS.
 */
