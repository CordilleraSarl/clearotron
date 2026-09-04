// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE REPORT MUST CARRY THE DISTINCTION THE RECEIPT ALREADY HOLDS.
//
// exists because an unreachable door read as a refusal. That is fixed in the DATA:
// the receipt records `answerClass: "infra-unavailable"`, `transport: true`, and a reason naming the
// address nothing was listening on. The operator-facing half was not fixed. The reduced-coverage line
// rendered `${a.status ?? "no status"}`, so a socket nobody was listening on printed `(no status)` —
// accurate, because the transport never returned an HTTP status, and the least useful true thing
// available.
//
// Three conditions with three different remedies rendered identically:
//
//   nothing listening on the port       start the service, or fix the port
//   the service answered with an error   a different problem entirely
//   the port was never configured        configure it
//
// Measured on round 18640238, 2026-08-25: nine cases, every one rendering `(no status)` in the report
// while every corresponding receipt answer carried the ECONNREFUSED text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { doorUnavailableLabel } from "../../scripts/e2e.mjs";

const E2E_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "e2e.mjs");

/** The three conditions, as the receipt actually records them. */
const NOTHING_LISTENING = { door: "ops-mcp", status: null, transport: true, reason: "connect ECONNREFUSED 127.0.0.1:18899" };
const SERVICE_ERRORED = { door: "ops-mcp", status: 503, transport: false, reason: "upstream refused the forward" };
const NEVER_CONFIGURED = { door: "ops-mcp", status: null, transport: true, reason: "no TRADEMARK_MCP_HTTP_PORT in scope" };

test("the three conditions render as three DIFFERENT lines — the property that was missing", () => {
  // The defect was not that any one line was wrong. It was that all three were the same line, so the
  // report could not be read without the receipt. Asserting each label's content one at a time would
  // have passed on the old code for two of them; the distinctness is the thing.
  const labels = [NOTHING_LISTENING, SERVICE_ERRORED, NEVER_CONFIGURED].map((a) => doorUnavailableLabel(a));
  assert.equal(new Set(labels).size, 3,
    `all three conditions must be distinguishable from the report line alone:\n  ${labels.join("\n  ")}`);
  for (const l of labels) {
    assert.notEqual(l, "no status", "the old rendering must not survive for any of them");
    assert.ok(l.trim().length > 0, "an empty label is worse than the one being replaced");
  }
});

test("each line names the thing an operator would act on", () => {
  assert.match(doorUnavailableLabel(NOTHING_LISTENING), /127\.0\.0\.1:18899/,
    "nothing listening — the ADDRESS is the actionable part, and it must survive into the report");
  assert.match(doorUnavailableLabel(SERVICE_ERRORED), /503/,
    "a service that answered — the status is what says this is a different problem");
  assert.match(doorUnavailableLabel(NEVER_CONFIGURED), /TRADEMARK_MCP_HTTP_PORT/,
    "never configured — the variable to set");
});

test("reason wins over status, and both are shown when both exist", () => {
  // Precedence matters: the reason is the only one of the two that can name an address, a missing
  // variable or a spawn failure. But a status answers a different question, so it is kept beside it.
  const both = doorUnavailableLabel(SERVICE_ERRORED);
  assert.match(both, /503/);
  assert.match(both, /upstream refused/);
  // A status with no reason still renders as a status, and says that is what it is.
  assert.equal(doorUnavailableLabel({ door: "ops-mcp", status: 429, reason: null }), "status 429");
});

test("an answer recording NEITHER field says which absence it is — it never reads as 'fine'", () => {
  // `(no status)` was ambiguous: it meant "no HTTP status", which a reader could take for "the door
  // said nothing was wrong". An answer with neither field is a gap in the RECEIPT, and the line must
  // say so rather than filling it with a guess.
  const label = doorUnavailableLabel({ door: "cli", status: null, reason: null });
  assert.match(label, /no status and no reason/,
    "the fallback must name what is missing, so a reader can tell a silent receipt from a silent door");
  assert.equal(doorUnavailableLabel({}), "no status and no reason recorded",
    "and a malformed answer takes the same honest fallback rather than throwing or printing 'undefined'");
});

test("a long reason keeps BOTH ends, because the address is at the end", () => {
  // A plain head-truncate throws away the only part worth reading — the same lesson `brief` carries.
  const long = { door: "ops-mcp", status: null, reason: "Error: request to http://127.0.0.1:18899/mcp failed, "
    + "reason: ".padEnd(140, "x") + " connect ECONNREFUSED 127.0.0.1:18899" };
  const label = doorUnavailableLabel(long);
  assert.ok(label.length <= 95, `clipped, not dumped: ${label.length} chars`);
  assert.match(label, /ECONNREFUSED 127\.0\.0\.1:18899/, "the address survives the clip");
});

test("whitespace in a reason is collapsed, so one answer stays one line", () => {
  // A multi-line stack in a reason would break the one-item-one-line shape the report is read in.
  const label = doorUnavailableLabel({ door: "ops-mcp", status: null, reason: "connect ECONNREFUSED\n  at Socket\n  at TCP" });
  assert.ok(!label.includes("\n"), "a reduced-coverage line must not become three lines");
});

test("the report actually CALLS it — a helper nothing calls changes no report", () => {
  // The arms above prove the label is right. This proves it reaches the surface the issue is about:
  // an exported formatter with no caller passes its own tests and ships the old line forever.
  const src = readFileSync(E2E_SRC, "utf8");
  assert.match(src, /doorUnavailableLabel\(a\)/,
    "the reduced-coverage render must build its `who` from the label");

  // CODE ONLY. The helper's own docblock QUOTES the rendering it replaced, because a reader deciding
  // whether to change it back needs to see what it was — and a scanner that reads its own documentation
  // as the thing it forbids is the shape this repo has already been caught by once. Strip comment
  // lines, then require the corpus to still be non-empty so the strip cannot pass by deleting the file.
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  assert.ok(code.length > 1000, `the comment strip left ${code.length} lines — it removed too much to prove anything`);
  const offenders = code.filter((l) => /a\.status \?\? "no status"/.test(l));
  assert.deepEqual(offenders, [],
    "the old rendering must be gone from the CODE, not merely bypassed — a second site would "
    + "reintroduce it silently:\n  " + offenders.join("\n  "));
});

test("ONE formatter serves both surfaces, and it reads both spellings of the field", () => {
  // At RUN time an answer carries the raw output as `out`; on the RECEIPT the same text is persisted as
  // `reason`. Before this there were two renderings: the run-time line read `status ?? out` — precedence
  // backwards, so a 503 printed `503` and dropped the sentence — and the report line read `status`
  // alone. Two independent renderings of one fact is the shape that drifts, and these two already had.
  assert.equal(doorUnavailableLabel({ door: "ops-mcp", status: null, out: "connect ECONNREFUSED 127.0.0.1:18899" }),
    "connect ECONNREFUSED 127.0.0.1:18899", "the run-time spelling resolves");
  assert.equal(doorUnavailableLabel({ door: "ops-mcp", status: null, reason: "connect ECONNREFUSED 127.0.0.1:18899" }),
    "connect ECONNREFUSED 127.0.0.1:18899", "and the receipt spelling gives the SAME line");
  assert.equal(doorUnavailableLabel({ door: "ops-mcp", status: 503, out: "upstream refused" }), "503: upstream refused",
    "and the old backwards precedence is gone — the sentence beside a 503 is no longer thrown away");

  const src = readFileSync(E2E_SRC, "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  const stragglers = code.filter((l) => /a\.status \?\? \(String\(a\.out/.test(l));
  assert.deepEqual(stragglers, [], "the run-time site must use the shared formatter, not its own copy");
  assert.ok(code.filter((l) => /doorUnavailableLabel\(a/.test(l)).length >= 2,
    "both surfaces call it — one of them calling it proves nothing about the other");
});

test("the same line feeds the round's limitations, so both surfaces agree", () => {
  // The reduced-coverage case prints to the console AND pushes a row into `notProbed`, which is what a
  // reader consults to decide what the round proved. They are built from one `who`, deliberately: two
  // renderings of one fact drift, and the limitations row is the one that outlives the terminal.
  const src = readFileSync(E2E_SRC, "utf8");
  const block = src.slice(src.indexOf("for (const { c, out } of unavailable)"));
  const head = block.slice(0, 1200);
  assert.match(head, /const who = out\.map/, "one `who` is built");
  assert.ok((head.match(/\$\{who\}/g) || []).length >= 2,
    "and both the console line and the notProbed row use it, rather than formatting the answer twice");
});
