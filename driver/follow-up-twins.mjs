// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// follow-up-twins.mjs — when a written coverage row with an axis label stands in for the driver's Follow-up row.
//
// "Left open" listed one unfinished search twice: once as the writer's row ("Register / …") and once as the row the
// driver composes for a deferred directive ("Follow-up / …"). An axis-labelled row was never allowed to stand in,
// because word containment alone had erased two genuinely different open searches on a delivered page. The rule
// now rests on the search the run RECORDED for the deferred directive (design, 2026-11-19): the frame receipt
// (`_driver/frame-reopen.json`) keeps, per directive, the plan questions minted for it, and each question's id names
// its search kind (`supp:primary-sweep:exact:…`).
//
// A WRITTEN ROW STANDS IN ONLY WHEN ALL OF THIS HOLDS, and the Follow-up stays otherwise:
//   - the directive's recorded questions name exactly one kind of search; none recorded, as on every older run and
//     on every common-law directive, or several kinds, keeps the Follow-up;
//   - the written row is open, carries an axis label whose head is that kind's spelling (its own key, its reader
//     label, and "register" for the main register search), and carries every significant word of the directive;
//   - no other open row fits equally well.
// A completed row never stands in. The driver composing the rows, the lint reading the page and the page itself all
// ask this one function, so the three cannot disagree. The free-text arm each of them already has is unchanged.
import { readFileSync } from "node:fs";
import { AXIS_READER_LABEL } from "./coverage-ledger.mjs";
import { plainDirective } from "./deferral-row.mjs";
import { paths } from "./run-record.mjs";

const STOPWORDS = new Set(["the", "a", "an", "as", "for", "of", "in", "on", "and", "or", "to", "is",
  "was", "it", "its", "this", "that", "with", "by", "at", "be", "been", "run", "search", "searched"]);
/** The significant words of a text, as the page's Follow-up test reads them. PURE. */
export const significantWords = (t) => new Set(String(t || "").toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => !STOPWORDS.has(w)) ?? []);

const keyOf = (directive) => plainDirective(directive).toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The search kinds the run recorded for each deferred directive, keyed by the directive as a Follow-up row prints it
 * (its plain form, lower case). A kind is a question id's second segment. A directive with no recorded question has
 * no entry. PURE.
 */
export function followUpKinds(receipt) {
  const out = new Map();
  const qids = receipt?.directive_qids && typeof receipt.directive_qids === "object" ? receipt.directive_qids : {};
  for (const d of Array.isArray(receipt?.deferrals) ? receipt.deferrals : []) {
    const directive = typeof d?.directive === "string" ? d.directive : "";
    const ids = Array.isArray(qids[directive]) ? qids[directive].filter((q) => typeof q === "string") : [];
    const segments = ids.map((q) => q.split(":")[1]);
    // Every recorded question must name its kind: one that does not leaves the record incomplete, and nothing folds.
    if (directive && ids.length && segments.every(Boolean)) out.set(keyOf(directive), new Set(segments));
  }
  return out;
}

/** The kinds as the report document carries them, `[directive, [kind, …]]` pairs, read back into the Map above. PURE. */
export const followUpKindsFrom = (pairs) => new Map((pairs ?? []).map(([k, kinds]) => [k, new Set(Array.isArray(kinds) ? kinds : [])]));

/** The kinds recorded for the directive a Follow-up row prints, or null. The directive is its note's opening clause. PURE. */
export function kindsForFollowUp(row, kinds) {
  if (!(kinds instanceof Map) || !kinds.size) return null;
  return kinds.get(keyOf(String(row?.note ?? "").split("—")[0])) ?? null;
}

const headOf = (area) => {
  const a = String(area ?? "");
  const cut = a.indexOf(" / ");
  return cut < 0 ? null : a.slice(0, cut).trim().toLowerCase();
};
const spells = (head, kind) => head === kind || head === AXIS_READER_LABEL[kind] || (kind === "primary-sweep" && head === "register");

/**
 * The one written row that stands in for a Follow-up row whose directive is `directive` and whose recorded kinds are
 * `kinds`, or null when none does. `written` is every row that is not a Follow-up row. PURE.
 */
export function axisTwin(directive, kinds, written) {
  if (!(kinds instanceof Set) || kinds.size !== 1) return null;
  const [kind] = kinds;
  const want = significantWords(directive);
  if (!want.size) return null;
  const fits = (Array.isArray(written) ? written : []).filter((w) => {
    if (!w || w.state === "confirmed-clean") return false;
    const head = headOf(w.area);
    if (!head || !spells(head, kind)) return false;
    const theirs = significantWords(w.area);
    return [...want].every((word) => theirs.has(word));
  });
  return fits.length === 1 ? fits[0] : null;
}

/** The recorded kinds of a run's deferred directives, read from its frame receipt; empty when the run has none. IMPURE. */
export function followUpKindsOf(runDir) {
  if (!runDir) return new Map();
  try { return followUpKinds(JSON.parse(readFileSync(paths(runDir).frameReopenReceipt, "utf8"))); } catch { return new Map(); }
}
