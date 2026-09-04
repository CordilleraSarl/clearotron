// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// WHICH RULEBOOK DID THIS REPORT ACTUALLY FOLLOW?
//
// The methodology a run rates under — the customer's risk framework and its worked examples, the synthesis
// rules, the delivery contract, the sector doctrine — is prose in the config store, read fresh from disk at
// every stage spawn. gateway.mjs re-derives the resolver on every dispatch and nothing memoises, by design:
// the framework manifest deliberately carries "vocabulary and order ONLY … never a mapping table, threshold,
// or decision rule — those live in the deck prose, where the model reasons with them".
//
// That design is not in question here. Its consequence is: edit a framework at 2pm while a search is
// running and the stages before 2pm rated under one rulebook and the stages after under another. One
// report, two methodologies, and nothing anywhere recording that it happened.
//
// A per-run FREEZE would prevent it, and was declined (D7) — for good reasons: it fights the live-prose
// rule and it would stop a methodology CORRECTION reaching a run parked overnight. So this does not freeze,
// pin, or gate anything. It writes down what each stage read. The run still does exactly what it did
// before; afterwards, the question "which rulebook rated this?" has an answer.
//
// THE SILENT CASE, which is the sharper one. `config.resolveSkillPath` returns the BASE path when the
// overlay does not hold the file — correct and deliberate, it is what makes the overlay opt-in per file.
// But it means DELETING an overlay file mid-run silently swaps a customer's own framework for the house
// default, between one stage and the next, with nothing in any log at all. That is a rating change nobody
// asked for and nobody can see. It gets a line.
//
// EXPLICITLY NOT wired into stageInputs (stages.mjs). That map drives the delivery freshness gate, and a
// methodology file in it would make an ordinary edit KILL runs — the same deadlock the registry
// auto-corrector just had to be dug out of. Recording and gating are different jobs; this is the first one.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { basename } from "node:path";
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";   // — one definition of where `_driver/` is

export const WITNESS_FILE = "methodology-read.json";

// The same pattern the engines use to find refs in a prompt (engine/common.mjs SKILL_REF). Duplicated
// rather than imported because this module must not depend on an engine adapter — it observes what the
// prompt asked for, which is upstream of whichever engine ends up running it.
const SKILL_REF = /(?<![\w/.])skills\/[A-Za-z0-9._/-]+\.md/g;

const sha = (p) => { try { return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12); } catch { return null; } };

/** The `skills/…md` references a stage prompt actually carries, deduped, in first-appearance order. */
export function skillRefsIn(message) {
  return [...new Set(String(message ?? "").match(SKILL_REF) ?? [])];
}

/**
 * Record what this stage read, and report anything that MOVED since an earlier stage read the same
 * document.
 *
 * Returns the drift rows rather than logging them itself — the caller owns the run's note()/runLog, and a
 * module that reaches for a logger is a module that cannot be tested without one.
 *
 * Never throws. A witness that can break a run is worse than no witness: this exists to make a rating
 * change visible, and a run dying because the bookkeeping failed would be a strictly worse outcome than
 * the invisibility it is fixing.
 */
export function witnessStageMethodology(runDir, stage, message, resolveSkill) {
  const out = { drift: [], fellBackToBase: [], recorded: 0 };
  try {
    const refs = skillRefsIn(message);
    if (!refs.length || !runDir) return out;

    const path = driverDir(runDir, WITNESS_FILE);
    let doc = { schema: 1, stages: {} };
    if (existsSync(path)) { try { doc = JSON.parse(readFileSync(path, "utf8")) || doc; } catch { /* unreadable ⇒ start clean */ } }
    doc.stages ||= {};

    const seen = [];
    for (const ref of refs) {
      let abs = null;
      try { abs = resolveSkill ? resolveSkill(ref) : null; } catch { abs = null; }
      if (!abs) continue;
      const row = { ref, path: abs, sha: sha(abs) };
      // The overlay→base fall-through. `ref` ends in the same basename under either root, so a resolved
      // path that does NOT sit under the overlay means the customer's copy was not there.
      if (!String(abs).includes("/skills/") || basename(abs) !== basename(ref)) row.resolvedOddly = true;
      seen.push(row);

      // Compare against the most recent EARLIER reading of the same ref.
      for (const [prevStage, prevRows] of Object.entries(doc.stages)) {
        if (prevStage === stage) continue;
        const prev = (Array.isArray(prevRows) ? prevRows : []).find((r) => r.ref === ref);
        if (!prev || prev.sha == null || row.sha == null) continue;
        if (prev.sha !== row.sha && !out.drift.some((d) => d.ref === ref))
          out.drift.push({ ref, from: prev.sha, to: row.sha, firstReadBy: prevStage, nowReadBy: stage });
        if (prev.path !== row.path && !out.fellBackToBase.some((d) => d.ref === ref))
          out.fellBackToBase.push({ ref, from: prev.path, to: row.path, firstReadBy: prevStage, nowReadBy: stage });
      }
    }
    if (!seen.length) return out;

    doc.stages[stage] = seen;
    out.recorded = seen.length;
    ensureDriverDir(runDir);
    writeFileSync(`${path}.tmp`, JSON.stringify(doc, null, 2) + "\n");
    renameSync(`${path}.tmp`, path);   // atomic: a torn witness must never look like drift
  } catch { /* never fatal — see the docblock */ }
  return out;
}

/** Human-readable lines for the run log. Empty when nothing moved, which is the normal case. */
export function describeMethodologyDrift({ drift = [], fellBackToBase = [] } = {}) {
  const lines = [];
  for (const d of drift)
    lines.push(`methodology changed mid-run: ${d.ref} was ${d.from} when ${d.firstReadBy} read it, ${d.to} when ${d.nowReadBy} did — this report followed two versions of that document`);
  for (const d of fellBackToBase)
    lines.push(`methodology SOURCE changed mid-run: ${d.ref} resolved to ${d.from} for ${d.firstReadBy} and ${d.to} for ${d.nowReadBy} — a customer's own document being replaced by the house copy (or the reverse) changes what the run rates under`);
  return lines;
}
