// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STAGE RUN AGAIN IS ANSWERED WHAT IT ALREADY ASKED.
//
// A stage runs again after a retry, a park, a correction or a stale input, and it sent its research questions again
// each time, though the run kept every answer. The research server now answers a question from the answer its stage
// already got, when the request is the same: the same words, tier, options and instructions. Anything else is sent:
// another stage's question, a question asked differently, one whose earlier call failed or came back unreadable, and
// one whose answer was kept before requests were fingerprinted.
//
// These drive the real server over stdio, with the research service stood in for inside the server's own process, so
// nothing leaves this machine. The stand-in writes each request it receives to a file, which is the count of what a run
// pays for. Every owner and mark below is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, appendFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { driverDir } from "../../shared/driver-dir.mjs";
import { RESEARCH_ANSWERS_FILE, researchRequestKey, heldAnswerToRequest } from "../research-answers.mjs";
import { buildRequestBody } from "../../providers/perplexity/src/core.js";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp", "perplexity-server.mjs");
const KEY = "clearance-acme-run-amber-fox-synthesis";
const OTHER = "clearance-acme-run-amber-fox-common-law-half-a";
const ask = (owner) => `Does ${owner} use the mark QZORVEL for toys in France, and has it opposed or sued over a similar mark?`;

// The research service, stood in for in the server's process. Each request is appended to STUB_CALLS, and each answer
// carries the request's number, so an answer given again is told apart from a new one. "fail" is a refused key and
// "unreadable" a completed reply with no text in it.
const STUB = `
import { appendFileSync, readFileSync } from "node:fs";
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init) => {
  appendFileSync(process.env.STUB_CALLS, init.body + "\\n");
  const n = readFileSync(process.env.STUB_CALLS, "utf8").trim().split("\\n").length;
  if (process.env.STUB_RESEARCH === "fail") return new Response("invalid api key", { status: 401 });
  if (process.env.STUB_RESEARCH === "unreadable") return json({ status: "completed", output: [] });
  return json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Answer " + n + ": the owner sells toys in France under QZORVEL (https://example.com/qzorvel-" + n + ")." }] }] });
};`;
const PRELOAD = `data:text/javascript,${encodeURIComponent(STUB)}`;

function newRun(t) {
  const d = mkdtempSync(join(tmpdir(), "research-reuse-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  mkdirSync(driverDir(d), { recursive: true });
  return d;
}
const sent = (d) => existsSync(join(d, "stub-calls.jsonl"))
  ? readFileSync(join(d, "stub-calls.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const logRows = (d) => readFileSync(driverDir(d, "reading-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

/** One call to the real research server over stdio, as the session `session`. */
async function callResearch(d, args, { session = KEY, stub = "ok" } = {}) {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "perplexity_research", arguments: args } },
  ];
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", PRELOAD, SERVER], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PERPLEXITY_API_KEY: "placeholder-not-a-key", STUB_RESEARCH: stub, STUB_CALLS: join(d, "stub-calls.jsonl"),
        CLEAROTRON_BAND_RUN_DIR: d, CLEAROTRON_GATHER_SESSION_KEY: session } });
    let buf = "", text = null;
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(text ?? ""); };
    const timer = setTimeout(done, 15000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id === 2) text = m.result?.content?.[0]?.text ?? ""; } catch { /* not a reply */ }
      }
      if (text !== null) { clearTimeout(timer); done(); }
    });
    child.on("error", reject);
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}

test("a stage's retry and its resume send only the question it has no answer to", async (t) => {
  const d = newRun(t);
  const first = [await callResearch(d, { task: ask("Example Holdings") }), await callResearch(d, { task: ask("Sample Trading") })];
  assert.equal(sent(d).length, 2, "the first pass did not send its two questions");

  // The retry asks both again and one new question: only the new one goes out, and the two held answers come back as
  // they were given.
  const retry = [
    await callResearch(d, { task: ask("Example Holdings") }, { session: `${KEY}-rerun1` }),
    await callResearch(d, { task: ask("Sample Trading") }, { session: `${KEY}-rerun1` }),
    await callResearch(d, { task: ask("Placeholder Ltd") }, { session: `${KEY}-rerun1` }),
  ];
  assert.equal(sent(d).length, 3, "the retry sent a question its stage already had an answer to");
  assert.deepEqual(retry.slice(0, 2), first, "a held answer did not come back as it was given");
  assert.match(retry[2], /^Answer 3: /);

  // A resume dispatches the stage under its own key again, and every question it asks is answered from the run.
  for (const owner of ["Example Holdings", "Sample Trading", "Placeholder Ltd"]) await callResearch(d, { task: ask(owner) });
  assert.equal(sent(d).length, 3, "the resumed stage paid again for an answer the run holds");

  const rows = logRows(d).filter((r) => r.tool === "perplexity_research");
  assert.deepEqual(rows.map((r) => r.reused === true), [false, false, true, true, false, true, true, true],
    "the log does not say which questions were answered from the run");
  assert.ok(rows.every((r) => r.ok === true && typeof r.args?.task === "string"), "a reused answer was logged as anything but a completed question");
});

test("another stage's answer is never reused, and neither is a question asked differently", async (t) => {
  const d = newRun(t);
  await callResearch(d, { task: ask("Example Holdings") });
  await callResearch(d, { task: ask("Example Holdings") }, { session: OTHER });
  assert.equal(sent(d).length, 2, "another stage was answered with this stage's answer");
  await callResearch(d, { task: ask("Example Holdings"), depth: "fast-search" });
  await callResearch(d, { task: ask("Example Holdings"), allow_fetch: true });
  await callResearch(d, { task: `${ask("Example Holdings")} Name the source.` });
  assert.equal(sent(d).length, 5, "a question at another depth, with another option or in other words was not sent");
  await callResearch(d, { task: ask("Example Holdings"), depth: "fast-search" }, { session: `${KEY}-rerun2` });
  assert.equal(sent(d).length, 5, "the same question at the same depth was sent again");
});

test("a question whose earlier call failed or came back unreadable is sent again", async (t) => {
  const d = newRun(t);
  assert.match(await callResearch(d, { task: ask("Sample Trading") }, { stub: "fail" }), /^ERROR: Research failed/);
  await callResearch(d, { task: ask("Sample Trading") }, { stub: "unreadable" });
  assert.match(await callResearch(d, { task: ask("Sample Trading") }), /^Answer 3: /);
  assert.equal(sent(d).length, 3, "a question with no answer held was not sent again");
  await callResearch(d, { task: ask("Sample Trading") }, { session: `${KEY}-rerun1` });
  assert.equal(sent(d).length, 3, "the answer the third call got was not held for the stage's retry");
});

test("an answer kept before requests were fingerprinted is asked again, and one outside a stage is never reused", async (t) => {
  const d = newRun(t);
  appendFileSync(driverDir(d, RESEARCH_ANSWERS_FILE), JSON.stringify({ ts: "2026-01-01T10:00:00.000Z", session: KEY,
    task: ask("Example Holdings"), preset: "pro-search", text: "An answer kept before the fingerprint." }) + "\n");
  assert.match(await callResearch(d, { task: ask("Example Holdings") }), /^Answer 1: /);
  assert.equal(sent(d).length, 1);
  await callResearch(d, { task: ask("Example Holdings") }, { session: "" });
  assert.equal(sent(d).length, 2, "a call with no stage session was answered from a stage's answer");
});

test("the fingerprint is the whole request, and a held answer is the latest real one of its stage", (t) => {
  const base = { task: ask("Example Holdings"), preset: "pro-search" };
  const k = researchRequestKey(buildRequestBody(base));
  assert.equal(researchRequestKey(buildRequestBody({ ...base })), k, "the same request was fingerprinted twice differently");
  for (const change of [{ preset: "fast-search" }, { allowFetch: true }, { domainFilter: ["example.com"] }, { modelOverride: "m" },
    { enableSandbox: true }, { responseSchema: { type: "object" }, schemaName: "s" }, { task: `${base.task} ` }])
    assert.notEqual(researchRequestKey(buildRequestBody({ ...base, ...change })), k, `a request with ${Object.keys(change)} changed was taken for the same`);

  const d = newRun(t);
  const row = (o) => appendFileSync(driverDir(d, RESEARCH_ANSWERS_FILE), JSON.stringify({ task: base.task, request: k, ...o }) + "\n");
  row({ ts: "2026-01-01T10:00:00.000Z", session: KEY, text: "the first answer" });
  row({ ts: "2026-01-01T10:05:00.000Z", session: `${KEY}-rerun1`, text: "a later answer" });
  row({ ts: "2026-01-01T10:06:00.000Z", session: `${KEY}-rerun1`, text: "ERROR: Research failed — 429" });
  row({ ts: "2026-01-01T10:07:00.000Z", session: OTHER, text: "another stage's answer" });
  assert.equal(heldAnswerToRequest(d, KEY, k)?.text, "a later answer");
  assert.equal(heldAnswerToRequest(d, OTHER, k)?.text, "another stage's answer");
  assert.equal(heldAnswerToRequest(d, "clearance-acme-run-amber-fox-review", k), null);
  assert.equal(heldAnswerToRequest(d, KEY, "0".repeat(24)), null);
  assert.equal(heldAnswerToRequest(join(d, "nowhere"), KEY, k), null);
});
