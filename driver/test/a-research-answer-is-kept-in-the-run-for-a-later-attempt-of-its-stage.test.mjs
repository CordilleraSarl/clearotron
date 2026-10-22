// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RESEARCH ANSWER IS KEPT IN THE RUN, BESIDE ITS QUESTION, FOR A LATER ATTEMPT OF ITS STAGE.
//
// A stage attempt that times out took its research answers with it: the text the model read lived only in its turn, and
// the retry asked again. The research server now keeps each answer's text in the run folder. Only answers are kept: a
// failed call, or a reply the formatter could not read, is asked again. A stage's own answers are its session's and its
// retries', never another stage's. Every owner and mark below is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { keepResearchAnswer, researchAnswersFor, RESEARCH_ANSWERS_FILE } from "../research-answers.mjs";

const KEY = "clearance-acme-run-amber-fox-synthesis";
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp", "perplexity-server.mjs"), "utf8");
const run = (t) => { const d = mkdtempSync(join(tmpdir(), "research-answers-")); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const ask = (owner) => `Does ${owner} use the mark QZORVA for software in Japan, and has it opposed a similar mark?`;

test("an answer is kept beside its question, and a failed call or an unreadable reply is not", (t) => {
  const d = run(t);
  keepResearchAnswer(d, { session: KEY, agent: "a", task: ask("Example Holdings"), preset: "pro-search", text: "Yes: https://example.com/qzorva" });
  keepResearchAnswer(d, { session: KEY, task: ask("Sample Trading"), text: "ERROR: Perplexity returned a response but no text content could be extracted. Status: failed" });
  keepResearchAnswer(d, { session: KEY, task: ask("Placeholder Ltd"), text: "   " });
  keepResearchAnswer(null, { session: KEY, task: ask("Outside Co"), text: "kept nowhere" });
  const rows = readFileSync(driverDir(d, RESEARCH_ANSWERS_FILE), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => [r.session, r.task, r.preset, r.text]),
    [[KEY, ask("Example Holdings"), "pro-search", "Yes: https://example.com/qzorva"]], "a reply that is not an answer was kept, or an answer was lost");
});

test("a stage's answers are its own session's and its retries', oldest first, the latest answer to each question", (t) => {
  const d = run(t);
  const row = (session, task, text, ts) => appendFileSync(driverDir(d, RESEARCH_ANSWERS_FILE), JSON.stringify({ ts, session, task, text }) + "\n");
  mkdirSync(driverDir(d), { recursive: true });
  row(KEY, ask("Example Holdings"), "first answer", "2026-01-01T10:00:00.000Z");
  row(`${KEY}-rerun1`, ask("Sample Trading"), "no result", "2026-01-01T10:05:00.000Z");
  row(`${KEY}-rerun1`, ask("Example Holdings"), "a later answer", "2026-01-01T10:06:00.000Z");
  row(`${KEY}-corrective`, ask("Other Corp"), "another session's answer", "2026-01-01T10:07:00.000Z");
  row(`${KEY}-rerunx`, ask("Other Corp"), "another session's answer", "2026-01-01T10:07:30.000Z");
  row("clearance-acme-run-amber-fox-common-law-half-a", ask("Other Corp"), "another stage's answer", "2026-01-01T10:08:00.000Z");
  row(KEY, ask("Broken Answer Co"), "ERROR: Research failed — 429", "2026-01-01T10:09:00.000Z");
  appendFileSync(driverDir(d, RESEARCH_ANSWERS_FILE), '{"ts":"2026-01-01T10:10:00.000Z","session":"' + KEY + '","task":"torn');
  assert.deepEqual(researchAnswersFor(d, KEY).map((a) => [a.task, a.text]), [
    [ask("Sample Trading"), "no result"],
    [ask("Example Holdings"), "a later answer"],
  ]);
  assert.deepEqual(researchAnswersFor(d, "clearance-acme-run-amber-fox-review"), [], "a stage with no research of its own was handed another's");
  assert.deepEqual(researchAnswersFor(join(d, "nowhere"), KEY), []);
});

test("the research server keeps a free-form answer when it is returned, never on a failure and never from a grid", () => {
  const freeForm = SRC.slice(SRC.indexOf("if (!task || task.trim()"), SRC.indexOf("serve({"));
  const success = freeForm.slice(freeForm.indexOf("const text = "), freeForm.indexOf("return text;"));
  assert.match(success, /keepResearchAnswer\(RUN_DIR, \{ session: SESSION, agent: AGENT, task, preset, text \}\);/, "the answer returned is not kept");
  assert.equal((SRC.match(/keepResearchAnswer\(/g) ?? []).length, 1, "an answer is kept from somewhere other than the returned free-form answer");
});
