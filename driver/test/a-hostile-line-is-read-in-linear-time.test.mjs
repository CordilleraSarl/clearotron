// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-hostile-line-is-read-in-linear-time.test.mjs — two regexes that read text nobody controls finish in
// time proportional to the text.
//
// Code scanning flagged both as polynomial, and a benchmark confirmed it (2026-09-18): doubling a hostile
// input roughly quadrupled the time. The internal-note marker regex took 4.3 s on a 40,000-character
// line holding one unclosed marker; the trailing-slash regex took 2.8 s on 40,000 slashes ending in a
// letter. A report line is model-written, and a queue path is configuration: neither is ours to bound.
// Rewritten, each takes about a millisecond at ten times that length.
//
// Asserted as a generous wall, not a benchmark: a whole second for 400,000 characters. The quadratic
// forms needed minutes there, so this separates the two shapes by orders of magnitude and does not
// flicker on a busy machine. The outputs are pinned too, so "fast" cannot come from doing less.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripInternal } from "../publish/parse.mjs";
import { queueWatchVerdict } from "../queue-watch-verdict.mjs";

const N = 400_000;
const ms = (f) => { const t = process.hrtime.bigint(); f(); return Number(process.hrtime.bigint() - t) / 1e6; };

test("an unclosed internal-note marker followed by a long run of spaces is read in linear time", () => {
  const took = ms(() => stripInternal("*::p::" + " ".repeat(N) + "x", { client: true }));
  assert.ok(took < 1000, `${N} characters took ${took.toFixed(0)} ms — the marker regex is super-linear again`);
});

test("the marker rewrite keeps every output the old one gave", () => {
  // The internal note is still found and still stripped for a client, wrapped or bare.
  assert.equal(stripInternal("keep this **::p:: drop that**", { client: true }), "keep this");
  assert.equal(stripInternal("keep this *::p:: drop that*", { client: true }), "keep this");
  assert.equal(stripInternal("keep **::p::   drop that**"), "keep [internal] drop that");
  assert.equal(stripInternal("no marker at all", { client: true }), "no marker at all");
});

test("a queue path of a long run of slashes is read in linear time, and its trailing slashes still go", () => {
  const hostile = "/".repeat(N) + "x";
  const took = ms(() => queueWatchVerdict({ queueDirs: [hostile], watched: [hostile + "/"], unitPath: "unit.path" }));
  assert.ok(took < 1000, `${N} slashes took ${took.toFixed(0)} ms — the trailing-slash regex is super-linear again`);
  // THE OUTPUT: a watched path differing only by trailing slashes is the same directory.
  const v = queueWatchVerdict({ queueDirs: ["/srv/queue"], watched: ["/srv/queue///"], unitPath: "unit.path" });
  assert.notEqual(v.state, "fail", `trailing slashes made a watched directory read as unwatched: ${v.message}`);
});
