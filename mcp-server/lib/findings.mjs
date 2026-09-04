// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/findings.mjs — the structured findings + report-card view of a run.
//
// Primary source = the deterministic audit.md (parseAudit) — the complete, count-guaranteed decision record.
// Backstop = regenerate from the register + common-law spine via buildAuditMd (the EXACT way the driver
// builds audit.md) when audit.md is absent (audit build is non-fatal in the pipeline). Curated grouping
// (on-field / off-field / out-of-scope) lives on the report cards, so we expose those separately. Read-only.

import { existsSync, readFileSync } from "node:fs";
import { parseAudit, parseReport, parseBlocks, parseFront, parseSections, buildAuditMd } from "./driver.mjs";

// id-stamp the three block lists so callers (get_finding / trace) can address a single record.
function idStamp(lists) {
  return {
    findings: (lists.findings ?? []).map((f, i) => ({ id: `F${i + 1}`, ...f })),
    negatives: (lists.negatives ?? []).map((n, i) => ({ id: `NR${i + 1}`, ...n })),
    audit: (lists.audit ?? []).map((a, i) => ({ id: `AT${i + 1}`, ...a })),
  };
}

// The run's own findings.json, or null. — the backstop rebuild needs it to stamp dispositions;
// `null` is the value buildAuditMd already treats as "no findings set", so every failure here lands on
// the behaviour this path had before rather than on an exception. Both shapes are accepted because both
// are on disk: the array form, and the object wrapper whose `findings` key holds it.
function readRunFindings(P) {
  try {
    if (!P?.findings || !existsSync(P.findings)) return null;
    const j = JSON.parse(readFileSync(P.findings, "utf8"));
    if (Array.isArray(j)) return j;
    return Array.isArray(j?.findings) ? j.findings : null;
  } catch { return null; }
}

// parseAudit but over an in-memory string (for the rebuilt-from-spine backstop).
function parseAuditText(md) {
  const { body } = parseFront(md);
  const secs = parseSections(body);
  return {
    findings: parseBlocks(secs["Findings"]),
    negatives: parseBlocks(secs["Negative Results"]),
    audit: parseBlocks(secs["Audit Trail"]),
  };
}

// { findings, negatives, audit, source } — never throws; empty lists + source:"none" if nothing parseable.
export function loadFindings(P) {
  if (existsSync(P.audit)) {
    try { return { ...idStamp(parseAudit(P.audit)), source: "audit.md" }; } catch { /* fall through to backstop */ }
  }
  try {
    const reg = existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "";
    const cl = existsSync(P.commonLaw) ? readFileSync(P.commonLaw, "utf8") : "";
    if (reg || cl) {
      // — THE BACKSTOP GETS THE FINDINGS SET, because without it this rebuild is a DIFFERENT
      // document from the one the driver writes. audit-from-spine.mjs says so in its own words: the
      // resolution and withdrawn stamps are applied only "if (Array.isArray(runFindings))", and
      // "absent a findings set (replay/legacy callers), this is a no-op".
      //
      // So a run whose audit.md was missing came back through here with NO `- disposition: withdrawn`
      // on any block and no resolutions at all — and scrub.mjs's client filter, which reads that stamp,
      // would have had nothing to act on. A filter that is correct and never fires is the shape this
      // whole issue is about.
      //
      // Best-effort by construction: an unreadable or absent findings.json yields undefined, which is
      // exactly the no-op this path already had. It can only add fidelity, never remove it.
      const { md } = buildAuditMd(reg, cl, { findings: readRunFindings(P) });
      return { ...idStamp(parseAuditText(md)), source: "rebuilt-from-spine" };
    }
  } catch { /* fall through */ }
  return { findings: [], negatives: [], audit: [], source: "none" };
}

export function getFinding(P, id) {
  const want = String(id ?? "").toUpperCase();   // ids are stamped uppercase (F1/NR1/AT1); accept any case
  const all = loadFindings(P);
  return [...all.findings, ...all.negatives, ...all.audit].find((x) => x.id === want) ?? null;
}

// Filter the audit findings by kind + source layer (group is a report-card property — see loadCards).
export function filterFindings(P, { kind, sourceLayer } = {}) {
  const all = loadFindings(P);
  let list = kind === "negatives" ? all.negatives : kind === "audit" ? all.audit : all.findings;
  if (sourceLayer) list = list.filter((f) => String(f.source_layer ?? "").toLowerCase() === sourceLayer.toLowerCase());
  return { source: all.source, kind: kind ?? "findings", items: list };
}

// The curated client-report cards: group (on-field/off-field/out-of-scope) + the read + the source URL.
export function loadCards(P) {
  if (!existsSync(P.report)) return { fm: {}, cards: [], note: "report.md not present" };
  try {
    const { fm, cards } = parseReport(P.report);
    return {
      fm,
      cards: cards.map((c) => ({
        who: c.who,
        group: c.meta?.group ?? null,
        tier: c.meta?.tier ?? null,
        label: c.meta?.label ?? null,
        // — report.md's per-finding sentence is now STAMPED by the driver as `- net:` from the typed
        // findings.json field; the authored `- one:` line is retired. Both keys are read, newest first, so
        // this projection answers for a fresh run AND for every archived one (which has only `one:`).
        // Reading `one` alone would have returned null for every card on every run from forward —
        // a delivered MCP surface going quiet with no error, which is the failure this issue exists to end.
        one: c.meta?.net ?? c.meta?.one ?? null,
        open: c.meta?.open ?? null,
        // `### The read` is retired with the same ruling (it was a third condensation of the finding the
        // line above already summarises), so this is null on a fresh run BY DESIGN and carries the section
        // for archived runs. Kept rather than dropped: an archived card's read is still real content.
        read: c.blocks?.find((b) => /read/i.test(b.label))?.body ?? null,
        fullDetail: c.blocks?.find((b) => /detail/i.test(b.label))?.body ?? null,
      })),
    };
  } catch (e) {
    return { fm: {}, cards: [], note: `report.md parse failed: ${e.message}` };
  }
}
