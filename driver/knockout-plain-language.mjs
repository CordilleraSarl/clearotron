// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// knockout-plain-language.mjs — where a Knockout's default-visible lines break the plain-language rule, counted by
// rating group and by field, on the rating as saved and on the record as published. Recording only.
//
// The rule stays where it is: no default-visible sentence over the word limit, and none of the lawyer's vocabulary, both
// flagged for whoever fixes the run and never shown to a client, and never a reason to stop a delivery. The rating step
// carries it on its first pass, and nothing after it rewrites these lines. Whether a further turn per group would earn
// its cost is open, so each delivered Knockout records the counts that decide it: per group, how many sentences run long
// and how many words are the lawyer's, field by field, as the rating saved them and as the page published them; whether
// the group was sent to the correction step; and how many groups another turn would have had to touch.
//
// The counts are the lint's own (predelivery-lint.mjs: the same walk over the same fields, the same limit and the same
// vocabulary), so this record and the lint's flag cannot disagree about what a long line is.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { knockoutVisibleProse } from "./predelivery-lint.mjs";
import { PLAIN_FORMS, SENTENCE_WORD_LIMIT, termMatcher } from "./plain-register.mjs";
import { knockoutAssessChunkFile } from "./knockout-assess-record.mjs";
import { paths } from "./run-record.mjs";
import { readRunChoices } from "./engine/run-choices.mjs";
import { runLog } from "./log.mjs";

/** A visible field's short name: the summary, a conflict sentence, the basis line, a factor, or the field itself. */
const FIELD = { "batch.executiveSummary": "summary", "findings.net": "conflict", basis: "basis", factors: "factors", counterFactors: "factors" };
const fieldOf = (at) => FIELD[at?.field] ?? String(at?.field ?? "other");

/**
 * Counts over one record, field by field: `{ long: { <field>: n }, words: { <field>: n } }`. `long` counts sentences over
 * the word limit, `words` the lawyer's terms. PURE.
 */
export function plainLanguageByField(findings) {
  const long = {}, words = {};
  for (const { text, at } of knockoutVisibleProse(findings)) {
    if (at?.engineOwned) continue;   // the engine's own caveats are not a seat's to rewrite, and no turn would touch them
    const f = fieldOf(at);
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/))
      if (sentence.trim().split(/\s+/).filter(Boolean).length > SENTENCE_WORD_LIMIT) long[f] = (long[f] ?? 0) + 1;
    for (const [term] of PLAIN_FORMS) if (termMatcher(term).test(text)) words[f] = (words[f] ?? 0) + 1;
  }
  return { long, words };
}
const total = (byField) => Object.values(byField).reduce((n, v) => n + v, 0);
const any = (c) => total(c.long) + total(c.words) > 0;

/** The rating groups a run saved: `[{ group, record }]`, in order, from its own chunk files. */
function savedGroups(runDir) {
  const out = [];
  let names = [];
  try { names = readdirSync(runDir); } catch { return out; }
  const nums = names.map((n) => n.match(/^knockout-assess-(\d+)\.json$/)?.[1]).filter((n) => n != null).map(Number).sort((a, b) => a - b);
  for (const n of nums) {
    try { out.push({ group: n, record: JSON.parse(readFileSync(knockoutAssessChunkFile(runDir, n), "utf8")) }); } catch { /* a torn chunk is left out, and the count says how many were read */ }
  }
  return out;
}

/** The groups the review sent to the correction step, from the run's own correction work. */
function correctedGroups(runDir) {
  const p = paths(runDir).knockoutCorrectionWork;
  if (!existsSync(p)) return new Set();
  try { return new Set((JSON.parse(readFileSync(p, "utf8"))?.defects ?? []).map((d) => d?.chunk).filter((c) => c != null).map(Number)); }
  catch { return new Set(); }
}

/**
 * The record for one delivered Knockout: per group, the counts as saved and as published, whether the group was sent to
 * correction, and how many groups a further turn would have had to touch. `delivered` is the record handed to publish.
 */
export function knockoutPlainLanguage({ runDir, delivered }) {
  const corrected = correctedGroups(runDir);
  const groups = savedGroups(runDir).map(({ group, record }) => {
    const marks = (record?.marks ?? []).map((m) => String(m?.name ?? "")).filter(Boolean);
    const saved = plainLanguageByField({ batch: { executiveSummary: record?.chunkSummary ?? record?.batch?.executiveSummary }, marks: record?.marks ?? [] });
    const shown = plainLanguageByField({ marks: (delivered?.marks ?? []).filter((m) => marks.includes(String(m?.name ?? ""))) });
    return { group, marks: marks.length, saved, published: shown, sentToCorrection: corrected.has(group) };
  });
  // The batch summary is published once for the whole order, so it is counted once, apart from the groups.
  const summary = plainLanguageByField({ batch: delivered?.batch ?? {}, marks: [] });
  return {
    engine: readRunChoices(runDir).engine ?? null,
    limit: SENTENCE_WORD_LIMIT,
    groups,
    publishedSummary: summary,
    groupsWithAFlagAsSaved: groups.filter((g) => any(g.saved)).length,
    groupsWithAFlagAsSavedAndNotSentToCorrection: groups.filter((g) => any(g.saved) && !g.sentToCorrection).length,
  };
}

/** Write the record to the run's spine at delivery. Best-effort: a count never affects a delivery. */
export function stampKnockoutPlainLanguage(runDir, delivered) {
  try {
    const rec = knockoutPlainLanguage({ runDir, delivered });
    runLog(runDir, { event: "knockout-plain-language", ...rec });
    return rec;
  } catch { return null; }
}
