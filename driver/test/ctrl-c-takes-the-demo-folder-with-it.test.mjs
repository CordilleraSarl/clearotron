// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// CTRL-C TAKES THE DEMO'S FOLDER WITH IT, LIKE ANY OTHER STOP.
//
// The README promises the demo "removes everything it made when you close it — nothing of it is left on
// the machine". Most readers close it with Ctrl-C, which is not the orderly stop the removal was written
// against: if the signal path bypassed the teardown, or exited before it, the promise would hold only
// for the way almost nobody stops it, and the folder would be left behind in the ordinary case.
//
// The decision itself — which base may be removed, and what `--keep` means — is held by
// `the-demo-takes-its-folder-with-it.test.mjs`. This is the other half: that the decision is REACHED on
// the paths a reader actually takes.
//
// READ FROM THE SOURCE, deliberately. Driving it would mean starting a real supervisor, binding ports
// and a portal, and the acceptance for this asks for a test that does not spawn a browser. What can go
// wrong here is structural — a signal wired somewhere else, an exit before the teardown, or the removal
// drifting out of the function the signals reach — and all three are visible in the text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const START = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");

/** The body of `shutdown`, which is where every stop ends up. */
function shutdownBody() {
  const at = START.search(/(async )?function shutdown\s*\(/);
  assert.ok(at > 0, "there is no shutdown function any more, so nothing below reads what a stop does");
  // To the `process.exit(code)` that ends it — the removal has to sit before that line, not after.
  const end = START.indexOf("process.exit(code)", at);
  assert.ok(end > at, "shutdown no longer ends in an exit, so its extent cannot be read");
  return START.slice(at, end);
}

test("Ctrl-C and a terminated process both land on the same teardown", () => {
  for (const sig of ["SIGINT", "SIGTERM"])
    assert.match(START, new RegExp(`process\\.on\\("${sig}",\\s*\\(\\)\\s*=>\\s*\\{?\\s*void shutdown\\(`),
      `${sig} no longer reaches shutdown — a demo closed that way would keep its folder`);
});

test("the folder removal is inside the teardown the signals reach", () => {
  // THE DEFECT THIS GUARDS: a removal that drifts out of `shutdown` — into the orderly-stop path, or
  // after the exit — still passes every arm about WHICH folder may be removed, and silently stops
  // happening on Ctrl-C.
  const body = shutdownBody();
  assert.match(body, /rmSync\(paths\.base/, "the removal is no longer inside the teardown a signal reaches");
  assert.match(body, /DEMO && !READER_BASE && !DEMO_KEEP/,
    "the removal's condition is not in the teardown, so a signal cannot reach the decision");
});

test("a stop that keeps the folder still says how to remove it", () => {
  // The other branch, on the same path: a reader who asked to keep it is owed the one command, and
  // that line must be reachable from a signal too — it was unreachable for the whole of 0.3.1.
  const body = shutdownBody();
  assert.match(body, /The demo's folder is kept at/, "the keep branch is not reachable from a signal stop");
  assert.match(body, /rm -rf/, "the keep branch no longer prints the remove command");
});

test("a failed removal is said rather than swallowed", () => {
  // The promise printed here is the one thing a reader cannot check once the window has closed, so a
  // cleanup that failed must not print that it succeeded.
  const body = shutdownBody();
  assert.match(body, /could not remove/, "a failed cleanup no longer says so");
  const good = body.indexOf("is gone, and nothing of it is left");
  const bad = body.indexOf("could not remove");
  assert.ok(good > 0 && bad > 0, "one of the two outcomes is no longer stated");
  assert.ok(body.slice(0, bad).includes("try {"), "the success line is not inside the guarded block");
});
