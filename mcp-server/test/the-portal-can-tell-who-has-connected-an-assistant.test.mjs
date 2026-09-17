// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Reading the connector's access log back, so a report can tell whether this reader has an assistant.
//
// WHAT THESE ARMS ARE FOR. The Ask-AI button on a report offers a menu to a reader who has connected and
// a short setup panel to one who has not, and this log is the only evidence either process holds —
// enrolment says a person MAY connect, never that they did. Every arm here is about the difference
// between a fact and the absence of one:
//
//   · a log that is not there is NOT "nobody has connected". It is a could-not-look, and a caller that
//     rendered it as "you have never connected" would be asserting a measurement nobody took.
//   · the window is bounded, so "not in the tail" is also not "never". The control carries its own way
//     past that, and these arms pin the honest shape rather than pretending the window is the history.
//   · the PATH is the connector's fact, not the portal's. The portal computing it from its own
//     environment is the class that nearly struck a live key's record on a split install.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAudit, readConnections, auditPaths, LEGACY_AUDIT_PATH, UNNAMED_DOOR } from "../lib/audit.mjs";

const scratch = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "connected-"));
const line = (o) => JSON.stringify(o) + "\n";

test("a reader who called a connector is found; one who never did is not", () => {
  const dir = scratch();
  const path = join(dir, "access.jsonl");
  writeFileSync(path, [
    line({ ts: "2026-09-10T09:00:00Z", email: "reader@example.test", method: "tools/call", tool: "get_run" }),
    line({ ts: "2026-09-11T09:00:00Z", email: "other@example.test", method: "initialize" }),
  ].join(""));

  const seen = readConnections({ paths: [path] });
  assert.equal(seen.available, true);
  assert.ok(seen.emails.has("reader@example.test"));
  assert.ok(!seen.emails.has("nobody@example.test"), "a reader who never called must not be found");
});

test("the address is matched however it was capitalised", () => {
  // Sign-in identity comes from an identity provider and the log records whatever that call carried.
  // A mixed-case address matching nothing would park a connected reader on the setup panel for good —
  // the same defect that lost half a person per removal on the people file.
  const dir = scratch();
  const path = join(dir, "access.jsonl");
  writeFileSync(path, line({ ts: "2026-09-10T09:00:00Z", email: "Reader@Example.TEST", method: "initialize" }));
  assert.ok(readConnections({ paths: [path] }).emails.has("reader@example.test"));
});

test("NO LOG IS NOT AN EMPTY LOG: available says which one this is", () => {
  // The whole point of the field. A caller that only looked at `emails.size` could not tell a fresh
  // installation apart from one where nobody has ever connected, and would draw the same screen while
  // meaning two different things — one of them a claim it had no basis for.
  const dir = scratch();
  const missing = readConnections({ paths: [join(dir, "nothing-here.jsonl")] });
  assert.equal(missing.available, false, "a path that does not exist is a could-not-look");
  assert.equal(missing.emails.size, 0);

  const empty = join(dir, "empty.jsonl");
  writeFileSync(empty, "");
  const read = readConnections({ paths: [empty] });
  assert.equal(read.available, true, "a log that exists and says nobody HAS been read");
  assert.equal(read.emails.size, 0);
});

test("an unreadable log is a could-not-look that says so, and never throws", () => {
  // Best-effort is the contract: this is called on a page load and a permissions problem on one box
  // must not 500 every report on it. But it must not go quiet either — the note is what makes an
  // operator able to find out why every reader is being offered setup.
  const dir = scratch();
  const path = join(dir, "locked.jsonl");
  writeFileSync(path, line({ email: "reader@example.test" }));
  chmodSync(path, 0o000);
  try {
    const seen = readConnections({ paths: [path] });
    assert.equal(seen.available, false, "unreadable is not 'nobody connected'");
    assert.ok(seen.note, "and the reason is carried, not swallowed");
  } finally {
    chmodSync(path, 0o600);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("BOTH CANDIDATE PATHS ARE READ, because the two processes resolve the default at different moments", () => {
  // `DEFAULT_AUDIT_PATH` picks between the legacy home and the current one by existence, AT IMPORT, in
  // whichever process is doing the importing. The portal and the connector start at different times, so
  // a legacy file appearing between those two imports gives them different answers with nothing in
  // either log to say so. Reading both and taking the union removes the question rather than answering
  // it — which is the part that could be wrong.
  const dir = scratch();
  const a = join(dir, "legacy.jsonl");
  const b = join(dir, "current.jsonl");
  writeFileSync(a, line({ email: "early@example.test", method: "initialize" }));
  writeFileSync(b, line({ email: "late@example.test", method: "initialize" }));
  const seen = readConnections({ paths: [a, b] });
  assert.ok(seen.emails.has("early@example.test") && seen.emails.has("late@example.test"),
    "a reader in either file is a reader who connected");

  // And with the name unset the default list carries both homes, so nothing has to know which one this
  // box uses.
  const saved = process.env.TRADEMARK_MCP_AUDIT_LOG;
  try {
    delete process.env.TRADEMARK_MCP_AUDIT_LOG;
    assert.ok(auditPaths().includes(LEGACY_AUDIT_PATH), "the legacy home is still read");
    assert.equal(auditPaths().length, 2, "both homes, and nothing else");

    // AN OVERRIDE IS AN ANSWER, NOT A PREFERENCE, and this is the arm that says so. `appendAudit` writes
    // to the override and nowhere else; a reader that also consulted the default homes would report
    // readers out of a file the connector on this box is not writing to — which is exactly what it did
    // on first drive, turning an installation with a relocated and still-empty log into one where the
    // portal answered off somebody else's.
    process.env.TRADEMARK_MCP_AUDIT_LOG = "/somewhere/else/access.jsonl";
    assert.deepEqual(auditPaths(), ["/somewhere/else/access.jsonl"], "the override is the whole list");
  } finally {
    if (saved === undefined) delete process.env.TRADEMARK_MCP_AUDIT_LOG; else process.env.TRADEMARK_MCP_AUDIT_LOG = saved;
  }
});

test("the read is BOUNDED and says when it did not reach the start of the file", () => {
  // This log is append-only and unrotated. Reading it whole on every report open is the cost this
  // avoids; `truncated` is what stops a caller from reporting the window as the history.
  const dir = scratch();
  const path = join(dir, "big.jsonl");
  const filler = Array.from({ length: 400 }, (_, i) => line({ email: `f${i}@example.test`, method: "initialize" })).join("");
  writeFileSync(path, line({ email: "ancient@example.test", method: "initialize" }) + filler);

  const seen = readConnections({ paths: [path], maxBytes: 2048 });
  assert.equal(seen.truncated, true, "the window did not reach the start");
  assert.ok(!seen.emails.has("ancient@example.test"), "a reader past the window reads as absent, honestly");
  assert.ok(seen.emails.size > 0, "and the window still found the recent ones");

  // A window that starts mid-file starts MID-LINE, and that fragment is not a record. Parsing it as one
  // would either throw or, worse, half-parse into an object with a truncated address in it.
  for (const email of seen.emails) assert.match(email, /^f\d+@example\.test$/, `half a line became a reader: ${email}`);
});

test("a corrupt line is skipped, not fatal — one bad write must not blind the whole control", () => {
  const dir = scratch();
  const path = join(dir, "mixed.jsonl");
  writeFileSync(path, [
    "{not json at all\n",
    line({ email: "good@example.test", method: "initialize" }),
    "null\n",
    "[1,2,3]\n",
    line({ email: "also-good@example.test", method: "initialize" }),
  ].join(""));
  const seen = readConnections({ paths: [path] });
  assert.deepEqual([...seen.emails].sort(), ["also-good@example.test", "good@example.test"]);
});

test("THE LOCAL ROUTE LEAVES A RECORD, and it invents no identity", () => {
  // The HTTP doors write the caller's email on every request; the local connector wrote nothing, so a
  // reader whose only connector is the local one was invisible and could only ever be offered setup
  // they had already done. It has no signed-in identity, and a synthesized address would match a person
  // who did nothing — so the record says what is true and the caller decides what that answers.
  const dir = scratch();
  const path = join(dir, "local.jsonl");
  appendAudit({ email: null, sub: null, body: { method: "initialize" }, status: "connected", transport: "stdio", path });

  const seen = readConnections({ paths: [path] });
  assert.equal(seen.available, true);
  assert.equal(seen.local, true, "the local route was seen");
  assert.equal(seen.emails.size, 0, "and it named nobody");
});

test("an HTTP record does not read as a local one, and a local one names no reader", () => {
  // The distinction is the whole gate: on a hosted install the local flag answers for nobody, and
  // reading an HTTP call as local would mark every reader connected the moment one of them called.
  const dir = scratch();
  const path = join(dir, "both.jsonl");
  appendAudit({ email: "reader@example.test", body: { method: "initialize" }, status: 200, path });
  const httpOnly = readConnections({ paths: [path] });
  assert.equal(httpOnly.local, false, "an HTTP call is not the local route");
  assert.ok(httpOnly.emails.has("reader@example.test"));

  appendAudit({ email: null, body: { method: "initialize" }, status: "connected", transport: "stdio", path });
  const both = readConnections({ paths: [path] });
  assert.equal(both.local, true);
  assert.deepEqual([...both.emails], ["reader@example.test"], "the local record added no reader");
});

test("appendAudit writes no transport unless one is given, so the existing log shape does not move", () => {
  const dir = scratch();
  const path = join(dir, "shape.jsonl");
  mkdirSync(dir, { recursive: true });
  appendAudit({ email: "reader@example.test", body: { method: "tools/call", params: { name: "get_run" } }, status: 200, path });
  const rec = JSON.parse(readFileSync(path, "utf8").trim());
  assert.ok(!("transport" in rec), "an HTTP record carries no transport key");
  assert.equal(rec.tool, "get_run", "and everything it did carry still travels");
});

test("appendAudit ALWAYS writes a door, because an absent one was being read as the staff surface", () => {
  // THIS ARM SAID THE OPPOSITE YESTERDAY, AND THE REASON IT GAVE IS THE REASON IT IS WRONG. It asserted
  // that a record given no door carried no door key, so the log's shape would not move for a reader, on
  // the grounds that "the staff door names no door because it has no second surface to be told apart
  // from."
  //
  // There was a third surface. The key door — a client presenting an access key at the local socket — was
  // built without naming itself, so every line it wrote had the field absent, and absence was then read as
  // the staff door because that was the only other thing it could be. Measured on a live instance: six
  // lines, five naming a door, one not, and the reader who found it took it for a staff call. In the one
  // record kept to tell a client key from a staff session, a client's calls were being attributed to staff
  // by elimination.
  //
  // So absence is not an encoding any more. Unlike `transport`, which answers a question with exactly one
  // interesting value, `door` is a closed set and every line answers it. A caller that names none writes a
  // value a reader can search for, which is the thing a missing key can never be.
  const dir = scratch();
  const path = join(dir, "no-door.jsonl");
  appendAudit({ email: "reader@example.test", body: { method: "tools/call", params: { name: "list_runs" } }, status: 200, path });
  const rec = JSON.parse(readFileSync(path, "utf8").trim());
  assert.ok("door" in rec, `every record answers which door took the call: ${JSON.stringify(rec)}`);
  assert.equal(rec.door, UNNAMED_DOOR,
    "and a caller that named none is loud about it rather than silently reading as whichever surface is left");
  assert.equal(rec.tool, "list_runs", "everything the record already carried still travels");
});

test("a door NAMES A SURFACE and not a route, so the local-route reader is unmoved by it", () => {
  // `readConnections` tests `transport` for exactly one value to mean the local route. A client-door
  // record is an HTTP record that happens to name its surface, and it must not start reading as local —
  // which is what folding "which door" into "which route" would have done.
  const dir = scratch();
  const path = join(dir, "client-door.jsonl");
  appendAudit({ email: "client@example.test", body: { method: "tools/call", params: { name: "list_runs" } }, status: 200, door: "client", path });

  const rec = JSON.parse(readFileSync(path, "utf8").trim());
  assert.equal(rec.door, "client", "the door is on the line");
  assert.ok(!("transport" in rec), "naming a door must not invent a transport");

  const seen = readConnections({ paths: [path] });
  assert.equal(seen.local, false, "a client-door record read as the LOCAL route");
  assert.ok(seen.emails.has("client@example.test"), "and it is still a reader who connected");
});
