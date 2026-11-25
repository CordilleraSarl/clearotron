// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STAGE MEETS EACH PARAGRAPH ITS MANUAL CARRIES ONCE (manual-paragraphs.mjs). Six instruction paragraphs that hold no case
// value moved into their stage's own manual (design, 2026-11-20): the variant generation's family floor, two synthesis rules
// and three report-card rules. The prose rules followed into report-prose.md, which the three writing stages read (design,
// 2026-11-24), and a writer with a customer's own worked examples meets them once too. The stage composer keeps each as a fallback, and the gateway drops it from the stage text when
// an inlined manual already says it. Read here: the manuals hold them, each stage's opening message holds each of its own
// paragraphs exactly once on both engines, a company's own copy of a manual that lacks the paragraph still delivers it once,
// a manual that cannot be read leaves it in the stage text, and a warm patch sends none. Case material is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "manual-paragraphs-locks-"));
const { runStage, warmPatchMessage, warmTimeoutMessage } = await import("../gateway.mjs");
const { inlineManuals } = await import("../manuals-inline.mjs");
const { MANUAL_PARAGRAPHS } = await import("../manual-paragraphs.mjs");
const { DRIVER, everyModelStageDispatch, baseOf } = await import("./model-stage-dispatches.mjs");
const { STAGES: CLEARANCE, paths } = await import("../stages.mjs");

const ENGINES = {
  "anthropic-agent": (dir, out) => ({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"),
    MOCK_CLAUDE_FILE: "a stub\n", MOCK_OUT_FILE: out, MOCK_CLAUDE_CALL_LOG: join(dir, "calls.jsonl"), MOCK_COUNT_FILE: join(dir, "count") }),
  "openai-agent": (dir) => ({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"),
    CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-invented", MOCK_CODEX_FILE: "a stub\n", MOCK_CODEX_CALL_LOG: join(dir, "calls.jsonl") }),
};
const MESSAGES = new Map(everyModelStageDispatch("/nonexistent/invented-run")
  .filter((d) => d.label === "house default").map((d) => [d.name, d]));
// The stage each manual's paragraphs belong to, and the label one of its sessions runs under.
const PROSE = "skills/clearance-search/report-prose.md";
const STAGES = [["skills/clearance-variants/SKILL.md", "clearance-variants"],
  ["skills/clearance-search/synthesis-finding-rules.md", "synthesis"], ["skills/clearance-search/report-card-rules.md", "report-card:1"],
  [PROSE, "synthesis"], [PROSE, "report-overview"], [PROSE, "report-card:1"]];
const WRITERS = ["synthesis", "report-overview", "report-card:1"];
// The invented firm's worked examples in this tree, standing in for a customer's own.
const CUSTOM_EXAMPLES = "skills/clearance-search/worked-examples-zephyr.md";
const customMessage = (label) => CLEARANCE[baseOf(label)].message({ profile: { workedExamplesPath: CUSTOM_EXAMPLES }, job: {},
  paths: paths("/nonexistent/invented-run"), axis: "primary-sweep", half: "a", finding: { ordinal: 1 }, run: { slug: "invented", codename: "invented" } });
const count = (text, p) => text.split(p).length - 1;

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  return (async () => { try { return await fn(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } } })();
}

/** What the stand-in program was handed for one fresh dispatch of `label`. */
async function wireOf(engine, label, env = {}, composed = MESSAGES.get(baseOf(label)).message) {
  const dir = mkdtempSync(join(tmpdir(), "manual-paragraphs-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    const out = join(dir, "out.md");
    const message = `${composed}\nThis case's own material: INVENTED-CASE.`;
    await withEnv({ ...ENGINES[engine](dir, out), CLEAROTRON_RETRY_BACKOFF_MS: "0", ...env },
      () => runStage(label, { message, model: "opus", sessionKey: `manual-paragraphs-${engine}-${label}`, runDir: dir,
        expectFile: out, maxRetries: 0, timeoutSec: 30 }).catch(() => null));
    assert.ok(existsSync(join(dir, "calls.jsonl")), `${label}: the program was never called`);
    return String(JSON.parse(readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n")[0]).wire ?? "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("each paragraph is a line of its own in its manual, once, and its stage reads that manual", () => {
  for (const [ref, label] of STAGES) {
    const lines = readFileSync(join(DRIVER, ref), "utf8").split("\n");
    for (const p of MANUAL_PARAGRAPHS[ref]) assert.equal(lines.filter((l) => l === p).length, 1, `${ref}: ${p.slice(0, 40)}`);
    assert.ok(MESSAGES.get(baseOf(label)).declared.includes(ref), `${label} does not read ${ref}`);
  }
  for (const d of MESSAGES.values()) {
    const own = STAGES.filter(([, label]) => baseOf(label) === d.name).flatMap(([ref]) => MANUAL_PARAGRAPHS[ref]);
    for (const p of Object.values(MANUAL_PARAGRAPHS).flat()) {
      if (!own.includes(p)) assert.ok(!d.message.includes(p), `${d.name} composes a paragraph another stage's manual carries: ${p.slice(0, 40)}`);
    }
  }
});

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: each stage's opening message holds each of its paragraphs exactly once`, async () => {
    for (const label of new Set(STAGES.map(([, l]) => l))) {
      const wire = await wireOf(engine, label);
      for (const [ref] of STAGES.filter(([, l]) => l === label)) {
        assert.ok(wire.includes(`=== MANUAL: `) && wire.includes(ref.split("/").pop()), `${label}: ${ref} was not carried`);
        for (const p of MANUAL_PARAGRAPHS[ref]) assert.equal(count(wire, p), 1, `${label}: ${p.slice(0, 40)}`);
      }
    }
  });

  test(`${engine}: each writer with a customer's own worked examples meets the prose rules once`, async () => {
    for (const label of WRITERS) {
      const composed = customMessage(label);
      const wire = await wireOf(engine, label, {}, composed);
      if (label === "synthesis") assert.ok(composed.includes(CUSTOM_EXAMPLES) && wire.includes("worked-examples-zephyr.md"), "premise: the custom examples were named");
      assert.ok(wire.includes("report-prose.md ==="), `${label}: the rulebook was not carried`);
      for (const p of MANUAL_PARAGRAPHS[PROSE]) assert.equal(count(wire, p), 1, `${label}: ${p.slice(0, 40)}`);
    }
  });

  test(`${engine}: a company's own rulebook that lacks the rules still delivers each rule once`, async () => {
    const overlay = mkdtempSync(join(tmpdir(), "manual-paragraphs-prose-overlay-"));
    try {
      mkdirSync(join(overlay, "skills", "clearance-search"), { recursive: true });
      writeFileSync(join(overlay, "skills", "clearance-search", "report-prose.md"), "An invented firm's own prose guide.\nINVENTED-FIRM-SENTINEL sits in its middle.\n");
      for (const label of WRITERS) {
        const wire = await wireOf(engine, label, { CLEAROTRON_INSTRUCTIONS_DIR: join(overlay, "skills") });
        assert.ok(wire.includes("INVENTED-FIRM-SENTINEL"), `premise: ${label} carried the company's own copy`);
        for (const p of MANUAL_PARAGRAPHS[PROSE]) assert.equal(count(wire, p), 1, `${label}: ${p.slice(0, 40)}`);
      }
    } finally { rmSync(overlay, { recursive: true, force: true }); }
  });

  test(`${engine}: the rulebook states the visible 25-word limit once, and no writer is left without it`, async () => {
    // The limit was stated three times in the rulebook: in TWO LEVELS, in WORD BUDGETS and in the default-visible paragraph.
    // It stays in TWO LEVELS only. A company's rulebook that lacks it still gets it from the stage text's fallback, and an
    // older rulebook that still states it keeps it. Other manuals a writer reads are not counted here.
    const LIMIT = /no visible sentence over 25 words/gi;
    const limits = (text) => (text.match(LIMIT) ?? []).length;
    const block = (wire) => wire.match(/=== MANUAL: [^\n]*report-prose\.md ===\n[\s\S]*?\n=== END MANUAL: [^\n]*report-prose\.md ===/)?.[0] ?? "";
    const outside = (wire) => limits(wire) - limits(block(wire));
    for (const label of WRITERS) {
      const wire = await wireOf(engine, label);
      assert.ok(block(wire), `premise: ${label} carried the rulebook`);
      assert.equal(limits(block(wire)), 1, `${label}: the shipped rulebook states the limit once`);
    }
    const overlay = mkdtempSync(join(tmpdir(), "manual-paragraphs-limit-overlay-"));
    try {
      mkdirSync(join(overlay, "skills", "clearance-search"), { recursive: true });
      const own = join(overlay, "skills", "clearance-search", "report-prose.md");
      writeFileSync(own, "An invented firm's own prose guide.\nINVENTED-FIRM-SENTINEL sits in its middle.\n");
      for (const label of WRITERS) {
        const shipped = await wireOf(engine, label);
        const wire = await wireOf(engine, label, { CLEAROTRON_INSTRUCTIONS_DIR: join(overlay, "skills") });
        assert.ok(wire.includes("INVENTED-FIRM-SENTINEL"), `premise: ${label} carried the company's own copy`);
        assert.equal(limits(block(wire)), 0, `premise: ${label}'s company rulebook does not state the limit`);
        assert.equal(outside(wire), outside(shipped) + 1, `${label}: the stage text's fallback gives the limit back once`);
      }
      // An older rulebook: today's, with the two restatements the limit used to have put back.
      const shippedText = readFileSync(join(DRIVER, "skills", "clearance-search", "report-prose.md"), "utf8");
      const older = shippedText
        .replace("about 20-25 words a sentence behind a fold, about 80 words a paragraph.",
          "about 20-25 words a sentence behind a fold, no visible sentence over 25 words (TWO LEVELS), about 80 words a paragraph.")
        .replace("One idea per sentence. The conclusion first.", "One idea per sentence. **No visible sentence over 25 words.** The conclusion first.");
      assert.notEqual(older, shippedText, "premise: the older rulebook differs from the shipped one");
      writeFileSync(own, older);
      for (const label of WRITERS) {
        assert.ok(limits(block(await wireOf(engine, label, { CLEAROTRON_INSTRUCTIONS_DIR: join(overlay, "skills") }))) >= 1,
          `${label}: an older rulebook keeps the limit`);
      }
    } finally { rmSync(overlay, { recursive: true, force: true }); }
  });

  test(`${engine}: a company's own copy of the manual that lacks the paragraph still delivers it once`, async () => {
    const overlay = mkdtempSync(join(tmpdir(), "manual-paragraphs-overlay-"));
    try {
      mkdirSync(join(overlay, "skills", "clearance-variants"), { recursive: true });
      writeFileSync(join(overlay, "skills", "clearance-variants", "SKILL.md"), "An invented firm's own variants manual.\nINVENTED-FIRM-SENTINEL sits in its middle.\nIts last line.\n");
      const wire = await wireOf(engine, "clearance-variants", { CLEAROTRON_INSTRUCTIONS_DIR: join(overlay, "skills") });
      assert.ok(wire.includes("INVENTED-FIRM-SENTINEL"), "premise: the company's own copy was carried");
      for (const p of MANUAL_PARAGRAPHS["skills/clearance-variants/SKILL.md"]) assert.equal(count(wire, p), 1, p.slice(0, 40));
    } finally { rmSync(overlay, { recursive: true, force: true }); }
  });
}

test("a manual that cannot be read leaves its paragraphs in the stage text, and a readable one takes them out", () => {
  const ref = "skills/clearance-search/report-card-rules.md";
  const [first, ...rest] = MANUAL_PARAGRAPHS[ref];
  const message = `First, read and follow exactly: skills/a.md, ${ref}.\nThe card.\n${[first, ...rest].join("\n")}\nINVENTED-CASE.`;
  const read = (p) => { if (p.endsWith("report-card-rules.md")) throw new Error("absent"); return "Text of a."; };
  const unread = inlineManuals(message, { resolve: (r) => `/x/${r}`, read });
  assert.deepEqual(unread.missing, [ref]);
  for (const p of MANUAL_PARAGRAPHS[ref]) assert.equal(count(unread.text, p), 1, `unreadable: ${p.slice(0, 40)}`);
  const whole = inlineManuals(message, { resolve: (r) => `/x/${r}`, read: (p) => (p.endsWith("report-card-rules.md") ? MANUAL_PARAGRAPHS[ref].join("\n\n") : "Text of a.") });
  for (const p of MANUAL_PARAGRAPHS[ref]) assert.equal(count(whole.text, p), 1, `read: ${p.slice(0, 40)}`);
  assert.match(whole.text, /\nThe card\.\nINVENTED-CASE\.$/, "the stage text kept a paragraph its manual says");
  // A manual that says only one of them takes out only that one.
  const part = inlineManuals(message, { resolve: (r) => `/x/${r}`, read: (p) => (p.endsWith("report-card-rules.md") ? first : "Text of a.") });
  for (const p of MANUAL_PARAGRAPHS[ref]) assert.equal(count(part.text, p), 1, `partial: ${p.slice(0, 40)}`);
});

test("a warm patch and a warm resume send none of the paragraphs", () => {
  const all = Object.values(MANUAL_PARAGRAPHS).flat();
  const texts = [warmPatchMessage({ reason: "missing_file:out.md" }, "/x/out.md"), warmTimeoutMessage("/x/out.md")];
  for (const t of texts) for (const p of all) assert.ok(!String(t).includes(p), p.slice(0, 40));
});
