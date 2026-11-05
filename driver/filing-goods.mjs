// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// filing-goods.mjs — the goods each filing covers, carried from what the run already holds onto the neutral record a
// knockout's assessment reads. No register call: the listing logged every record body it fetched.
//
// WHY. A saved eight-name knockout, 2026-10-28, fetched 160 record bodies, and all but one carried goods. None of its 160
// neutral records did, because the record listed the fields a search row names and goods is not one of them for a register
// whose goods come with the full record. The assessment did not open the bodies, and 14 of its 15 recorded reads of a filing
// named goods wording as missing. The run had paid for that wording already.
//
// A SHORT VIEW, AND THE WHOLE TEXT ONE READ AWAY. A long statement is cut in the view and the record says so
// (`goodsShortened`), and the whole held record is written to its own file (`fullRecord`, relative to the run), with the
// duplicate raw goods list left out where the normalised list carries it. On that batch the view at this length is 106 KB
// of 153 KB, and it shortens 39 of 394 statements, on 16 of 160 records. Pasting every record whole into every read is what
// this avoids; hiding wording the run holds is what it must not do.
//
// WHAT THE GOODS REST ON IS THE FULL ENGINE'S RECORD, not a new one: `goodsState` and `goodsFrom` are goods-evidence.mjs's
// states and labels, read through the same reader. So complete, cut by the register, not established whole, absent, failed
// and not held stay six different facts. None of the last five means the goods are unrelated.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { recordGoods, recordAsServed, untaggedIsEnglish } from "./record-goods.mjs";
import { heldBodiesOf, heldRecordProvenance, readRunCallRows, recordFetchOutcomes, recordGoodsEvidence, goodsFromLabel } from "./goods-evidence.mjs";
import { DEFAULT_LEDGER_PATH } from "./provider-usage.mjs";

/** The folder under the run that holds one whole record per filing, for a reader who needs more than the short view. */
export const FILING_RECORDS_DIR = "register-filings";
/** The longest statement the short view carries whole. */
export const GOODS_VIEW_CHARS = 1200;

/**
 * Statements as the short view carries them: one line each, its classes first ("9, 35: computer software"), and whether any
 * was cut. A plain line because this view is read whole by a model on every chunk: as typed objects the sidecar of the saved
 * batch came to 330 KB, and as lines to 282 KB. What the goods rest on is the record's own `goodsState`. PURE.
 */
export function shortGoodsView(statements, limit = GOODS_VIEW_CHARS) {
  let shortened = false;
  const goods = (Array.isArray(statements) ? statements : []).map((g) => {
    const chars = [...String(g?.text ?? "")];
    const cut = chars.length > limit;
    if (cut) shortened = true;
    const text = cut ? `${chars.slice(0, limit).join("")}…` : chars.join("");
    return Array.isArray(g?.classes) && g.classes.length ? `${g.classes.join(", ")}: ${text}` : text;
  });
  return { goods, shortened };
}

/** A filing's file under FILING_RECORDS_DIR, named as `_records/` names one where its id is an address. PURE. */
export function filingRecordName(recordId) {
  const id = String(recordId ?? "");
  const key = normalizeRecordUri(id);
  if (key) return `${key.replace(/^\/mark\//, "").replace(/[^a-z0-9]+/gi, "-")}.json`;
  return `${id.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}-${createHash("sha256").update(id).digest("hex").slice(0, 8)}.json`;
}

/**
 * The sidecar with each record's goods on it: `goods`, `goodsState`, `goodsFrom`, `goodsShortened` and `fullRecord`. A record's
 * own statements are read from the body the run holds for it, or otherwise from what its search row carried (`goods` on the
 * way in: register-records.mjs `toRecord`). Writes the filings' files and sends nothing. Never throws: a file that cannot be
 * read or written leaves that record the less on it, and a failure here must not cost the run its filings.
 */
export function withFilingGoods(doc, runDir, { runPrefix = null, callLog = DEFAULT_LEDGER_PATH, limit = GOODS_VIEW_CHARS } = {}) {
  const marks = Array.isArray(doc?.marks) ? doc.marks : null;
  if (!marks) return doc;
  const ids = marks.flatMap((m) => (Array.isArray(m?.records) ? m.records : [])).map((r) => r?.recordId).filter(Boolean);
  let bodies = new Map(), held = new Map(), fetches = null;
  try { bodies = heldBodiesOf(runDir, ids); held = heldRecordProvenance(runDir); } catch { /* nothing held reads as nothing held */ }
  try { if (runPrefix) fetches = recordFetchOutcomes(readRunCallRows(callLog, runPrefix).rows, { runPrefix }); } catch { fetches = null; }
  const dir = join(runDir, FILING_RECORDS_DIR);
  const keep = (recordId, content) => {
    try {
      const name = filingRecordName(recordId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), content);
      return `${FILING_RECORDS_DIR}/${name}`;
    } catch { return null; }
  };
  const carried = (rec) => {
    const key = normalizeRecordUri(rec?.recordId);
    const body = key ? bodies.get(key) ?? null : null;
    const fromBody = body ? recordGoods(body, { english: untaggedIsEnglish(key) }) : [];
    const statements = fromBody.length ? fromBody : (Array.isArray(rec?.goods) ? rec.goods : []);
    const evidence = recordGoodsEvidence({ record_id: rec?.recordId }, { goods: { of: () => statements, held: () => fromBody.length > 0 }, held, fetches });
    const view = shortGoodsView(statements, limit);
    const fullRecord = !rec?.recordId ? null
      : body ? keep(rec.recordId, recordAsServed(`${JSON.stringify(body, null, 2)}\n`).text)
      : view.shortened ? keep(rec.recordId, `${JSON.stringify({ recordId: rec.recordId, goods: statements }, null, 2)}\n`) : null;
    return { ...rec, goods: view.goods, goodsState: evidence.state, goodsFrom: goodsFromLabel(evidence), goodsShortened: view.shortened, fullRecord };
  };
  return { ...doc, marks: marks.map((m) => (Array.isArray(m?.records) ? { ...m, records: m.records.map(carried) } : m)) };
}
