// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT IS REVIEWED ONCE, against the evidence its opinions cite, handed to it up front, in design's approved words. It
// rewrites nothing: a clean read is its answer to the client's question and an empty list of defects. A correction reads its
// defect and what it rests on, and nothing reads the corrected record again. Names here are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";
import { acceptKnockoutReview, recordKnockoutReview } from "../knockout-review-record.mjs";
import { builtinToolsFor } from "../engine/mcp/gather-config.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const REVIEW = "Read the opinion summaries and their cited evidence together. For each name, check the stated use and scope, material claims against their sources, and registered findings against the filing and risk framework. Report each material defect with the affected name, claim or finding, source, and correction needed. Consult a specific held source only when the supplied evidence is insufficient to decide that point. Leave supported wording alone.";
const CORRECTION = "Read the reported defect, the affected passage or finding, and its cited evidence. Correct the error and any conclusion for this name that depends on it. When the evidence leaves a material fact uncertain, state that limit.";
const THIN = "Give a marketplace lead its own finding when the source supports a relevant commercial use. A thin unregistered mention or isolated listing with no evidence of trade does not warrant a separate finding or follow-up.";
const QUESTION = "Does the report answer the client's question: who could object, how strong they are, what the client should do? Are the marks a lawyer would list present, and is each position written from the record that matters?";

const review = (ctx = {}) => KO_STAGES["knockout-review"].message({ K: koPaths(mkdtempSync(join(tmpdir(), "ko-review-"))), ...ctx });

test("the review opens on the client's question, checks the opinions against their evidence in the approved words, and rewrites nothing", () => {
  const msg = review();
  assert.equal(msg.split("\n").find((l) => l.trim()), QUESTION, "the client's question leads");
  assert.ok(msg.includes(REVIEW), "the review's approved line, verbatim");
  assert.ok(msg.includes(THIN), "a thin web lead is not chased");
  assert.doesNotMatch(msg, /THE WORDS COME AFTER|THE RULE\.|A REWRITE|rewrites|any check on wording|report-prose/, "the rewording job is gone");
  assert.doesNotMatch(msg, /read again|second look|recheck/i, "no step reads the record after the correction");
  assert.match(msg, /Send `first_question`, your answer to the question this message opens with, and `material`: one row per material defect, as above, or an empty list where there is none\./);
});

test("the review is handed the opinion summaries, their cited evidence and the owner checks, and each block only where it holds rows", () => {
  const full = review({ digestLines: ['### "QUILLBRAE": High'], sourceLines: ["- tm_1 · \"QUILLBRAE\""], ownerCheckRows: ["- Brightmoor Candle Co: sells candles"] });
  assert.match(full, /THE OPINION SUMMARIES, as rated, one block a name\. Findings carry their ordinals; their sources are named by record ID or address\.\n### "QUILLBRAE": High/);
  assert.match(full, /THEIR CITED EVIDENCE, each source once, with what this run holds of it and the opinion that cites it:\n- tm_1/);
  assert.match(full, /THE OWNER CHECKS behind each name's filings, each with its answer:\n- Brightmoor Candle Co/);
  const none = review();
  assert.doesNotMatch(none, /THE OPINION SUMMARIES|THEIR CITED EVIDENCE|THE OWNER CHECKS/, "a heading with no rows under it");
  assert.match(review({ registerTableFile: "/run/_driver/register-table.review.json" }), /what the reading set aside, and why, is in \/run\/_driver\/register-table\.review\.json\./);
});

test("the review starts with file read and tool search only, so a consult is one deliberate read", () => {
  assert.deepEqual(builtinToolsFor("knockout-review"), ["Read", "ToolSearch"]);
});

test("a clean review is an answer; a call with neither an answer nor a defect list, or with a rewrite, is refused", () => {
  assert.equal(acceptKnockoutReview({ first_question: "Yes.", material: [] }).ok, true, "a clean read is refused");
  assert.equal(acceptKnockoutReview({ material: [] }).ok, false, "an empty call is accepted");
  assert.equal(acceptKnockoutReview({ first_question: "Yes." }).ok, false, "an answer with no defect list is accepted");
  const dir = mkdtempSync(join(tmpdir(), "ko-review-call-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(join(dir, "knockout-findings.json"), JSON.stringify({ marks: [] }));
  const r = recordKnockoutReview(dir, { first_question: "Yes.", material: [], rewrites: [{ at: { field: "basis", mark: "QUILLBRAE" }, text: "x" }] });
  assert.equal(r.written, null, "a rewrite was accepted");
  assert.match(String(r.refused), /rewords nothing, so it takes no `rewrites`/, "a rewrite is refused for what it is, not for the line it names");
  assert.equal(acceptKnockoutReview({ first_question: "Yes.", material: [], declined: [{ why: "x" }] }).ok, false, "a declined line was accepted");
  assert.equal(acceptKnockoutReview({ first_question: "Yes.", material: [], rewrites: [], declined: [] }).ok, true, "an empty retired list was refused");
});

test("the correction answers its defect in the approved words, with what it rests on and no whole research payload", () => {
  const K = koPaths(mkdtempSync(join(tmpdir(), "ko-correct-")));
  const work = { defects: [{ n: 1, kind: "band", mark: "QUILLBRAE", chunk: 0, problem: "The first conflict is rated too low.", rests_on: ["https://example.test/x"] }] };
  const msg = KO_STAGES["knockout-correct"].message({ K, chunkNo: 0, work, chunkMarks: [{ name: "QUILLBRAE" }] });
  assert.ok(msg.includes(CORRECTION), "the correction's approved line, verbatim");
  assert.match(msg, /WHAT YOUR DEFECTS REST ON, as this run holds it: each source a defect names, and each source the finding it names cites\.\n- https:\/\/example\.test\/x · not held by this run/);
  assert.doesNotMatch(msg, /quillbrae\.md|research payload: /, "the correction is pointed at a whole research payload");
});

test("there is one review: a second pass's label writes the same file", () => {
  const K = koPaths(mkdtempSync(join(tmpdir(), "ko-review-once-")));
  assert.equal(KO_STAGES["knockout-review"].out(K, 1), K.review);
});

// The tool's own words reach the model beside the dispatch's, so they are read as the model receives them: from the server.
function servedTools() {
  return new Promise((resolve, reject) => {
    const p = spawn("node", [join(DRIVER, "engine", "mcp", "recording-server.mjs")], { stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: join(DRIVER, "..", ".no-such-run") } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("recording-server.mjs did not answer tools/list — could not look")); }, 20000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return resolve(m.result?.tools ?? []);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "knockout-review-words", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

test("the review tool takes the answer and the defects, and has no field for a rewrite", async () => {
  const tool = (await servedTools()).find((t) => t.name === "record_knockout_review");
  assert.ok(tool, "record_knockout_review was not served — that is a finding, not a pass");
  assert.deepEqual(Object.keys(tool.inputSchema?.properties ?? {}).sort(), ["first_question", "material", "schema_version"]);
  assert.match(tool.description, /Send an empty `material` list when you found none\./);
});
