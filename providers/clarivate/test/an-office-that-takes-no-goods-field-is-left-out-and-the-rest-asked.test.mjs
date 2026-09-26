// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN OFFICE THAT TAKES NO GOODS FIELD IS LEFT OUT, AND THE REST OF THE QUESTION IS ASKED.
//
// The register refuses a whole goods-narrowed request when one office in it lacks the goods field. A
// question over every office then failed outright and was set aside as not searched, although every
// other office could answer it. It is now asked again without the refusing office, and the office is
// named on the result.
//
// Driven through the real enumerate arm and the real plan executor with the network stubbed, so the
// requests asserted are the requests a run sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doEnumerate, doExecutePlan, officeRefusingGoodsField, GOODS_FIELD, OWNER_FIELD } from "../src/core.js";

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

const goodsQuestion = { names: ["LANTERNWICK"], regions: ["US", "GB", "MC"], match_mode: "exact", goods_text: ["computer game software"] };

test("the refusing office is left out, the rest is asked, and the office is named on the result", async () => {
  const { out, counts } = await withRegister(["MC"], () => doEnumerate("k", "https://x", goodsQuestion, null));
  const parsed = JSON.parse(out.text);
  assert.equal(parsed.state, "enumerated", `the question was not answered: ${parsed.reason}`);
  assert.deepEqual(parsed.offices_without_goods_field, ["MC"]);
  assert.deepEqual(counts.map((c) => c.offices), [["US", "GB", "MC"], ["US", "GB"]]);
  assert.ok(counts.every((c) => c.goods), "the re-ask dropped the goods field instead of the office");
});

test("a second refusing office is left out in turn", async () => {
  const { out, counts } = await withRegister(["MC", "GB"], () => doEnumerate("k", "https://x", goodsQuestion, null));
  const parsed = JSON.parse(out.text);
  assert.equal(parsed.state, "enumerated");
  // The register names one refusing office at a time; this stand-in names the first in request order.
  assert.deepEqual(parsed.offices_without_goods_field, ["GB", "MC"]);
  assert.deepEqual(counts.map((c) => c.offices), [["US", "GB", "MC"], ["US", "MC"], ["US"]]);
});

test("an owner question keeps the note when the register then refuses its widened owner list", async () => {
  // The owner is widened by the register's own spellings of the company; the register refuses that list,
  // and the question falls back to the caller's own owner term. The fallback answer replaces the first,
  // so the note must be set after it, and the fallback must ask the reduced offices too.
  const real = globalThis.fetch;
  const counts = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const reply = (status, answer) => new Response(JSON.stringify(answer), { status, headers: { "content-type": "application/json" } });
    if (String(url).endsWith("/resolution/company"))
      return reply(200, { companies: [{ applicantName: "LANTERNWICK HOLDINGS LIMITED", registrationOfficeCode: "US", confidenceScore: 90 }] });
    const offices = body.registrationOfficeCodes ?? [];
    const goods = (body.searchFields ?? []).some((f) => f?.name === GOODS_FIELD);
    const widened = (body.searchFields ?? []).some((f) => f?.name === OWNER_FIELD && String(f.value).includes(" OR "));
    if (String(url).endsWith("/count")) counts.push({ offices, widened });
    if (goods && offices.includes("MC")) return reply(400, refusal("MC"));
    if (widened) return reply(400, { errorMessage: `searchFields[0] - ${OWNER_FIELD}` });
    return reply(200, { counts: Object.fromEntries(offices.map((o) => [o, 0])), ids: {}, totalResults: 0 });
  };
  try {
    const parsed = JSON.parse((await doEnumerate("k", "https://x",
      { owner: "Lanternwick Holdings", regions: ["US", "GB", "MC"], goods_text: ["computer game software"] }, null)).text);
    assert.equal(parsed.state, "enumerated", `the question was not answered: ${parsed.reason}`);
    assert.equal(parsed.owner_resolution?.degraded_to_unresolved_sweep, true, "the fallback to the caller's own owner term did not run");
    assert.deepEqual(parsed.offices_without_goods_field, ["MC"], "the fallback answer dropped the note");
    assert.deepEqual(counts.map((c) => `${c.offices.join(",")}${c.widened ? " widened" : ""}`),
      ["US,GB,MC widened", "US,GB widened", "US,GB"], "the fallback asked the refusing office again");
  } finally { globalThis.fetch = real; }
});

test("a run's plan executor answers the question instead of setting it aside", async () => {
  const dir = mkdtempSync(join(tmpdir(), "no-goods-office-"));
  try {
    // regions [] is backfilled from the plan's own regions, as on a worldwide run.
    const plan = { regions: ["US", "GB", "MC"], entries: [
      { qid: "q-goods", axis: "primary-sweep", predicate: "exact", term: "LANTERNWICK", nice_classes: [9], regions: [],
        goods_text: ["computer game software"], expected_kind: "enumerate" },
    ] };
    const planPath = join(dir, "register-plan.json"), outPath = join(dir, "primary-sweep-band.json");
    writeFileSync(planPath, JSON.stringify(plan));
    await withRegister(["MC"], () => doExecutePlan("k", "https://x", { plan_path: planPath, axis: "primary-sweep", output_path: outPath }, null));
    const block = JSON.parse(readFileSync(outPath, "utf8")).find((b) => b.qid === "q-goods");
    assert.equal(block?.state, "enumerated", `the block was not answered: ${JSON.stringify(block)}`);
    assert.ok(!block.error && !block.deferred, "the block still reads as a failed question");
    assert.deepEqual(block.offices_without_goods_field, ["MC"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("THE CONTROL: a refusal for any other reason is not asked again", async () => {
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/count")) n++;
    return new Response(JSON.stringify({ errorMessage: "searchFields[0] - APPLICANT_NAME" }), { status: 400, headers: { "content-type": "application/json" } });
  };
  try {
    const parsed = JSON.parse((await doEnumerate("k", "https://x", goodsQuestion, null)).text);
    assert.equal(parsed.state, "incomplete");
    assert.equal(parsed.offices_without_goods_field, undefined);
    assert.equal(n, 1, `a refusal that names no office was sent ${n} times`);
  } finally { globalThis.fetch = real; }
  assert.equal(officeRefusingGoodsField("HTTP 400: searchFields[0] - APPLICANT_NAME"), null);
  assert.equal(officeRefusingGoodsField(`HTTP 400: searchFields[2] - Search field ${GOODS_FIELD} is not supported for registrationOfficeCode MC.`), "MC");
});
