// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHEN A CHILD DIES, THE SUPERVISOR QUOTES IT — tracker issue 278.
//
// `bin/start.mjs` used to report a fatal child with "its own output above says why" while spawning that
// child with stderr INHERITED, so the parent held no copy of the line it was referring to. On the report
// that found this, the child's output never reached the reader's terminal at all: the one line naming
// the cause was gone, and the message sent them scrolling for it. A pointer at output you did not
// capture is worse than silence, because it reads as a working instruction.
//
// stderr is teed now — forwarded as it arrives, and the last lines kept — and this drives the message
// composition directly. A process manager's failure path is precisely the one nobody exercises by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { childExitReport } from "../../bin/start.mjs";

const base = { name: "the engine door", script: "mcp-server/http-server.mjs", code: 1, signal: null };

test("278 the child's own last line is IN the message, not referred to", () => {
  const said = childExitReport({ ...base, tail: ["[trademark-artifacts-http] FATAL: CLEAROTRON_ACCESS_FILE is unset"] });
  assert.match(said, /CLEAROTRON_ACCESS_FILE is unset/, "the cause must be in the sentence a reader is handed");
  assert.doesNotMatch(said, /output above/, "the pointer this replaced must not come back");
  assert.match(said, /exited with code 1/);
  assert.match(said, /the engine door/);
});

test("278 several lines are all carried, in order", () => {
  const said = childExitReport({ ...base, tail: ["first", "second", "third"] });
  assert.match(said, /Its last lines:/, "plural when there are several");
  assert.ok(said.indexOf("first") < said.indexOf("second"), "order is the child's own");
  assert.ok(said.indexOf("second") < said.indexOf("third"));
});

test("278 a SILENT child is reported as silent, not with an empty heading", () => {
  // The case that would otherwise print "Its last lines:" and nothing — which hides the one fact worth
  // having, that the child said nothing at all.
  const said = childExitReport({ ...base, tail: [] });
  assert.doesNotMatch(said, /Its last line/, "no heading over an empty quotation");
  assert.match(said, /without printing anything/, "and the silence is named as the finding it is");
});

test("278 a signal death says which signal, rather than a code that does not exist", () => {
  const said = childExitReport({ ...base, code: null, signal: "SIGKILL", tail: ["killed"] });
  assert.match(said, /exited on SIGKILL/);
  assert.doesNotMatch(said, /with code null/, "a signalled child has no exit code to print");
});
