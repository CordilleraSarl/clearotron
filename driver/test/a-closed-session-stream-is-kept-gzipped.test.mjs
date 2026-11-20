// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CLOSED SESSION'S STREAM IS KEPT GZIPPED. One long session wrote 28 to 41 MB of plain JSON lines, and the archive keeps
// every run's streams. A session that closes is written as `<name>.gz` holding exactly what it wrote; one that never
// closes, as when the process running it is killed, stays plain and readable to its last line; and a compression that
// fails keeps the plain file and says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

const { streamSink } = await import("../engine/session-record.mjs");
const dirOf = (t) => { const d = mkdtempSync(join(tmpdir(), "stream-gz-")); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const LINES = Array.from({ length: 400 }, (_, i) => JSON.stringify({ type: "item.completed", n: i, text: "an invented line of model output" }) + "\n").join("");

test("a closed session's stream is a .gz holding exactly what it wrote, and smaller", (t) => {
  const file = join(dirOf(t), "synthesis.attempt1.jsonl");
  const sink = streamSink(file, { freeBytes: 6 * 1024 ** 3 });
  sink.write(LINES);
  const closed = sink.close();
  assert.equal(closed.file, `${file}.gz`);
  assert.equal(existsSync(file), false, "the plain stream was left beside its gzipped copy");
  assert.equal(gunzipSync(readFileSync(closed.file)).toString("utf8"), LINES);
  assert.equal(closed.bytes, Buffer.byteLength(LINES));
  assert.ok(closed.storedBytes < closed.bytes / 5, `stored ${closed.storedBytes} of ${closed.bytes} bytes`);
});

test("a session that never closes leaves its plain stream, readable to its last line", (t) => {
  const file = join(dirOf(t), "synthesis.attempt1.jsonl");
  const sink = streamSink(file, { freeBytes: 6 * 1024 ** 3 });
  sink.write(LINES);
  // No close: the process running it was killed.
  assert.equal(readFileSync(file, "utf8"), LINES);
  assert.equal(existsSync(`${file}.gz`), false);
});

test("the next session under a name a closed session took takes the next name, not the freed plain one", (t) => {
  const file = join(dirOf(t), "synthesis.attempt1.jsonl");
  const one = streamSink(file, { freeBytes: 6 * 1024 ** 3 }); one.write("first\n"); const a = one.close();
  const two = streamSink(file, { freeBytes: 6 * 1024 ** 3 }); two.write("second\n"); const b = two.close();
  assert.equal(basename(a.file), "synthesis.attempt1.jsonl.gz");
  assert.equal(basename(b.file), "synthesis.attempt1.session2.jsonl.gz");
  assert.equal(gunzipSync(readFileSync(a.file)).toString("utf8"), "first\n", "the first session's stream was written over");
});

test("a compression that fails keeps the plain stream and says why",
  { skip: process.platform === "win32" && "mode bits: a Windows folder made read-only still takes a new file, so the failure cannot be planted" }, (t) => {
  if (process.getuid?.() === 0) return t.skip("root writes into a folder whatever its mode, so the failure cannot be planted");
  const dir = dirOf(t);
  const file = join(dir, "synthesis.attempt1.jsonl");
  const sink = streamSink(file, { freeBytes: 6 * 1024 ** 3 });
  sink.write(LINES);
  chmodSync(dir, 0o500);   // the gzipped copy cannot be created beside it
  let closed;
  try { closed = sink.close(); } finally { chmodSync(dir, 0o700); }
  assert.equal(closed.file, file);
  assert.match(closed.notCompressed ?? "", /EACCES|permission/i);
  assert.equal(readFileSync(file, "utf8"), LINES);
});
