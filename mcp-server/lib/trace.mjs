// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/trace.mjs — the "how did you reach Y" provenance walk over the FULL logic flow.
//
// Starts from any target (a stage, an artifact, a finding id, or the verdict) and walks the recorded decision
// chain in both directions: which stage emitted it (and whether a failover occurred), from which inputs (with
// the sha each input had WHEN consumed vs now), the per-search audit-trail rationale, the search terms +
// record URL, the skeptic escalations, and the refutation verdict that gated delivery.
// Model identity is confined to get_telemetry — trace is a narrative surface and carries the failover FACT only.
//
// Provenance comes from the SELF-DESCRIBING _driver/run.jsonl (each `stage` event records its own
// inputs:[{name,sha}] → output) — so it reflects what ACTUALLY ran (fan-out axes, fallbacks, corrective
// re-synthesis). The static stageInputs() DAG is only a cross-check. Read-only.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { STAGES, STAGE_ORDER, stageInputs, stageOrdinal, REGISTER_AXES, fileMeta, parseVerdict } from "./driver.mjs";
import { loadFindings } from "./findings.mjs";
import { providerUsage } from "./usage.mjs";
import { readEvents } from "./events.mjs";

// The live provider-usage tally reads the shared Corsearch ledger; wrap it so a slow/unreadable ledger
// degrades the (enrichment-only) field instead of failing the whole trace. Shallow mode skips it entirely.
function safeProviderUsage(run) {
  try { return providerUsage(run).live; }
  catch (e) { return { error: `provider-usage tally failed: ${e.message}` }; }
}

// basename → { name (canonical key, possibly "registerUnit:<axis>"), path }
function artifactByBasename(P) {
  const map = {};
  for (const [k, v] of Object.entries(P)) {
    if (k === "runDir" || typeof v === "function") continue;
    map[basename(v)] = { name: k, path: v };
  }
  for (const ax of REGISTER_AXES) { const p = P.registerUnit(ax); map[basename(p)] = { name: `registerUnit:${ax}`, path: p }; }
  return map;
}

// output-file basename → stage label (handles the register-unit axis fan-out)
function stageByOutputBasename(P, axes) {
  const map = {};
  for (const [name, def] of Object.entries(STAGES)) {
    if (!def.out) continue;
    if (name === "register-unit") {
      try { for (const ax of (axes ?? REGISTER_AXES)) map[basename(def.out(P, ax))] = `register-unit:${ax}`; } catch { /* skip */ }
    } else {
      try { map[basename(def.out(P))] = name; } catch { /* skip */ }
    }
  }
  return map;
}

// The winning (latest ok / skip) stage event for a label.
function stageEvent(events, label) {
  const evs = events.filter((e) => (e.event === "stage" || e.event === "skip") && e.stage === label);
  return [...evs].reverse().find((e) => e.event === "skip" || e.ok === true) ?? evs[evs.length - 1] ?? null;
}

function bareStage(label) { return String(label ?? "").split(":")[0]; }

// audit-trail rows plausibly tied to a finding (best-effort; the full list is always available separately).
function relatedAuditRows(auditRows, finding) {
  if (!finding) return [];
  const low = (s) => String(s ?? "").toLowerCase();
  const title = low(finding._title), owner = low(finding.owner);
  const terms = low(finding.search_terms).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const titleHead = title.split(/[ ,—-]/)[0];
  return auditRows.filter((r) => {
    const ref = low(r.finding_ref), q = low(r.query);
    if (ref && (title.includes(ref) || (titleHead && ref.includes(titleHead)))) return true;
    if (owner && (ref.includes(owner) || q.includes(owner))) return true;
    return terms.some((t) => t && (q.includes(t) || ref.includes(t)));
  });
}

// Resolve a free-form target → { kind, stageLabel, finding?, artifact? }.
function resolveTarget(run, target, ctx) {
  const t = String(target ?? "").trim();
  const { P, axes, findings } = ctx;
  if (!t || /^verdict$/i.test(t)) return { kind: "verdict", stageLabel: "narrative-refutation" };

  // a stage (bare or with :axis)
  if (STAGES[bareStage(t)]) return { kind: "stage", stageLabel: t };

  // a finding id — if the format matches but the id is absent, say so (don't fall through to a fuzzy match)
  if (/^(F|NR|AT)\d+$/i.test(t)) {
    const id = t.toUpperCase();
    const f = [...findings.findings, ...findings.negatives, ...findings.audit].find((x) => x.id === id);
    if (f) {
      const sl = String(f.source_layer ?? "").toLowerCase();
      const stageLabel = sl.includes("common") ? "common-law" : "register-digest";
      return { kind: "finding", stageLabel, finding: f };
    }
    return { kind: "unknown", stageLabel: null };
  }

  // an artifact canonical name (e.g. "report", "narrative", "registerFindings") or a basename ("report.md")
  const byBase = artifactByBasename(P);
  const byStageOut = stageByOutputBasename(P, axes);
  const asKey = P[t] && typeof P[t] !== "function" ? basename(P[t]) : null;
  const bn = asKey ?? (byBase[t] ? t : (byBase[`${t}.md`] ? `${t}.md` : null));
  if (bn && byStageOut[bn]) return { kind: "artifact", stageLabel: byStageOut[bn], artifact: byBase[bn]?.name ?? bn };
  if (bn) return { kind: "artifact", stageLabel: bn === "audit.md" ? "register-digest" : null, artifact: byBase[bn]?.name ?? bn, codeBuilt: bn === "audit.md" || bn === "email-body.md" };

  // fuzzy: a finding whose title/owner contains the query
  const low = t.toLowerCase();
  const hit = findings.findings.find((f) => String(f._title ?? "").toLowerCase().includes(low) || String(f.owner ?? "").toLowerCase().includes(low));
  if (hit) {
    const sl = String(hit.source_layer ?? "").toLowerCase();
    return { kind: "finding", stageLabel: sl.includes("common") ? "common-law" : "register-digest", finding: hit, fuzzy: true };
  }
  return { kind: "unknown", stageLabel: null };
}

// Build the node for one stage label, recursing into its inputs (depth-limited; visited-guarded).
function stageNode(label, ctx, depth, visited) {
  const { events, P, axes, byBase } = ctx;
  if (!label || visited.has(label)) return { stage: label, note: visited.has(label) ? "(already shown above)" : "(no stage)" };
  visited.add(label);
  const ev = stageEvent(events, label);
  const def = STAGES[bareStage(label)];
  const failover = events.find((e) => e.event === "failover" && e.stage === label);

  // inputs: prefer the recorded run.jsonl inputs[]; cross-check the static DAG.
  const recorded = ev?.inputs ?? null;
  const axis = label.includes(":") ? label.split(":")[1] : null;
  const staticInputs = def ? stageInputs(bareStage(label), P, { axes, axis }).map((p) => basename(p)) : [];
  const inputs = (recorded ?? []).map((inp) => {
    const art = byBase[inp.name];
    const current = art ? fileMeta(art.path) : null;
    return {
      name: inp.name,
      consumedSha: inp.sha, currentSha: current?.sha ?? null,
      changedSince: current && inp.sha ? current.sha !== inp.sha : null,
      emittedBy: art ? undefined : "(unmapped)",
      art,
    };
  });
  const recordedNames = inputs.map((i) => i.name);
  const daMismatch = staticInputs.filter((n) => !recordedNames.includes(n));

  const node = {
    stage: label,
    trigger: ev?.trigger ?? (ev?.event === "skip" ? "skip" : null),
    ok: ev?.ok ?? (ev?.event === "skip" ? true : null),
    attempts: ev?.attempts ?? null,
    fail: ev?.fail ?? null,
    summary: ev?.summary ?? null,
    output: ev?.output ?? null,
    failover: failover ? { occurred: true, attempt: failover.attempt ?? null } : null,
    inputs: inputs.map(({ art, ...rest }) => rest),
  };
  if (daMismatch.length) node.staticDagNote = `static stageInputs lists [${daMismatch.join(", ")}] not present in the recorded inputs (the run may have run a different axis set, or the static DAG drifted).`;

  // recurse upstream
  if (depth > 0) {
    node.upstream = inputs
      .filter((i) => i.art)
      .map((i) => {
        const childLabel = stageForArtifact(i.art.name, ctx);
        return childLabel ? stageNode(childLabel, ctx, depth - 1, visited) : { artifact: i.name, note: "(source stage not identified — e.g. deterministic/code-built)" };
      });
  }
  return node;
}

// which stage emitted an artifact (canonical name, possibly "registerUnit:<axis>")
function stageForArtifact(name, ctx) {
  if (String(name).startsWith("registerUnit:")) return `register-unit:${name.split(":")[1]}`;
  const map = stageByOutputBasename(ctx.P, ctx.axes);
  const bn = ctx.P[name] ? basename(ctx.P[name]) : null;
  return bn ? (map[bn] ?? null) : null;
}

function rawEnvelopeAvailable(runDir, label) {
  try {
    const files = readdirSync(driverDir(runDir));
    const stem = label.replace(":", "-"); // attempt files use the label form written by the gateway
    return files.some((f) => (f.startsWith(`${label}.attempt`) || f.startsWith(`${stem}.attempt`)) && f.endsWith(".rawjson.json"));
  } catch { return false; }
}

/**
 * trace(run, target, opts) — run = the resolved Run ({ runId, slug, codename, runDir, P, status }).
 * target = a stage | artifact name/basename | finding id (F#/NR#/AT#) | "verdict" | a fuzzy owner/mark string.
 */
export function trace(run, target, { depth = 2, shallow = false } = {}) {
  const P = run.P;
  const events = readEvents(run.runDir);
  const axesEvent = events.find((e) => e.event === "axes");
  const axes = axesEvent?.axes ?? REGISTER_AXES;

  // Shallow = fast skeleton: skip the two enrichments a deep trace pays for — the findings load (which may
  // rebuild the audit from the register/common-law spine) and the live provider-usage tally. Findings are
  // still loaded LAZILY iff the target turns out to need them (a finding id / fuzzy owner-mark).
  const emptyFindings = { findings: [], negatives: [], audit: [], source: "skipped (shallow)" };
  let findings = shallow ? emptyFindings : loadFindings(P);
  let ctx = { events, P, axes, findings, byBase: artifactByBasename(P) };

  let resolved = resolveTarget(run, target, ctx);
  if (shallow && resolved.kind === "unknown" && String(target ?? "").trim() && !/^verdict$/i.test(String(target))) {
    findings = loadFindings(P);                       // a finding/fuzzy target needs them after all
    ctx = { events, P, axes, findings, byBase: artifactByBasename(P) };
    resolved = resolveTarget(run, target, ctx);
  }
  if (resolved.kind === "unknown") {
    return {
      runId: run.runId, target,
      error: `Could not resolve target "${target}". Try a stage (${STAGE_ORDER.join(", ")}), an artifact (report, audit, narrative, registerFindings, commonLaw, placement, …), a finding id (F1, NR1, AT1), or "verdict".`,
    };
  }

  // judgment leaf (verdict + escalations + open-questions) — the decision moments a plain file read misses.
  const verdictEvents = events.filter((e) => e.event === "verdict" || e.event === "verdict-2");
  const verdict = verdictEvents.length ? verdictEvents[verdictEvents.length - 1].verdict
    : (existsSync(P.seniorEyeReview) ? parseVerdict(readFileSync(P.seniorEyeReview, "utf8")) : null);
  const escalated = events.filter((e) => e.event === "skeptic-escalation").flatMap((e) => e.escalated ?? []);
  const openQuestions = events.some((e) => e.event === "delivered-with-open-questions");

  const visited = new Set();
  const node = stageNode(resolved.stageLabel, ctx, depth, visited);

  const out = {
    runId: run.runId,
    target,
    mode: shallow ? "shallow" : "full",
    resolvedAs: { kind: resolved.kind, stage: resolved.stageLabel, fuzzy: resolved.fuzzy ?? false, codeBuilt: resolved.codeBuilt ?? false },
    emittingStage: node,
    judgment: { verdict, refutationFile: "senior-eye-review.md", skepticEscalated: [...new Set(escalated)], deliveredWithOpenQuestions: openQuestions },
    providerUsage: shallow ? "(skipped in shallow mode — call get_provider_usage for billed counts)" : safeProviderUsage(run),
    rawEnvelopeAvailable: rawEnvelopeAvailable(run.runDir, resolved.stageLabel),
    findingsSource: findings.source,
  };

  if (resolved.kind === "finding" && resolved.finding) {
    const f = resolved.finding;
    out.finding = f;
    out.searchTerms = f.search_terms ?? null;
    out.record = f.url ? { url: f.url, source: f.source ?? null } : null;
    out.auditTrail = relatedAuditRows(findings.audit, f);
    out.auditTrailNote = "Best-effort match of audit-trail rows to this finding; the full audit trail is available via list_findings(kind:'audit').";
  } else if (resolved.kind === "verdict") {
    out.note = "The verdict gates delivery: the refutation reviewer reads narrative + the source files and writes CLEAR / CONDITIONAL / BLOCKING. A non-CLEAR verdict triggers a corrective re-synthesis; unresolved concerns are surfaced to Alex (never withheld).";
  }
  return out;
}
