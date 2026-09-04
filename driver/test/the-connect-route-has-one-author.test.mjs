// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE ROUTE THAT NEEDS NO ADDRESS, STATED ONCE.
//
//. The owner installed the product fresh and could not connect it to anything: every
// surface that offers a connector is built around a hosted client address, a local install has none, and
// those surfaces render empty by their own rule — while `mcp-server/CONNECT.md` documents a one-line
// stdio registration that needs no address, no auth and no network, because the assistant spawns the
// server off the reader's own disk. Measured before the fix: `git ls-files portal-ui/src | xargs grep -l
// 'claude mcp add|server.mjs'` returned NOTHING.
//
// THREE SURFACES STATE THIS ROUTE — the Use-your-AI page, `clearotron start`'s closing block, and the
// report's Ask-AI control. A line of instruction with more than one author is this codebase's most
// productive defect: the copies drift, every one still renders, and the contradiction only surfaces as a
// reader following an instruction that does not work. So it is composed in one place and the client-side
// surfaces are HANDED the string. The browser cannot know the install's own path, which turns "must not
// drift" into "cannot" — and this file is what keeps that true.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";
import { stdioConnectCommand, stdioConnectOffer, STDIO_SERVER_NAME, INSTALL_ROOT }
  from "../../shared/stdio-connect.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "the-connect-route-has-one-author";

test("1959 the command is the one CONNECT.md documents, with this install's own path", () => {
  const cmd = stdioConnectCommand({ workDir: "/tmp/workspace" });
  assert.match(cmd, /^claude mcp add /, "not the documented verb — a reader following CONNECT.md would diverge");
  assert.match(cmd, new RegExp(`\\b${STDIO_SERVER_NAME}\\b`), "the server name must match what `claude mcp remove` takes");
  assert.match(cmd, /-- node .*mcp-server\/server\.mjs$/, "it must end at the server this install actually ships");
  assert.ok(cmd.includes(INSTALL_ROOT), "the path is not this install's — a reader would be told to run someone else's");
  // The documented form is in the shipped doc; the command must not contradict the file it came from.
  const doc = readFileSync(join(REPO, "mcp-server", "CONNECT.md"), "utf8");
  assert.match(doc, new RegExp(`claude mcp add ${STDIO_SERVER_NAME}`),
    "CONNECT.md no longer documents this registration under this name — one of the two moved without the other");
});

test("1959 a null workDir omits the setting rather than inventing a directory", () => {
  // Handing a reader a plausible-looking path they never chose is worse than omitting it: the server has
  // its own default, and a wrong workspace root reads as a working connector over an empty pile.
  assert.doesNotMatch(stdioConnectCommand({ workDir: null }), /-e /,
    "a workspace setting appeared with nothing configured to put in it");
  assert.match(stdioConnectCommand({ workDir: "/w" }), /-e CLEAROTRON_WORK_DIR=\/w /,
    "a configured workspace root is not carried, so the reader connects to the wrong pile");
});

/**
 * A file's CODE, with its prose removed. Markdown has no code comments, so it is scanned whole — a
 * document that spells the command IS a second author of it, which is the case this guard began with.
 */
function codeOnly(src, rel) {
  if (rel.endsWith(".md")) return src;
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")            // block comments
    .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");   // line comments, sparing a URL's //
}

test("1959 ONE AUTHOR — no surface composes this command for itself", () => {
  const tracked = trackedFiles(GUARD, { root: REPO });
  if (!tracked) { assert.ok(skipReason(GUARD), "no corpus and no stated reason"); return; }
  const offenders = [];
  for (const f of nonEmpty(tracked, "the tracked tree")) {
    if (f === "shared/stdio-connect.mjs" || f === "mcp-server/CONNECT.md" || f.startsWith("docs/")) continue;
    if (f === `driver/test/${GUARD}.test.mjs`) continue;
    if (!/\.(mjs|js|ts|tsx|md)$/.test(f)) continue;
    const src = readFileSync(join(REPO, f), "utf8");
    // A second author is a file that BUILDS the command, not one that mentions the product's name —
    // and that INTENT was already written here while the check could not honour it. A file explaining
    // why handing `claude mcp add` to a Codex user is a defect was reported as committing it (tracker
    // issue 1976). Same shape as `render-units.mjs`: a unit DOCUMENTING the placeholder mechanism made
    // the renderer refuse, and the fix there was to read directive lines only. So: strip comments,
    // then scan. A second author is code, so nothing that matters is lost.
    const code = codeOnly(src, f);
    if (/claude mcp add/.test(code) && !/stdioConnect(Command|Offer|For)/.test(code)) offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    "a file states this registration without going through shared/stdio-connect.mjs. Three surfaces "
    + "already say this route; a fourth spelling drifts from the other three silently, and the reader "
    + "who follows the stale one gets a command that does not work.");
});

test("1959 `clearotron start` prints the route, and prints the COMPOSED one", () => {
  const src = readFileSync(join(REPO, "bin", "start.mjs"), "utf8");
  assert.match(src, /stdioConnectOffer/,
    "the closing block does not offer the connect route. That block is the last thing a first-time "
    + "reader sees from the command they just ran, and it was where the owner hit the wall.");
  assert.doesNotMatch(src, /claude mcp add [^$`]/,
    "start.mjs spells the command itself instead of taking the composed one");
});

test("1959 the offer carries what a reader needs to judge it, not just the command", () => {
  const offer = stdioConnectOffer({ workDir: null });
  assert.ok(offer.note.length > 40, "no note — a bare command does not say what it does or where it works");
  assert.match(offer.note, /this install/i, "the note must say it only works on a machine with this install");
  assert.match(offer.verify, new RegExp(STDIO_SERVER_NAME), "no way to check it worked");
});
