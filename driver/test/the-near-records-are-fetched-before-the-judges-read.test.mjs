// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the judged step's fetch-first over invented piles, with a stand-in fetch
//
// THE RECORDS IN FRONT OF THE JUDGES ARE FETCHED FIRST WHERE THE LISTING CARRIES NO GOODS (design, 2026-10-03).
//
// On a register whose listing carries no goods wording, the judges read every record in front of them with
// no goods, where the bench's judges had them all, and a conflict was set aside on a ground they could not
// check. Before the judges read, the step now fetches the full record of every record the run does not hold
// for the owners in scope: the floor, or the floor and the near band. Where the listing carries the goods
// the run holds them already and nothing is fetched. The scope is the owner's to set and none is set: with
// none, nothing is fetched first. Every name here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeOwnerTools, OPENING_FETCH_SCOPE } from "../owner-tools.mjs";
import { openingBands } from "../owner-judgment.mjs";
import { fetchScopeRecords, fetchScopeOwners } from "../owner-judgment-run.mjs";
import { fetchRunRecord } from "../record-fetch.mjs";

const pad = (i) => String(i).padStart(4, "0");
/** Owners with two records each, live in class 9; `held` says which records the run holds whole. */
function pile({ same = 0, word = 0, near = 0, loose = 0, held = () => false }) {
  const records = [];
  let i = 0;
  const owner = (mark, qid) => { const o = `Owner ${pad(i)} Holdings Ltd`;
    for (const k of [0, 1]) records.push({ id: `/mark/us/${pad(i)}-${k}`, mark, owner: o, ownerCountry: "US", office: "US", classes: [9], status: "REGISTERED", filed: "2019-04-01", qids: [qid] });
    i += 1; };
  for (let k = 0; k < same; k++) owner("QORVEN", "q-exact");
  for (let k = 0; k < word; k++) owner("QORVEN LABS", "q-exact");
  for (let k = 0; k < near; k++) owner("QORVENA", "q-exact");
  for (let k = 0; k < loose; k++) owner("QORVENTALIS", "q-contains");
  const bodies = new Map(records.filter((r) => held(r.id)).map((r) => [r.id, { goodsServices: [{ classes: [9], description: "software" }] }]));
  let refreshed = 0;
  const p = { orderMarks: ["QORVEN"], orderClasses: [9], records,
    questions: [{ qid: "q-exact", match: "exact" }, { qid: "q-contains", match: "contains" }],
    readFullRecord: (id) => bodies.get(id) ?? null, refreshFullRecords: () => { refreshed += 1; },
    land: (id) => bodies.set(id, { goodsServices: [] }), refreshed: () => refreshed };
  return p;
}
const run = async (p, scope, answer = () => ({ ok: true })) => {
  const table = makeOwnerTools(p).table;
  const asked = [];
  const counts = await fetchScopeRecords({ pile: p, table, scope, fetch: async (id) => { asked.push(id); const a = answer(id); if (a?.ok) p.land(id); return a; } });
  return { counts, asked, table };
};

test("no scope is set in the build, and with none nothing is fetched first", async () => {
  assert.equal(OPENING_FETCH_SCOPE, null, "a scope landed without the owner's word");
  const { counts, asked } = await run(pile({ same: 1, word: 2, near: 3 }), null);
  assert.deepEqual(asked, []);
  assert.equal(counts.asked, 0);
});

test("scope band: every record of the floor and near-band owners the run does not hold is fetched, and no other", async () => {
  const p = pile({ same: 1, word: 2, near: 3, loose: 4, held: (id) => id.endsWith("0000-0") });
  const { counts, asked, table } = await run(p, "band");
  const bands = openingBands(table);
  const inScope = bands.band.flatMap((k) => table.byKey.get(k).records.map((r) => r.id));
  assert.deepEqual(asked.sort(), inScope.filter((id) => !id.endsWith("0000-0")).sort(), "the fetch went outside the scope or skipped a record");
  assert.deepEqual(counts, { scope: "band", owners: 6, records: 12, held: 1, asked: 11, ok: 11, failed: 0 });
  assert.equal(p.refreshed(), 1, "the pile was not re-read after the fetches");
});

test("scope floor: only the floor's records", async () => {
  const { counts } = await run(pile({ same: 1, word: 2, near: 3, loose: 4 }), "floor");
  assert.deepEqual(counts, { scope: "floor", owners: 3, records: 6, held: 0, asked: 6, ok: 6, failed: 0 });
});

test("a fetch that fails or throws is counted and the step goes on", async () => {
  let n = 0;
  const { counts } = await run(pile({ same: 1, word: 1 }), "floor", () => { n += 1; if (n === 2) throw new Error("hung"); return { ok: n !== 3 }; });
  assert.deepEqual(counts, { scope: "floor", owners: 2, records: 4, held: 0, asked: 4, ok: 2, failed: 2 });
});

test("CONTROL — where the listing carries the goods the run holds every record, and nothing is fetched", async () => {
  const { counts, asked } = await run(pile({ same: 1, word: 2, near: 3, held: () => true }), "band");
  assert.deepEqual(asked, []);
  assert.equal(counts.asked, 0);
  assert.equal(counts.held, counts.records);
});

test("an unknown scope is refused by name", () => {
  assert.throws(() => fetchScopeOwners(makeOwnerTools(pile({ same: 1 })).table, "everything"), /not one this step knows \(floor, band\)/);
});

test("a fetch is never sent to a register this build does not know", async () => {
  assert.match((await fetchRunRecord({ runDir: "/nowhere", providerId: null, id: "x" })).cause, /names no register/);
  assert.match((await fetchRunRecord({ runDir: "/nowhere", providerId: "no-such-register", id: "x" })).cause, /is not one this build knows/);
});

test("the judged step fetches first with the one scope setting and records the counts", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.match(src, /fetchScopeRecords\(\{ pile, table, scope: OPENING_FETCH_SCOPE, fetch: \(id\) => fetchRunRecord\(\{ runDir: P\.runDir, providerId: pile\.provider, id \}\) \}\)/);
  assert.match(src, /event: "owner-records-fetched-first", trigger, \.\.\.fetchedFirst/);
});
