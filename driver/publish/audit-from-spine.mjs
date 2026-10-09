// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Deterministic audit builder — NO LLM. Parses the register + common-law spine's markdown tables into the
// audit.md contract (# Findings / # Negative Results / # Audit Trail). Guarantees the FULL list every time
// (count-guarded), fixing the LLM audit-emit variance (47 vs 69 on identical input). The factual fields come
// straight from the tables; per-finding risk scoring lives in the curated report, not the raw audit.

import { findingJoinFor, normalizeJoinText } from "../doubt-ledger.mjs";   // pure — the shared doubt→finding join + its ONE normalization

// ---- generic markdown-table parsing ------------------------------------------------------------
const splitRow = (line) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.trim());
const isSep = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line || "");

// Returns [{ heading, columns:[...], rows:[{col:val}] }] for every markdown table, tagged with the nearest
// preceding ##/### heading.
function parseTables(md) {
  const lines = (md || "").split("\n");
  const tables = [];
  let heading = "";
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{2,4}\s+(.*)/);
    if (h) { heading = h[1].trim(); continue; }
    if (lines[i].trimStart().startsWith("|") && isSep(lines[i + 1])) {
      const columns = splitRow(lines[i]);
      const rows = [];
      let j = i + 2;
      for (; j < lines.length && lines[j].trimStart().startsWith("|") && !isSep(lines[j]); j++) {
        const cells = splitRow(lines[j]);
        if (cells.every((c) => !c)) continue;
        rows.push(Object.fromEntries(columns.map((c, k) => [c, cells[k] ?? ""])));
      }
      tables.push({ heading, columns, rows });
      i = j - 1;
    }
  }
  return tables;
}

const tablesUnder = (tables, re) => tables.filter((t) => re.test(t.heading));
const get = (row, ...names) => { for (const n of names) if (row[n] != null && row[n] !== "") return row[n]; return ""; };

// ---- map a spine finding row -> audit block fields -------------------------------------------
function findingBlock(row, sourceLayer) {
  const filed = get(row, "Filed", "App / Reg Dates");
  const expiry = get(row, "Expiry");
  const dates = [filed && `Filed ${filed}`, expiry && `Expiry ${expiry}`].filter(Boolean).join("; ");
  return {
    title: get(row, "Mark", "Finding", "Finding Name / Mark Text") || "(unnamed finding)",
    source_layer: sourceLayer,
    type: get(row, "Type"),
    owner: get(row, "Owner"),
    owner_country: get(row, "Country", "Owner Country"),
    classes: get(row, "Classes"),
    status: get(row, "Status"),
    dates,
    url: get(row, "URL", "URI"),
    description: get(row, "Notes", "Description"),
    key_factors: get(row, "Flag reason", "Trigger", "Why dropped"),
    source: get(row, "Source", "Source / Platform", "Source / Provider"),
    search_terms: get(row, "Search Term / Variant", "Search Terms Used / Variant"),
    verify: get(row, "Verify?"),
  };
}

const block = (title, fields) => {
  let s = `## ${title}\n`;
  for (const [k, v] of Object.entries(fields)) if (k !== "title" && v) s += `- ${k}: ${String(v).replace(/\s+/g, " ").trim()}\n`;
  return s;
};

// ---- one resolution per claim (2026-07-21) ---------------------------------------------------
// This builder is a UNION of the spine's rows and has no reconciliation step — by design, and that stays:
// the audit is the defensibility record of everything considered, so a claim that was asserted and then
// refuted belongs in it. What must NOT survive is the UNRESOLVED presentation. copper-gantry shipped the
// assertion ("PROPEL AQUAPLUS … active commercial product, nationwide US distribution"), the refutation
// (a later common-law pass that searched the owner's own sites and found no such product) and a negative
// row reading "PROPEL AQUAPLUS IDENTIFIED … confirmed" side by side, with no surface saying which won.
//
// The run already HAS its single resolution: findings.json `disposition:"withdrawn"` + a mandatory
// `withdrawn_reason` (findings-model.mjs enforces the pair). It simply had no reach into this surface.
// So: stamp it. No new prose is generated — the reason string is COPIED from the finding. The join is the
// same mark+owner test the pre-delivery lint uses (predelivery-lint.correctionConsistencyChecks); mark
// alone would be far more false-positive-prone here than on the client summary, because audit block titles
// ARE the mark and a run's own cleared mark commonly appears as a title.
// One normalization for every doubt/resolution join, imported — NOT re-implemented — from
// doubt-ledger.mjs (T2c: case/format + diacritics folding must be identical on both sides of every
// join, and a local copy here is exactly how the two matchers would drift apart).
const normJoin = normalizeJoinText;

/**
 * The finding of ANY disposition a block resolves to, or null — the generalization of the withdrawn
 * join (2026-07-22, doubt-stitch): the run's single resolution for a claim lives in findings.json
 * whatever the disposition (off-field, distinguished, …), not only when it is "withdrawn", and the
 * copper-gantry contradiction was exactly a case the old withdrawn-only reach missed (the PROPEL
 * finding was resolved off-field + a monitoring action — nothing stamped the audit blocks). Same
 * join test as before: BOTH the mark and the owner must appear — mark-alone false-trips whenever a
 * finding is named after the mark under search. PURE.
 */
export function resolutionMatchFor(blockTitle, blockOwner, findings) {
  const titleN = normJoin(blockTitle), ownerN = normJoin(blockOwner);
  if (!titleN || !ownerN) return null;
  for (const f of findings ?? []) {
    const markN = normJoin(f?.mark), fOwnerN = normJoin(f?.owner?.name);
    if (!markN || !fOwnerN) continue;
    if (titleN.includes(markN) && ownerN.includes(fOwnerN)) return f;
  }
  return null;
}

/**
 * The withdrawn finding a block resolves to, or null — the original special case, kept as its own
 * export (predelivery-lint documents this exact behavior) and checked FIRST by buildAuditMd so the
 * withdrawn stamp always wins over a generic resolution line. PURE.
 */
export function withdrawnMatchFor(blockTitle, blockOwner, findings) {
  return resolutionMatchFor(blockTitle, blockOwner, (findings ?? []).filter((f) => f?.disposition === "withdrawn"));
}

// ---- build audit.md from the two spine files -------------------------------------------------
/**
 * The parsed Findings blocks alone (register risk-relevant + watchlist annex + common-law finding
 * tables) — exported so the pipeline can mint audit-contradiction doubts (doubt-ledger.mjs
 * mintContradictionDoubts) from the SAME blocks buildAuditMd will render, before calling it. PURE.
 */
export function parseSpineFindingBlocks(registerMd, commonLawMd) {
  const reg = parseTables(registerMd);
  const cl = parseTables(commonLawMd);
  const regFindingRows = tablesUnder(reg, /risk-relevant|watchlist/i).flatMap((t) => t.rows);
  const clFindingRows = cl.filter((t) => t.columns.includes("Finding") || t.columns.includes("Source / Platform"))
    .flatMap((t) => t.rows);
  return [
    ...regFindingRows.map((r) => findingBlock(r, "Register")),
    ...clFindingRows.map((r) => findingBlock(r, "Common-law")),
  ];
}

// # Doubt Ledger line clamp — a birth quote is a whole audit-block pair at worst; the ledger line is a
// pointer, not a transcript.
const clipQuote = (s, n = 140) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// `runFindings` = the run's findings.json findings[] (NOT the spine blocks — the local `findings`
// array is the parsed audit blocks). `doubts` = the pipeline's minted+stitched doubt records
// (doubt-ledger.mjs). `asks` = the pipeline's derived ask records (ask-ledger.mjs, PR-6).
// `readingLog` = the run's band-lookup rows (reading-log.jsonl, PR-8). ALL optional: replay/legacy
// callers omit them and nothing is stamped and no ledger section renders — legacy output stays
// byte-identical. With asks present, doubts + asks render SIDE BY SIDE under
// "# Questions the run asked itself"; doubts alone keep the legacy "# Doubt Ledger" heading.

// item 33 — the common-law search log, derived from the grid's own per-term cells.
//
// Returns null when there is no usable grid, which is the signal to fall back to the prose tables (a
// pre-grid archive has no machine record and saying so is honest). Returns a possibly-EMPTY array when
// the grid parses and holds no cells — an empty machine record is a fact, and quietly re-reading the
// prose there would be the absence-reads-as-coverage shape.
//
// `status` is the cell's own vocabulary: a hit is a result the reader must see listed, a no_hit is the
// negative the log exists to record, and anything else (an errored or skipped cell) says so in the
// Result column rather than vanishing. gaps[] ride as their own rows for the same reason — a query that
// errored is part of what was searched, and leaving it out is how a short log reads as a complete one.
export function gridNegativeRows(gridRaw) {
  if (gridRaw == null) return null;
  let batches;
  try {
    const parsed = typeof gridRaw === "string" ? JSON.parse(gridRaw) : gridRaw;
    batches = Array.isArray(parsed) ? parsed : [parsed];
  } catch { return null; }   // unparseable → no machine record in hand; the prose path is the honest answer
  if (!batches.some((b) => b && Array.isArray(b.cells))) return null;
  const rows = [];
  for (const b of batches) {
    for (const c of (b?.cells ?? [])) {
      if (!c || typeof c.term !== "string" || typeof c.platform !== "string") continue;
      const n = Array.isArray(c.candidates) ? c.candidates.length : 0;
      rows.push({
        source_layer: "Common-law",
        search_term: c.term,
        platform: c.platform,
        result: c.status === "no_hit" ? "No relevant result"
          : c.status === "hit" ? `${n} candidate${n === 1 ? "" : "s"} reviewed`
            : String(c.status ?? "recorded"),
        notes: (Array.isArray(c.candidates) ? c.candidates : []).slice(0, 3)
          .map((x) => x?.url || x?.title).filter(Boolean).join(" ; "),
      });
    }
    for (const g of (b?.gaps ?? [])) {
      // gaps HAS TWO SHAPES and only one used to survive: jx-units.mjs writes the string
      // "<term> | <platform> | <error>", common-law-receipts.mjs writes { term, platform, error }. The
      // object form stringified to "[object Object]", split to one part, and was dropped by the length
      // guard below — so an unrunnable query produced NO row at all rather than a wrong one, which is the
      // same absence-reads-as-success failure one level further back.
      const g2 = (g && typeof g === "object" && !Array.isArray(g))
        ? [g.term, g.platform, g.error ?? g.reason ?? ""].map((x) => String(x ?? "").trim())
        : String(g ?? "").split("|").map((x) => x.trim());
      if (g2.length < 2 || !g2[0] || !g2[1]) continue;
      rows.push({ source_layer: "Common-law", search_term: g2[0], platform: g2[1],
        result: "Could not be searched", notes: g2.slice(2).filter(Boolean).join(" | "),
        // TYPED, not prose. This function already knows which arm a row came from — a cell was
        // executed, a gap was not — and it used to throw that away into a `result` string the audit
        // workbook then tried to recover by regex over an open vocabulary.
        //
        // The key is PRESENT-AND-TRUTHY rather than a `searched: false` boolean, because these rows
        // round-trip through markdown: the serialiser below writes a key only `if (v)`, so a false would
        // never be written, and parse.mjs reads every value back as a STRING, so a true would come back as
        // "true". A truthy marker is the one shape that survives both ends unchanged.
        not_searched: "yes" });
    }
  }
  return rows;
}

/**
 * Records a judgment stage ASKED FOR and never received —.
 *
 * A `band_record` miss is already visible as one `MISS (not-fetched)` line among up to 400 lookups. What
 * was not visible is the COVERAGE FACT: how many documents a judgment stage requested and the run never
 * delivered, which is a different and much smaller number than the raw miss count.
 *
 * MEASURED over 36 preserved runs: 125 failed opens, but only 108 distinct (run, record) pairs, and 66
 * of those recovered on a later open INSIDE THE SAME RUN. 42 is the count where a stage genuinely
 * proceeded without the body it asked for. Reporting 125 overstates the harm roughly threefold, and
 * reporting nothing — which is what happened — understates it completely.
 *
 * So a record counts here only if EVERY open for it failed. One success anywhere in the run clears it:
 * the stage got the document, late, and the earlier miss is a retrieval hiccup rather than a gap in what
 * was read. PURE.
 */
export function recordsNeverDelivered(readingLog) {
  if (!Array.isArray(readingLog)) return null;
  const asked = new Map();   // record_id → { ok: bool, misses: n, reasons: Set, sessions: Set }
  for (const r of readingLog) {
    if (r?.tool !== "band_record") continue;
    const id = r?.args?.record_id;
    if (typeof id !== "string" || !id) continue;
    if (!asked.has(id)) asked.set(id, { ok: false, misses: 0, reasons: new Set(), sessions: new Set() });
    const e = asked.get(id);
    if (r?.ok === false) {
      e.misses++;
      if (r?.reason) e.reasons.add(String(r.reason));
      if (r?.session) e.sessions.add(String(r.session));
    } else e.ok = true;
  }
  return [...asked.entries()]
    .filter(([, e]) => !e.ok && e.misses > 0)
    .map(([record_id, e]) => ({ record_id, misses: e.misses,
      reasons: [...e.reasons].sort(), sessions: [...e.sessions].sort() }))
    .sort((a, b) => b.misses - a.misses || a.record_id.localeCompare(b.record_id));
}

export function buildAuditMd(registerMd, commonLawMd, { findings: runFindings = null, doubts = null, asks = null, readingLog = null, commonLawGrid = null, doubtTruncations = null, registerPresence = null } = {}) {
  const reg = parseTables(registerMd);
  const cl = parseTables(commonLawMd);

  // FINDINGS: register risk-relevant + watchlist annex + common-law finding tables (exclude meta tables).
  const findings = parseSpineFindingBlocks(registerMd, commonLawMd);

  // NEGATIVE RESULTS: the "Negative results" table(s). Tag each row by which spine FILE it came from —
  // the register spine's rows are Register, the common-law spine's rows are Common-law. (The heading-regex
  // tag it used before mislabelled every common-law grid negative "Register", because those tables sit under
  // headings like "Initial Grid Negative Results" that don't say "common".) The common-law grid also names
  // its columns Variant / Platform | Channel / Receipt, so those aliases must be in the get() fallbacks or
  // the whole common-law search log drops out.
  const negBlock = (tables, layer) => tables.flatMap((t) =>
    t.rows.map((r) => ({
      source_layer: r["Source Layer"] || layer,
      search_term: get(r, "Search Term / Variant", "Variant", "Search term", "Finding", "Mark"),
      platform: get(r, "Platform / Source / Provider", "Source / Platform", "Platform", "Channel", "Provider", "Source"),
      result: get(r, "Result"),
      notes: get(r, "Notes", "Receipt"),
    })));
  // item 33 — THE COMMON-LAW SEARCH LOG COMES FROM THE MACHINE RECORD WHEN THERE IS ONE.
  //
  // The common-law half of this list used to be `negBlock(tablesUnder(cl, /negative/i), …)` — a heading
  // regex over the model's prose. already found and disclosed one way that loses rows (the jx lane
  // writes its per-term log under a heading the tagger does not match), and the workbook then reported a
  // search log that was short of what the run actually did. A heading is a presentation choice; the grid
  // is the record.
  //
  // `common-law-grid.json` carries `cells[]` = one deterministic `{term, platform, status, candidates[]}`
  // per query the grid actually ran, tool-written, plus `gaps[]` for the ones that errored. So when the
  // grid is in hand it is the source, and the prose tables are not consulted for negatives at all.
  //
  // WHY THE BUILDER AND NOT audit.md: this function runs on every REPUBLISH, so an already-delivered run
  // gets its search log repaired the next time its workbook is built. Fixing the durable artifact alone
  // would reach nothing that has already shipped.
  //
  // The markdown path stays for runs that genuinely have no grid (pre-grid archives, register-only runs).
  // That is not a fallback masking a defect — those runs have no machine record to read.
  const clNegRows = gridNegativeRows(commonLawGrid);
  const negRows = [
    ...negBlock(tablesUnder(reg, /negative result/i), "Register"),
    ...(clNegRows ?? negBlock(tablesUnder(cl, /negative/i), "Common-law")),
  ];

  // AUDIT TRAIL: the "Audit trail" table(s).
  const auditRows = tablesUnder(reg, /audit trail/i).concat(tablesUnder(cl, /audit trail/i)).flatMap((t) =>
    t.rows.map((r) => ({
      source_layer: get(r, "Source Layer", "Layer") || "Register",
      step: get(r, "Step"),
      query: get(r, "Query / Variant", "Query", "Variant"),
      rationale: get(r, "Rationale"),
      source: get(r, "Source / Provider", "Source", "Provider"),
      result_summary: get(r, "Result Summary", "Result", "Summary"),
      tool_call: get(r, "Tool Call #", "Tool Call", "Call"),
      finding_ref: get(r, "Finding Reference", "Finding Ref", "Ref"),
    })));

  // One resolution per claim, GENERALIZED (2026-07-22, doubt-stitch): a block that joins a findings.json
  // finding of ANY disposition gets the run's own recorded resolution stamped onto it. The withdrawn
  // case keeps its original stamp verbatim (checked FIRST — the reviewer's kill always wins); every
  // other disposition gets a rendered `- resolution:` line naming disposition/band + the finding
  // ordinal. NO prose is generated — every word is copied from the finding. Absent a findings set
  // (replay/legacy callers), this is a no-op.
  let withdrawnStamped = 0, resolutionStamped = 0;
  if (Array.isArray(runFindings)) {
    for (const f of findings) {
      const w = withdrawnMatchFor(f.title, f.owner, runFindings);
      if (w) {
        f.disposition = "withdrawn";
        f.withdrawn_reason = w.withdrawn_reason ?? "withdrawn by the review (no reason recorded)";
        withdrawnStamped++;
        continue;
      }
      const r = resolutionMatchFor(f.title, f.owner, runFindings);
      if (!r?.disposition || r.ordinal == null) continue;   // a legacy finding without a disposition stamps nothing
      f.resolution = `${[r.disposition, r.band].filter(Boolean).join(" / ")} — see finding #${r.ordinal}`;
      resolutionStamped++;
    }

    // Contradiction pairs (doubt-ledger mintContradictionDoubts): where ONE fragment of an asserted⇄
    // refuted pair matches the findings.json read, annotate BOTH blocks naming which fragment the
    // findings record supports — the reader of either fragment sees which one won, on the fragment
    // itself, not three pages away. WHICH side the record supports is the disposition's answer to the
    // existence question the pair disputes: a finding the run resolved off-field or withdrew records
    // "not a live in-field product/conflict" and so supports the REFUTING fragment; any live rated
    // disposition (adversarial / coexistence-partner / distinguished) records a real conflict and
    // supports the ASSERTING fragment. Coarse on purpose — code names the record's side, it never
    // re-argues it (meters/prose stay judgment's).
    for (const d of doubts ?? []) {
      if (d?.birth?.place !== "audit-contradiction" || !d?.subject?.asserted || !d?.subject?.refuting) continue;
      const r = findingJoinFor(d.subject, runFindings);
      if (!r?.disposition || r.ordinal == null) continue;
      const supported = (r.disposition === "off-field" || r.disposition === "withdrawn")
        ? d.subject.refuting : d.subject.asserted;
      const line = `findings.json (finding #${r.ordinal}, ${r.disposition}) supports "${supported}"`;
      for (const b of findings) {
        if (b.title === d.subject.asserted || b.title === d.subject.refuting) b.contradiction_resolution = line;
      }
    }
  }

  let md = "# Findings\n";
  findings.forEach((f) => { md += "\n" + block(f.title, f); });
  md += "\n# Negative Results\n";
  negRows.forEach((n, i) => { md += `\n## NR${i + 1}\n`; for (const [k, v] of Object.entries(n)) if (v) md += `- ${k}: ${v}\n`; });
  md += "\n# Audit Trail\n";
  auditRows.forEach((a, i) => { md += `\n## AT${i + 1}\n`; for (const [k, v] of Object.entries(a)) if (v) md += `- ${k}: ${v}\n`; });

  // Doubt Ledger — purely informational, rendered ONLY when the caller minted doubts (legacy/replay
  // callers see no section at all). One line per doubt: where it was born (quote, clipped), then how
  // it ended. A doubt with no ending ships VISIBLY as OPEN — delivery is never gated on it; the OPEN
  // line IS the disclosure. With an ask ledger present (PR-6) both ledgers render side by side under
  // "# Questions the run asked itself"; doubts alone keep the legacy heading byte-identical.
  let doubtsSettled = 0, doubtsOpen = 0, asksEnded = 0, asksOpen = 0;
  // ── — A TRUNCATED LEDGER SAYS SO, ON THE ARTIFACT THAT OUTLIVES THE RUN ────────────────────
  //
  // The doubt mints are capped (`mintRecordCarryDoubts`, `mintCommonLawCarryDoubts`, max 25) because
  // the unreasoned list is unbounded by construction — a wholly failed digest would drown the ledger.
  // The cap is right and it already reported what it omitted. The report went to `note()`, which
  // writes the RUN LOG, which is purged with the run dir — so on a delivered run a ledger sitting at
  // exactly 25 was indistinguishable from a complete one that happens to hold 25.
  //
  // That is the absence-reads-as-a-pass shape, on the one artifact a reviewing lawyer is pointed at.
  // Measured on delivered run 674db9c7: exactly 25 record-carry doubts, and whether a 26th existed is
  // unanswerable from every surviving artifact.
  //
  // THE COUNT, NEVER A BOOLEAN. "Some were omitted" tells a reader they are missing something and not
  // how much; the number is the difference between a ledger one row short and one showing a third of
  // what the run found.
  //
  // AND NOTHING ON THE COMMON PATH. A run that truncated nothing renders not one extra byte — the
  // rows below only exist when a mint actually dropped something, so this cannot become a line every
  // reader learns to skip.
  //
  // The full list lived in `_driver/`, which is not retained with the report. Pointing a delivered
  // artifact at a purged path would be worse than useless, so the line states the count and says
  // plainly that the remainder is not recoverable from this report.
  const truncationRows = (Array.isArray(doubtTruncations) ? doubtTruncations : [])
    .filter((t) => t && Number(t.omitted) > 0);
  const truncationLines = () => {
    if (!truncationRows.length) return "";
    let out = "";
    for (const t of truncationRows) {
      const src = String(t.source ?? "doubt mint");
      out += `\n- **TRUNCATED — ${src}: ${t.omitted} further unreasoned drop(s) are NOT listed above**`
        + ` (${t.minted} of ${Number(t.minted) + Number(t.omitted)} minted into this ledger).`
        + " The remainder was recorded in the run's own working directory, which is not retained with"
        + " this report — this count is the record of it.\n";
    }
    return out;
  };
  const doubtLines = () => {
    let out = "";
    if (!doubts.length) out += "\n- no doubts recorded this run\n";
    for (const d of doubts) {
      const q = clipQuote(d?.birth?.quote);
      if (d?.status === "checked-and-settled" && d?.ending?.evidence) {
        doubtsSettled++;
        // HOW it settled is part of the disclosure (T2c): a deterministic stitch and a model-cited
        // (code-verified) quote are different evidence classes and the reader must see which one.
        const how = d.ending.by === "doubt-closure-stage" ? "settled — model-cited (verified quote)" : "settled — code-stitch";
        out += `\n- [${d.birth?.place}] "${q}" — ${how} — ${d.ending.evidence.file}: '${clipQuote(d.ending.evidence.quote)}'\n`;
      } else {
        doubtsOpen++;
        out += `\n- [${d?.birth?.place}] "${q}" — OPEN — unanswered at delivery\n`;
      }
    }
    return out;
  };
  if (Array.isArray(asks)) {
    // # Questions the run asked itself — the two ledgers side by side (PR-6). Same posture as the
    // Doubt Ledger: purely informational, OPEN rows are the system disclosing, never a gate.
    md += "\n# Questions the run asked itself\n";
    md += "\nTwo ledgers, one law: every question the run raised to itself ends — executed (computed";
    md += "\nfrom the plan-execution record), judged immaterial (with recorded reasons), or handed over";
    md += "\nloudly. An OPEN row ships visibly with its handoff; delivery is never gated on one.\n";
    md += "\n## Doubt Ledger\n";
    md += Array.isArray(doubts) ? doubtLines() : "\n- doubt stitching unavailable this run\n";
    md += truncationLines();      // — after the rows it qualifies, and only when there are any
    md += "\n## Ask Ledger\n";
    if (!asks.length) md += "\n- no machine asks recorded this run\n";
    for (const a of asks) {
      const t = clipQuote(a?.ask?.text);
      const e = a?.ending;
      if (!e) {
        asksOpen++;
        md += `\n- [${a?.born?.place}] "${t}" — OPEN — ${clipQuote(a?.handoff) || "unanswered at delivery"}\n`;
      } else {
        asksEnded++;
        const detail = e.kind === "executed"
          ? clipQuote(e.evidence)
          : e.kind === "judged-immaterial"
            ? `${(e.reasons ?? []).map((r) => clipQuote(r)).join("; ")}${e.by === "doubt-closure-stage" ? " — model-cited (verified quote)" : ""}`
            : `${(e.reasons ?? []).map((r) => clipQuote(r)).join("; ")}${a?.handoff ? ` — handed over: ${clipQuote(a.handoff)}` : ""}`;
        const label = e.kind === "judged-immaterial" ? "judged immaterial" : e.kind;
        md += `\n- [${a?.born?.place}] "${t}" — ${label} — ${detail}\n`;
      }
    }
  } else if (Array.isArray(doubts)) {
    md += "\n# Doubt Ledger\n";
    md += doubtLines();
    md += truncationLines();      // — the legacy single-ledger form owes the same disclosure
  }

  // # Reading audit (PR-8) — what judgment actually looked up in the register band, from the band
  // tools' _driver/reading-log.jsonl. Rendered whenever the caller passes an ARRAY (a reading-layer
  // run) — an EMPTY log renders the honest zero line, because a band-consuming stage that read nothing
  // is exactly the fact this section exists to show. Legacy/replay callers pass nothing → no section,
  // byte-identical output. Purely informational: never a gate, never a count-guard.
  let readingLookups = 0;
  let neverDelivered = [];
  if (Array.isArray(readingLog)) {
    md += "\n# Reading audit\n";
    readingLookups = readingLog.length;
    if (!readingLog.length) {
      md += "\n- no band lookups recorded this run — no judgment stage read the register band through the band tools\n";
    } else {
      const byTool = {};
      const bySession = {};
      for (const r of readingLog) {
        byTool[r?.tool ?? "unknown"] = (byTool[r?.tool ?? "unknown"] ?? 0) + 1;
        const s = String(r?.session ?? "unattributed");
        bySession[s] = (bySession[s] ?? 0) + 1;
      }
      md += `\n- ${readingLog.length} lookup(s): ${Object.entries(byTool).sort().map(([t, n]) => `${t} ×${n}`).join(", ")}\n`;
      for (const [s, n] of Object.entries(bySession).sort()) md += `- session ${s}: ${n} lookup(s)\n`;
      const CAP = 400;   // the full log stays in _driver/reading-log.jsonl; the audit stays readable
      for (const r of readingLog.slice(0, CAP)) {
        const args = clipQuote(JSON.stringify(r?.args ?? {}), 120);
        // — a MISS carries the CAUSE the band server recorded (not-fetched / unreadable /
        // ambiguous / unparsable-uri), so the audit says whether a document went unread because it was
        // never fetched or because the run could not open one it holds. Older logs have no `reason`
        // and render exactly as before.
        const outcome = r?.ok === false ? `MISS${r?.reason ? ` (${r.reason})` : ""}` : [r?.matched != null ? `matched ${r.matched}` : null, r?.returned != null ? `returned ${r.returned}` : null, r?.bytes != null ? `${r.bytes}B` : null].filter(Boolean).join(", ") || "ok";
        md += `\n- [${r?.tool ?? "?"}] ${args} — ${outcome}${r?.session ? ` (${clipQuote(r.session, 80)})` : ""}\n`;
      }
      if (readingLog.length > CAP) md += `\n- … and ${readingLog.length - CAP} more lookup(s) — the complete log is _driver/reading-log.jsonl\n`;
    }
    // — THE COVERAGE FACT, stated rather than left to be counted off 400 lookup lines. A judgment
    // stage that asked for a document and did not get it read on partial evidence, and until this line
    // existed that fact lived only in a log nothing consults.
    neverDelivered = recordsNeverDelivered(readingLog) ?? [];
    if (neverDelivered.length) {
      md += `\n## Requested and never delivered — ${neverDelivered.length} record(s)\n`;
      md += "\nA judgment stage asked for each of these and the run never produced the body. Every open for "
        + "them failed; a record that failed once and succeeded later is NOT listed, because the stage got "
        + "it. Reasoning that named one of these rested on the band row alone, not on the document.\n";
      for (const n of neverDelivered.slice(0, 40)) {
        md += `\n- \`${clipQuote(n.record_id, 120)}\` — ${n.misses} failed open(s)`
          + `${n.reasons.length ? ` (${n.reasons.join(", ")})` : ""}`
          + `${n.sessions.length ? `, asked by ${n.sessions.map((x) => clipQuote(x, 70)).join(", ")}` : ""}\n`;
      }
      if (neverDelivered.length > 40) md += `\n- … and ${neverDelivered.length - 40} more — the complete log is _driver/reading-log.jsonl\n`;
    } else if (readingLog.length) {
      // THE ZERO IS PRINTED. An absent section reads as "nobody checked"; this says the check ran and
      // found nothing, which is the only form in which a zero here means anything.
      md += "\n- every record a judgment stage asked for was delivered at least once this run\n";
    }
  }

  // # Register Presence — the STORE of every live, matter-in-scope enumerated
  // record, whatever its screen verdict. Storage, not reporting: the client report renders none of
  // this; it exists so a record that ended in no finding, no negative row and no fate is still
  // queryable after the band is purged (65 such records measured on the run that minted the ruling).
  // Rendered whenever the caller derives it (deriveRegisterPresence) — an EMPTY store renders the
  // honest zero. Legacy/replay callers pass nothing → no section, byte-identical output.
  let presenceRows = null;
  if (registerPresence && Array.isArray(registerPresence.rows)) {
    const p = registerPresence;
    presenceRows = p.rows.length;
    const cell = (v) => String(v ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "—";
    md += "\n# Register Presence\n";
    md += "\nEvery enumerated register record that is LIVE and inside the matter's scope, stored for the"
      + "\nrecord whatever its screen verdict — including records that ended in no finding and no negative"
      + "\nrow. Stored, not reported: the client report is unaffected by this section.\n";
    md += `\n- scope territories: ${p.scope?.territories?.length ? p.scope.territories.join(", ") : "none recorded — no territorial restriction applied"}\n`;
    md += `- scope classes: ${p.scope?.classes?.length ? p.scope.classes.join(", ") : "none recorded — no class restriction applied"}\n`;
    if (p.scope?.offices?.length) md += `- offices counted as in scope (incl. EU member nationals under an EU scope, US state registers under a US scope, and WO): ${p.scope.offices.join(", ")}\n`;
    md += `- dominant element: ${p.dominant_element ?? "none comparable"} — the column names HOW a mark carries it (band-shape's own ladder), so both the token and the substring reading stay queryable\n`;
    md += `- rows: ${p.rows.length}\n`;
    if (!p.rows.length) {
      md += "\n- no live in-scope records were enumerated this run\n";
    } else {
      md += "\n| Record | Mark | Office | Classes | Status | Filed | Registered | Owner | Screen verdict | Dominant element |\n";
      md += "|---|---|---|---|---|---|---|---|---|---|\n";
      for (const r of p.rows) {
        md += `| ${cell(r.record_id)} | ${cell(r.mark_text)} | ${cell(r.office)} | ${cell((r.classes ?? []).join(", "))} | ${cell(r.status)} | ${cell(r.application_date)} | ${cell(r.registration_date)} | ${cell(r.owner_name)} | ${cell(r.screen_verdict)} | ${cell(r.dominant_element)} |\n`;
      }
    }
  }

  return { md, counts: { findings: findings.length, negatives: negRows.length, audit: auditRows.length,
    withdrawnStamped, resolutionStamped, doubtsSettled, doubtsOpen, asksEnded, asksOpen, readingLookups,
    // — countable, so the run log and a test can both assert the disclosure happened rather
    // than grepping the rendered markdown for a sentence.
    doubtsOmitted: truncationRows.reduce((n, t) => n + Number(t.omitted), 0),
    // — countable, so run.jsonl and a test can both assert the disclosure happened rather than
    // grepping the rendered markdown for a sentence.
    recordsNeverDelivered: neverDelivered.length,
    // 2067 — null when no store was derived (legacy/replay), a number (0 included) when it was: "the
    // section is absent" and "the section holds zero rows" stay distinguishable by VALUE.
    presenceRows } };
}
