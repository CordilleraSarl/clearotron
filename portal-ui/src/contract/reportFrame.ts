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

/** The message the portal sends inwards. Shaped here so both ends of the contract sit in one file. */
export function frameCommand(command: FrameCommand, value?: boolean) {
  return { source: FRAME_TAG, type: 'command' as const, command, value }
}

/**
 * THE FLAG HALF OF THIS BRIDGE IS RETIRED (, owner ruling 2026-08-20).
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
