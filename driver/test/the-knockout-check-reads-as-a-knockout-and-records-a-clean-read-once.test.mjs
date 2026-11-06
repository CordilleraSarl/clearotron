// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE KNOCKOUT CHECK READS AS A KNOCKOUT, AND RECORDS A CLEAN READ ONCE. The first look checks the request, the material
// conflicts, their support and the answer's agreement with itself; it rewrites only wording that obscures or misstates the
// answer. It is no longer told to account for every line it leaves alone, by the dispatch or by the tool it answers through.
// The question it answers first and the plain-language rule are unchanged, and the second look keeps its own scope.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { KO_STAGES, koPaths } from "../stages-knockout.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");

const KNOCKOUT_CHECK = "Check this as a knockout: does the answer address the actual request, carry the material exact or near-exact conflicts, use held support, and agree with itself? Challenge a supported judgment only for a material defect, not because you would phrase it differently. Follow a specific concern into the held evidence where needed; do not repeat the entire search or expand the product's scope. Rewrite only wording that obscures or misstates the answer, preserving its facts and reasons. If no change is needed, record that once; do not explain every unchanged line. A later recheck checks the original defects, repairs and their consequences, not another general prose edit.";
const RECORD_ONCE = "If no change is needed, record that once; do not explain every unchanged line.";
const EVERY_LINE = /FOR A LINE YOU ARE LEAVING ALONE|neither rewrite nor decline|One row per flagged line/;

const message = (extra = {}) => KO_STAGES["knockout-review"].message({ K: koPaths(mkdtempSync(join(tmpdir(), "ko-check-"))), evidenceLines: [], firstReadLines: [], ...extra });

test("the first look is told to check the answer as a knockout, once, and keeps its first question and its plain-language rule", () => {
  const first = message();
  assert.equal(first.split(KNOCKOUT_CHECK).length - 1, 1, "the knockout check's paragraph is in the first look once, word for word");
  assert.ok(first.indexOf(KNOCKOUT_CHECK) < first.indexOf("MATERIAL DEFECTS COME FIRST."), "it opens the first look's own instructions");
  assert.doesNotMatch(first, EVERY_LINE, "the first look is still told to account for every line it leaves alone");
  assert.match(first, /^Does the report answer the client's question: who could object, how strong they are, what the client should do\?/m);
  assert.match(first, /THE RULE\. A line a reader meets before opening anything carries no legal or engine vocabulary and no sentence longer than 25 words\./);
  assert.match(first, /send one `declined` row at one of these addresses saying so, rather than inventing a rewrite to fill the call\./,
    "a clean record is still answered by one row");
  const flagged = message({ evidenceLines: ["- a flagged line, at address {\"field\":\"basis\",\"mark\":\"QUILLBRAE\"}"] });
  assert.ok(flagged.includes(KNOCKOUT_CHECK), "a record with flagged lines is checked the same way");
  assert.doesNotMatch(flagged, EVERY_LINE, "a flagged line left alone owes no row");
});

test("the second look keeps its own scope and is not handed the first look's paragraph", () => {
  const recheck = message({ recheckTable: "| 1 | band | QUILLBRAE | not answered |" });
  assert.ok(!recheck.includes(KNOCKOUT_CHECK));
  assert.doesNotMatch(recheck, EVERY_LINE);
  assert.match(recheck, /Recheck every material defect raised by the first review, every changed answer and summary, and any other conclusion that the changes could affect\./);
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
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "knockout-check-words", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

test("the review tool asks for a clean read once, and no longer for a row per line left alone", async () => {
  const tool = (await servedTools()).find((t) => t.name === "record_knockout_review");
  assert.ok(tool, "record_knockout_review was not served — that is a finding, not a pass");
  const declined = tool.inputSchema?.properties?.declined;
  assert.equal(declined?.description, RECORD_ONCE);
  assert.deepEqual(declined?.items?.required, ["at", "why"], "a row still says where it is and why the lines stand");
  assert.doesNotMatch(JSON.stringify(tool), EVERY_LINE);
});
