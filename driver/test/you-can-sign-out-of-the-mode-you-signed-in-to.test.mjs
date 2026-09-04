// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — F47. On every fresh install you could sign in and you could not sign out.
//
// Three emitters linked unconditionally to Cloudflare Access's endpoint — two screens and this service's
// own error page. That is correct on a fronted deployment. On LOCAL sign-in, which is what
// `clearotron start` gives every fresh install, there is no Cloudflare, and the browser was handed
// `{"error":"not_found"}` as a raw JSON blob. There IS a real session in that mode, created by a
// passphrase, and nothing could end it.
//
// Not cosmetic: on a shared or borrowed machine, ending your session is the one control a person
// expects to work.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_ROUTE_HEADS } from "../portal-service.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";   // — the corpus check goes through the ONE helper

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const SERVICE = readFileSync(join(REPO, "driver", "portal-service.mjs"), "utf8");

/**
 * Every portal and driver source file, as ONE walk shared by the two arms below.
 *
 * — this is the recursion STEP of a discovered set, and an empty directory is a normal thing to
 * meet part-way through a tree. The aggregate is what must not be empty, and the arm below asserts it
 * before anything is concluded from a clean result. Registered in GUARDED_AT_THE_WALK for that reason.
 */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|mjs)$/.test(e.name)) out.push(p);
    }
  };
  walk(join(REPO, "portal-ui", "src"));
  walk(join(REPO, "driver"));
  return out;
}


test("2179-F47 sign-out is a RESERVED server route, or the shell answers it with a silent 200", () => {
  // A head the server answers but does not reserve falls through to the static handler, which returns
  // the app shell. For a route whose whole job is to end a session, a 200 of the wrong thing is the
  // worst available outcome — this file's own service comment says so about the others.
  assert.ok(SERVER_ROUTE_HEADS.includes("sign-out"),
    `sign-out must be reserved; heads are ${SERVER_ROUTE_HEADS.join(", ")}`);
});

test("2179-F47 the local branch's gate ADMITS the route, or its half is unreachable code", () => {
  // WHAT A SOURCE SCAN IS ACTUALLY GOOD FOR, and nothing more. This arm used to pin both branches'
  // exact expressions, and it went red when the fronted one was rewritten from a helper call to four
  // inline lines — a rewrite that FIXED a 500. An arm that reddens on a correct fix was asserting the
  // spelling, not the behaviour: the third time this batch that a shape assertion stood in for a
  // driven one, and the second time in this file's own subject.
  //
  // Both branches' BEHAVIOUR is driven in a-gone-session-meets-a-door-not-a-json-body.test.mjs, over a
  // real socket, in both identity modes. What cannot be driven from there is reachability inside a gate
  // this test file can read, so that is what stays here.
  assert.match(SERVICE, /url\.pathname === "\/portal\/login" \|\| url\.pathname === "\/portal\/logout" \|\| url\.pathname === "\/portal\/sign-out"/,
    "the local branch's gate must admit the route, or the local half never executes");
});

test("2179-F47 the population this walks is real, so an empty result means something", () => {
  // — a discovered set says how big it is before anything is concluded from it. An offenders
  // list that is empty because the walk found no files is not a pass. Measured 1203 on 2026-09-04.
  // Through the shared helper, not a hand-rolled length check: requires the corpus guard this
  // walk's registry entry points at to be the one the detector can actually see.
  const files = nonEmpty(sourceFiles(), "the portal and driver source walk");
  assert.ok(files.length > 200,
    `expected the portal and driver sources — measured 1203 on 2026-09-04 — and found ${files.length}`);
});

test("2179-F47 NO surface links straight to Cloudflare's endpoint any more", () => {
  // The class arm. The defect was three emitters each assuming the fronted mode; naming the three that
  // existed would pass while a fourth is added tomorrow, so this walks the population.
  const offenders = [];
  for (const p of nonEmpty(sourceFiles(), "the portal and driver source walk")) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      // The DEFECT's shape: a link or redirect TARGET. Prose about the endpoint is how both the fix
      // and this arm explain themselves, and a grep that caught that would be unwriteable-around.
      if (/(href|action)\s*=\s*["']\/cdn-cgi\/access\/logout/.test(line))
        offenders.push(`${p}: ${line.trim().slice(0, 90)}`);
    }
  }
  assert.deepEqual(offenders, [],
    `these link a browser straight at Cloudflare's endpoint, which does not exist on a local-sign-in install:\n${offenders.join("\n")}`);
});

test("2179-F47 the three known emitters now point at the resolving route", () => {
  const shell = readFileSync(join(REPO, "portal-ui", "src", "shell", "AppShell.tsx"), "utf8");
  const prefs = readFileSync(join(REPO, "portal-ui", "src", "screens", "Preferences.tsx"), "utf8");
  assert.match(shell, /href="\/portal\/sign-out"/, "the shell's Log out menu item");
  assert.match(prefs, /href="\/portal\/sign-out"/, "Preferences' Log out pill");
  assert.match(SERVICE, /href="\/portal\/sign-out">Sign in as someone else/, "the service's own error page");
});
