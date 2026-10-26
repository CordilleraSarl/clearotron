// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN OFFICE THAT REFUSED THE GOODS FIELD IS LEFT OUT FOR THE REST OF THE RUN.
//
// The register refuses a goods-narrowed request when one office in it lacks the goods field, and names that office.
// Each request was asked again without it, which is right, but every later request learned the same refusals again:
// on a test run of a crowded matter fifteen offices refused the field twenty times each, 300 calls that answered
// nothing. The run now keeps the offices that refused in its own folder, and a later goods-narrowed request leaves
// them out before it is sent, naming them as left out on the result as before. A question with no goods term asks
// every office, and a process with no run asks as it always has.
//
// Driven through the real enumerate arm with the network stubbed, so the requests asserted are the requests a run
// sends. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "../src/core.js";
import { RUN_RECORD_LOG_FILE } from "../../_shared/ledger-path.mjs";

const { doEnumerate, GOODS_FIELD } = core;
// The file the run keeps them in, named by the module that writes it.
const GOODS_REFUSALS_FILE = core.GOODS_REFUSALS_FILE ?? "offices-without-goods-field.json";
const refusal = (office) => ({ errorMessage: `searchFields[2] - Search field ${GOODS_FIELD} is not supported for registrationOfficeCode ${office}.` });

// A register where the named offices take no goods field. Every other request counts 0.
async function withRegister(noGoods, fn) {
  const real = globalThis.fetch;
  const counts = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const offices = body.registrationOfficeCodes ?? [];
    const goods = (body.searchFields ?? []).some((f) => f?.name === GOODS_FIELD);
    if (String(url).endsWith("/count")) counts.push({ offices, goods });
    const refuses = goods ? offices.find((o) => noGoods.includes(o)) : null;
    const answer = refuses ? refusal(refuses) : { counts: Object.fromEntries(offices.map((o) => [o, 0])), ids: {}, totalResults: 0 };
    return new Response(JSON.stringify(answer), { status: refuses ? 400 : 200, headers: { "content-type": "application/json" } });
  };
  try { return { out: await fn(), counts }; } finally { globalThis.fetch = real; }
}

const question = (extra = {}) => ({ names: ["LANTERNWICK"], regions: ["US", "GB", "MC", "DO"], match_mode: "exact", goods_text: ["computer game software"], ...extra });
const aRun = (t) => {
  const run = mkdtempSync(join(tmpdir(), "goods-refusals-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  const driverDir = join(run, "_driver");
  mkdirSync(driverDir, { recursive: true });
  return { driverDir, tctx: { recordLog: join(driverDir, RUN_RECORD_LOG_FILE) } };
};

test("a later goods-narrowed request leaves out the offices the run has seen refuse, and names them", async (t) => {
  const { driverDir, tctx } = aRun(t);
  const first = await withRegister(["MC", "DO"], () => doEnumerate("k", "https://x", question(), tctx));
  assert.deepEqual(first.counts.map((c) => c.offices), [["US", "GB", "MC", "DO"], ["US", "GB", "DO"], ["US", "GB"]],
    "premise: the first request learns each refusing office in turn");
  assert.deepEqual(JSON.parse(readFileSync(join(driverDir, GOODS_REFUSALS_FILE), "utf8")).sort(), ["DO", "MC"], "the run did not keep the offices that refused");
  const later = await withRegister(["MC", "DO"], () => doEnumerate("k", "https://x", question({ names: ["LANTERNWISP"] }), tctx));
  assert.deepEqual(later.counts.map((c) => c.offices), [["US", "GB"]], "a later request learned the refusals again");
  const parsed = JSON.parse(later.out.text);
  assert.equal(parsed.state, "enumerated", `the later question was not answered: ${parsed.reason}`);
  assert.deepEqual(parsed.offices_without_goods_field, ["MC", "DO"], "the offices left out are not named on the result");
});

test("a question with no goods term asks every office, whatever the run has seen refuse", async (t) => {
  const { tctx } = aRun(t);
  await withRegister(["MC"], () => doEnumerate("k", "https://x", question(), tctx));
  const plain = question();
  delete plain.goods_text;
  const { counts } = await withRegister(["MC"], () => doEnumerate("k", "https://x", plain, tctx));
  assert.deepEqual(counts.map((c) => c.offices), [["US", "GB", "MC", "DO"]], "an office was left out of a question that asks no goods field");
});

test("a request that asks only offices the run has seen refuse is sent as written, and the refusal stands", async (t) => {
  const { tctx } = aRun(t);
  await withRegister(["MC"], () => doEnumerate("k", "https://x", question(), tctx));
  const { counts } = await withRegister(["MC"], () => doEnumerate("k", "https://x", question({ regions: ["MC"] }), tctx));
  assert.deepEqual(counts.map((c) => c.offices), [["MC"]]);
});

test("a process with no run learns each refusal as it always has", async () => {
  await withRegister(["MC"], () => doEnumerate("k", "https://x", question(), null));
  const { counts } = await withRegister(["MC"], () => doEnumerate("k", "https://x", question(), null));
  assert.deepEqual(counts.map((c) => c.offices), [["US", "GB", "MC", "DO"], ["US", "GB", "DO"]], "a request with no run was narrowed by another's refusals");
});
