// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// repair-digest.mjs — failure-signature RECURRENCE for the ops digest (read-only).
//
// repairs.mjs computes a stable signature for every failure, and the run-level catch records it in
// the terminal packet, status.json and run.jsonl — but the signatures were log-only: the SAME
// register-plan defect could terminal-fail three runs in a week and the first person to notice was
// a lawyer missing a report. This module scans recent run dirs across every agent workspace (live +
// archive) and aggregates the recorded signatures per stage, so recurrence is a morning ops-digest
// line instead. Pure file reads, no model, no gateway, no writes — the status-snapshot.mjs
// contract; every dependency is injectable so tests run offline against fixture run dirs.
//
// Sources per run (all written by the driver at failure time — nothing new is recorded here), in
// trust order:
//   • _driver/failure.json          — the terminal packet: sig / class / terminalKind verbatim.
//     Written on every run-level terminal since  deleted the send stage whose success used to
//     suppress it. On an ARCHIVED run from before that, absence means the ping went out instead.
//   • .failed sentinel              — written unconditionally at every pipeline terminal with the
//     sig verbatim and the UNTRUNCATED reason. This is the primary fallback: status.json's reason
//     is truncated to 200 RAW chars BEFORE normalization, so a signature recomputed from it
//     diverges from the recorded one whenever the reason is long (e.g. any stack trace) — the same
//     defect would split into separate "single-run" groups and the RECURRING signal would vanish.
//     The runner's self-resume cap writes a sig-less .failed; its untruncated reason still
//     recomputes the true signature.
//   • status.json state:"failed"    — LAST resort when neither packet nor sentinel is readable:
//     the signature is RECOMPUTED from failedStage+reason via the same repairs.mjs helpers. Exact
//     grouping with recorded sigs holds only while the reason survived truncation intact.
//   • status.json recoveryHistory[] — one append-only row per auto-recovery park {sig, stage,
//     class, ts}: a signature that parks across MANY runs is a defect class worth an ops look even
//     when every run recovered. Since  the row also carries `quantityToken` and `classSource`,
//     which is what makes a classifier gap reportable HERE: the pipeline logs one to run.jsonl, and
//     this module never opens that file, so the park row is the only carrier it can read.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { failureSignature, classifyFailureReason, bareStage, REFUSAL_TERMINAL_KIND,
  unnamedStructuredFailure } from "./repairs.mjs";
import { enumerateRuns } from "../mcp-server/lib/runs.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — realpath both sides, or a symlinked invocation exits 0 silently

const DAY_MS = 86400000;

function readJsonDefault(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }

// The failure events one run contributes inside the window. `run` is an enumerateRuns row (status +
// runDir). A torn packet or a malformed history row degrades to less detail — never a throw.
export function failureEventsForRun(run, { sinceMs = 0, readJson = readJsonDefault } = {}) {
  const status = run.status ?? {};
  const events = [];
  const runId = run.runId ?? "?";
  // Terminal failure — keyed on the status STATE, not packet presence: the packet can outlive a
  // manual resume, and a delivered run with a stale packet is not a missing report.
  if ((run.state ?? status.state) === "failed") {
    const ts = Date.parse(status.updatedAt ?? "") || 0;  // a failed run's last status write IS the failure write
    // — A DESIGNED REFUSAL IS NOT A DEFECT CLASS, AND THIS IS THE FAILURE STATISTIC. This module's
    // whole output is "the same signature ended N runs this week, go look at it". A refusal the product
    // is designed to make recurs by design — a free-tier deployment refusing every US-only order recurs
    // once per order — so left in these groups it would out-rank every real defect and read as the most
    // urgent thing in the digest. It is counted and NAMED instead of dropped: an operator must be able
    // to tell "no refusals" from "refusals hidden", which is the same absence-reads-as-a-pass mistake
    // one layer up.
    //
    // Read off `status`, which is ALREADY IN HAND above. The `.failed` sentinel carries the kind too,
    // but reading it here would mean an unreadable sentinel silently defaults a refusal back into the
    // statistics — the zero would take the failure path, which is exactly what this issue is about.
    if (ts >= sinceMs && status.terminalKind === REFUSAL_TERMINAL_KIND) {
      events.push({ kind: "refusal", runId, ts, sig: null, stage: bareStage(status.failedStage), failClass: null,
        terminalKind: REFUSAL_TERMINAL_KIND, sample: String(status.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 160) || null });
    } else if (ts >= sinceMs) {
      const packet = run.runDir ? readJson(driverDir(run.runDir, "failure.json")) : null;
      if (packet?.failureSignature) {
        events.push({
          kind: "terminal", runId, ts, sig: packet.failureSignature, stage: bareStage(packet.failedStage),
          failClass: packet.failClass ?? null, terminalKind: packet.terminalKind ?? null,
          sample: String(packet.reason ?? "").slice(0, 160) || null,
        });
      } else {
        // No usable packet — prefer the .failed sentinel: its sig is verbatim and its reason is
        // UNTRUNCATED, so it always groups with packet-borne and park recordings of the same
        // defect. status.json's reason was cut to 200 raw chars before normalization and only
        // recomputes the true signature for short reasons — keep it strictly as the last resort.
        const marker = run.runDir ? readJson(join(run.runDir, ".failed")) : null;
        const stageSrc = marker?.stage ?? status.failedStage;
        const reasonSrc = marker && "reason" in marker ? marker.reason : status.reason;
        const sig = typeof marker?.sig === "string" && marker.sig
          ? marker.sig
          : failureSignature(stageSrc, reasonSrc).sig;
        events.push({
          kind: "terminal", runId, ts, sig, stage: bareStage(stageSrc),
          failClass: marker?.class ?? classifyFailureReason(reasonSrc),
          terminalKind: marker?.terminalKind ?? null,
          sample: String(reasonSrc ?? "").replace(/\s+/g, " ").trim().slice(0, 160) || null,
        });
      }
    }
  }
  // Auto-recovery parks — history is append-only, so a run that RECOVERED still surfaces the
  // defect class it had to park around.
  for (const row of Array.isArray(status.recoveryHistory) ? status.recoveryHistory : []) {
    const ts = Date.parse(row?.ts ?? "") || 0;
    if (ts < sinceMs || !row?.sig) continue;
    // — did the classifier fail to name a failure the validator had named? Decided by the SAME
    // exported predicate the pipeline decides with, over the fields the park row now carries.
    //
    // `measured` is not decoration. A row written before this field existed has no `classSource` key at
    // all, and running the predicate over it returns false — i.e. "no gap" — which is the absent-reads-
    // as-a-pass mistake this module already refuses to make about refusals one block up. So the two
    // states are kept apart: `classifierGap: null` means NOT MEASURED, `false` means measured and clean.
    const measured = row && typeof row === "object" && "classSource" in row;
    events.push({ kind: "park", runId, ts, sig: row.sig, stage: bareStage(row.stage), failClass: row.class ?? null, terminalKind: null, sample: null,
      classifierGap: measured
        ? unnamedStructuredFailure({ failClass: row.class, classSource: row.classSource, token: row.quantityToken, kind: row.kindToken })
        : null,
      // build A: `kind` is passed HERE TOO, and it has to be. The pipeline has always passed both
      // halves to this predicate and this call passed only the token, so the two ends decided the same
      // question with different inputs. Harmless while every structured reason landed on `reason-text`;
      // fatal once build A routes a validator token to `validator-token`, because then `token` implies
      // NOT-a-gap and this call would have had nothing left that could ever return true. A digest line
      // that cannot fire reads exactly like one with nothing to report.
      //
      // Epoch-safe: a park row written before this carries no `kindToken` key, so `row.kindToken` is
      // undefined, `Boolean(undefined)` is false, and archived rows decide exactly as they did before.
      // The token named in the report falls back the same way, or a fired gap names nothing — which is
      // the "could not name it" defect reappearing inside the instrument built to report it.
      reasonToken: row.quantityToken ?? row.kindToken ?? null });
  }
  return events;
}

// One group per signature over the window: which runs hit it, how many terminals vs parks, and a
// sample reason. Sorted most-recurrent first (run count, then terminals, then recency).
export function aggregateFailureRecurrence({ enumerate = enumerateRuns, now = Date.now(), days = 7, readJson = readJsonDefault } = {}) {
  const nowMs = typeof now === "number" ? now : (Date.parse(now) || Date.now());
  const sinceMs = nowMs - days * DAY_MS;
  const bySig = new Map();
  // — refusals are counted OUT of the groups and reported as their own number. A designed refusal
  // has no signature to group by (nothing recurred; the product answered the same way twice about two
  // different orders), so it never enters bySig — but a count that nobody prints is a diagnostic
  // computed and dropped, which is the class this issue belongs to.
  const refusals = { count: 0, runIds: [], stages: [] };
  // — counted and NAMED, never dropped: 's shape immediately above, for the same reason. A park
  // whose class was "unknown" over a reason a validator had already structured is a gap in the
  // classifier, not an unknowable failure, and the digest is where an operator would ever see it. It is
  // reported BESIDE the groups rather than inside them: it is a fact about how a failure was classified,
  // not a fourth defect class, and the correction is explicit that the taxonomy must not move.
  // `unmeasured` counts park rows written before the fields existed — they carry no verdict either way,
  // and letting them read as clean is the absence-reads-as-a-pass mistake one block up already refuses.
  const classifierGaps = { count: 0, runIds: [], stages: [], tokens: [], unmeasured: 0 };
  for (const run of enumerate()) {
    if (run.status?.retired) continue;  // presentation-retired (e2e noise) is hidden from EVERY surface
    for (const ev of failureEventsForRun(run, { sinceMs, readJson })) {
      if (ev.classifierGap === true) {
        classifierGaps.count++;
        if (!classifierGaps.runIds.includes(ev.runId)) classifierGaps.runIds.push(ev.runId);
        if (ev.stage && !classifierGaps.stages.includes(ev.stage)) classifierGaps.stages.push(ev.stage);
        if (ev.reasonToken && !classifierGaps.tokens.includes(ev.reasonToken)) classifierGaps.tokens.push(ev.reasonToken);
      } else if (ev.kind === "park" && ev.classifierGap === null) {
        classifierGaps.unmeasured++;
      }
      if (ev.kind === "refusal") {
        refusals.count++;
        if (!refusals.runIds.includes(ev.runId)) refusals.runIds.push(ev.runId);
        if (ev.stage && !refusals.stages.includes(ev.stage)) refusals.stages.push(ev.stage);
        continue;
      }
      let g = bySig.get(ev.sig);
      if (!g) bySig.set(ev.sig, g = { sig: ev.sig, stage: ev.stage, failClass: null, terminalKinds: [], sample: null, runIds: [], terminalCount: 0, parkCount: 0, lastTs: 0 });
      if (!g.runIds.includes(ev.runId)) g.runIds.push(ev.runId);
      if (ev.kind === "terminal") {
        g.terminalCount++;
        if (ev.terminalKind && !g.terminalKinds.includes(ev.terminalKind)) g.terminalKinds.push(ev.terminalKind);
        // a terminal event's class outranks a park row's guess, whatever order the runs enumerate in
        if (ev.failClass) g.failClass = ev.failClass;
      } else {
        g.parkCount++;
      }
      if (!g.failClass && ev.failClass) g.failClass = ev.failClass;
      if (!g.sample && ev.sample) g.sample = ev.sample;
      if (ev.ts > g.lastTs) g.lastTs = ev.ts;
    }
  }
  const groups = [...bySig.values()]
    .sort((a, b) => b.runIds.length - a.runIds.length || b.terminalCount - a.terminalCount || b.lastTs - a.lastTs);
  return { days, sinceISO: new Date(sinceMs).toISOString(), groups, refusals, classifierGaps };
}

const MAX_RUNS_LISTED = 8;

// Compact plain text for the digest email. The full sig ("stage|hash12") is printed verbatim so an
// operator can grep it straight out of run.jsonl / status.json.
export function renderFailureRecurrence(agg) {
  const n = (c, w) => `${c} ${w}${c === 1 ? "" : "s"}`;
  // — one line, always, when there were any: the digest states what it left out. `refusals` is
  // absent on an aggregate built before this field existed, and an old aggregate must read as "nothing
  // to say" rather than as "none happened".
  // The run ids ride the line too. Collecting them and printing only the count would be this issue's own
  // class in this issue's own fix: a diagnostic computed and dropped, and "1 refusal happened somewhere"
  // is not something an operator can act on.
  const refusalLine = (agg.refusals?.count ?? 0) > 0
    ? `${n(agg.refusals.count, "designed refusal")} in this window (${agg.refusals.stages.join(", ") || "stage not recorded"}) — the product declining an order it does not serve on this deployment. Not a defect class, not counted below.`
      + `\n    runs: ${agg.refusals.runIds.slice(0, MAX_RUNS_LISTED).join(", ")}${agg.refusals.runIds.length > MAX_RUNS_LISTED ? ` +${agg.refusals.runIds.length - MAX_RUNS_LISTED} more` : ""}`
    : null;
  // — one line, and it says which token the validator had named. "the classifier could not name it"
  // is not actionable; "it could not name connotation_quote_unbound" sends a reader to a regex and a
  // throw site. The unmeasured tail is printed whenever there is one, because a gap count computed over
  // rows that predate the field would otherwise read as a clean window. `classifierGaps` is absent on an
  // aggregate built before this field existed, and that must read as "nothing to say", never as "none".
  const gaps = agg.classifierGaps;
  const gapLine = (gaps?.count ?? 0) > 0 || (gaps?.unmeasured ?? 0) > 0
    ? [
      (gaps.count ?? 0) > 0
        ? `${n(gaps.count, "classifier gap")} in this window (${gaps.stages.join(", ") || "stage not recorded"}) — the recovery classifier returned \`unknown\` over a reason a validator had already named: ${gaps.tokens.join(", ") || "token not recorded"}. The budget is unchanged; the classifier is what wants widening.`
        + `\n  runs: ${gaps.runIds.slice(0, MAX_RUNS_LISTED).join(", ")}${gaps.runIds.length > MAX_RUNS_LISTED ? ` +${gaps.runIds.length - MAX_RUNS_LISTED} more` : ""}`
        : null,
      (gaps.unmeasured ?? 0) > 0
        ? `Not measured: ${n(gaps.unmeasured, "park")} in this window written before the classifier-gap fields existed — absent, not clean.`
        : null,
    ].filter(Boolean).join("\n")
    : null;
  if (!agg.groups.length) {
    return `No prelim failures or auto-recovery parks in the last ${agg.days} days.${refusalLine ? `\n${refusalLine}` : ""}${gapLine ? `\n${gapLine}` : ""}`;
  }
  const head = (g) =>
    `${n(g.runIds.length, "run")}  ${g.sig}  [${g.failClass ?? "?"}]  ` +
    `${n(g.terminalCount, "terminal")}${g.terminalKinds.length ? ` (${g.terminalKinds.join(", ")})` : ""}, ${n(g.parkCount, "park")}`;
  const runsLine = (g) =>
    `    runs: ${g.runIds.slice(0, MAX_RUNS_LISTED).join(", ")}${g.runIds.length > MAX_RUNS_LISTED ? ` +${g.runIds.length - MAX_RUNS_LISTED} more` : ""}`;
  const lines = [`Window: last ${agg.days} days (since ${agg.sinceISO.slice(0, 10)}).`];
  if (refusalLine) lines.push("", refusalLine);
  if (gapLine) lines.push("", gapLine);
  const recurring = agg.groups.filter((g) => g.runIds.length >= 2);
  const single = agg.groups.filter((g) => g.runIds.length < 2);
  if (recurring.length) {
    lines.push("", "RECURRING — same signature across runs (a defect class, not noise):");
    for (const g of recurring) {
      lines.push(`  ${head(g)}`);
      if (g.sample) lines.push(`    reason: ${g.sample}`);
      lines.push(runsLine(g));
    }
  }
  if (single.length) {
    lines.push("", "Single-run signatures:");
    for (const g of single) lines.push(`  ${head(g)} — ${g.runIds[0]}`);
  }
  return lines.join("\n");
}

// CLI: `node repair-digest.mjs [--days N]` — the ops-digest generator (scripts/ops-digest-daily.sh)
// invokes this and pastes the output into its "Prelim Failure Recurrence" section.
if (isEntrypoint(import.meta.url)) {
  const ix = process.argv.indexOf("--days");
  const days = ix >= 0 ? Math.max(1, Number(process.argv[ix + 1]) || 7) : 7;
  console.log(renderFailureRecurrence(aggregateFailureRecurrence({ days })));
}
