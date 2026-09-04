// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// zip.js — just enough ZIP to stream one bulk file out of one archive, with no dependency.
//
// WHY THIS EXISTS AT ALL. USPTO publishes the bulk register as `.zip`, and Node ships `zlib` (raw
// DEFLATE) but no archive reader. The alternatives were a dependency or shelling out to `unzip`; both
// break the promise this whole provider is built on — clone, run, no install. So: the central
// directory is parsed here, and the entry's bytes are handed to `zlib.createInflateRaw` as a STREAM.
//
// STREAMING IS NOT AN OPTIMISATION HERE. A year's file is several GB compressed and more inflated.
// Reading it into a Buffer would work on a fixture and die on the real thing, at which point the
// failure is an OOM in a sync job nobody watched. Only the central directory is read into memory, and
// that is a few hundred bytes per entry at the end of the file.
//
// WHAT IS DELIBERATELY NOT IMPLEMENTED, and why each one THROWS rather than degrading:
//   * encryption            — an encrypted entry inflates to garbage, and garbage XML parses to zero
//                             records. A zero-record ingest is the false clean this provider exists to
//                             prevent, so it must be a loud error and not an empty index.
//   * multi-disk archives   — same reason: a partial archive is a partial register.
//   * compression methods
//     other than store/deflate — unrecognised method bytes would otherwise be handed to inflateRaw and
//                             produce the same silent garbage.
//   * ZIP64 is READ, not skipped. A file over 4 GB writes 0xFFFFFFFF in the 32-bit fields and puts the
//     real numbers in an extra field. Ignoring that reads the offset as ~4 GB into a much larger file
//     and inflates whatever happens to be there. USPTO's annual products are past that line.

import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";

const EOCD_SIG = 0x06054b50;        // end of central directory
const EOCD64_LOC_SIG = 0x07064b50;  // zip64 end of central directory LOCATOR
const EOCD64_SIG = 0x06064b50;      // zip64 end of central directory
const CEN_SIG = 0x02014b50;         // central directory file header
const LOC_SIG = 0x04034b50;         // local file header

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;

/** The trailing bytes an EOCD can hide in: 22-byte record + up to 64 KB of comment. */
const EOCD_SEARCH = 22 + MAX16;

async function readSlice(fh, start, length) {
  const buf = Buffer.allocUnsafe(length);
  const { bytesRead } = await fh.read(buf, 0, length, start);
  return buf.subarray(0, bytesRead);
}

/**
 * Read one entry out of the extra field. ZIP64's is header id 0x0001, and its fields are present
 * ONLY for the ones that were saturated in the fixed record — the order is fixed, the presence is not.
 */
function zip64Extra(extra, { needSize, needCompressed, needOffset }) {
  const out = {};
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = extra.readUInt16LE(p);
    const len = extra.readUInt16LE(p + 2);
    if (id === 0x0001) {
      let q = p + 4;
      const take = () => { const v = extra.readBigUInt64LE(q); q += 8; return Number(v); };
      if (needSize && q + 8 <= p + 4 + len) out.size = take();
      if (needCompressed && q + 8 <= p + 4 + len) out.compressedSize = take();
      if (needOffset && q + 8 <= p + 4 + len) out.offset = take();
      return out;
    }
    p += 4 + len;
  }
  return out;
}

/**
 * List the archive's entries.
 *
 * @returns {Promise<Array<{name,size,compressedSize,method,offset}>>} `offset` is the LOCAL header's,
 *          not the data's — the data offset needs the local header's own variable-length fields, which
 *          `openEntry` reads. Trusting the central directory's name/extra lengths for that is a
 *          classic zip bug: writers are allowed to differ between the two headers.
 */
export async function listEntries(path) {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, EOCD_SEARCH);
    const tail = await readSlice(fh, size - tailLen, tailLen);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(`not a zip archive (no end-of-central-directory record): ${path}`);

    let entryCount = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    const disk = tail.readUInt16LE(eocd + 4);
    const cdDisk = tail.readUInt16LE(eocd + 6);

    // ZIP64: the 32-bit fields saturate and the truth lives in a second record the locator points at.
    if (entryCount === MAX16 || cdOffset === MAX32 || cdSize === MAX32) {
      let loc = -1;
      for (let i = eocd - 20; i >= 0; i--) {
        if (tail.readUInt32LE(i) === EOCD64_LOC_SIG) { loc = i; break; }
      }
      if (loc < 0) {
        throw new Error(
          `${path} saturates the 32-bit zip fields but carries no ZIP64 locator. Refusing rather than `
          + "reading a truncated offset — the result would be a partial register that looks complete.");
      }
      const eocd64At = Number(tail.readBigUInt64LE(loc + 8));
      const rec = await readSlice(fh, eocd64At, 56);
      if (rec.length < 56 || rec.readUInt32LE(0) !== EOCD64_SIG) throw new Error(`${path}: bad ZIP64 end-of-central-directory record`);
      entryCount = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
    if (disk !== 0 || cdDisk !== 0) {
      throw new Error(`${path} is part of a MULTI-DISK archive — a partial archive is a partial register, so this is refused rather than ingested.`);
    }

    const cd = await readSlice(fh, cdOffset, cdSize);
    if (cd.length !== cdSize) {
      throw new Error(`${path}: the central directory is ${cdSize} bytes and only ${cd.length} were readable — the archive is TRUNCATED. Refusing: a short read here drops entries with no error.`);
    }
    const entries = [];
    let p = 0;
    for (let i = 0; i < entryCount && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== CEN_SIG) throw new Error(`${path}: central directory entry ${i} has a bad signature`);
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20);
      let entrySize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString("utf8");
      const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);

      if (flags & 0x0001) {
        throw new Error(`${path}: entry "${name}" is ENCRYPTED. An encrypted entry inflates to garbage and garbage XML parses to zero records — refusing rather than building an empty index.`);
      }
      const z64 = zip64Extra(extra, {
        needSize: entrySize === MAX32, needCompressed: compressedSize === MAX32, needOffset: offset === MAX32,
      });
      if (entrySize === MAX32) entrySize = z64.size ?? entrySize;
      if (compressedSize === MAX32) compressedSize = z64.compressedSize ?? compressedSize;
      if (offset === MAX32) offset = z64.offset ?? offset;

      entries.push({ name, size: entrySize, compressedSize, method, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (entries.length !== entryCount) {
      throw new Error(`${path}: central directory says ${entryCount} entries, ${entries.length} were readable — refusing a partial read.`);
    }
    return entries;
  } finally {
    await fh.close();
  }
}

/**
 * A readable stream of ONE entry's decompressed bytes.
 *
 * The data offset is computed from the LOCAL header, deliberately: the central directory's copies of
 * the name and extra lengths are allowed to differ from the local ones, and using the wrong pair puts
 * the read a few bytes off — which inflates to an error on a good day and to truncated XML on a bad
 * one. Truncated XML is the silent case: the scanner simply sees fewer records.
 */
export async function openEntry(path, entry) {
  const fh = await open(path, "r");
  let dataAt;
  try {
    const loc = await readSlice(fh, entry.offset, 30);
    if (loc.length < 30 || loc.readUInt32LE(0) !== LOC_SIG) {
      throw new Error(`${path}: entry "${entry.name}" has no local file header at offset ${entry.offset}`);
    }
    dataAt = entry.offset + 30 + loc.readUInt16LE(26) + loc.readUInt16LE(28);
  } finally {
    await fh.close();
  }

  const raw = createReadStream(path, { start: dataAt, end: dataAt + entry.compressedSize - 1 });
  if (entry.method === 0) return raw;                       // stored
  if (entry.method === 8) return raw.pipe(createInflateRaw());
  throw new Error(
    `${path}: entry "${entry.name}" uses compression method ${entry.method}, which this reader does not `
    + "implement. Refusing rather than handing unknown bytes to inflate, which would yield garbage that "
    + "parses to zero records.");
}

/**
 * The one entry worth ingesting from a USPTO bulk archive.
 *
 * The daily products carry exactly one XML file. If that ever stops being true, this must say so
 * rather than pick one: silently ingesting the first of several would drop the rest of the register
 * with no error anywhere.
 */
export async function soleXmlEntry(path) {
  const entries = (await listEntries(path)).filter((e) => !e.name.endsWith("/"));
  const xml = entries.filter((e) => /\.xml$/i.test(e.name));
  if (xml.length === 1) return xml[0];
  if (xml.length === 0) throw new Error(`${path} contains no .xml entry (found: ${entries.map((e) => e.name).join(", ") || "nothing"})`);
  throw new Error(
    `${path} contains ${xml.length} .xml entries (${xml.map((e) => e.name).join(", ")}). This reader `
    + "expects one per archive; picking one would silently drop the others, so it refuses instead.");
}
