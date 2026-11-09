// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// workbook-entries.mjs — a workbook's contents, for a comparison that has to read them.
//
// A workbook is a zip, and its bytes move on every write because each entry carries the moment it was made. Comparing the
// entries' contents compares the cells and the layout. Only the two timestamps in the document properties are generation
// metadata, so only those are taken out; a date in a cell is content and stays.
import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;

/** Every entry of a zip as `[name, bytes]`, sorted by name. Throws on a buffer that is not a zip it can read. */
export function zipEntries(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== END_OF_CENTRAL_DIRECTORY) end--;
  if (end < 0) throw new Error("not a zip: no end-of-central-directory record");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== CENTRAL_ENTRY) throw new Error(`not a zip: entry ${i} has no central header`);
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`${name}: compression method ${method} is not one this reads`);
    out.push([name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw)]);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** An entry's text with its generation metadata out: the created and modified stamps of `docProps/core.xml`, nothing else. */
export function workbookEntryText(name, bytes) {
  const text = bytes.toString("utf8");
  if (name !== "docProps/core.xml") return text;
  return text.replace(/(<dcterms:(created|modified)[^>]*>)[^<]*(<\/dcterms:\2>)/g, "$1<GENERATED>$3");
}
