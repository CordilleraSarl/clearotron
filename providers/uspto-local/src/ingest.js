// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ingest.js — USPTO bulk trademark XML into the local index.
//
// SOURCE OF TRUTH: "Trademark Applications Document Type Definition (DTD) V 2.0" and "Trademarks
// Application Daily XML V2.0 Documentation" (USPTO Electronic Information Products Division). Every
// element name below is from that DTD; none is inferred from a sample. The shape is:
//
//   <trademark-applications-daily>
//     <application-information><file-segments><action-keys>
//       <case-file>
//         <serial-number> <registration-number>
//         <case-file-header>
//           <filing-date> <registration-date> <status-code> <status-date>
//           <mark-identification> <mark-drawing-code> <renewal-date> …
//         <case-file-statements><case-file-statement><type-code><text>
//         <classifications><classification><international-code>… <primary-code>
//         <case-file-owners><case-file-owner><party-type><nationality><country>
//                                            <party-name> …
//
// WHY A HAND-ROLLED SCANNER. The engine carries three dependencies and this adds none. The records
// are regular and the DTD is frozen at V2.0 (2004-11-08), so a streaming tag scan is enough; an XML
// library would buy generality this file does not need and put a package in front of every
// open-source clone. Whether the parse rate is comfortable at register scale is UNMEASURED — see the
// provider doc's Provenance section. No throughput figure is stated here, because the only ones that
// existed came from a synthetic fixture and asserting them would be inventing evidence.
//
// STREAMING IS NOT OPTIONAL. The uncompressed backfile is measured in gigabytes; nothing here ever
// holds more than one record plus the tail of the read buffer.

import { StringDecoder } from "node:string_decoder";

import { statusClassOf } from "./index-store.js";

/** Only these five are legal in XML content, and USPTO emits the named forms. */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(s) {
  return String(s ?? "").replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, ref) => {
    if (ref[0] === "#") {
      const cp = ref[1] === "x" || ref[1] === "X"
        ? Number.parseInt(ref.slice(2), 16)
        : Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[ref] ?? m;
  });
}

/**
 * USPTO dates are eight positions, YYYYMMDD — and the documentation is explicit that "elements that
 * do not have the required date will contain zeros". So 00000000 is an ABSENT date, not the year
 * zero. Left as a string it would sort before every real date and read as the oldest filing in the
 * register.
 */
export function usptoDate(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d{8}$/.test(s) || s === "00000000") return null;
  const [y, m, d] = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)];
  if (y === "0000" || m === "00" || d === "00") return null;
  return `${y}-${m}-${d}`;
}

// Scanning helpers. `pick` takes the FIRST occurrence within the given slice, which is why callers
// slice down to the right parent element before asking — `status-code` appears in case-file-header
// AND in every classification, and the two mean different things.
function pick(xml, tag) {
  const open = `<${tag}>`;
  const a = xml.indexOf(open);
  if (a < 0) return null;
  const b = xml.indexOf(`</${tag}>`, a);
  if (b < 0) return null;
  return decodeXml(xml.slice(a + open.length, b));
}

function pickAll(xml, tag) {
  const open = `<${tag}>`, close = `</${tag}>`;
  const out = [];
  let pos = 0;
  for (;;) {
    const a = xml.indexOf(open, pos);
    if (a < 0) break;
    const b = xml.indexOf(close, a);
    if (b < 0) break;
    out.push(decodeXml(xml.slice(a + open.length, b)));
    pos = b + close.length;
  }
  return out;
}

function section(xml, tag) {
  const open = `<${tag}>`;
  const a = xml.indexOf(open);
  if (a < 0) return "";
  const b = xml.indexOf(`</${tag}>`, a);
  return b < 0 ? "" : xml.slice(a + open.length, b);
}

/**
 * One <case-file> element to the row shape index-store.putRecords takes.
 *
 * Returns null for a record with no serial number: the DTD makes serial-number mandatory, so its
 * absence means the chunk is not a case file, and a row keyed on null would collide with every
 * other malformed one.
 */
export function parseCaseFile(xml) {
  const serial = pick(xml, "serial-number");
  if (!serial) return null;

  const header = section(xml, "case-file-header");
  const status = pick(header, "status-code");

  // classifications/classification/international-code — the Nice classes. Scoped to the
  // classifications section so the classification-level <status-code> is never mistaken for the
  // case-level one.
  const classes = [...new Set(pickAll(section(xml, "classifications"), "international-code"))]
    .map((c) => String(c).trim()).filter(Boolean);

  // The first owner is the current one; later entries are the assignment chain.
  const owners = section(xml, "case-file-owners");
  const firstOwner = owners ? section(owners, "case-file-owner") : "";
  const nationality = firstOwner ? section(firstOwner, "nationality") : "";

  // Goods & services ride case-file-statements whose type-code begins "GS" (documentation, Table of
  // TEXT TYPE: "GS - Goods and Services"). Every other statement type — disclaimers, colour claims,
  // mark descriptions — is different data and must not be concatenated in as if it were the scope.
  const gs = [];
  for (const st of splitElements(section(xml, "case-file-statements"), "case-file-statement")) {
    const type = pick(st, "type-code") ?? "";
    if (type.slice(0, 2).toUpperCase() === "GS") {
      const text = pick(st, "text");
      if (text) gs.push(text.trim());
    }
  }

  return {
    serial: String(serial).trim(),
    regno: pick(xml, "registration-number")?.trim() || null,
    text: pick(header, "mark-identification") ?? "",
    owner: firstOwner ? (pick(firstOwner, "party-name") ?? null) : null,
    owner_country: nationality ? (pick(nationality, "country") ?? pick(nationality, "state") ?? null) : null,
    status,
    status_class: statusClassOf(status),
    status_date: usptoDate(pick(header, "status-date")),
    mark_feature: markFeatureOf(pick(header, "mark-drawing-code")),
    classes,
    filed: usptoDate(pick(header, "filing-date")),
    regd: usptoDate(pick(header, "registration-date")),
    // A registration's life runs to its renewal date when one exists; otherwise the office has not
    // set an expiry and we must not invent one.
    expiry: usptoDate(pick(header, "renewal-date")),
    gs: gs.length ? gs.join(" ") : null,
  };
}

/**
 * mark-drawing-code position 1 is the drawing type. 1 = typeset word / 4 = standard character mark
 * are word marks; 2/5 are design-only; 3/6 are design plus words. 0 is "not yet assigned".
 *
 * UNVERIFIED AGAINST REAL DATA. The mapping follows the documented code list, but nothing here has
 * been run over a real file yet, so an unrecognised leading digit returns null rather than guessing
 * "word" — a mark whose feature we cannot read must not be filtered as though we could.
 */
export function markFeatureOf(code) {
  const c = String(code ?? "").trim();
  if (!c) return null;
  switch (c[0]) {
    case "1": case "4": return "word";
    case "2": case "5": return "design";
    case "3": case "6": return "combined";
    default: return null;
  }
}

/** Split a container's direct children by tag, keeping each child's inner XML. */
function* splitElements(xml, tag) {
  const open = `<${tag}>`, close = `</${tag}>`;
  let pos = 0;
  for (;;) {
    const a = xml.indexOf(open, pos);
    if (a < 0) return;
    const b = xml.indexOf(close, a);
    if (b < 0) return;
    yield xml.slice(a + open.length, b);
    pos = b + close.length;
  }
}

const CASE_OPEN = "<case-file>";
const CASE_CLOSE = "</case-file>";

/**
 * Pull complete <case-file> elements out of a growing buffer.
 *
 * Returns the records found and the UNCONSUMED tail, which the caller feeds back in with the next
 * chunk. The tail matters: a record straddling two reads would otherwise be dropped silently, and a
 * dropped record in a register search is a false clean.
 */
export function drainCaseFiles(buffer) {
  const records = [];
  let pos = 0;
  for (;;) {
    const a = buffer.indexOf(CASE_OPEN, pos);
    if (a < 0) break;
    const b = buffer.indexOf(CASE_CLOSE, a);
    if (b < 0) break;                       // incomplete — keep it in the tail
    const rec = parseCaseFile(buffer.slice(a + CASE_OPEN.length, b));
    if (rec) records.push(rec);
    pos = b + CASE_CLOSE.length;
  }
  // Keep from the last unconsumed open tag, or from `pos` when nothing is pending. Never discard
  // more than has actually been parsed.
  const pending = buffer.indexOf(CASE_OPEN, pos);
  return { records, tail: pending >= 0 ? buffer.slice(pending) : buffer.slice(pos) };
}

/**
 * Stream an XML source through the parser, handing batches to `onBatch`.
 *
 * `source` is any async iterable of strings or Buffers — a file read stream, a decompressed entry,
 * or an array in a test. Returns the number of records parsed.
 */
export async function ingestStream(source, { onBatch, batchSize = 20_000 } = {}) {
  if (typeof onBatch !== "function") throw new Error("[uspto-local] ingestStream needs an onBatch(rows) sink");
  let buffer = "";
  let batch = [];
  let total = 0;
  // A StringDecoder, not Buffer.toString(), and the difference is a silent one. A read stream chops the
  // file at arbitrary BYTE offsets, so a multi-byte UTF-8 character routinely straddles two chunks;
  // decoding each chunk on its own turns that character into replacement characters at BOTH ends. The
  // XML still parses, the record is still stored, and the mark's text is quietly wrong — so an exact
  // search for it finds nothing, which is a clean negative for a mark that is sitting in the index.
  // The decoder holds the partial sequence until the rest of it arrives.
  const decoder = new StringDecoder("utf8");
  for await (const chunk of source) {
    buffer += typeof chunk === "string" ? chunk : decoder.write(Buffer.from(chunk));
    const { records, tail } = drainCaseFiles(buffer);
    buffer = tail;
    for (const r of records) {
      batch.push(r);
      if (batch.length >= batchSize) { await onBatch(batch); total += batch.length; batch = []; }
    }
  }
  // A final drain: the last record ends exactly at EOF with no further chunk to trigger it. `end()`
  // flushes anything the decoder was still holding — without it a file ending mid-character silently
  // drops the tail, and the tail is a whole record.
  buffer += decoder.end();
  const { records } = drainCaseFiles(buffer);
  for (const r of records) batch.push(r);
  if (batch.length) { await onBatch(batch); total += batch.length; }
  return total;
}
