// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REFUSED REQUEST KEEPS THE REGISTER'S WORDS IN THE RUN'S OWN RECORD.
//
// The run's request log kept each request's status and nothing more, so after a run nobody could read why the
// register had answered 400. A goods-narrowed request is asked again without each office that takes no goods field,
// one refusal per office, and each refusal names its office; a query the register cannot parse answers 400 too.
// Telling them apart took rebuilding every request from the plan. A refused request's row now carries the
// register's words, clipped short, and an answered one carries none.
//
// Driven through the real enumerate and count arms with the network stubbed and the run's answer memory on, as it is
// by default on this register, so the rows asserted are the rows a run writes. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doCount, doEnumerate, GOODS_FIELD, REFUSAL_WORDS_LIMIT } from "../src/core.js";
import { RUN_RECORD_LOG_FILE } from "../../_shared/ledger-path.mjs";
import { ANSWER_WATCH_LOG, startAnswerMemory } from "../../_shared/answer-memory.mjs";

const refusal = (office) => ({ errorMessage: `searchFields[2] - Search field ${GOODS_FIELD} is not supported for registrationOfficeCode ${office}.` });

// A register where the named offices take no goods field. Every other request counts 0.
async function withRegister(noGoods, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const offices = body.registrationOfficeCodes ?? [];
    const goods = (body.searchFields ?? []).some((f) => f?.name === GOODS_FIELD);
    const refuses = goods ? offices.find((o) => noGoods.includes(o)) : null;
    const answer = refuses ? refusal(refuses) : { counts: Object.fromEntries(offices.map((o) => [o, 0])), ids: {}, totalResults: 0 };
    return new Response(JSON.stringify(answer), { status: refuses ? 400 : 200, headers: { "content-type": "application/json" } });
  };
  try { return await fn(); } finally { globalThis.fetch = real; }
}

const aRun = (t, mode = "on") => {
  const run = mkdtempSync(join(tmpdir(), "refusal-words-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  const driverDir = join(run, "_driver");
  mkdirSync(driverDir, { recursive: true });
  startAnswerMemory(run, mode);
  return { watchLog: join(driverDir, ANSWER_WATCH_LOG), tctx: { recordLog: join(driverDir, RUN_RECORD_LOG_FILE) } };
};
const rowsOf = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

test("each refused request's row names what the register said, and an answered row carries no words", async (t) => {
  const { watchLog, tctx } = aRun(t);
  const question = { names: ["LANTERNWICK"], regions: ["US", "GB", "MC", "DO"], match_mode: "exact", goods_text: ["computer game software"] };
  await withRegister(["MC", "DO"], () => doEnumerate("k", "https://x", question, tctx));
  const rows = rowsOf(watchLog);
  const counts = rows.filter((r) => r.path === "/count");
  assert.deepEqual(counts.map((r) => r.status), [400, 400, 200], "premise: the request is asked again without each office that refused");
  assert.match(counts[0].words ?? "", new RegExp(`Search field ${GOODS_FIELD} is not supported for registrationOfficeCode MC\\.`), "the first refusal's words are not on its row");
  assert.match(counts[1].words ?? "", /registrationOfficeCode DO\./, "the second refusal's words are not on its row");
  for (const r of rows.filter((x) => x.status === 200)) assert.equal(r.words, undefined, `an answered ${r.path} row carries words`);
});

test("a refusal that is not the register's JSON keeps its text, clipped to the limit at both ends", async (t) => {
  const { watchLog, tctx } = aRun(t);
  const page = `<html>Bad Request ${"x".repeat(2000)} request 7f3a</html>`;
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(page, { status: 400, headers: { "content-type": "text/html" } });
  try { await doCount("k", "https://x", { names: ["LANTERNWICK"], regions: ["US"], match_mode: "exact" }, tctx); }
  finally { globalThis.fetch = real; }
  const [row] = rowsOf(watchLog).filter((r) => r.path === "/count");
  assert.equal(row?.status, 400);
  assert.ok(row.words.length <= REFUSAL_WORDS_LIMIT, `the words run to ${row.words.length} characters`);
  assert.match(row.words, /^<html>Bad Request /);
  assert.match(row.words, /request 7f3a<\/html>$/, "the end of the register's answer was dropped");
});

test("THE CONTROL: with the run's answer memory off, no request log is written, as before", async (t) => {
  const { watchLog, tctx } = aRun(t, "off");
  await withRegister(["MC"], () => doEnumerate("k", "https://x", { names: ["LANTERNWICK"], regions: ["US", "MC"], match_mode: "exact", goods_text: ["computer game software"] }, tctx));
  assert.equal(existsSync(watchLog), false);
});
