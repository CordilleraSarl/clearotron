// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 1053 — NO TRACKED SOURCE FILE CONTAINS A NUL BYTE, and the class is asserted, not the instance.
//
// One 0x00 byte in a shipped TypeScript file made git classify it as binary: `git diff` showed
// `Bin N -> M bytes` instead of content, `grep` printed nothing and exited 1, and `git grep` skipped
// it silently — so every check built on any of the three had a hole exactly one file wide and said
// nothing about it. The census for this guard then found a SECOND carrier the issue did not know
// about, in scripts/, whose two NULs sat past git's binary-sniff window and so never even produced
// the Bin-diff tell. Both were the same idiom — a raw NUL typed into a template literal as a
// composite-key separator — and both now spell it as the escape sequence `\u0000`, which builds the
// identical runtime string and leaves the file text.
//
// WHY THE SWEEP READS BYTES AND NOT `grep`. The defect this guards against is precisely the one that
// makes grep useless for guarding it: a NUL-carrying file is the file grep goes quiet on. The first
// census draft here used `grep -P` and reported ZERO carriers over a tree that measurably held eight
// — the instrument failed exactly the way its target fails. Buffers do not have that failure mode.
//
// THE EXEMPTION IS AN EXTENSION LIST, AND IT IS EARNED. Real binary fixtures are tracked on purpose
// (the uspto-local zip fixtures). They are exempted by extension, and a companion test asserts the
// exemption still pays its way in BOTH directions — an extension exempted while no tracked file of
// that kind carries a NUL is a stale hole waiting for a real one to move into (tracker issue 1054's rule, one
// guard over).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "no-nul-bytes (tracked tree)";
const NO_CORPUS = skipReason(GUARD);

// Binary BY DESIGN, each row with its measured population. Growth here is a decision somebody makes
// out loud in a diff, not a default.
const BINARY_EXTENSIONS = new Set([
  ".zip", // providers/uspto-local/test/fixtures/*.zip — six real archive fixtures, measured 2026-08-16
  // docs/assets/example-report.png — ONE file, the public README's screenshot of a finished report
  // (tracker issue 857 decision 4), measured 2026-08-20. It was the first image asset tracked outside portal-ui,
  // whose twelve assets are .svg and therefore text. The row is stated rather than defaulted because
  // the arm below makes the exemption earn itself in both directions: delete the screenshot and this
  // row fails for exempting nothing, and it also fails the day a .png lands that is somehow NUL-free.
  ".png",
  // docs/assets/portal-*.jpg — TWO files, the owner's portal screenshots for the public README,
  // added 2026-09-03 on his ruling. The row exists because .png was here and .jpg was not, so the
  // first JPEG ever tracked in this repository failed a guard written when every image was a PNG —
  // caught by the export's private suite, which is the only thing that runs the whole corpus.
  ".jpg",
]);

/**
 * Every file whose bytes contain 0x00, plus every file the reader could not read at all. The reader
 * is injected so the planted-canary test proves THIS sweep fires, not that a fresh one would — and an
 * unreadable file is returned as its own finding, never folded into "no NUL seen" (an absence the
 * instrument manufactured is not an absence in the tree).
 */
function nulCarriers(files, readFn) {
  const carriers = [];
  const unreadable = [];
  for (const f of files) {
    let bytes = null;
    try { bytes = readFn(f); } catch { /* recorded below */ }
    if (bytes == null) { unreadable.push(f); continue; }
    if (bytes.includes(0)) carriers.push(f);
  }
  return { carriers, unreadable };
}

test("the detector fires on a planted NUL — a zero from an instrument never shown non-zero licenses nothing", () => {
  const planted = new Map([
    ["clean.mjs", Buffer.from("const a = 1;\n")],
    ["carrier.mjs", Buffer.concat([Buffer.from("const k = `a"), Buffer.from([0]), Buffer.from("b`;\n")])],
  ]);
  const { carriers, unreadable } = nulCarriers([...planted.keys()], (f) => planted.get(f));
  assert.deepEqual(carriers, ["carrier.mjs"], "the sweep must find exactly the planted carrier");
  assert.deepEqual(unreadable, []);
  const missing = nulCarriers(["ghost.mjs"], (f) => planted.get(f));
  assert.deepEqual(missing.unreadable, ["ghost.mjs"], "a file the reader cannot produce is a finding, never a clean");
});

test("no tracked source file contains a NUL byte", (ctx) => {
  const corpus = trackedFiles(GUARD, { root: ROOT });
  if (!corpus) return ctx.skip(NO_CORPUS);
  const source = corpus.filter((f) => !BINARY_EXTENSIONS.has(extname(f)));
  const { carriers, unreadable } = nulCarriers(source, (f) => readFileSync(join(ROOT, f)));
  assert.deepEqual(carriers, [],
    "a tracked source file carries a 0x00 byte — git and grep both go quiet on it (#1053). If the byte is a " +
    "composite-key separator, spell it as the \\u0000 escape: identical runtime string, and the file stays text");
  assert.deepEqual(unreadable, [], "tracked files this guard could not read — it cannot certify what it cannot see");
});

test("the binary exemption is earned in both directions", (ctx) => {
  const corpus = trackedFiles(GUARD, { root: ROOT });
  if (!corpus) return ctx.skip(NO_CORPUS);
  for (const ext of BINARY_EXTENSIONS) {
    const ofKind = corpus.filter((f) => extname(f) === ext);
    assert.ok(ofKind.length > 0,
      `BINARY_EXTENSIONS exempts ${ext} but the tree tracks no such file — delete the stale row before something real hides under it`);
    const { carriers } = nulCarriers(ofKind, (f) => readFileSync(join(ROOT, f)));
    assert.ok(carriers.length > 0,
      `every tracked ${ext} file is NUL-free — the ${ext} exemption no longer buys anything; delete the row`);
  }
});
