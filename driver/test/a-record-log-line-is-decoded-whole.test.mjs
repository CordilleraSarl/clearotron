// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RECORD LOG LINE IS DECODED WHOLE. The ledger reader walks a file in chunks, and it decoded each chunk on its
// own: a character a chunk boundary split came back as two replacement characters, and the garbled text reached
// the record bodies a run writes (measured on the two largest record logs of a test deployment, 2026-11-19). Lines are now
// split on the newline byte and each is decoded once. Small chunks here put the boundary where the test wants it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forEachLedgerLine } from "../registry-fidelity.mjs";

function ledger(t, text) {
  const dir = mkdtempSync(join(tmpdir(), "ledger-utf8-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "log.jsonl");
  writeFileSync(path, text);
  return path;
}
const read = (path, chunk) => { const lines = []; const r = forEachLedgerLine(path, (l) => lines.push(l), { chunk }); return { lines, r }; };

test("a character a chunk boundary splits comes back whole, at every boundary position", (t) => {
  const rows = [{ goods: "Café, crème brûlée, 東京 — ç" }, { goods: "Écoute" }].map((r) => JSON.stringify(r));
  const path = ledger(t, rows.join("\n") + "\n");
  const bytes = Buffer.byteLength(rows.join("\n") + "\n");
  assert.equal(bytes > 40, true, "the fixture is too short to put a boundary inside a character");
  for (let chunk = 1; chunk <= 40; chunk++) {
    const { lines, r } = read(path, chunk);
    assert.deepEqual(lines, rows, `a ${chunk}-byte chunk changed a line`);
    assert.equal(r.error, null);
  }
});

test("a line longer than several chunks, and a last line with no newline, are each read once and whole", (t) => {
  const long = JSON.stringify({ goods: "ü".repeat(500) });
  const path = ledger(t, `${long}\n\n{"a":"ß"}`);
  const { lines, r } = read(path, 7);
  assert.deepEqual(lines, [long, '{"a":"ß"}']);
  assert.equal(r.lines, 2);
});
