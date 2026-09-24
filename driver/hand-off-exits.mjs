// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// hand-off-exits.mjs — every record, page or hit that leaves a hand-off with no ground, counted from the
// traces the run already writes about how each one left.
//
// THE RULE IT MEASURES: no record leaves a hand-off without a ground. A ground may cover an owner's whole
// set of records, so the picking step reports owners beside records: the number of grounds a run owes is
// the number of owners, not the number of filings.
//
// THREE HAND-OFFS, FOUR TRACES (THE WEB HAS TWO HOPS), ONE QUESTION.
//   picking   record-carry.json — a record that stopped at placement with no step recording why
//             (`step-silent`, or `absent` where no ledger spoke). A structural stop (the stage did not
//             complete) states its cause and is not counted.
//   web       commonlaw-carry.json — a grid row that stopped at findings with no reason (`absent`, the
//             `findings:silent-drop` class). The jx zh slice's carry counts beside the main one.
//   notes     common-law-findings.md against the delivered findings — a page the web notes surfaced that
//             no delivered finding cites and synthesis did not decline. The carry above ends where the notes
//             begin, so a page the notes called a conflict and the findings then left out was invisible to it.
//   knockout  knockout-carry.json — a page a mark's research payload named, or a filing the mark was
//             handed, that no finding cites or weighs, no read or absence covers, and no set-aside ground
//             covers. The trace is derived here, from the payload, the filings and the findings, because
//             the lane wrote none before.
//
// IT REPORTS AND NEVER GATES. Nothing here changes what is searched, carried or delivered. A count of
// exits is a fact about the run for the reviewing lawyer and for the replay, not a threshold.
//
// "NOT COMPUTABLE" IS NOT ZERO. A missing trace answers `computable: false` with the reason by name, so a
// run that wrote nothing can never read as a run where nothing left silently.
import { normalizeUrl, knockoutCitedUrls } from "./verify-knockout.mjs";
import { parseFindingsSurfaces } from "./commonlaw-carry.mjs";

export const KNOCKOUT_CARRY_SCHEMA_VERSION = 2;   // 2: filings are traced beside pages, and a ground in setAside is a stated exit

const notComputable = (reason) => ({ computable: false, reason, exits: 0, rows: [] });

/** Records that left the picking step with no ground. PURE. */
export function pickingExits(recordCarry) {
  if (!recordCarry || !Array.isArray(recordCarry.rows)) {
    return notComputable("no record-carry trace — nothing records how the register's records left the picking step");
  }
  const rows = recordCarry.rows
    .filter((r) => r?.stopped_at === "placement" && (r.reason_source === "step-silent" || r.reason_source === "absent"))
    .map((r) => ({ uri: r.uri ?? null, mark: r.mark ?? null, owner: r.owner ?? null }));
  const owners = new Set(rows.map((r) => String(r.owner ?? "").trim()));
  return { computable: true, reason: null, exits: rows.length, owners: rows.length ? owners.size : 0, rows };
}

/** Grid rows that left the web findings step with no reason, across every common-law carry given. PURE. */
export function webExits(carries = []) {
  const docs = (Array.isArray(carries) ? carries : [carries]).filter((c) => c && Array.isArray(c.rows));
  if (!docs.length) {
    return notComputable("no common-law carry trace — nothing records how the web grid's rows left the findings step");
  }
  const rows = docs.flatMap((d) => d.rows)
    .filter((r) => r?.stopped_at === "findings" && r.reason_source === "absent")
    .map((r) => ({ url: r.url ?? null, platform: r.platform ?? null, cell: r.cell ?? null }));
  return { computable: true, reason: null, exits: rows.length,
    pages: new Set(rows.map((r) => normalizeUrl(r.url) ?? r.url)).size,
    cells: new Set(rows.map((r) => JSON.stringify(r.cell))).size, rows };
}

/**
 * Pages the web notes surfaced that no delivered finding cites and synthesis did not decline with a
 * ground. `declinedPages` is the decline ledger's pages (a Map or Set keyed by normalised address); a
 * page it holds left by a stated decision and is not an exit. PURE.
 */
export function notesExits(notesText, findings, declinedPages = null) {
  if (notesText == null) return notComputable("no web notes on this run — nothing records which pages the web step surfaced");
  if (findings == null) return notComputable("no delivered findings — the web notes cannot be followed to them");
  const { urls } = parseFindingsSurfaces(notesText);
  const cited = new Set([...parseFindingsSurfaces(JSON.stringify(findings)).urls.keys()]);
  const declined = declinedPages instanceof Map || declinedPages instanceof Set ? declinedPages : new Set();
  const left = [...urls].filter(([page]) => !cited.has(page));
  const rows = left.filter(([page]) => !declined.has(page)).map(([page, url]) => ({ page, url }));
  return { computable: true, reason: null, exits: rows.length, surfaced: urls.size, declined: left.length - rows.length, rows };
}

/**
 * The web notes' pages as rows on synthesis's offered list, after the register records: the seat
 * declines a page by its position there, exactly as it declines a record. `page` is the normalised
 * address the notes and the findings are joined on; `url` is the address as the notes printed it.
 * No notes, no rows. PURE.
 */
export function notesPageRows(notesText) {
  if (notesText == null) return [];
  return [...parseFindingsSurfaces(notesText).urls].map(([page, url]) => ({ kind: "page", page, url }));
}

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;

/** Every page a research payload names, normalised, in the order first named. PURE. */
export function payloadPages(payload) {
  const seen = new Map();
  for (const raw of String(payload ?? "").match(URL_RE) ?? []) {
    const url = raw.replace(/[.,;:!?*_]+$/, "");   // sentence punctuation, and the markdown emphasis that wraps a link
    const page = normalizeUrl(url);
    if (page && !seen.has(page)) seen.set(page, url);
  }
  return [...seen].map(([page, url]) => ({ page, url }));
}

/**
 * The knockout's notes-to-findings trace: one row per page each mark's research payload named, and one
 * per filing the mark was handed, saying how each left. A page left cited by a finding or by a scoped
 * absence's source, or set aside with a ground in the mark's `setAside`; a filing left weighed by a
 * finding, read in `registerReads`, or set aside the same way. Anything else left with no ground.
 * `payloadFor(name)` returns the mark's payload text, or null when it has none (a degraded mark named no
 * page, so it contributes no page row and is listed by name); `filingsFor(name)` returns the record ids
 * the run holds for the mark. A set-aside row naming a page or filing the mark was not handed matches
 * nothing and grounds nothing. PURE.
 */
export function knockoutCarry(marks = [], payloadFor = () => null, filingsFor = () => []) {
  const rows = [];
  const withoutPayload = [];
  for (const m of Array.isArray(marks) ? marks : []) {
    const findings = Array.isArray(m?.findings) ? m.findings : [];
    const setAside = Array.isArray(m?.setAside) ? m.setAside : [];
    const grounded = (r) => typeof r?.ground === "string" && r.ground.trim().length > 0;
    const setAsidePages = new Set(setAside.filter(grounded).map((r) => normalizeUrl(r?.page)).filter(Boolean));
    const setAsideFilings = new Set(setAside.filter(grounded).map((r) => String(r?.recordId ?? "").trim()).filter(Boolean));
    const payload = payloadFor(m?.name);
    if (payload == null) withoutPayload.push(m?.name ?? null);
    else {
      const cited = new Set([...findings.flatMap((f) => knockoutCitedUrls(f)),
        ...(Array.isArray(m?.negatives) ? m.negatives : []).flatMap((n) => payloadPages(n?.source).map((x) => x.url))]
        .map((u) => normalizeUrl(u)).filter(Boolean));
      for (const { page, url } of payloadPages(payload)) {
        rows.push(cited.has(page)
          ? { kind: "page", mark: m.name, page, url, reach: "finding", stopped_at: null, reason: null, reason_source: null }
          : setAsidePages.has(page)
            ? { kind: "page", mark: m.name, page, url, reach: "set-aside", stopped_at: "findings", reason: "notes:set-aside", reason_source: "step-stated" }
            : { kind: "page", mark: m.name, page, url, reach: "named", stopped_at: "findings", reason: "notes:silent-drop", reason_source: "absent" });
      }
    }
    const weighed = new Set([...findings.flatMap((f) => (Array.isArray(f?.weighedFilings) ? f.weighedFilings : [])),
      ...(Array.isArray(m?.registerReads) ? m.registerReads : []).map((r) => r?.recordId)].map((x) => String(x ?? "").trim()).filter(Boolean));
    for (const recordId of filingsFor(m?.name) ?? []) {
      rows.push(weighed.has(recordId)
        ? { kind: "filing", mark: m.name, recordId, reach: "finding", stopped_at: null, reason: null, reason_source: null }
        : setAsideFilings.has(recordId)
          ? { kind: "filing", mark: m.name, recordId, reach: "set-aside", stopped_at: "findings", reason: "filings:set-aside", reason_source: "step-stated" }
          : { kind: "filing", mark: m.name, recordId, reach: "handed", stopped_at: "findings", reason: "filings:silent-drop", reason_source: "absent" });
    }
  }
  const count = (kind, reach) => rows.filter((r) => r.kind === kind && (!reach || r.reach === reach)).length;
  return { schema_version: KNOCKOUT_CARRY_SCHEMA_VERSION, rows,
    totals: { marks: (marks ?? []).length, pages: count("page"), filings: count("filing"),
      finding: rows.filter((r) => r.reach === "finding").length, set_aside: rows.filter((r) => r.reach === "set-aside").length,
      unreasoned: rows.filter((r) => r.reason_source === "absent").length },
    marks_without_payload: withoutPayload };
}

/** Pages and filings that left the knockout's assessment with no ground. PURE. */
export function knockoutExits(carry) {
  if (!carry || !Array.isArray(carry.rows)) {
    return notComputable("no knockout carry trace — nothing records how the research payload's pages left for the findings");
  }
  const rows = carry.rows.filter((r) => r?.reason_source === "absent")
    .map((r) => (r.kind === "filing" ? { mark: r.mark ?? null, recordId: r.recordId ?? null } : { mark: r.mark ?? null, url: r.url ?? null }));
  return { computable: true, reason: null, exits: rows.length, rows };
}

/** The run-log line: counts and reasons only, never a row. PURE. */
export function exitsForLog(exits = {}) {
  const out = {};
  for (const [handOff, e] of Object.entries(exits)) {
    if (!e) continue;
    out[handOff] = e.computable
      ? { computable: true, exits: e.exits, ...("owners" in e ? { owners: e.owners } : {}),
        ...("pages" in e ? { pages: e.pages, cells: e.cells } : {}), ...("surfaced" in e ? { surfaced: e.surfaced, declined: e.declined ?? 0 } : {}) }
      : { computable: false, reason: e.reason };
  }
  return out;
}
