// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PLAIN MODEL CAN SUPPLY A STAGE'S RESULT, AND ITS RESULT IS CHECKED BEFORE ANYTHING READS IT.
//
// A stage declared with no record tool and `output: "reply"` (stage-declarations.mjs) hands back its result as its reply
// text. The driver writes the reply to the stage's one output file, the stage's validator judges it there, and a reply
// that is missing or does not pass takes the stage's ordinary failure and retry path. The dispatch names no file, so
// neither engine's output rule asks the model to write one, and the turn is told the seat writes nothing itself.
// Shown through the real gateway and each engine's real adapter, against the stand-in programs, with a stage the test
// describes, since no live stage declares it. Invented values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { runStage } = await import("../gateway.mjs");
const { STAGE_DECLARATIONS } = await import("../stage-declarations.mjs");

const ENGINES = {
  "anthropic-agent": (dir, reply) => ({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"),
    MOCK_CLAUDE_NOFILE: "1", MOCK_CLAUDE_RESULT: reply, MOCK_CLAUDE_CALL_LOG: join(dir, "calls.jsonl"), MOCK_COUNT_FILE: join(dir, "count") }),
  "openai-agent": (dir, reply) => ({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"),
    CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-invented", MOCK_CODEX_NOFILE: "1", MOCK_CODEX_RESULT: reply,
    MOCK_CODEX_CALL_LOG: join(dir, "calls.jsonl") }),
};

// The invented stage: no tools, no record tool, its reply is its output, and a code validator that accepts a JSON object
// naming one answer.
const DECLARATION = Object.freeze({ grant: [], recording: null, validator: "inventedAnswer", output: "reply" });
const inventedAnswer = (_file, text) => {
  let doc = null;
  try { doc = JSON.parse(text); } catch { return { ok: false, reason: "invented_answer_unparseable: the reply is not JSON" }; }
  return typeof doc?.answer === "string" && doc.answer ? { ok: true } : { ok: false, reason: "invented_answer_missing: no answer named" };
};
const MESSAGE = "Name the colour of the invented lantern, and reply with one JSON object: {\"answer\": \"<colour>\"}.";

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  return (async () => { try { return await fn(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } } })();
}

/** One dispatch of the invented stage on `engine`, whose reply is `reply`: the outcome, the output file and the calls made. */
async function plain(engine, reply) {
  const dir = mkdtempSync(join(tmpdir(), "plain-stage-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    const out = join(dir, "invented-answer.json");
    const res = await withEnv({ ...ENGINES[engine](dir, reply), CLEAROTRON_RETRY_BACKOFF_MS: "0" },
      () => runStage("invented-plain-stage", { message: MESSAGE, model: "haiku", sessionKey: `plain-${engine}`, runDir: dir, expectFile: out,
        validate: inventedAnswer, declaration: DECLARATION, maxRetries: 1, timeoutSec: 30 }));
    const calls = readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    return { res, calls, dir, out, written: existsSync(out) ? readFileSync(out, "utf8") : null };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a reply that passes its validator is the stage's result, written where the validator read it`, async () => {
    const r = await plain(engine, "{\"answer\": \"amber\"}");
    assert.equal(r.res.ok, true, `refused: ${r.res.fail}`);
    assert.equal(r.res.attempts, 1);
    assert.equal(r.written, "{\"answer\": \"amber\"}\n", "the reply is not the stage's output file");
    assert.equal(r.calls.length, 1);
    assert.ok(!String(r.calls[0].prompt).includes(r.out), "the dispatch named an output file");
  });

  test(`${engine}: a reply that does not pass takes the stage's failure and retry path`, async () => {
    const r = await plain(engine, "the lantern is amber");
    assert.equal(r.res.ok, false, "an invalid reply was accepted");
    assert.equal(r.res.attempts, 2, "the failed reply was not retried");
    assert.match(String(r.res.fail), /^invalid_file:.*invented-answer\.json:invented_answer_unparseable/);
    assert.equal(r.calls.length, 2, "the retry did not reach the engine");
  });
}

test("an empty reply is a missing output, so a file an earlier turn left at the stage's path is not judged in its place", async () => {
  for (const engine of Object.keys(ENGINES)) {
    const dir = mkdtempSync(join(tmpdir(), "plain-empty-"));
    try {
      mkdirSync(driverDir(dir), { recursive: true });
      const out = join(dir, "invented-answer.json");
      writeFileSync(out, "{\"answer\": \"an earlier turn's\"}\n");
      const res = await withEnv({ ...ENGINES[engine](dir, " "), CLEAROTRON_RETRY_BACKOFF_MS: "0" },
        () => runStage("invented-plain-stage", { message: MESSAGE, model: "haiku", sessionKey: `plain-empty-${engine}`, runDir: dir, expectFile: out,
          validate: inventedAnswer, declaration: DECLARATION, maxRetries: 0, timeoutSec: 30 }));
      assert.equal(res.ok, false, `${engine}: an empty reply passed on an earlier turn's file`);
      assert.match(String(res.fail), /^missing_file:invented-answer\.json/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("a reply that fails a form check takes the ladder's retry, not a form repair inside the dispatch", async () => {
  // A closed-vocabulary refusal is form-class, which a written file would have repaired in its own session. A reply has
  // no file of its own to patch, so the retry is a fresh dispatch whose reply is written and judged.
  let checks = 0;
  const formOnce = (file, text) => (checks++ === 0 ? { ok: false, reason: "framediff_severity_invalid:major (not in: dominant-element, material, minor)" } : inventedAnswer(file, text));
  for (const engine of Object.keys(ENGINES)) {
    checks = 0;
    const dir = mkdtempSync(join(tmpdir(), "plain-form-"));
    try {
      mkdirSync(driverDir(dir), { recursive: true });
      const out = join(dir, "invented-answer.json");
      const res = await withEnv({ ...ENGINES[engine](dir, "{\"answer\": \"amber\"}"), CLEAROTRON_RETRY_BACKOFF_MS: "0" },
        () => runStage("invented-plain-stage", { message: MESSAGE, model: "haiku", sessionKey: `plain-form-${engine}`, runDir: dir, expectFile: out,
          validate: formOnce, declaration: DECLARATION, maxRetries: 1, timeoutSec: 30 }));
      assert.equal(res.ok, true, `${engine}: refused: ${res.fail}`);
      assert.equal(res.attempts, 2, `${engine}: the refusal was not retried by the ladder`);
      assert.equal(res.formRepairs ?? 0, 0, `${engine}: a form repair was attempted on a reply`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("anthropic-agent: the turn of a stage whose reply is its output is granted no write into the run folder", async () => {
  const r = await plain("anthropic-agent", "{\"answer\": \"amber\"}");
  const argv = r.calls[0].argv ?? [];
  const added = argv.flatMap((a, i) => (a === "--add-dir" ? [argv[i + 1]] : []));
  assert.ok(!added.includes(r.dir), "the run folder was granted to a seat that writes nothing");
});

test("no live stage declares its reply as its output: each keeps the model and the result path it has", () => {
  assert.deepEqual(Object.entries(STAGE_DECLARATIONS).filter(([, d]) => d.output !== undefined).map(([s]) => s), []);
});
