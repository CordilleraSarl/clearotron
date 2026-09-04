// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// zip.test.mjs — the dependency-free archive reader, against archives a DIFFERENT implementation wrote.
//
// THE FIXTURES ARE THE POINT. Testing a hand-rolled zip reader against a hand-rolled zip writer proves
// only that the two agree with each other. These archives were produced by Python's `zipfile`, so every
// offset, flag and field order below is somebody else's reading of the spec, not a mirror of ours.
//
// What a wrong reader looks like: NOT an exception. A data offset that is a few bytes off inflates to
// truncated XML, the scanner sees fewer <case-file> records, and the index is quietly short. Every
// refusal in zip.js exists because the alternative was an empty or partial index that reports success.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { listEntries, openEntry, soleXmlEntry } from "../src/zip.js";
import { ingestStream } from "../src/ingest.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = async (path) => {
  const chunks = [];
  for await (const c of await openEntry(path, await soleXmlEntry(path))) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
};

test("a deflated archive's entry inflates to the exact bytes on disk", async () => {
  const expected = readFileSync(join(FIX, "daily.xml"), "utf8");
  assert.equal(await read(join(FIX, "daily-deflate.zip")), expected);
});

test("a STORED entry is read without being handed to inflate", async () => {
  // Method 0 through inflateRaw is not an error, it is garbage — and garbage XML parses to zero
  // records rather than throwing.
  const expected = readFileSync(join(FIX, "daily.xml"), "utf8");
  assert.equal(await read(join(FIX, "daily-stored.zip")), expected);
});

test("the end-of-central-directory is found behind a trailing archive comment", async () => {
  // A writer may append up to 64 KB of comment, so the EOCD is often NOT the last bytes of the file.
  // Reading the tail and expecting the record at a fixed offset works on most archives and fails on
  // this one — with "not a zip archive", which at least is loud.
  const expected = readFileSync(join(FIX, "daily.xml"), "utf8");
  assert.equal(await read(join(FIX, "commented.zip")), expected);
});

test("an entry whose LOCAL header carries an extra field is still read from the right offset", async () => {
  // ADDED BECAUSE THE BREAK-MATRIX WENT GREEN. Dropping the local extra-field length from the data
  // offset — the classic zip bug, since the field is usually absent — failed to red any test above,
  // because the writer emits no local extra for a small stored/deflated entry. This fixture forces one
  // (20 bytes of ZIP64 extra), so the offset arithmetic is actually exercised.
  //
  // And it must come from the LOCAL header, not the central directory's copy: a writer is allowed to
  // put different extra fields in the two, and reading the wrong length lands the stream a few bytes
  // into the data. Inflate then errors on a good day and yields truncated XML on a bad one — and
  // truncated XML is fewer marks, silently.
  const path = join(FIX, "zip64-extra.zip");
  const [e] = await listEntries(path);
  assert.equal(e.name, "apc260808.xml");
  assert.equal(await read(path), readFileSync(join(FIX, "daily.xml"), "utf8"));
});

test("entry metadata matches what the writer recorded", async () => {
  const [e] = await listEntries(join(FIX, "daily-deflate.zip"));
  assert.equal(e.name, "apc260808.xml");
  assert.equal(e.method, 8);
  assert.equal(e.size, readFileSync(join(FIX, "daily.xml")).length);
  assert.ok(e.compressedSize > 0 && e.compressedSize < e.size);
});

test("an archive with several XML entries is REFUSED, not silently reduced to the first", async () => {
  await assert.rejects(() => soleXmlEntry(join(FIX, "two-xml.zip")), /2 \.xml entries/);
});

test("an archive with no XML says so rather than yielding nothing", async () => {
  await assert.rejects(() => soleXmlEntry(join(FIX, "no-xml.zip")), /no \.xml entry/);
});

test("an ENCRYPTED entry is refused before it can inflate to garbage", async () => {
  // Synthesised by setting bit 0 of the general-purpose flags in the central directory of a real
  // archive — the same bit a password-protected writer sets. Without this check the encrypted bytes go
  // straight to inflateRaw and the result is an index with no records and no error.
  const dir = mkdtempSync(join(tmpdir(), "uspto-zip-"));
  try {
    const buf = readFileSync(join(FIX, "daily-deflate.zip"));
    let cen = -1;
    for (let i = buf.length - 4; i >= 0; i--) if (buf.readUInt32LE(i) === 0x02014b50) { cen = i; break; }
    assert.ok(cen > 0, "the fixture has a central directory header to mutate");
    buf.writeUInt16LE(buf.readUInt16LE(cen + 8) | 0x0001, cen + 8);
    const p = join(dir, "encrypted.zip");
    writeFileSync(p, buf);
    await assert.rejects(() => listEntries(p), /ENCRYPTED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a TRUNCATED archive is refused rather than read short", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uspto-zip-"));
  try {
    const buf = readFileSync(join(FIX, "daily-deflate.zip"));
    // Keep the EOCD (so the file still looks like a zip) but cut the central directory it points at.
    const p = join(dir, "truncated.zip");
    writeFileSync(p, Buffer.concat([buf.subarray(0, 60), buf.subarray(buf.length - 22)]));
    await assert.rejects(() => listEntries(p), /TRUNCATED|bad signature|central directory/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a file that is not a zip at all is named as such", async () => {
  await assert.rejects(() => listEntries(join(FIX, "daily.xml")), /not a zip archive/);
});

test("the archive round-trips through the ingest scanner to real records", async () => {
  // The end of the chain: archive → inflate → scanner → rows. If the offset arithmetic were wrong this
  // is where it would show as a SHORT count rather than an error.
  const rows = [];
  const total = await ingestStream(await openEntry(join(FIX, "daily-deflate.zip"), await soleXmlEntry(join(FIX, "daily-deflate.zip"))),
    { onBatch: (batch) => rows.push(...batch) });
  assert.equal(total, 2);
  assert.deepEqual(rows.map((r) => r.serial), ["86264144", "86264145"]);
  assert.equal(rows[0].text, "ARBORA CAFÉ", "a multi-byte character survives the archive and the decoder");
  assert.equal(rows[0].status_class, "live");
  assert.equal(rows[1].status_class, "dead");
});

test("a multi-byte character split across two read chunks is not mangled", async () => {
  // THE SILENT ONE, and it needs no archive at all. A read stream chops at arbitrary BYTE offsets, so
  // the two bytes of "É" routinely land in different chunks. Decoding each chunk on its own replaces
  // both halves with U+FFFD: the XML still parses, the record is still stored, and an exact search for
  // the mark finds nothing — a clean negative for a mark that is sitting in the index.
  const xml = readFileSync(join(FIX, "daily.xml"));
  const cut = xml.indexOf(Buffer.from("É", "utf8")) + 1;   // between the two bytes of É
  assert.ok(cut > 1, "the fixture really does carry a multi-byte character");
  const rows = [];
  await ingestStream([xml.subarray(0, cut), xml.subarray(cut)], { onBatch: (b) => rows.push(...b) });
  assert.equal(rows[0].text, "ARBORA CAFÉ");
  assert.ok(!rows[0].text.includes("�"), "no replacement characters — the decoder held the partial sequence");
});
