// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SYNTHESIS RETRY IS HANDED THE RESEARCH ITS EARLIER ATTEMPT GOT.
//
// The research server keeps each answer's text in the run (research-answers.mjs). When synthesis is dispatched again, on
// a fresh retry of a timed-out attempt or on a resumed pass, the driver writes the answers its earlier attempts got to
// `research-answers.md` in the run folder, one question and its answer per line, and the message ends with a block that
// says how many there are and how to find one: by the owner's name, with the artifact search synthesis already holds. A
// first attempt has no saved answers, and its message is what it was, byte for byte. Every owner and mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths, STAGES } from "../stages.mjs";
import { messageCtxFor } from "../pipeline.mjs";
import { keepResearchAnswer, RESEARCH_ANSWERS_MD } from "../research-answers.mjs";
import { searchRunArtifacts, SEARCH_LIMITS } from "../skeptic-search.mjs";

const RUN = { slug: "acme-run", codename: "amber-fox" };
const KEY = `clearance-${RUN.slug}-${RUN.codename}-synthesis`;
const ask = (owner, mark = "QZORVA") => `Does ${owner} use the mark ${mark} for accounting software in Japan, and has it opposed or sued over a similar mark?`;
const LONG = `Example Holdings sells QZORVA accounting software in Japan through its own shop (https://example.com/qzorva/jp).\n${"Its catalogue lists the product under the QZORVA name in every edition since 2019. ".repeat(12)}\nNo opposition, dispute or court action over QZORVA or a similar mark was found.\n\n---\n_Research metadata: Depth: pro-search | Tokens: 1834 | Citations: 3_`;

function runFolder(t) {
  const runDir = mkdtempSync(join(tmpdir(), "synthesis-retry-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(join(runDir, "_driver"), { recursive: true });
  const ctx = { run: RUN, paths: paths(runDir), job: {}, customerUnknown: false, profile: null, intakeAsks: [], enforcerSignals: null,
    framework: null, jxAim: null, registerOnly: false, crowdContext: null, dispatchBlocks: {} };
  return { runDir, ctx };
}
const messageOf = (ctx) => String(STAGES.synthesis.message(messageCtxFor("synthesis", ctx)));
const refreshedOf = (ctx) => String(STAGES.synthesis.message(messageCtxFor("synthesis", STAGES.synthesis.refreshCtx(ctx))));

test("a first attempt with no saved answers sends the message it sent before, and no file is written", (t) => {
  const { runDir, ctx } = runFolder(t);
  const before = String(STAGES.synthesis.message({ ...ctx, placementSetAsides: messageCtxFor("synthesis", ctx).placementSetAsides }));
  assert.equal(messageOf(ctx), before, "the message changed with nothing saved");
  assert.equal(refreshedOf(ctx), before, "a rebuilt first attempt is not the message it replaces");
  assert.doesNotMatch(before, /RESEARCH THIS RUN HAS ALREADY ANSWERED/);
  assert.equal(existsSync(join(runDir, RESEARCH_ANSWERS_MD)), false, "a file was written with nothing to hand on");
});

test("a retry is handed the answers: a file with one question and its answer per line, and the block last", (t) => {
  const { runDir, ctx } = runFolder(t);
  keepResearchAnswer(runDir, { session: KEY, task: ask("Example Holdings"), text: LONG });
  keepResearchAnswer(runDir, { session: `${KEY}-rerun1`, task: ask("Sample Trading", "QZORVEN"), text: "No result: no page shows Sample Trading using QZORVEN.\n\n---\n_Research metadata: Depth: pro-search_" });
  keepResearchAnswer(runDir, { session: KEY, task: ask("Broken Answer Co"), text: "ERROR: Research failed — 429" });
  keepResearchAnswer(runDir, { session: `clearance-${RUN.slug}-${RUN.codename}-common-law-half-a`, task: ask("Other Stage Co"), text: "another stage's answer" });

  const text = messageOf(ctx);
  const block = "RESEARCH THIS RUN HAS ALREADY ANSWERED: an earlier attempt of this stage asked 2 questions and got their answers. "
    + "They are in research-answers.md, one question and its answer per line. Before you ask about a finding's owner and mark, search that file "
    + "for the owner's name with search_run_artifacts. Where one of them asked about that owner and mark for the same field and country, use its "
    + "answer as that finding's check, cite its URL and record it as you would a fresh one; ask only what none of them covers.";
  assert.ok(text.endsWith(`\n${block}`), `the block is not the message's last line:\n${text.slice(-700)}`);
  assert.equal(refreshedOf(ctx), text, "a fresh retry is not handed the same");

  const lines = readFileSync(join(runDir, RESEARCH_ANSWERS_MD), "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, 2, "a failed call or another stage's answer was handed on, or an answer was lost");
  assert.equal(lines[0], `Question 1: ${ask("Example Holdings")} Answer 1: ${LONG.replace(/\s*\n\s*/g, " ")}`);
  assert.match(lines[1], /^Question 2: .*QZORVEN.* Answer 2: No result: no page shows Sample Trading using QZORVEN\. --- _Research metadata: Depth: pro-search_$/);
});

test("one saved answer is told in the singular", (t) => {
  const { runDir, ctx } = runFolder(t);
  keepResearchAnswer(runDir, { session: KEY, task: ask("Example Holdings"), text: "Yes: https://example.com/qzorva" });
  assert.match(messageOf(ctx), /an earlier attempt of this stage asked 1 question and got its answer\. They are in research-answers\.md, one question and its answer per line\./);
});

test("the artifact search hands back a whole answer line from the answers file, and still cuts other files' lines", (t) => {
  const { runDir, ctx } = runFolder(t);
  keepResearchAnswer(runDir, { session: KEY, task: ask("Example Holdings"), text: LONG });
  messageOf(ctx);
  const found = searchRunArtifacts(runDir, { file: RESEARCH_ANSWERS_MD, terms: ["Example Holdings"] });
  assert.equal(found.matches.length, 1);
  assert.ok(found.matches[0].text.length > SEARCH_LIMITS.maxLineChars, "the answer line was cut");
  assert.match(found.matches[0].text, /No opposition, dispute or court action over QZORVA or a similar mark was found\./, "the answer's end was cut off");

  writeFileSync(join(runDir, "register-findings.md"), `Example Holdings ${"x".repeat(2000)}\n`);
  assert.equal(searchRunArtifacts(runDir, { file: "register-findings.md", terms: ["Example Holdings"] }).matches[0].text.length, SEARCH_LIMITS.maxLineChars);
});

test("an answers file whose matching lines would overflow one tool reply is cut between lines and says so", (t) => {
  const { runDir } = runFolder(t);
  const line = (i) => `Question ${i}: ${ask(`Owner ${i} Holdings`)} Answer ${i}: ${"Example Holdings appears in this answer. ".repeat(220)}`;
  writeFileSync(join(runDir, RESEARCH_ANSWERS_MD), Array.from({ length: 40 }, (_, i) => line(i + 1)).join("\n") + "\n");
  const found = searchRunArtifacts(runDir, { file: RESEARCH_ANSWERS_MD, terms: ["Example Holdings"] });
  const bytes = found.matches.reduce((n, m) => n + m.text.length, 0);
  assert.ok(bytes <= 60000, `one reply carried ${bytes} characters of lines`);
  assert.ok(found.matches.every((m) => m.text === line(m.line)), "a line was handed back cut");
  assert.equal(found.total_matches, 40);
  assert.equal(found.truncated, true, "a reply that left lines out did not say so");
});
