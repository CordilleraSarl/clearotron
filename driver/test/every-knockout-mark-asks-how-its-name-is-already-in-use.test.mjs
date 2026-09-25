// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Every mark in a knockout is asked one more web question, after its broad one: whether the name is
// already in use off the register, in the ways that matter in the client's field. The broad question asks
// whether the name IS a well-known work or brand, never whether something already USES it.
//
// WHICH ways is the frame's judgment, made per matter from the client's field and written into the plan
// as `batch.inUseAs` — a character, place, title or achievement for a games client; a cocktail, venue or
// beverage line for a drinks client. The question carries those words and no list of its own, so every
// client is asked about its own field. The plan is refused without them.
//
// Both answers land in the mark's one research file, so the rating step reads them together and the
// receipts gate traces a citation to either. A mark whose broad question failed is degraded as it always
// was and asks nothing more. A second question that does not answer leaves the broad answer standing
// alone, with its failed row on the sweep ledger that the audit workbook's trail prints.
//
// The knockout runs end to end on the repo's mock model, with the research calls injected, so nothing
// here reaches a network. The marks are invented.
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "name-already-in-use-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
process.env.CLEAROTRON_AGENT = "clawdi";
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";

import { test } from "node:test";
import assert from "node:assert/strict";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { knockoutPrompt, knockoutInUseAsPrompt, IN_USE_AS, SECOND_ANSWER_SEPARATOR, kebab } = await import("../stages-knockout.mjs");
const { knockoutReceipts, validators } = await import("../verify-knockout.mjs");
const { refuseUndeclared, mergeKnockoutFrameCall } = await import("../knockout-frame-record.mjs");
const { buildKnockoutWorkbook } = await import("../publish/knockout.mjs");

const ROW = { name: "BIO VELTRIS", classesPlain: "Class 9 (downloadable game software)", contextFraming: null };
const GAMES = { productContext: "video games", inUseAs: "a character, a place, a title or an achievement inside a game, show, film or book" };
const DRINKS = { productContext: "a craft spirits brand", inUseAs: "a cocktail, a venue or a beverage line" };

test("the second question asks in the frame's words for the client's field, and carries no list of its own", () => {
  const games = knockoutInUseAsPrompt(ROW, GAMES);
  assert.match(games, /- Is this name already in use as a character, a place, a title or an achievement inside a game, show, film or book\?/);
  const drinks = knockoutInUseAsPrompt(ROW, DRINKS);
  assert.match(drinks, /- Is this name already in use as a cocktail, a venue or a beverage line\?/);
  assert.doesNotMatch(drinks, /character|achievement|game/i, "a drinks client is not asked about games");
  assert.match(drinks, /No use of BIO VELTRIS as a cocktail, a venue or a beverage line identified/);
  assert.match(drinks, /- For each such use: where it appears, and who makes or owns it\./);
  assert.match(drinks, /"BIO VELTRIS" — exact phrase/);
  assert.match(drinks, /"BIOVELTRIS" — no spaces/);
  assert.match(drinks, /- Global — all jurisdictions/);
  assert.match(drinks, /SAY NOTHING ABOUT WHETHER THE REGISTERS WERE SEARCHED/, "the second answer lands in the same file, so it carries the same silence");
  assert.doesNotMatch(drinks, /CLASSES\/INDUSTRIES TO CONSIDER/, "a use in the client's field is asked whatever its class");
  assert.notEqual(drinks, knockoutPrompt(ROW, DRINKS));
  assert.throws(() => knockoutInUseAsPrompt(ROW, { productContext: "video games" }), /inUseAs/, "no words, no question");
});

test("a pointed screen names its territories in both places the second question states scope", () => {
  const q = knockoutInUseAsPrompt(ROW, DRINKS, { jurisdictions: ["US", "EU"] });
  assert.match(q, /- US, EU — named territories only/);
  assert.match(q, /findings OUTSIDE US, EU are out of scope for this screen and should be omitted/);
});

test("the frame's plan is refused without the kinds of use, and the frame's tool takes and keeps them", () => {
  const dir = mkdtempSync(join(tmpdir(), "in-use-as-plan-"));
  const file = join(dir, "knockout-plan.json");
  const plan = (batch) => JSON.stringify({ schema: 1, batch,
    marks: [{ ref: null, name: "BIO VELTRIS", classes: [33], beltAndBraces: [], classesPlain: "spirits (33)",
      contextFraming: "the flagship gin", priorKnowledge: null, priority: 1 }] });
  assert.equal(validators.knockoutPlan(file, plan(DRINKS)).ok, true);
  const refused = validators.knockoutPlan(file, plan({ productContext: DRINKS.productContext }));
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /batch\.inUseAs/);
  assert.equal(validators.knockoutPlan(file, plan({ ...DRINKS, inUseAs: "  " })).ok, false, "blank words are no words");

  assert.equal(refuseUndeclared({ batch: DRINKS }), null, "the tool declares the field");
  const merged = mergeKnockoutFrameCall({ batch: DRINKS, marks: [] }, { batch: { executionOrder: ["BIO VELTRIS"] } });
  assert.equal(merged.batch.inUseAs, DRINKS.inUseAs, "a second call that does not send the field keeps it");
});

const MARKS = ["LANTERNWICK", "MOSSGLEN", "QUARRYBELL"];
const FIRST = (mark) => `Broad answer for ${mark}. https://example.test/broad/${kebab(mark)}`;
const SECOND = (mark) => `Second answer for ${mark}: a product line of that name. https://example.test/uses/${kebab(mark)}`;

async function knockout(codename) {
  const id = `ko-${codename}`;
  const studioRoot = join(ROOT, "studio", id);
  const dir = join(studioRoot, "clearance-search", "runs", "lanternwick", `2026-09-25-${codename}`);
  mkdirSync(driverDir(dir), { recursive: true });
  const run = { runDir: dir, studioRoot, slug: "lanternwick", date: "2026-09-25", codename, archiveDir: join(studioRoot, "archive", `2026-09-25-${codename}`) };
  const job = { id, markName: MARKS[0], marks: MARKS.map((name) => ({ name })), classes: [9], jurisdictions: ["EU"],
    forwarder: "jordan", msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "clawdi", paths: { runDir: dir }, profile: {},
    searchPolicy: { level: "knockout", stageLabel: "Knockout", components: {} } };
  const calls = [];
  const res = await knockoutInner(ctx, job, {
    // LANTERNWICK: both questions answer. MOSSGLEN: the second does not. QUARRYBELL: the first does not.
    sweepExecutor: async (task, { mark, question = null }) => {
      calls.push({ mark, question, task });
      if (mark === "QUARRYBELL" && !question) return { ok: false, cause: "HTTP 500: the research service is down" };
      if (mark === "MOSSGLEN" && question) return { ok: false, cause: "HTTP 500: the research service is down" };
      const text = question ? SECOND(mark) : FIRST(mark);
      return { ok: true, text, bytes: Buffer.byteLength(text) };
    },
  });
  // A delivered run moves to its archive folder, and reports where; a stopped one stays where it began.
  return { res, calls, dir: res?.runDir ?? dir };
}

test("each mark asks its broad question, then the frame's, and both answers land in its one research file", async () => {
  const { calls, dir } = await knockout("both-questions");
  const plan = JSON.parse(readFileSync(join(dir, "knockout-plan.json"), "utf8"));
  const uses = plan.batch.inUseAs;
  assert.ok(typeof uses === "string" && uses.trim(), "guard: the frame named the kinds of use for this matter");

  const asked = (mark) => calls.filter((c) => c.mark === mark).map((c) => c.question);
  assert.deepEqual(asked("LANTERNWICK"), [null, IN_USE_AS], "the broad question first, then the second");
  assert.deepEqual(asked("MOSSGLEN"), [null, IN_USE_AS]);
  assert.deepEqual(asked("QUARRYBELL"), [null], "a mark whose broad question failed asks nothing more");
  const first = calls.find((c) => c.mark === "LANTERNWICK" && !c.question);
  const second = calls.find((c) => c.mark === "LANTERNWICK" && c.question);
  assert.match(first.task, /Are there any MAJOR existing brands/, "the broad question is the one it always was");
  assert.ok(second.task.includes(`- Is this name already in use as ${uses}?`), "the executor is handed the frame's words");
  assert.match(second.task, /"LANTERNWICK" — exact phrase/);
  assert.match(second.task, /- EU — named territories only/, "on the job's own territories");

  const research = (mark) => join(dir, "research", `${kebab(mark)}.md`);
  assert.equal(readFileSync(research("LANTERNWICK"), "utf8"), `${FIRST("LANTERNWICK")}${SECOND_ANSWER_SEPARATOR}${SECOND("LANTERNWICK")}`);
  assert.equal(readFileSync(research("MOSSGLEN"), "utf8"), FIRST("MOSSGLEN"), "an unanswered second question leaves the broad answer alone");
  assert.equal(existsSync(research("QUARRYBELL")), false, "the degraded mark holds no payload");
  assert.equal(existsSync(`${research("QUARRYBELL")}.failed`), true);

  const ledger = readFileSync(driverDir(dir, "knockout-sweep.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse);
  assert.equal(ledger.length, 5, "every call is receipted: three broad questions and two second ones");
  const row = (mark, question) => ledger.find((r) => r.mark === mark && (r.question ?? null) === question);
  assert.equal(row("LANTERNWICK", IN_USE_AS).ok, true);
  assert.equal(row("LANTERNWICK", IN_USE_AS).inUseAs, uses, "the receipt carries the words the question asked with");
  assert.equal(row("MOSSGLEN", IN_USE_AS).ok, false, "the failed second question is on the ledger the audit trail prints");
  assert.match(row("MOSSGLEN", IN_USE_AS).cause, /HTTP 500/);
  assert.equal(row("QUARRYBELL", null).ok, false);
  assert.equal(ledger.filter((r) => !r.question).every((r) => !("question" in r) && !("inUseAs" in r)), true,
    "a broad question's row is shaped as it always was");

  // a citation the second answer carries is traced to held evidence, like one from the broad answer
  const receipts = knockoutReceipts(dir, [{ name: "LANTERNWICK", findings: [
    { name: "A product line", url: "https://example.test/uses/lanternwick" },
    { name: "A broad find", url: "https://example.test/broad/lanternwick" },
  ] }]);
  assert.equal(receipts.checked.urls, 2, "guard: both citations were checked");
  assert.deepEqual(receipts.failures, []);
});

test("the audit trail names the kinds of use the second question asked about, and leaves the broad row as it was", async () => {
  const ExcelJS = (await import("exceljs")).default;
  const out = join(mkdtempSync(join(tmpdir(), "in-use-as-xlsx-")), "audit.xlsx");
  const base = { ts: "2026-09-25T10:00:00Z", mark: "LANTERNWICK", preset: "pro-search", executor: "perplexity", took_ms: 30000, bytes: 10, ok: true };
  await buildKnockoutWorkbook({ marks: [] }, [
    { ...base, callNo: 1 },
    { ...base, callNo: 2, question: IN_USE_AS, inUseAs: DRINKS.inUseAs },
  ], out);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const ws = wb.getWorksheet("Audit Trail");
  const col = ws.getRow(1).values.indexOf("Source / Context");
  assert.equal(ws.getRow(2).getCell(col).value, "perplexity (pro-search)");
  assert.equal(ws.getRow(3).getCell(col).value, "perplexity (pro-search) — in use as a cocktail, a venue or a beverage line");
});
