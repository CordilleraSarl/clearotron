// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Family → Mark → Reads.
//
// The Clearances list was one row per RUN. That is the shape the data arrives in and the wrong shape to
// read: a mark cleared three times appeared as three unrelated rows saying nearly the same thing, and the
// page's own copy — "Open a row to see each read on that name" — promised a thread that did not exist.
// Expanding a single clearance said, literally, "One read on this name."
//
// Three levels, and they are three different questions:
//
//   READ    one run. A single search at one depth, on one date, with its own report.
//   MARK    every read of one name, newest first. This is the thing a user actually tracks.
//   FAMILY  several marks a customer treats as one piece of work — AQUAPLUS and AQUAMAX.
//
// WHY FAMILY IS MANUAL. The first two are derivable; the third is not. That AQUAPLUS and AQUAMAX belong
// together is a commercial judgment about a brand line — no string distance, shared prefix or class
// overlap decides it, and each of those would be confidently wrong in both directions. So a family is
// something a person asserts, stored beside the pool rather than derived from it. A later multi-name
// submission can seed one at intake; that is the same fact arriving earlier, not a different mechanism.
//
// ── the two roll-up rules, which are NOT the same ────────────────────────────────────────────────────
//
// A MARK shows its LATEST read. Not the worst. A knockout that came back High followed by a preliminary
// that came back Medium is a mark whose current standing is Medium — the deeper read supersedes the
// screen. Rolling "worst" up a thread would resurface a superseded band and tell the reader that the
// analysis they paid for is really the answer it replaced. That is not conservative, it is wrong.
//
// A FAMILY shows the WORST of its marks. Here the reads do not supersede each other — they are different
// names, all live at once, and one of them being Blocking is the fact that matters. This is the same
// reasoning the knockout batch already uses for "N names, worst: <band>".
//
// The two rules look inconsistent and are not: down a thread, later supersedes earlier; across marks,
// nothing supersedes anything.

import type { Run } from './api.ts'
import type { Band, Tone } from './tone.ts'
import { displayName, markKey, newestFirst } from './reads.ts'
import { worstBand, bandRank } from './tone.ts'

/** One name, with every read of it. */
export type MarkGroup = {
  readonly kind: 'mark'
  /** account + normalised mark — stable across renders, usable as a React key and an open-state id. */
  readonly id: string
  readonly account: string
  readonly name: string
  /** Newest first. Never empty: a MarkGroup exists because a read does. */
  readonly reads: readonly Run[]
  /** The latest read — the one whose band and date the row shows. */
  readonly current: Run
  readonly band: string | null
  readonly tone: Tone | null
  readonly date: string | null
  /** The latest read's completion timestamp — the key the thread is ordered by. Null on old runs. */
  readonly issuedAt: string | null
  /** The ladder these bands belong to, so a caller can rank without reaching into a run. */
  readonly bands: readonly Band[]
  /**
   * The bands the latest read actually contains, worst first.
   *
   * REPORTED, never computed. One mark carries one; a batch carries what its names came back with. The
   * test is whether a reader could reconstruct the row's contents from the cell — which a synthesised
   * "worst" cannot pass, whatever it is called.
   */
  readonly rowBands: readonly string[]
  /**
   * The worst band an EARLIER read carried, when it was worse than the latest one. Null otherwise, which
   * is almost always.
   *
   * The one thing a latest-read rule would otherwise hide: the row is correct about now, and a reader who
   * remembers the old answer would think the page had lost it. It lives outside the Risk cell and only
   * appears when the two disagree — a marker on every row is one nobody sees.
   */
  readonly improvedFrom: string | null
  /** What the Status cell shows: the latest read's state. */
  readonly state: Run['state']
  readonly familyId: string | null
}

/** Several marks a person has grouped by hand. */
export type FamilyGroup = {
  readonly kind: 'family'
  readonly id: string
  readonly account: string
  readonly name: string
  readonly marks: readonly MarkGroup[]
  /** The WORST band across its marks — see the note above. */
  readonly band: string | null
  readonly tone: Tone | null
  readonly bands: readonly Band[]
  /** The most recent activity anywhere in the family. */
  readonly date: string | null
  /**
   * The same answer to the second, and the key a caller ORDERS by. `date` is day precision, so
   * two families last worked on the same day tie under it and `Array.prototype.sort` is stable — which
   * makes the surviving order whatever the grouping happened to yield. Null only where every mark under
   * it predates `issuedAt` crossing the wire.
   */
  readonly issuedAt: string | null
  /** In flight while ANY mark under it is: a family is finished only once all of it is. */
  readonly state: Run['state']
}

export type Row = FamilyGroup | MarkGroup

/** What the family sidecar says, once it reaches the browser: run id → family, and family id → name. */
export type Families = {
  readonly of: Readonly<Record<string, string>>
  readonly names: Readonly<Record<string, string>>
}

export const NO_FAMILIES: Families = { of: {}, names: {} }

/**
 * The bands actually present in a row, worst first.
 *
 * NOT a computed summary. The aim, in the issue's words, is that a reader could reconstruct the row's
 * contents from the cell — so this REPORTS what is there and never synthesises a value to stand for it.
 * One mark carries one band, which is what the cell already showed; a batch covering several shows the
 * several, in ladder order.
 *
 * Duplicates collapse: a batch of four marks all Manageable says "Manageable", not the word four times.
 */
export function bandsPresent(bands: readonly Band[], labels: readonly (string | null)[]): readonly string[] {
  const seen: string[] = []
  for (const l of labels) if (typeof l === 'string' && l && !seen.includes(l)) seen.push(l)
  return seen.sort((x, y) => bandRank(bands, x) - bandRank(bands, y))
}

/**
 * Group runs into marks.
 *
 * Keyed on account AND mark. Two brand owners clearing the same word at the same time is ordinary, and a
 * key without the account would put one client's reads under another client's name. The server already
 * scopes what it returns; this is the second wall, not the first.
 */
export function marksOf(runs: readonly Run[], families: Families = NO_FAMILIES): readonly MarkGroup[] {
  const byKey = new Map<string, Run[]>()
  for (const run of runs) {
    const key = `${run.account}\u0000${markKey(displayName(run))}`
    const bucket = byKey.get(key)
    if (bucket) bucket.push(run)
    else byKey.set(key, [run])
  }

  const out: MarkGroup[] = []
  for (const [id, bucket] of byKey) {
    const reads = [...bucket].sort(newestFirst)
    const current = reads[0]!
    // The row's own bands, worst first. A single mark has exactly one; a batch has what its names came
    // back with. Reported, never computed — see bandsPresent.
    const rowBands = bandsPresent(
      current.bands,
      current.marks.length ? current.marks.map((m) => m.band) : [current.band],
    )
    // IMPROVED SINCE. A marker for the one case a latest-read rule would otherwise hide: an earlier read
    // came back WORSE than the current one, so the row is telling the truth about now while a reader who
    // remembers the old answer would think the page had lost it. Only when they disagree, which is what
    // keeps it rare enough to notice — the issue rejects a marker that renders on every row.
    const worstEarlier = reads.slice(1).reduce<string | null>(
      (w, r) => (r.band && (w === null || bandRank(current.bands, r.band) < bandRank(current.bands, w)) ? r.band : w),
      null,
    )
    const improvedFrom =
      worstEarlier && current.band && bandRank(current.bands, worstEarlier) < bandRank(current.bands, current.band)
        ? worstEarlier
        : null
    out.push({
      kind: 'mark',
      id,
      account: current.account,
      name: displayName(current),
      reads,
      current,
      // The row speaks for the latest read, so it borrows that read's band and date wholesale rather
      // than computing anything. A run still in flight has no band, and the row says so too.
      band: current.band,
      tone: current.tone,
      date: current.date,
      issuedAt: current.issuedAt,
      bands: current.bands,
      rowBands,
      improvedFrom,
      state: current.state,
      // A family is asserted per RUN, so a mark belongs to whichever family any of its reads names.
      // Newest wins, which is what re-filing a mark looks like from the outside.
      familyId: reads.map((r) => families.of[r.runId]).find((f) => typeof f === 'string') ?? null,
    })
  }
  return out
}

/**
 * Fold marks into their families, leaving unfamilied marks at the top level.
 *
 * Unfamilied marks are NOT wrapped in a family of one. Most marks have no family and never will, and a
 * container around a single item is pure ceremony — an extra chevron between the reader and the thing
 * they came for.
 *
 * Ordering is inherited, not re-derived: rows come out in the order their leading member arrived, so the
 * caller's sort survives. A family lands at the position of its first member.
 */
export function rowsOf(marks: readonly MarkGroup[], families: Families = NO_FAMILIES): readonly Row[] {
  const rows: Row[] = []
  const at = new Map<string, number>()

  for (const mark of marks) {
    const fid = mark.familyId
    if (!fid) {
      rows.push(mark)
      continue
    }
    const seen = at.get(fid)
    if (seen === undefined) {
      at.set(fid, rows.length)
      rows.push({
        kind: 'family',
        id: fid,
        account: mark.account,
        name: families.names[fid] ?? fid,
        marks: [mark],
        band: null,
        tone: null,
        bands: [],
        date: null,
        issuedAt: null,
        state: 'delivered',
      })
    } else {
      const fam = rows[seen] as FamilyGroup
      rows[seen] = { ...fam, marks: [...fam.marks, mark] }
    }
  }

  // Roll up once, after every member is in place. Doing it incrementally would mean recomputing the
  // worst band on each append, and getting the empty case wrong on the first one.
  return rows.map((row) => (row.kind === 'family' ? rolledUp(row) : row))
}

function rolledUp(fam: FamilyGroup): FamilyGroup {
  // The ladder belongs to the runs, not to the family — bands are framework-scoped and the UI never
  // invents one. Taking it from the first member that has one is safe because a family is one account,
  // and an account is one framework.
  const ladder: readonly Band[] = fam.marks.find((m) => m.current.bands.length)?.current.bands ?? []
  const labels = fam.marks.map((m) => m.band)
  const band = ladder.length ? worstBand(ladder, labels) : null
  return {
    ...fam,
    band,
    tone: band ? (ladder.find((b) => b.label === band)?.tone ?? null) : null,
    bands: ladder,
    date: fam.marks.map((m) => m.date).reduce<string | null>((a, b) => (String(b ?? '') > String(a ?? '') ? b : a), null),
    // The same max over the marks, on the precise field. Computed beside `date` rather than derived from
    // it, because a family's newest mark by day and by second can be different marks.
    issuedAt: fam.marks.map((m) => m.issuedAt).reduce<string | null>((a, b) => (String(b ?? '') > String(a ?? '') ? b : a), null),
    // Finished only when all of it is. A family reported as delivered while one of its names is still
    // running invites someone to read a conclusion that is still being written.
    state: fam.marks.find((m) => m.state !== 'delivered')?.state ?? 'delivered',
  }
}

/** Everything a row contains, flattened — what a filter counts and what a search matches against. */
export function runsIn(row: Row): readonly Run[] {
  return row.kind === 'mark' ? row.reads : row.marks.flatMap((m) => m.reads)
}
