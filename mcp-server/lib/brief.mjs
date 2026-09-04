// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/brief.mjs — ONE plain-markdown briefing string for a run: the answer to "what do you have on X?".
//
// SOURCED FROM report-data.json, the client data surface BOTH lanes publish beside the report
// (publish/report-data.mjs for a clearance, publish/render-knockout.mjs for a knockout). That file exists
// for exactly this reader: every free string in it has already been through the driver's own client scrub
// chain at source, so nothing is re-scrubbed, re-worded or re-filtered here. A second copy of "what is
// client-safe" is the drift scrub.mjs's header forbids.
//
// It used to build primarily from client-summary.md, whose producing STAGE was retired 2026-08-01. No new
// run has that document, so the primary path was dead and every brief silently took the report-card
// fallback. That fallback survives — for archived runs published before report-data.json existed — and it
// now says so in the brief instead of being indistinguishable from the real thing. The client-summary
// branch is deleted, and with it the `**Recommendation:** …` line that only it emitted: the deliverable
// carries prioritized facts and never advice (owner ruling 2026-07-28) — the recipient is a lawyer who
// layers advice on top. The line is gone by construction, not suppressed.
//
// THE PRODUCT NAME IS DERIVED, NEVER STORED AND NEVER HARDCODED. Every run used to announce itself as
// "preliminary trademark clearance" whatever it was, so a Knockout search, a Multi-country focus search
// and a Full country search all claimed to be the same product. The name now comes from the registry
// resolver (runs.mjs productIdentityFor → reportIdentityFor), and a run the registry cannot name prints
// no product name at all rather than a guess.
//
// WHAT A DELIVERED RUN WITH NOTHING READABLE SAYS. The "may still be in flight" line is gated on the run's
// STATE, not on file presence. A knockout writes its report to the pool and never into the run dir, so a
// file-presence test told a client their delivered knockout might still be running. And a brief that
// printed no conflicts because a file was absent would read as a clean search — the worst answer this tool
// can give. An absence is reported as an absence. Read-only.

import { existsSync, readFileSync } from "node:fs";
import { parseReport } from "./driver.mjs";
import { readReportData, productIdentityFor } from "./runs.mjs";

// Drop internal-only context (::p:: marker) and the leading risk-formula clause ("Level N Risk = … →").
// APPLIED ONLY TO report.md-DERIVED TEXT (the archived-run fallback below). Strings out of report-data.json
// do not pass through here: they are the client cut already, and running them through a second transform
// is how two surfaces come to disagree about the same sentence.
function plainClause(s) {
  let t = String(s ?? "").replace(/::p::[\s\S]*$/i, "").trim();
  const i = t.indexOf("→");
  if (i >= 0 && /level\s*\d/i.test(t.slice(0, i))) t = t.slice(i + 1).trim();
  return t;
}

const titleCase = (w) => (w ? w.charAt(0) + w.slice(1).toLowerCase() : w);

// One clearance finding → one line. NO SECOND FILTER: report-data.json already carries only the live
// findings (a withdrawn one is not in the file), so the brief's conflicts and the report's findings are
// one for one. The old report-card path dropped `group: out-of-scope` cards and therefore briefed a
// shorter list than the document the client was holding.
function clearanceLine(f) {
  const who = [f.mark, f.owner?.name].filter(Boolean).join(" — ") || "(unnamed finding)";
  const band = f.band ? ` — ${titleCase(String(f.band))} risk.` : "";
  return `- **${who}**${band}${f.net ? ` ${f.net}` : ""}`.trimEnd();
}

/**
 * buildBrief(run) — run = the resolved Run ({ runId, P, poolDir, status, markName, verdict, state, date }).
 * Returns { runId, markName, product, overall, verdict, state, date, source, brief }.
 * `source` is one of: report-data | report-cards | unavailable | none — so a caller can always tell which
 * path answered, and `product` is null when the registry cannot name the run's product.
 * Never throws.
 */
export function buildBrief(run) {
  const { P } = run;
  const fm = existsSync(P.report) ? parseReport(P.report).fm : {};
  const docs = readReportData(run);
  const product = productIdentityFor(run, docs);
  const clearance = docs.find((d) => d?.kind === "clearance") ?? null;
  // The knockout shape carries no `kind` at all and is told apart by `marks[]` — the same discrimination
  // portal-service.mjs makes. Both lanes stamp `schema: 'report-data/1'`, so the schema string cannot.
  const koDocs = docs.filter((d) => d?.kind !== "clearance" && Array.isArray(d?.marks));
  const delivered = run.state === "delivered" || Boolean(run.deliveredAt);
  const lines = [];

  const overall = clearance?.verdict?.band ?? clearance?.verdict?.verdict
    ?? (koDocs.length === 1 ? (koDocs[0].overall ?? null) : null)
    ?? fm.overall_label ?? run.verdict ?? null;

  // headline — the mark, the product THIS run actually is, and the run date. A null product prints
  // nothing rather than a fallback name.
  // The data file's own name is in the chain before the runId because a knockout run dir holds no
  // report.md — `fm` is empty there, so nothing else could rescue a run whose status.json predates
  // markName, and a client would be briefed on a run-id string instead of their mark.
  const subject = run.markName ?? clearance?.markName ?? fm.title
    ?? koDocs[0]?.marks?.[0]?.name ?? run.runId;
  const dateStr = run.date ?? fm.run ?? null;
  const tail = [product, dateStr ? `run ${dateStr}` : null].filter(Boolean).join(", ");
  lines.push(`**${subject}**${tail ? ` — ${tail}` : ""}.`);

  const caption = clearance
    ? (clearance.verdict?.statement ?? clearance.caption ?? "")
    : plainClause(fm.overall_caption ?? "");
  if (overall) lines.push(`**Overall risk: ${titleCase(String(overall))}.** ${caption}`.trim());
  if (run.state) {
    // a park is paused, not finished — say so plainly, and name the clock only where one exists
    // (rate-limit resetsAt; a recovery park backs off on recoveryResumesAt; a grace-exit park waits
    // for the next runner activation).
    const paused = run.state === "postponed" ? ` — paused on a usage-limit cap, auto-resumes ${run.resetsAt ? `at ${String(run.resetsAt).replace("T", " ").slice(0, 16)} UTC` : "when the cap resets"}`
      : run.state === "recovering" ? ` — auto-recovery backoff, resumes ${run.recoveryResumesAt ? `at ${String(run.recoveryResumesAt).replace("T", " ").slice(0, 16)} UTC` : "on its own"}`
      : run.state === "parked-for-human" ? ` — parked by a runner stop (deploy/restart), resumes on the next runner activation` : "";
    lines.push(`Status: ${run.state}${paused}${run.verdict ? ` (reviewer verdict: ${run.verdict})` : ""}.`);
  }

  let source = "none";
  if (clearance) {
    source = "report-data";
    if (clearance.findings?.length) {
      lines.push("", "**The conflicts that matter:**");
      for (const f of clearance.findings) lines.push(clearanceLine(f));
    } else {
      lines.push("", "No conflicts are recorded on this run.");
    }
    // Conditions gate a clean result; advisories never do, so only the conditions ride the briefing.
    const conditions = [
      ...(clearance.verdict?.conditions ?? []),
      ...(clearance.actions?.conditions ?? []).map((a) => a?.text),
    ].filter(Boolean);
    if (conditions.length) {
      lines.push("", "**Conditions on that result:**");
      for (const c of conditions) lines.push(`- ${c}`);
    }
    if (clearance.url) lines.push("", `Report: ${clearance.url}`);
  } else if (koDocs.length) {
    source = "report-data";
    // A batch writes one file per name, each with that name's own band and its own report link — so the
    // link belongs on the mark line, not on the run.
    const summary = koDocs.map((d) => d.summary).find(Boolean);
    if (summary) lines.push("", summary);
    lines.push("", "**Each name screened:**");
    for (const d of koDocs) {
      for (const m of (d.marks ?? [])) {
        const band = m.band ? `${titleCase(String(m.band))}${m.qualifier ? ` (${m.qualifier})` : ""}` : "unrated";
        lines.push(`- **${m.name}** — ${band}.${d.url ? ` Report: ${d.url}` : ""}`);
        for (const f of (m.findings ?? [])) {
          const who = [f.name, f.owner].filter(Boolean).join(" — ");
          lines.push(`  - ${who}${f.net ? `: ${f.net}` : ""}`.trimEnd());
        }
      }
    }
    const caveats = [...new Set(koDocs.flatMap((d) => d.caveats ?? []).filter(Boolean))];
    if (caveats.length) {
      lines.push("", "**Scope of this screen:**");
      for (const c of caveats) lines.push(`- ${c}`);
    }
  } else if (existsSync(P.report)) {
    // ARCHIVED-RUN FALLBACK — runs published before report-data.json existed, and runs whose data file
    // failed to write (publish stamps meta.reportSchema only on a successful write). Named in the brief:
    // a reader must be able to tell a full answer from a reconstructed one.
    source = "report-cards";
    lines.push("", "_No published data file for this run — the lines below are read from the report document itself._");
    const { cards } = parseReport(P.report);
    const main = cards.filter((c) => (c.meta.group ?? "") !== "out-of-scope");
    if (main.length) {
      lines.push("", "**The conflicts that matter:**");
      // item 9a — prefer the TYPED net from findings.json over the `- one:` line parsed out of the
      // card markdown. Same sentence, one author: the brief and the report card were separately
      // summarising the same finding, which is how two surfaces come to disagree about it. The parsed
      // line stays as the fallback for archived runs, whose findings carry no `net`.
      const netByOrd = new Map();
      try {
        const doc = JSON.parse(readFileSync(P.findings, "utf8"));
        for (const f of (doc?.findings ?? [])) if (f?.net) netByOrd.set(String(f.ordinal), String(f.net));
      } catch { /* no findings.json on this run — the card line stands */ }
      for (const c of main)
        lines.push(`- **${c.who}** — ${plainClause(netByOrd.get(String(c.meta.ord)) ?? c.meta.one ?? "")}`.trim());
    }
  } else if (delivered) {
    // AN ABSENCE, SAID OUT LOUD. This run is finished, so "it may still be in flight" would be a lie and
    // silence would read as a search that found nothing. Neither is available here.
    source = "unavailable";
    lines.push("",
      "**This run is delivered, but none of its published output can be read from here.** No data file "
      + `(report-data.json) was found in its delivery directory and no report document is in its run directory. `
      + "This is a missing file, NOT a search that found no conflicts — do not brief it as a clean result. "
      + "The delivered report itself is unaffected; ask an operator to check the run's published output.");
  } else {
    source = "none";
    lines.push("", "No published report is on disk for this run yet — it may still be in flight. get_coverage shows what has been produced so far.");
  }

  return {
    runId: run.runId, markName: run.markName ?? clearance?.markName ?? fm.title ?? null,
    product,
    overall, verdict: run.verdict ?? null, state: run.state ?? null, date: run.date ?? null,
    source, brief: lines.join("\n"),
  };
}
