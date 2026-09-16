// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What a row on Clearances says and offers: its status words, which report its risk speaks for, and
// which buttons it carries.
//
// HERE RATHER THAN IN THE SCREEN because the screen has no DOM harness: a rule left inline in a `.tsx`
// is a rule nothing checks. Clearances renders these answers; `test/nameRow.test.ts` drives them.
//
// ONE DERIVATION, THREE CONSUMERS. The report a name row shows is the same report its Risk cell draws
// its bands from, its second line dates, its Open button opens and its Ask AI asks about. Computed once
// here, those four cannot come to describe four different searches.

import type { Run } from './api.ts'
import type { FamilyGroup, MarkGroup, Row } from './grouping.ts'

/**
 * Whether a read has a report a reader can open.
 *
 * `read.report` is the RUN-LEVEL link, and the service sets it null for a multi-name batch on purpose:
 * there is no run-level document, and serving the first name's report as "the report" was a defect.
 * A batch's reports are per name, so a read with any of those has something to open too — gating on
 * `report` alone listed every knockout batch as unopenable.
 */
export function hasReport(read: Run): boolean {
  return Boolean(read.report) || read.reports.length > 0
}

/** "1 search", "3 searches". */
export function searchesLabel(n: number): string {
  return `${n} ${n === 1 ? 'search' : 'searches'}`
}

/** "1 name", "7 names". */
export function namesLabel(n: number): string {
  return `${n} ${n === 1 ? 'name' : 'names'}`
}

/** Searches of this name or group still under way — waiting for a slot, running, or paused. */
export function inProgress(row: Row): number {
  return row.queued + row.running
}

/**
 * The report a name row speaks for, or null when it speaks for none.
 *
 * TWO CASES, and the difference is what the reader already holds:
 *   · A search is under way — the row shows the LATEST REPORT, dated, so the assessment the reader
 *     already has does not vanish while a re-read waits. Null if the name has never delivered one.
 *   · Nothing is under way — the row speaks for its newest read, and that read has a report only if
 *     it delivered. A stopped or failed newest read shows no band: the name's standing is that it
 *     stopped, and borrowing an older band without saying so is the blend the row exists to avoid.
 */
export function shownReport(mark: MarkGroup): Run | null {
  if (inProgress(mark) > 0) return mark.latestReport
  return mark.current.state === 'delivered' ? mark.current : null
}

/**
 * The quiet second line under the Risk cell: "latest report · 2026-09-02".
 *
 * Only while a search is under way and a report exists — exactly when the band beside it belongs to a
 * different search than the status beside it. Otherwise the status and the band describe one read and
 * the line would be noise on every row.
 */
export function reportLine(mark: MarkGroup): string | null {
  const parts = reportLineParts(mark)
  return parts ? (parts.date ? `${parts.label} · ${parts.date}` : parts.label) : null
}

/** `reportLine` in its two parts, so a screen can keep the date whole on a narrow line. */
export function reportLineParts(mark: MarkGroup): { readonly label: 'latest report'; readonly date: string | null } | null {
  const report = shownReport(mark)
  if (!report || inProgress(mark) === 0) return null
  return { label: 'latest report', date: report.date }
}

/**
 * What the Status cell adds after the state's own word: " · 1 search" in "Queued · 1 search".
 *
 * Paired with `reportLine`, and for the same reason: it is what tells the search under way apart from
 * the completed assessment shown one cell over. A name with nothing delivered has nothing to tell apart,
 * so its status is its state alone — "Running" with its stage beneath.
 */
export function statusCount(mark: MarkGroup): string | null {
  return reportLine(mark) ? searchesLabel(inProgress(mark)) : null
}

/**
 * A group's status when any name in it has a search under way: "1 search queued".
 *
 * Null when nothing is under way, and the group then states its members' own roll-up as before.
 */
export function groupStatus(family: FamilyGroup): { readonly text: string; readonly state: 'queued' | 'running' } | null {
  const { queued, running } = family
  if (!queued && !running) return null
  if (!running) return { text: `${searchesLabel(queued)} queued`, state: 'queued' }
  if (!queued) return { text: `${searchesLabel(running)} running`, state: 'running' }
  return { text: `${searchesLabel(running)} running · ${queued} queued`, state: 'running' }
}

/** The line under a group's name, saying what its Risk cell rolls up. */
export const GROUP_RISK_LINE = 'Highest risk across the latest report for each name.'

/** The line under a stopped name's status. */
export const STOPPED_LINE = 'No report will be produced. Completed work stays readable through Ask AI.'

export type NameActions = {
  /** The bordered button, or null. Its label is also its accessible name. */
  readonly open: { readonly label: 'Open' | 'Open latest report'; readonly read: Run } | null
  /** The read Ask AI composes its question from, or null for no Ask AI. */
  readonly askAbout: Run | null
}

/**
 * The buttons a name row carries.
 *
 *   · A report to show — Open (or "Open latest report" once the name has more than one search) and
 *     Ask AI, both about that report. Ask AI on the name asks what Ask AI on the report asks, because
 *     it is composed from the same read.
 *   · Stopped or failed, with no report — Ask AI alone, about the read that stopped: its completed
 *     work is readable through the assistant, and there is no document to open.
 *   · Waiting or running, with no report — nothing. There is nothing to open and nothing yet to ask.
 */
export function nameActions(mark: MarkGroup): NameActions {
  const report = shownReport(mark)
  if (report) {
    return {
      open: hasReport(report) ? { label: mark.reads.length > 1 ? 'Open latest report' : 'Open', read: report } : null,
      askAbout: report,
    }
  }
  const ended = mark.current.state === 'cancelled' || mark.current.state === 'failed'
  return { open: null, askAbout: ended ? mark.current : null }
}

/** The band a row's Risk cell shows — what the Risk sort orders by, so the order matches the column. */
export function shownBand(row: Row): string | null {
  return row.kind === 'family' ? row.band : shownReport(row)?.band ?? null
}
