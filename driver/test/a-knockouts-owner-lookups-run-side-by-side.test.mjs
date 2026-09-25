// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT'S OWNER LOOKUPS RUN SIDE BY SIDE, ASK THE SAME QUESTIONS, AND KEEP THE OWNERS' ORDER.
//
// A four-mark knockout owed nine owner lookups and asked them one after another, so their times added up:
// 3.9 of its 13.7 minutes, measured in testing. Each lookup is independent, so they now run three at a
// time, the same limit the knockout's other register and research fan-outs use. What each lookup asks,
// and which owners are asked, does not change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runOwnerChecks, composeOwnerQuery } from "../owner-use-check.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const OWNERS = Array.from({ length: 9 }, (_, i) => ({ mark: `VELTRIS ${1 + Math.floor(i / 3)}`, owner: `Quarvintex Holding ${i + 1} AG`, recordIds: [`/mark/eu/01877700${i}`], classes: [9] }));

// A fake executor that records how many lookups are in flight. Later owners answer sooner, so a result
// kept in completion order would come back reversed.
function fakeExec({ failAt = -1 } = {}) {
  let inFlight = 0, most = 0;
  const asked = [];
  const exec = async (query) => {
    const i = OWNERS.findIndex((o) => query === composeOwnerQuery(o));
    asked.push(query);
    inFlight++; most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 5 + (OWNERS.length - i) * 3));
    inFlight--;
    if (i === failAt) throw new Error("provider 503");
    return { ok: true, text: `The company sells software. https://example.test/owner-${i + 1}` };
  };
  return { exec, asked, most: () => most };
}

function runDirWithResearch() {
  const d = mkdtempSync(join(tmpdir(), "owner-lookups-"));
  mkdirSync(join(d, "research"));
  return d;
}

test("nine lookups run three at a time, ask the same nine questions, and come back in the owners' order", async () => {
  const d = runDirWithResearch();
  try {
    const f = fakeExec();
    const ledgerPath = join(d, "owner-check.jsonl");
    const rows = await runOwnerChecks({ owners: OWNERS, exec: f.exec, runDir: d, ledgerPath, concurrency: 3 });
    assert.equal(f.most(), 3, "the lookups did not run three at a time");
    assert.deepEqual([...f.asked].sort(), OWNERS.map(composeOwnerQuery).sort(), "a different set of questions was asked");
    assert.deepEqual(rows.map((r) => r.owner), OWNERS.map((o) => o.owner), "the rows are not in the owners' order");
    assert.ok(rows.every((r) => r.ok && r.source.startsWith("https://example.test/")));
    assert.equal(readFileSync(ledgerPath, "utf8").trim().split("\n").length, 9, "the receipts ledger lost a row");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a lookup that fails still gets its row, in its place, and the others still answer", async () => {
  const d = runDirWithResearch();
  try {
    const rows = await runOwnerChecks({ owners: OWNERS, exec: fakeExec({ failAt: 4 }).exec, runDir: d, concurrency: 3 });
    assert.equal(rows.length, 9);
    assert.equal(rows[4].ok, false);
    assert.match(rows[4].cause, /executor threw: provider 503/);
    assert.ok(rows.filter((r, i) => i !== 4).every((r) => r.ok), "a failure took another lookup down");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("with no limit given, or a limit that is not a number, the lookups run one at a time", async () => {
  for (const concurrency of [undefined, 0, Number.NaN]) {
    const f = fakeExec();
    const rows = await runOwnerChecks({ owners: OWNERS.slice(0, 4), exec: f.exec, runDir: null, concurrency });
    assert.equal(f.most(), 1, `limit ${concurrency} ran lookups side by side`);
    assert.equal(rows.length, 4);
  }
  assert.deepEqual(await runOwnerChecks({ owners: [], exec: fakeExec().exec, runDir: null, concurrency: 3 }), []);
});

test("the knockout asks its owner lookups three at a time", () => {
  const src = readFileSync(join(DRIVER, "pipeline-knockout.mjs"), "utf8");
  const at = src.indexOf("await runOwnerChecks({");
  assert.ok(at > 0 && /concurrency: 3,/.test(src.slice(at, at + 400)), "the knockout does not pass its fan-out limit to the owner lookups");
});
