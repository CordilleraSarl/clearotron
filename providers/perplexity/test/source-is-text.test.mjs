// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// This file must stay greppable, and its cell key must keep its value.
//
// `cellKey` joins a term and a platform with a NUL, deliberately: NUL is the one character that can never
// appear in a search term or a platform name, so cellKey("A|B", "etsy") cannot collide with
// cellKey("A", "B|etsy"). That is load-bearing — the key is what the receipts join uses to decide whether a
// dictated grid cell was actually searched, and a collision there would silently account one cell as two.
//
// It was written as a RAW NUL BYTE in the source, and that had a consequence nobody had noticed: `file`
// classified core.js as "data" rather than JavaScript, and **grep skipped the entire file**. Not "found no
// match" — skipped, silently, returning clean regardless of contents. Any grep-based audit, secret scan, or
// "does this pattern exist" check was blind to this one file. It was found by grepping for a fix that WAS
// present and getting nothing back.
//
// The byte is now written as the escape `\u0000`. Identical character at runtime, ordinary text on disk.
// The delimiter is NOT removed — removing it is the tempting "cleanup" that would merge distinct cells.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SRC = fileURLToPath(new URL("../src/core.js", import.meta.url));
const NUL = String.fromCharCode(0);

test("NO SOURCE FILE IN THIS TREE CARRIES A RAW CONTROL BYTE — or grep goes blind on it", () => {
  // Widened from core.js to the whole provider tree, INCLUDING THIS TEST, because writing the check is not
  // the same as obeying it: the first draft of this very file used raw NULs in its own fixtures and was
  // itself classified as "data". A rule its author trips over on the first attempt is a rule worth
  // enforcing by machine.
  const dir = fileURLToPath(new URL("..", import.meta.url));
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|js|json)$/.test(e.name)) files.push(p);
    }
  };
  walk(dir);
  // Assert WHAT was walked, not how many: a count is a number that drifts, and "walked 3 files" would
  // still pass on a tree that had silently stopped including core.js.
  assert.ok(files.some((f) => f.endsWith("src/core.js")), "the walk reached core.js — the file this exists for");
  assert.ok(files.some((f) => f.endsWith("source-is-text.test.mjs")), "…and this test, which broke the rule first");
  for (const f of files) {
    const bytes = readFileSync(f);
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d)
        assert.fail(`${f}: raw control byte 0x${b.toString(16).padStart(2, "0")} at ${i} — write it as an escape. `
          + `A literal one makes \`file\` report "data" and makes grep SKIP the whole file, silently.`);
    }
  }
});

test("…and the delimiter is still THERE, as an escape — it was never the problem", () => {
  const src = readFileSync(SRC, "utf8");
  assert.match(src, /const cellKey = \(term, platform\) => `\$\{gnorm\(term\)\}\\u0000\$\{gnorm\(platform\)\}`/,
    "the NUL separator survives as \\u0000; deleting it would merge distinct grid cells");
});

test("THE KEY'S RUNTIME VALUE IS UNCHANGED — escape and raw byte are the same character", () => {
  // Reconstructed rather than imported: cellKey is module-private. What matters is that the escape the
  // source now uses produces exactly the byte the source used to contain.
  const gnorm = (s) => String(s ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").toLowerCase();
  const viaEscape = (t, p) => `${gnorm(t)}\u0000${gnorm(p)}`;
  const viaRawByte = (t, p) => gnorm(t) + NUL + gnorm(p);
  for (const [t, p] of [["A|B", "etsy"], ["A", "B|etsy"], ["  Satin & Steel ", "Amazon"], ["", ""], [null, undefined], ['"quoted"', "`etsy`"]])
    assert.equal(viaEscape(t, p), viaRawByte(t, p), `${JSON.stringify([t, p])}`);
});

test("the separator still does its job: a term containing the obvious delimiter cannot collide", () => {
  // Why NUL and not "|": the gap rows in this plugin's own contract are pipe-joined strings, so a term
  // carrying a pipe would collide with a different (term, platform) pair under any printable separator.
  const gnorm = (s) => String(s ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").toLowerCase();
  const key = (t, p) => `${gnorm(t)}\u0000${gnorm(p)}`;
  assert.notEqual(key("A|B", "etsy"), key("A", "B|etsy"), "distinct cells stay distinct");
  assert.equal(key(" A|B ", "ETSY"), key("a|b", "etsy"), "…while normalisation still folds the same cell together");
});
