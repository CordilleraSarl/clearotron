// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CHILD'S OUTPUT IS DECODED AS A STREAM, NOT CHUNK BY CHUNK.
//
// Test helpers read a child process's output by adding each chunk to a string as it arrived, and a chunk was
// decoded on its own. A character of two or more bytes split across two chunks then read as replacement
// characters, so the text a test compared grew by a character or two. It surfaced when an em dash in the band
// server's answer landed on a 64 KB pipe boundary: the answer was right, and the test read it as wrong.
// `setEncoding("utf8")` decodes the stream and holds a split character until its last byte arrives. Every
// test-side reader of a child's stdout or stderr now sets it, and this guard refuses a new reader that does
// not. A handler that takes no chunk reads nothing from it and is not a reader.
//
// THE DECODING IS THE READER'S OWN: the same stream's `setEncoding` on the lines just above it. Read across the
// whole file, one decoded reader excused every other reader of a stream by that name in the file, so a raw one
// added beside it passed.
//
// LINE-LOCAL, LIKE THE IMPORT GUARD BESIDE IT. A reader inside a child script written as a template literal is
// read as code and must decode too, which is the direction that refuses. Comment lines are skipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { trackedFiles } from "../../shared/tracked-files.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "a child's output is decoded as a stream";
// ✕ EXCLUDED FROM ITS OWN POPULATION: the control below quotes the shape this guard refuses.
const SELF = "driver/test/a-childs-output-is-decoded-as-a-stream.test.mjs";
const TEST_SIDE = (rel) => /(^|\/)test\/|\.test\./.test(rel);

const SITE = /([A-Za-z_$][\w$]*)\??\.(stdout|stderr)\??\.(?:on|once|addListener|prependListener)\(\s*(['"])data\3\s*,\s*(?:async\s+)?(\(\s*\)|function\s*\(\s*\))?/g;

// How far above a reader its own `setEncoding` may sit. Every reader in the tree has it within three lines.
const WINDOW = 5;

/** Every reader of a child's stdout or stderr in a source: its line, receiver and stream, whether its handler takes the chunk, and whether that stream is decoded on the lines just above the reader. PURE. */
function readersIn(src) {
  const lines = src.split("\n"), out = [];
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    for (const m of l.matchAll(SITE)) {
      const [, recv, stream, , noChunk] = m;
      const above = [...lines.slice(Math.max(0, i - WINDOW), i), l.slice(0, m.index)].join("\n");
      out.push({ line: i + 1, recv, stream, takesChunk: !noChunk,
        decoded: new RegExp(`\\b${recv}\\??\\.${stream}\\??\\.setEncoding\\(`).test(above) });
    }
  });
  return out;
}

test("every test-side reader of a child's output decodes the stream", (t) => {
  const all = trackedFiles(GUARD, { root: REPO, pathspec: ["*.mjs", "*.js", "*.cjs"] });
  if (all === null) return t.skip("no tracked corpus in this tree — the guard could not look");
  assert.ok(all.includes(SELF), "this guard's own file is not in the corpus — the exclusion is aimed at nothing");
  const sites = [];
  for (const rel of all.filter(TEST_SIDE)) {
    if (rel === SELF) continue;
    let src;
    try { src = readFileSync(join(REPO, rel), "utf8"); } catch { continue; }
    for (const s of readersIn(src)) sites.push({ rel, ...s });
  }
  // THE FLOOR: far fewer readers than the tree holds means the reading broke, not that the tree improved.
  assert.ok(sites.length >= 80, `only ${sites.length} readers of a child's output were read — the extractor is not reading the tree`);
  const raw = sites.filter((s) => s.takesChunk && !s.decoded).map((s) => `${s.rel}:${s.line}  ${s.recv}.${s.stream}`);
  assert.deepEqual(raw, [], `these read a child's output chunk by chunk; call setEncoding("utf8") on the stream before reading it:\n  ${raw.join("\n  ")}`);
});

test("the guard refuses a chunk-by-chunk reader, and passes a decoded one and a handler that takes no chunk", () => {
  const reader = 'child.stdout.on("data", (d) => { out += d; });';
  assert.deepEqual(readersIn(reader).map((s) => [s.recv, s.stream, s.takesChunk, s.decoded]), [["child", "stdout", true, false]]);
  assert.equal(readersIn(`child.stdout.setEncoding("utf8");\n${reader}`)[0].decoded, true);
  assert.equal(readersIn(`child.stderr.setEncoding("utf8");\n${reader}`)[0].decoded, false, "another stream's decoding counted for this one");
  const two = readersIn(`child.stdout.setEncoding("utf8");\n${reader}\n${"\n".repeat(WINDOW)}${reader}`);
  assert.deepEqual(two.map((s) => s.decoded), [true, false], "one decoded reader excused another of the same stream in its file");
  assert.equal(readersIn(`c.stdout?.once("data", () => started());`)[0].takesChunk, false);
  assert.deepEqual(readersIn(`// ${reader}`), [], "a comment was read as a reader");
});

test("setEncoding holds a character split across two chunks; adding each chunk on its own does not", async () => {
  const read = (decode) => new Promise((resolve) => {
    const s = new PassThrough();
    if (decode) s.setEncoding("utf8");
    let out = "";
    s.on("data", (d) => { out += d; });
    s.on("end", () => resolve(out));
    s.write(Buffer.from([0xe2]));         // the first byte of an em dash
    s.write(Buffer.from([0x80, 0x94]));   // and its last two, in the next chunk
    s.end();
  });
  assert.notEqual(await read(false), "—", "control: decoded chunk by chunk, the split dash reads whole — the arm below would prove nothing");
  assert.equal(await read(true), "—");
});
