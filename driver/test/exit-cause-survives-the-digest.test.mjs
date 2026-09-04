// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// criterion 2 — THE nonzero_exit_1 CAUSE IS CAPTURED.
//
// On the codex engine the warm-patch rung of the attempt ladder dies in under a second with exit 1, zero
// tokens, `runId: null`, `wrote: false` — a startup crash, not a model turn. The rung is spent either
// way; what this issue is about is that the CAUSE was unrecoverable from the artifacts afterwards.
//
// Both attempt records kept `stderr.split("\n").filter(Boolean).slice(-3)` — the LAST three lines, which
// is the wrong end for a process that fails on startup. A crash says why it failed first and exits last.
// What survived was the standing codex PATH-alias warning ("Refusing to create helper binaries under
// temporary dir"), which is emitted late and repeatedly, so the record carried the noise and dropped the
// signal. Nothing else on the record could recover it: `usage: null`, `modelActual: null`,
// `modelBasis: "unknown"`.
//
// This does not fix criterion 1 (whether such a rung should cost a ladder attempt at all) and does not
// pretend to. It makes the next occurrence diagnosable, which is what the issue says is buildable today
// and what a warm-patch path being exercised will then be able to report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { streamDigest, STREAM_DIGEST_KEEP } from "../gateway.mjs";

// The observed shape: a real cause first, the standing PATH-alias warning repeated late, an exit line.
const CRASH = [
  "codex: starting",
  "ERROR: cannot resolve helper path /tmp/ct-xyz/bin",
  "  at resolveHelper (codex/dist/helper.js:41:11)",
  "  at main (codex/dist/cli.js:203:7)",
  "Refusing to create helper binaries under temporary dir",
  "Refusing to create helper binaries under temporary dir",
  "exiting 1",
].join("\n");

test("#789 the CAUSE survives, where slice(-3) kept only the standing warning", () => {
  const old = CRASH.split("\n").filter(Boolean).slice(-3).join(" ⏎ ");
  assert.doesNotMatch(old, /cannot resolve helper path/,
    "the fixture does not reproduce the defect — the old tail already carried the cause, so this file proves nothing");
  assert.match(old, /Refusing to create helper binaries/, "the fixture's noise is not where the defect put it");

  const now = streamDigest(CRASH);
  assert.match(now, /cannot resolve helper path/, "the exit cause is still unrecoverable from the record");
});

test("#789 NOT FILTERED — the known noise survives too", () => {
  // The obvious alternative was to drop the PATH-alias line and keep three real ones. Refused: a filter
  // that removes what it has decided is noise is how a real cause disappears the first time it arrives in
  // an unexpected shape. Widening keeps both; filtering bets on today's understanding of the noise.
  assert.match(streamDigest(CRASH), /Refusing to create helper binaries/,
    "the digest is filtering — it now decides what is worth keeping, and it will be wrong eventually");
});

test("#789 an elided middle SAYS it was elided, with a count", () => {
  const long = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");
  const d = streamDigest(long);
  assert.match(d, /line 1 ⏎/, "the head is gone — the crash cause lives there");
  assert.match(d, /line 40$/, "the tail is gone — the exit state lives there");
  assert.match(d, /… 32 line\(s\) elided …/,
    "the digest dropped its middle silently — a narrator claiming to be a transcript");
  assert.equal(STREAM_DIGEST_KEEP * 2 + 32, 40, "the arithmetic in this assertion drifted from the constant");
});

test("#789 a short stream is passed through whole — no phantom elision", () => {
  const short = "only\ntwo";
  assert.equal(streamDigest(short), "only ⏎ two");
  assert.doesNotMatch(streamDigest(short), /elided/, "a complete stream is announcing an elision that did not happen");
  // Exactly at the boundary: keep*2 lines is still complete, and must not claim otherwise.
  const exact = Array.from({ length: STREAM_DIGEST_KEEP * 2 }, (_, i) => `l${i}`).join("\n");
  assert.doesNotMatch(streamDigest(exact), /elided/, "an off-by-one at the boundary is inventing an elision");
});

test("#789 SHAPE FUZZ: the digest never throws and never invents content", () => {
  for (const bad of [null, undefined, "", "   ", "\n\n\n", 0, {}, []]) {
    let out;
    assert.doesNotThrow(() => { out = streamDigest(bad); }, `threw on ${JSON.stringify(bad)}`);
    assert.equal(typeof out, "string");
    assert.doesNotMatch(out, /elided/, `${JSON.stringify(bad)} produced an elision notice over no content`);
  }
});
