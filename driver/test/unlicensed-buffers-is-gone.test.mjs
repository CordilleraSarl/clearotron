// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE ONE UNLICENSED PACKAGE IN THE PRODUCTION CHAIN IS GONE, AND STAYS GONE.
//
// `buffers@0.1.1` reached production through driver → exceljs → unzipper → binary. It carried no
// `license` field, no LICENSE file and no header: unlicensed is not permissive, it is all rights
// reserved, and this repository ships AGPL-3.0-only. `vendor/buffers` is a clean-room replacement
// written from the consumer's requirements — the five members `binary` uses — and substituted through
// an `overrides` entry, so the package LEAVES the tree rather than being shadowed by it.
//
// WHAT WOULD PUT IT BACK, SILENTLY. Dropping either half of the declaration: `dependencies.buffers`
// alone resolves nothing for binary, and `overrides` alone has no target to point at. Either way the
// next `npm ci` reinstalls the registry tarball and everything still works — which is the point. The
// only visible difference would be a line in a lockfile nobody reads, so the lockfile is asserted here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

test("#854 both halves of the substitution are declared — either one alone silently restores the registry copy", () => {
  const pkg = readJSON(join(ROOT, "package.json"));
  assert.equal(pkg.dependencies?.buffers, "file:vendor/buffers",
    "the root no longer depends on the local copy, so `$buffers` in overrides points at nothing");
  assert.equal(pkg.overrides?.buffers, "$buffers",
    "the override is gone — binary resolves buffers from the registry again, unlicensed");
  const vendored = readJSON(join(ROOT, "vendor", "buffers", "package.json"));
  assert.equal(vendored.license, "AGPL-3.0-only", "the replacement must state its licence; that was the whole defect");
});

test("#854 the LOCKFILE — the file CI actually installs from — resolves buffers locally, with no tarball", () => {
  const lock = readJSON(join(ROOT, "package-lock.json"));
  const entry = lock.packages?.["node_modules/buffers"];
  assert.ok(entry, "there is no buffers entry at all — this arm can no longer tell which copy CI installs");
  assert.equal(entry.link, true, "the lock points at a package to download, not at the local one");
  assert.equal(entry.resolved, "vendor/buffers");
  // The tarball URL and its integrity hash are the two things that would bring the unlicensed copy back.
  assert.equal(entry.integrity, undefined, "an integrity hash means a registry tarball is still pinned here");
  assert.doesNotMatch(String(entry.resolved), /^https?:/, "still resolving over the network");
  assert.ok(lock.packages?.["vendor/buffers"], "the local package is not in the lock, so `npm ci` cannot link it");
});

test("#854 `buffers` resolves to our file, and that file says who owns it", () => {
  const resolved = require.resolve("buffers");
  assert.ok(resolved.includes(join("vendor", "buffers")),
    `buffers resolved to ${resolved} — the replacement is not the copy in play`);
  const src = readFileSync(resolved, "utf8");
  assert.match(src, /SPDX-License-Identifier: AGPL-3\.0-only/, "the replacement carries no licence header either");
});

// ── the contract, from the five members binary/index.js uses ────────────────────────────────────────

test("#854 length, push and slice behave as the concatenated byte range", () => {
  const Buffers = require("buffers");
  const b = Buffers();
  assert.equal(b.length, 0);
  b.push(Buffer.from("abc"));
  b.push(Buffer.from("de"), Buffer.from("fgh"));
  assert.equal(b.length, 8, "length is not the total across the list");
  assert.equal(b.slice().toString(), "abcdefgh", "slice() with no arguments must return the whole range");
  assert.equal(b.slice(2, 5).toString(), "cde", "a slice spanning a boundary came back wrong");
  assert.equal(b.slice(3, 3).length, 0);
  assert.equal(b.slice(0, 99).toString(), "abcdefgh", "an end past the range must clamp, not throw");
  // A COPY, not a view: binary hands this to a caller that keeps it while the list is spliced away.
  const s = b.slice(0, 3);
  s[0] = 0x7a;
  assert.equal(b.slice(0, 3).toString(), "abc", "slice returned a view — mutating it corrupted the list");
});

test("#854 splice returns a BUFFERS, not a Buffer — binary calls .slice() on the result", () => {
  // binary/index.js:59-61 does `buf = buffers.splice(0, bytes); buf = buf.slice();`. A splice that
  // returns a plain Buffer still answers `.slice()`, but with Buffer semantics — the bug survives a
  // smoke test and shows up as a short read on real data.
  const Buffers = require("buffers");
  const b = Buffers();
  b.push(Buffer.from("abcd"), Buffer.from("efgh"));
  const cut = b.splice(0, 6);
  assert.equal(typeof cut.slice, "function", "the splice result cannot be sliced");
  assert.equal(cut.slice().toString(), "abcdef", "the removed bytes are wrong");
  assert.equal(cut.length, 6);
  // THE THREE ASSERTIONS ABOVE ALL PASS ON A PLAIN BUFFER — measured, by planting exactly that. They
  // check the accessor, not the type, and Buffer answers every one of them. The difference that bites
  // is what .slice() RETURNS: a Buffers copies, a Buffer hands back a VIEW, so binary's
  // `buf = buf.slice()` would give a caller memory the stream goes on to reuse.
  assert.equal(Buffer.isBuffer(cut), false,
    "splice returned a plain Buffer, whose .slice() is a view onto memory the stream reuses");
  const copy = cut.slice();
  copy[0] = 0x7a;
  assert.equal(cut.slice().toString(), "abcdef", "the splice result's .slice() aliased it instead of copying");
  assert.equal(b.length, 2, "the list did not shrink by what was removed");
  assert.equal(b.slice().toString(), "gh", "the remainder is wrong");
  assert.equal(b.splice(0, 99).slice().toString(), "gh", "a splice longer than the list must clamp");
  assert.equal(b.length, 0);
});

test("#854 indexOf finds a needle that STRADDLES two buffers, which is why it cannot delegate per-buffer", () => {
  const Buffers = require("buffers");
  const b = Buffers();
  b.push(Buffer.from("hello wo"), Buffer.from("rld and more"));
  assert.equal(b.indexOf(Buffer.from("world")), 6, "a needle across the boundary was not found");
  assert.equal(b.indexOf("world"), 6, "a string needle is not accepted");
  assert.equal(b.indexOf(Buffer.from("hello")), 0);
  assert.equal(b.indexOf(Buffer.from("more")), 16);
  assert.equal(b.indexOf(Buffer.from("absent")), -1, "a miss must be -1, not a throw and not 0");
  assert.equal(b.indexOf(Buffer.from("o"), 5), 7, "the offset was ignored");
  // A needle spanning THREE buffers — the case a two-buffer join would miss.
  const c = Buffers();
  c.push(Buffer.from("ab"), Buffer.from("cd"), Buffer.from("ef"));
  assert.equal(c.indexOf(Buffer.from("bcde")), 1);
});

test("#854 the consumer still works: an xlsx written and read back through unzipper -> binary -> buffers", async () => {
  // The read path is the only consumer of this package in the product. A contract test that passes
  // while exceljs cannot open a workbook would prove nothing worth having.
  const { default: ExcelJS } = await import("exceljs");
  const file = join(mkdtempSync(join(tmpdir(), "buffers-xlsx-")), "book.xlsx");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Findings");
  ws.columns = [{ header: "Mark", key: "m" }, { header: "Class", key: "c" }];
  for (let i = 0; i < 200; i++) ws.addRow({ m: `MARK-${i}-${"x".repeat(i % 30)}`, c: (i % 45) + 1 });
  await wb.xlsx.writeFile(file);

  const back = new ExcelJS.Workbook();
  await back.xlsx.readFile(file);
  const rs = back.getWorksheet("Findings");
  assert.equal(rs.rowCount, 201, "the workbook did not come back whole");
  let wrong = 0;
  for (let i = 0; i < 200; i++) {
    const r = rs.getRow(i + 2);
    if (r.getCell(1).value !== `MARK-${i}-${"x".repeat(i % 30)}`) wrong++;
    if (r.getCell(2).value !== (i % 45) + 1) wrong++;
  }
  assert.equal(wrong, 0, "cells did not survive the round trip through the replaced package");
});
