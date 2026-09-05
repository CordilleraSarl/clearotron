// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The shipped portal bundle carries no engineering commentary.
//
// WHY THIS EXISTS. Vite 8 replaced Rollup with Rolldown, and Rolldown PRESERVES source comments where
// Rollup dropped most of them. On the bump the shipped JS went 665 kB to 993 kB raw (158 to 226 kB
// gzip) and its comment lines went 1,444 to 2,522 — carrying internal engineering prose into every
// client's browser, including a sentence about which file paths staff keep. The firm-reference guard
// caught the symptom (six mentions of the firm against three declared); nothing was watching the cause.
//
// `comments: false` in portal-ui/vite.config.ts fixes it, and this arm is what stops a future bundler
// change quietly undoing it. A config flag nobody checks is a config flag that gets flipped back.
//
// WHAT IS ALLOWED, AND WHY IT IS NOT A LOOPHOLE. Two kinds of comment legitimately survive:
//   * Bundler REGION MARKERS — Rolldown emits `//#region <module path>` / `//#endregion` as structural
//     scaffolding. They name module paths, carry no prose, and removing them is not in our gift.
//   * LICENCE and copyright headers, which a distributor is obliged to reproduce. Stripping those would
//     trade one defect for a worse one.
// Everything else is commentary and does not belong in a client's download.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ASSETS = join(REPO, "portal-ui", "dist", "assets");

// A line that is only a comment. An inline trailing comment after real code is not what this is about —
// the defect is whole lines of prose riding along.
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;
// Rolldown's structural scaffolding.
const REGION_MARKER = /^\s*\/\/#(region|endregion)\b/;
// Licence and attribution, which must survive.
const LEGAL = /SPDX-License-Identifier|@license|@preserve|\bCopyright\b|\bLicensed under\b/i;

const bundles = () => (existsSync(ASSETS) ? readdirSync(ASSETS).filter((f) => f.endsWith(".js")) : []);

test("the built portal bundle carries no engineering commentary", (ctx) => {
  // BUILD OUTPUT, NOT SOURCE — portal-ui/dist is not tracked, so this arm has nothing to read until
  // someone builds. Same shape as shipped-brand-is-the-product's bundle arm, and skipped with a reason
  // rather than passing vacuously: a green over an absent bundle would certify nothing.
  const files = bundles();
  if (!files.length) return ctx.skip("portal-ui/dist is build output and absent here — `npm run build:ui` to run this arm");

  const offenders = [];
  for (const f of files) {
    const lines = readFileSync(join(ASSETS, f), "utf8").split("\n");
    for (const [i, line] of lines.entries()) {
      if (!COMMENT_LINE.test(line)) continue;
      if (REGION_MARKER.test(line)) continue;
      if (LEGAL.test(line)) continue;
      offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 100)}`);
    }
  }
  assert.deepEqual(offenders.slice(0, 12), [],
    `the shipped bundle carries ${offenders.length} line(s) of commentary. Rolldown preserves source `
    + "comments; `comments: false` in portal-ui/vite.config.ts is what keeps them out of a client's "
    + "browser, and something has turned it off or worked around it");
});

test("the arm is not vacuous — the bundle it read has real content and real region markers", (ctx) => {
  // The control. An arm that silently read an empty directory, or a file with no comments of any kind,
  // would pass the assertion above while proving nothing about comment stripping.
  const files = bundles();
  if (!files.length) return ctx.skip("portal-ui/dist is build output and absent here — `npm run build:ui` to run this arm");

  const all = files.map((f) => readFileSync(join(ASSETS, f), "utf8")).join("\n");
  assert.ok(all.length > 100_000, `the bundle is ${all.length} bytes — too small to be the real portal`);
  assert.ok(/^\s*\/\/#region\b/m.test(all),
    "no region markers at all: either the bundler changed or this arm is reading something that is not "
    + "the Rolldown output it was written against, and its allowances no longer mean what they say");
});
