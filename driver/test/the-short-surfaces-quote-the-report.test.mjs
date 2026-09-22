// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE SHORT SURFACES QUOTE THE REPORT.
//
// Three delivered runs carried a reviewer's sign-off of BLOCKING and a report whose conclusion was
// conditional. The email banner, the run list and the assistant each printed a separately composed
// summary — "On hold — the reviewing lawyer's open questions must be resolved …" — so a client was told
// the matter was on hold, opened the report, and read that it was conditional. Nothing had held it.
// Ruled 2026-09-22: the report is the master. The rating leads, then the report's own conclusion,
// verbatim; nothing composes a second summary and nothing says "on hold".
//
// Driven here on one run whose sign-off and report say different things, through the email composer,
// the run list and the assistant's briefing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeEmailHtml, regenIndex } from "../publish/index.mjs";
import { riskStatement } from "../findings-model.mjs";
import { buildBrief } from "../../mcp-server/lib/brief.mjs";

const SIGN_OFF = "BLOCKING";
const TIER = "High";
const CONCLUSION = "One close mark in class 9 drives the rating. The conclusion is conditional because the owner's consent and the class 42 search remain open.";
const REPORT = ["---", "type: clearance-clearance", "matter: tmp9-demo", "title: INVENTED MARK",
  "overall_label: HIGH", "overall_badge: l4", `overall_caption: ${CONCLUSION}`,
  "classes: 9", "jurisdiction: United States only", "run: 2026-09-22", "---", "",
  "# Findings", "## Invented Owner", "- one: An invented conflict.", "### The read", "An invented read."].join("\n");
const OLD_STATEMENT = "On hold — the reviewing lawyer's open questions must be resolved before any recommendation.";
const noSecondOpinion = (text, where) => {
  assert.doesNotMatch(text, /on hold/i, `${where} says the matter is on hold, and nothing holds it`);
  assert.ok(!text.includes(SIGN_OFF), `${where} prints the reviewer's sign-off word`);
};

test("the email leads with the rating, then the report's own conclusion", () => {
  const dir = mkdtempSync(join(tmpdir(), "master-email-"));
  writeFileSync(join(dir, "report.md"), REPORT);
  const html = composeEmailHtml(join(dir, "report.md"), "https://portal.example/report/r1", "audit.xlsx", ["Invented Owner"],
    { email: "table", privileged: true }, { verdict: SIGN_OFF, tier: TIER, statement: riskStatement({ tier: TIER, verdict: SIGN_OFF }), conditions: [] });
  assert.ok(html.includes(`<b>Overall risk: ${TIER}.</b> ${CONCLUSION.replace(/'/g, "&#39;")}`) || html.includes(`<b>Overall risk: ${TIER}.</b> ${CONCLUSION}`),
    "the banner is not the rating followed by the report's conclusion");
  noSecondOpinion(html, "the email");
});

test("the run list quotes the report's conclusion, and an archived statement is not shown", () => {
  const pool = mkdtempSync(join(tmpdir(), "master-index-"));
  const runId = "tmp9-demo-2026-09-22-pewter-quill";
  mkdirSync(join(pool, runId));
  writeFileSync(join(pool, runId, "meta.json"), JSON.stringify({ runId, matter: "TMP", title: "INVENTED MARK", client: "Acme",
    customerKey: "acme", overall: TIER, badge: "l4", date: "2026-09-22", codename: "pewter-quill", verdict: SIGN_OFF,
    statement: OLD_STATEMENT, caption: CONCLUSION }));
  regenIndex(pool);
  const idx = readFileSync(join(pool, "index.html"), "utf8");
  assert.ok(idx.includes(`>${CONCLUSION}</span>`), "the run list does not quote the report's conclusion");
  noSecondOpinion(idx, "the run list");
});

test("the assistant's briefing gives the rating and the report's conclusion, and no second summary", () => {
  const pool = mkdtempSync(join(tmpdir(), "master-brief-"));
  const runId = "tmp9-demo-2026-09-22-pewter-quill";
  const poolDir = join(pool, runId);
  mkdirSync(poolDir, { recursive: true });
  writeFileSync(join(poolDir, "report.md"), REPORT);
  writeFileSync(join(poolDir, "report-data.json"), JSON.stringify({ schema: "report-data/1", kind: "clearance", markName: "INVENTED MARK",
    // The band as publish writes it (report-data.mjs → findings-model's derived record), never a bare word:
    // a string here is the shape that let "Overall risk: [object object]." pass this arm.
    verdict: { verdict: SIGN_OFF, tier: TIER, band: { label: TIER, rankFromTop: 2, scale: 5 }, statement: OLD_STATEMENT, conditions: [] },
    caption: CONCLUSION }));
  const b = buildBrief({ runId, P: { report: join(poolDir, "report.md") }, poolDir, state: "delivered", date: "2026-09-22",
    statement: OLD_STATEMENT, caption: CONCLUSION, tier: TIER });
  assert.ok(b.brief.includes(`**Overall risk: ${TIER}.** ${CONCLUSION}`), `the briefing is not the rating and the report's conclusion:\n${b.brief}`);
  assert.doesNotMatch(b.brief, /\[object /i, "the band record was printed instead of its word");
  assert.equal(b.overall, TIER);
  noSecondOpinion(b.brief, "the briefing");
  assert.equal(b.caption, CONCLUSION);
  assert.equal(b.statement, undefined, "the briefing record still carries a second summary");
});
