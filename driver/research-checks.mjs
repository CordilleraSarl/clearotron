// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// research-checks.mjs — the research behind the findings' use checks, written beside the record for the review.
//
// The review checked a claimed research result against the writer's word alone: it was handed neither the research log
// nor the run's answers. On a test run the writer wrote that a refused search "returned no result", and nothing the
// review held could show otherwise. The writer's record now writes, each time it is accepted, what the review needs to
// check each claim: every finding's use check with the question it names, whether that question completed, and its
// answer, and every research question the writer asked, with its outcome. It is focused on those claims: no other answer
// is copied, and nothing is asked again. The file sits in the run folder, so the review reads it on either engine and an
// experiment's copy of the review carries it (stages.mjs, the review's inputs).
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { isUseCheckNoResult } from "./findings-model.mjs";
import { questionKey, sameStageSession } from "./research-answers.mjs";

export const RESEARCH_CHECKS_FILE = "research-checks.md";

// The reviewer's instruction (design, 2026-10-28), word for word. Model-facing: it changes only as model-facing wording does.
export const REVIEW_RESEARCH_CHECK = "Check a claimed research result against the relevant saved answer and its completion record. "
  + "A failed or unanswered question is not a negative result. An unknown status alone does not require an invented source. "
  + "Flag unsupported claims and the conclusions that depend on them; preserve unaffected work.";

/** The review message's line: the instruction, then where its evidence is. Model-facing. PURE. */
export const reviewResearchLine = (path) => `${REVIEW_RESEARCH_CHECK} The research behind the findings' use checks is in ${path}: `
  + "the cited questions, their recorded outcomes, any saved answers, and the writer's research questions with their outcomes.";

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const quoted = (s) => `"${oneLine(s).replace(/"/g, "'")}"`;
const rows = (p) => { try { return readFileSync(p, "utf8").split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } }); } catch { return []; } };

/**
 * The file's text, from the accepted record's findings, the answers the writer held and the research log. PURE.
 * `asked` is the writer's own research calls, oldest first: { question, ok, error }.
 */
export function researchChecksText(findings, held, asked) {
  const out = ["# Research behind the findings' use checks", "", "## Findings that record a use check or a use status", ""];
  const cited = [];
  for (const f of Array.isArray(findings) ? findings : []) {
    if (f?.disposition === "withdrawn") continue;
    const use = f?.meters?.use?.token ?? "unknown";
    if (f?.use_check == null && use === "unknown") continue;
    const who = [f?.mark, f?.owner?.name].filter(Boolean).map(oneLine).join(" — ");
    const head = `- Finding ${f?.ordinal ?? "?"}${who ? ` (${who})` : ""}: use ${use}; enforcement ${f?.meters?.enforcer?.token ?? "unknown"}`;
    const src = f?.use_check?.source;
    if (src == null) { out.push(`${head}; no use check recorded.`); continue; }
    const q = typeof f.use_check.question === "string" ? f.use_check.question : "";
    const h = q ? held?.get(questionKey(q)) : null;
    const claim = isUseCheckNoResult(src) ? "no result" : oneLine(src);
    const status = q ? (h ? "completed" : "no completed answer this writer holds") : isUseCheckNoResult(src) ? "no question named" : null;
    out.push(`${head}; use check: ${claim}${q ? `; question ${quoted(q)}: ${status}` : status ? `; ${status}` : ""}.`);
    if (h && !cited.includes(h)) cited.push(h);
  }
  if (out.length === 4) out.push("- None.");
  out.push("", "## The cited questions' answers", "");
  if (!cited.length) out.push("- None.");
  for (const h of cited) out.push(`- ${quoted(h.question)}: ${h.answer == null ? "(answer not kept)" : oneLine(h.answer)}`);
  out.push("", "## Research questions the writer asked, with their outcomes", "");
  if (!asked.length) out.push("- None.");
  for (const a of asked) out.push(`- ${quoted(a.question)}: ${a.ok ? "completed" : `did not complete (${oneLine(a.error || "failed")})`}`);
  return out.join("\n") + "\n";
}

/**
 * Write the file for the record that now stands (`findingsAt`, the folded findings.json). `held` is what the record
 * checked against; `sessionKey` the writer's session: every session of its stage asked as the writer, so the file the
 * review reads after a correction still lists the main pass's questions. Best-effort: a file
 * that cannot be written never fails the record it describes. Returns the path written, or null. IMPURE.
 */
export function writeResearchChecks(runDir, { findingsAt, held = null, sessionKey = null } = {}) {
  try {
    const doc = JSON.parse(readFileSync(findingsAt, "utf8"));
    const own = (s) => sameStageSession(s, sessionKey);
    const asked = rows(driverDir(runDir, "reading-log.jsonl"))
      .filter((r) => r?.tool === "perplexity_research" && own(r.session) && !r.args?.grid && typeof r.args?.task === "string" && r.args.task.trim())
      .map((r) => ({ question: r.args.task, ok: r.ok === true, error: r.error ?? null }));
    const at = join(runDir, RESEARCH_CHECKS_FILE);
    writeFileSync(`${at}.tmp`, researchChecksText(doc?.findings, held, asked));
    renameSync(`${at}.tmp`, at);
    return at;
  } catch { return null; }
}
