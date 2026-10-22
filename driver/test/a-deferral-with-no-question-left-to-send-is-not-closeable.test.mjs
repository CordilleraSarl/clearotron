// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A DEFERRAL WITH NO QUESTION LEFT TO SEND IS NOT CLOSEABLE.
//
// The envelope close, the escalation gate and the review's table re-run an axis to close its deferred rows. A re-run
// sends questions, so it closes a row only when the run's own record holds a question it would send. On a test run of a
// crowded matter the table listed as closeable rows with nothing left to send: follow-ups the safety net had already
// refused, and the review sent the work back for them. Now the plan-execution receipt decides. An axis's missing
// questions, planned and never sent or failed at the provider, keep its rows closeable; with none, they are held. A row
// carrying its question's qid follows that question. With no receipt the split answers as before. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitDeferredByCloseability, heldForNothingToSend } from "../coverage-ledger.mjs";
import { askableOf, skepticDeferralExtra } from "../pipeline.mjs";
import { paths } from "../stages.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const row = (axis, scope, reason, qid = null) => ({ axis, scope, status: "deferred", reason, ...(qid ? { qid } : {}) });
const RECEIPT = {
  executed: [], missing: ["transliteration-numeric:exact:qzorvak-cn"], deferred: [{ qid: "supp:primary-sweep:exact:qzorvak-er", reason: "capability-gap: office outside the register's vocabulary" }],
  skeleton: [
    { axis: "transliteration-numeric", state: "unexecuted", missing: ["transliteration-numeric:exact:qzorvak-cn"] },
    { axis: "incumbent-class", state: "incomplete", missing: [] },
    { axis: "primary-sweep", state: "deferred", missing: [], deferred: ["supp:primary-sweep:exact:qzorvak-er"] },
  ],
};
const ROWS = [
  row("transliteration-numeric", "QZORVAK in Chinese", "the gateway timed out on both tries"),
  row("incumbent-class", "Example Holdings, owner reading", "the owner's records were not read as a set; the corrective follow-ups were returned outstanding"),
  row("primary-sweep", "QZORVAK in ER", "outside the register's office vocabulary", "supp:primary-sweep:exact:qzorvak-er"),
];
const split = (axis, askable) => splitDeferredByCloseability(ROWS, axis, new Set(), { askable });

test("a row on an axis whose receipt holds a question to send again stays closeable", () => {
  assert.deepEqual(split("transliteration-numeric", askableOf(RECEIPT)).closeable.map((r) => r.scope), ["QZORVAK in Chinese"]);
});

test("a row on an axis with nothing left to send is held, and a row follows its own question", () => {
  const held = split("incumbent-class", askableOf(RECEIPT));
  assert.deepEqual([held.closeable.length, held.held.length], [0, 1], "a row with no question left to send was offered for a re-run");
  const own = split("primary-sweep", askableOf(RECEIPT));
  assert.deepEqual([own.closeable.length, own.held.length], [0, 1], "a row whose own question is not missing was offered for a re-run");
  const sent = askableOf({ skeleton: [{ axis: "primary-sweep", missing: ["supp:primary-sweep:exact:qzorvak-er"] }] });
  assert.deepEqual(split("primary-sweep", sent).closeable.length, 1, "a row whose own question is missing was held");
});

test("with no receipt to read, the split answers as before", () => {
  for (const axis of ["transliteration-numeric", "incumbent-class"]) assert.equal(split(axis, askableOf(null)).closeable.length, 1, axis);
  assert.equal(askableOf(null)({ axis: "incumbent-class" }), null);
});

test("a script the register cannot express stays held on an axis the receipt indicts", () => {
  const script = [row("transliteration-numeric", "QZORVAK in Japanese", "the register indexes non-latin filings by their transliteration")];
  const s = splitDeferredByCloseability(script, "transliteration-numeric", new Set(["transliteration-numeric"]), { askable: askableOf(RECEIPT) });
  assert.deepEqual([s.closeable.length, s.held.length], [0, 1]);
  assert.equal(heldForNothingToSend(s), false, "a capability gap was named a row with nothing left to send");
});

test("an axis held only because nothing is left to send is named so, and one with a capability gap among its rows is not", () => {
  // The envelope's operator note and the escalation's skip record read this to name the cause.
  assert.equal(heldForNothingToSend(split("incumbent-class", askableOf(RECEIPT))), true);
  const mixed = [...ROWS, row("incumbent-class", "Example Holdings in ER", "capability-gap: office outside the register's vocabulary")];
  const m = splitDeferredByCloseability(mixed, "incumbent-class", new Set(["incumbent-class"]), { askable: askableOf(RECEIPT) });
  assert.deepEqual([m.closeable.length, m.held.length, heldForNothingToSend(m)], [0, 2, false]);
  assert.equal(heldForNothingToSend(split("transliteration-numeric", askableOf(RECEIPT))), false, "an axis with nothing held was named held");
});

test("the review's table lists a row with nothing left to send as not closeable", (t) => {
  const runDir = mkdtempSync(join(tmpdir(), "closeable-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  const P = paths(runDir);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(P.registerCoverageLedger, JSON.stringify(ROWS) + "\n");
  writeFileSync(P.planExecution, JSON.stringify(RECEIPT) + "\n");
  const text = skepticDeferralExtra({ paths: P, registerPlan: { provider: null, entries: [] } });
  const closeable = text.slice(text.indexOf("CLOSEABLE floor obligations"), text.indexOf("NOT CLOSEABLE"));
  const notCloseable = text.slice(text.indexOf("NOT CLOSEABLE"));
  assert.match(closeable, /QZORVAK in Chinese/, "the row with a question to send again is not offered");
  assert.match(notCloseable, /Example Holdings, owner reading/, "the row with nothing left to send is still offered for a re-run");
});
