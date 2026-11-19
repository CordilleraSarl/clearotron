// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline to delivery and reads what it delivered
//
// A RIGHT WHOSE RATING WAS WITHDRAWN REACHES THE DELIVERED PAGE AND THE WORKBOOK, WITH THE OWNER'S SENTENCE. The review withdrew the rating
// on one right because its goods wording could not be used, and the right stands. Before, it left the delivered page with the
// findings the review rejected, and only the overview's Methodology note, which the page does not show, could still mention it.
// Now it is one "Left open" row: the right's identifying detail, then the sentence the owner approved (2026-11-19). A finding
// the review rejected gets no such row, and the marked one stays off every card and total.
//
// One delivered clearance, three findings: finding 2 rejected, finding 3's rating withdrawn on the approved ground. Read in the
// record, the delivered page and the audit workbook. The report's Markdown, which the connector serves, carries no "Left open"
// section for any row yet, so neither is read here; until it does, the overview's Methodology note stays. Every name is the
// mock's invented one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { zipEntries, workbookEntryText } from "./snapshot/workbook-entries.mjs";

const TEMP_DIRS = [];
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const SENTENCE = "We could not rate this earlier right because we could not verify which goods its record covers.";
const MARKED = { ordinal: 3, mark: "PROJECT NOVAPULSE 3", owner: "Mystery Owner 3 LLC" };
const REJECTED = { ordinal: 2, owner: "Mystery Owner 2 LLC" };
const JOB = { id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8442", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch" };

const root = mkdtempSync(join(tmpdir(), "clearotron-withdrawn-rating-"));
TEMP_DIRS.push(root);
for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
  CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
  MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "3",
  MOCK_RECORD_WITHDRAWS: String(REJECTED.ordinal), MOCK_RECORD_RATING_WITHDRAWN: String(MARKED.ordinal) })) pinEnv(process.env, k, v);

const { pipeline } = await import("../pipeline.mjs");
const res = await pipeline({ ...JOB });
const walk = (d) => (existsSync(d) ? readdirSync(d, { recursive: true }).map((p) => join(d, String(p))) : []);
const count = (text, needle) => String(text).split(needle).length - 1;

test("premise: the run delivered, finding 3 is withdrawn on the approved ground and finding 2 is rejected", () => {
  assert.equal(res?.ok, true, `the run did not deliver: ${JSON.stringify(res).slice(0, 300)}`);
  const doc = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  const by = (o) => doc.findings.find((f) => f.ordinal === o);
  assert.equal(by(MARKED.ordinal)?.rating_withdrawn_ground, "goods-wording-unavailable");
  assert.equal(by(REJECTED.ordinal)?.disposition, "withdrawn");
  assert.equal(by(REJECTED.ordinal)?.rating_withdrawn_ground, undefined);
});

test("the record carries one Left open row for the marked right, and no card counts it", () => {
  const doc = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  const rows = (doc.coverage ?? []).filter((c) => c.note === SENTENCE);
  assert.equal(rows.length, 1, "the marked right has no row, or the rejected finding has one too");
  assert.ok(rows[0].area.startsWith(`${MARKED.mark} — ${MARKED.owner}`), `the row does not name the right: ${rows[0].area}`);
  assert.equal(rows[0].state, "open");
  assert.equal(existsSync(join(res.runDir, "report-cards", `${MARKED.ordinal}.md`)), false, "the marked finding got a card");
});

test("the delivered page says it once", () => {
  const pages = walk(join(root, "pool")).filter((p) => /report[^/]*\.html$/.test(p));
  assert.ok(pages.length > 0, "no delivered page was found in the pool");
  const hits = pages.filter((p) => readFileSync(p, "utf8").includes(SENTENCE));
  assert.ok(hits.length > 0, "no delivered page carries the sentence");
  for (const p of hits) assert.equal(count(readFileSync(p, "utf8"), SENTENCE), 1, `${p} carries the sentence more than once`);
});

test("the audit workbook carries it", () => {
  const books = walk(join(root, "pool")).filter((p) => p.endsWith(".xlsx"));
  assert.ok(books.length > 0, "no workbook was found in the pool");
  const text = books.map((b) => zipEntries(readFileSync(b)).map(([n, bytes]) => workbookEntryText(n, bytes)).join("\n")).join("\n");
  assert.ok(text.includes(SENTENCE), "no workbook carries the sentence");
});

