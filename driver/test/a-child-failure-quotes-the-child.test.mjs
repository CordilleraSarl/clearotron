// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHEN A CHILD DIES, THE SUPERVISOR QUOTES IT.
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

test("the child's own last line is IN the message, not referred to", () => {
  const said = childExitReport({ ...base, tail: ["[trademark-artifacts-http] FATAL: CLEAROTRON_ACCESS_FILE is unset"] });
  assert.match(said, /CLEAROTRON_ACCESS_FILE is unset/, "the cause must be in the sentence a reader is handed");
  assert.doesNotMatch(said, /output above/, "the pointer this replaced must not come back");
  assert.match(said, /exited with code 1/);
  assert.match(said, /the engine door/);
});

test("several lines are all carried, in order", () => {
  const said = childExitReport({ ...base, tail: ["first", "second", "third"] });
  assert.match(said, /Its last lines:/, "plural when there are several");
  assert.ok(said.indexOf("first") < said.indexOf("second"), "order is the child's own");
  assert.ok(said.indexOf("second") < said.indexOf("third"));
});

test("a SILENT child is reported as silent, not with an empty heading", () => {
  // The case that would otherwise print "Its last lines:" and nothing — which hides the one fact worth
  // having, that the child said nothing at all.
  const said = childExitReport({ ...base, tail: [] });
  assert.doesNotMatch(said, /Its last line/, "no heading over an empty quotation");
  assert.match(said, /without printing anything/, "and the silence is named as the finding it is");
});

test("a signal death says which signal, rather than a code that does not exist", () => {
  const said = childExitReport({ ...base, code: null, signal: "SIGKILL", tail: ["killed"] });
  assert.match(said, /exited on SIGKILL/);
  assert.doesNotMatch(said, /with code null/, "a signalled child has no exit code to print");
});

// The retained tail is assembled from stream chunks, and a chunk is not a line. This drives the
// assembly the supervisor uses rather than asserting on the shape of the message alone.
const assemble = (chunks, max = 12) => {
  const tail = []; let pending = "";
  const keep = (line) => { if (line.trim()) tail.push(line); while (tail.length > max) tail.shift(); };
  for (const c of chunks) { const parts = (pending + c).split("\n"); pending = parts.pop() ?? ""; for (const l of parts) keep(l); }
  keep(pending);
  return tail;
};

test("a line split across two chunks is quoted whole, not in halves", () => {
  // The pipe gives whatever boundary it gives. Splitting each chunk on its own would push two half-lines
  // and hand the reader a cut sentence — on precisely the message that exists because they could not see
  // the original. Found in review, 2026-09-08.
  const whole = "FATAL: CLEAROTRON_ACCESS_FILE is unset — refusing to start.";
  const tail = assemble(["FATAL: CLEAROTRON_ACC", "ESS_FILE is unset — refusing to start.\n"]);
  assert.deepEqual(tail, [whole], `the line arrived in pieces: ${JSON.stringify(tail)}`);
});

test("a process that dies mid-line still has its last words kept", () => {
  // No trailing newline, because it did not get that far. The remainder is the thing it was saying.
  assert.deepEqual(assemble(["one\n", "two\n", "three, unterminated"]), ["one", "two", "three, unterminated"]);
});
