// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — counts over literal records, then a Knockout through the mock pipeline on both engines
//
// A KNOCKOUT RECORDS WHERE ITS DEFAULT-VISIBLE LINES BREAK THE PLAIN-LANGUAGE RULE, BY RATING GROUP AND FIELD, AS SAVED AND
// AS PUBLISHED (design's decision of 2026-11-26). Recording only: the rule, its internal flag and the unconditional delivery
// are unchanged, and no turn is added. The counts are the lint's own, so the record and the flag agree on what a long line
// is. Every name and sentence here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { plainLanguageByField, knockoutPlainLanguage } = await import("../knockout-plain-language.mjs");
const { plainLanguageChecks } = await import("../predelivery-lint.mjs");
const { SENTENCE_WORD_LIMIT, PLAIN_FORMS } = await import("../plain-register.mjs");

const long = (n = SENTENCE_WORD_LIMIT + 4) => `${Array.from({ length: n }, (_, i) => `word${i}`).join(" ")}.`;
const [TERM] = PLAIN_FORMS.find(([t]) => /^[a-z]/i.test(t)) ?? [];

test("the counts are the lint's own: by field, sentences over the limit and the lawyer's words, a caveat the rating wrote included", () => {
  const record = {
    batch: { executiveSummary: `${long()} A short close.`, standardCaveats: [long()] },
    marks: [{ name: "QUILLBRAE", basis: long(), factors: ["Short.", long()], counterFactors: [long()], findings: [{ ordinal: 1, net: `The ${TERM} sits here.` }] }],
  };
  const c = plainLanguageByField(record);
  assert.deepEqual(c.long, { summary: 1, "batch.standardCaveats": 1, basis: 1, factors: 2 }, JSON.stringify(c));
  assert.equal(c.words.conflict, 1);
  const lintSaysLong = plainLanguageChecks({ findings: record }).find((x) => x.id === "plain-language-sentence-length");
  assert.equal(lintSaysLong.pass, false, "the lint and the record disagree about a long line");
  assert.deepEqual(plainLanguageByField({ batch: { executiveSummary: "One name screened." }, marks: [] }), { long: {}, words: {} });
});

test("per group, as saved and as published, with the group's correction status and the count another turn would touch", () => {
  const runDir = mkdtempSync(join(tmpdir(), "ko-plain-"));
  writeFileSync(join(runDir, "knockout-assess-0.json"), JSON.stringify({ chunkSummary: long(), marks: [{ name: "QUILLBRAE", basis: long() }] }));
  writeFileSync(join(runDir, "knockout-assess-1.json"), JSON.stringify({ chunkSummary: "One name screened, rated Low.", marks: [{ name: "MOSSVALE", basis: "Nothing close." }] }));
  writeFileSync(join(runDir, "knockout-assess-2.json"), JSON.stringify({ chunkSummary: "One name.", marks: [{ name: "TARNHOLM", basis: long() }] }));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(driverDir(runDir, "knockout-correction-work.json"), JSON.stringify({ defects: [{ chunk: 2, mark: "TARNHOLM", kind: "source" }] }));
  const delivered = { batch: { executiveSummary: "Three names screened." }, marks: [{ name: "QUILLBRAE", basis: "Split now." }, { name: "MOSSVALE", basis: "Nothing close." }, { name: "TARNHOLM", basis: long() }] };
  const r = knockoutPlainLanguage({ runDir, delivered });
  assert.deepEqual(r.groups.map((g) => [g.group, g.marks, g.saved.long, g.published.long, g.sentToCorrection]), [
    [0, 1, { summary: 1, basis: 1 }, {}, false],
    [1, 1, {}, {}, false],
    [2, 1, { basis: 1 }, { basis: 1 }, true],
  ]);
  assert.equal(r.groupsWithAFlagAsSaved, 2);
  assert.equal(r.groupsWithAFlagAsSavedAndNotSentToCorrection, 1);
  assert.deepEqual(r.publishedSummary.long, {});
  assert.equal(r.limit, SENTENCE_WORD_LIMIT);
});

// Through the lane, on each engine: a delivered Knockout carries the record, and the delivery does not wait on it.
const ROOT = mkdtempSync(join(tmpdir(), "ko-plain-pipeline-"));
const PROFILES = join(ROOT, "profiles");
cpSync(join(HERE, "..", "profiles"), PROFILES, { recursive: true });
const CLAUDE = join(HERE, "mock-claude.mjs"), CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755); chmodSync(CODEX, 0o755);
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");
const EXECUTORS = {
  recordLister: async () => ({ ok: true, total: null, records: [] }),
  countExecutor: async () => ({ ok: true, total: 0 }),
  gridExecutor: async (spec) => answeredGrid(spec, []),
  sweepExecutor: async () => ({ ok: true, text: "Nothing found." }),
};
const ENGINES = {
  "anthropic-agent": { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  "openai-agent": { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
for (const [engine, env] of Object.entries(ENGINES)) {
  test(`${engine}: a delivered Knockout records its plain-language counts by group, and names its engine`, async () => {
    const ws = mkdtempSync(join(ROOT, `${engine}-`));
    for (const [k, v] of Object.entries({ ...env, CLEAROTRON_WORK_DIR: join(ws, "ws"), CLEAROTRON_REPORTS_DIR: join(ws, "pool"),
      CLEAROTRON_REPORTS_URL: "https://trademark.test", CLEAROTRON_CUSTOMERS_DIR: PROFILES, CLEAROTRON_REGISTER_CALL_LOG: join(ws, "register-calls.jsonl"),
      CLEAROTRON_DATABASE: "signa", CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_DEFAULT_AGENT: "intake-agent",
      MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" })) pinEnv(process.env, k, v);
    for (const k of ["CLEAROTRON_REGISTER_RECORD_LOG", "CLEAROTRON_SIGNA_ANSWER_MEMORY", "CLEAROTRON_KNOCKOUT_MODEL"]) pinEnv(process.env, k, undefined);
    const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
    const res = await pipeline({ id: `ko-plain-${engine}`, msgId: `<ko-plain-${engine}@x>`, forwarder: "jordan", forwarderDomain: "example.com",
      product: "knockout-search", classes: [4], jurisdictions: ["EU"], markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }, { name: "CLUVENDRA" }] }, EXECUTORS);
    assert.equal(res.ok, true, JSON.stringify(res));
    const rows = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const rec = rows.find((e) => e.event === "knockout-plain-language");
    assert.ok(rec, "the delivered Knockout carries no plain-language record");
    assert.equal(rec.engine, engine);
    const chunks = readdirSync(res.runDir).filter((n) => /^knockout-assess-\d+\.json$/.test(n)).length;
    assert.equal(rec.groups.length, chunks, "a saved rating group is missing from the record");
    assert.equal(rec.groups.reduce((n, g) => n + g.marks, 0), 2);
    for (const g of rec.groups) for (const side of ["saved", "published"]) assert.ok(g[side]?.long && g[side]?.words, `group ${g.group} has no ${side} counts`);
  });
}
