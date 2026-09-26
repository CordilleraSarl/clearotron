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
import { doEnumerate, doExecutePlan, officeRefusingGoodsField, GOODS_FIELD } from "../src/core.js";

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
