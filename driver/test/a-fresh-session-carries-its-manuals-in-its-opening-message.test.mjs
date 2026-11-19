// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FRESH SESSION CARRIES ITS STAGE'S MANUALS IN ITS OPENING MESSAGE, on both engines alike (manuals-inline.mjs). Each
// dispatch below goes through the real gateway and each engine's real adapter to the stand-in program, and the test reads
// the text that program was handed. Two cards, two halves, two register units, a Knockout stage and a company's own copy
// of a manual, as design set the checks (tracker issue 1385, B1 to B3, item 2). Messages and case material are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "manuals-inline-locks-"));
const { runStage } = await import("../gateway.mjs");
const { inlineManuals, stageTextOf, MANUALS_SENTENCE } = await import("../manuals-inline.mjs");
const { DRIVER, everyModelStageDispatch, baseOf } = await import("./model-stage-dispatches.mjs");

const ENGINES = {
  "anthropic-agent": (dir, out) => ({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"),
    MOCK_CLAUDE_FILE: "a stub\n", MOCK_OUT_FILE: out, MOCK_CLAUDE_CALL_LOG: join(dir, "calls.jsonl"), MOCK_COUNT_FILE: join(dir, "count") }),
  "openai-agent": (dir) => ({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"),
    CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-invented", MOCK_CODEX_FILE: "a stub\n", MOCK_CODEX_CALL_LOG: join(dir, "calls.jsonl") }),
};
const MESSAGES = new Map(everyModelStageDispatch("/nonexistent/invented-run")
  .filter((d) => d.label === "house default" || d.label === "knockout").map((d) => [d.name, d]));

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  return (async () => { try { return await fn(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } } })();
}

/** One dispatch of `label` with this case's own material appended; what the program was handed, and the attempt row. */
async function dispatch(engine, label, material, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "manuals-inline-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    const out = join(dir, "out.md");
    const message = `${MESSAGES.get(baseOf(label)).message}\nThis case's own material: ${material}.`;
    await withEnv({ ...ENGINES[engine](dir, out), CLEAROTRON_RETRY_BACKOFF_MS: "0", ...env },
      () => runStage(label, { message, model: "opus", sessionKey: `manuals-inline-${engine}-${label}-${material}`, runDir: dir,
        expectFile: out, maxRetries: 0, timeoutSec: 30 }).catch(() => null));
    const call = JSON.parse(readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n")[0]);
    const journal = existsSync(driverDir(dir, "run.jsonl")) ? readFileSync(driverDir(dir, "run.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { wire: String(call.wire ?? ""), prompt: String(call.prompt ?? ""), row: journal.find((e) => e.event === "attempt" && e.stage === label) ?? null };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** A line from the middle and the last line of a manual that name no other file, so an adapter's path rewrite leaves them as written. */
function witnessLines(ref) {
  const lines = readFileSync(join(DRIVER, ref), "utf8").split("\n").map((l) => l.trim()).filter((l) => l.length > 20 && !/skills\//.test(l));
  return [lines[Math.floor(lines.length / 2)], lines.at(-1)];
}
const commonPrefix = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };

const PAIRS = [["report-card", "report-card:1"], ["common-law-half", "common-law-half:b"], ["register-unit", "register-unit:primary-sweep"]];

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: two of a kind carry their manuals whole, share the manuals as their leading text, and neither carries the other's case`, async () => {
    for (const [one, two] of PAIRS) {
      const a = await dispatch(engine, one, "INVENTED-CASE-ONE"), b = await dispatch(engine, two, "INVENTED-CASE-TWO");
      const declared = MESSAGES.get(baseOf(one)).declared;
      for (const r of [a, b]) {
        assert.ok(r.wire.startsWith(MANUALS_SENTENCE), `${one}: the opening message does not open with the manuals`);
        for (const ref of declared) for (const line of witnessLines(ref)) assert.ok(r.wire.includes(line), `${one}: ${ref} is not carried whole: ${line.slice(0, 60)}`);
        assert.ok(!r.wire.includes("First, read and follow exactly"), `${one}: a manual was left to a read`);
        assert.ok(r.prompt.includes("First, read and follow exactly") && !r.prompt.includes("=== MANUAL"), `${one}: the stage's own text cannot be told from its manuals`);
        assert.deepEqual(r.row?.manualsInline?.map((m) => m.ref), declared, `${one}: the attempt row does not record what was carried`);
        for (const m of r.row.manualsInline) assert.equal(m.sha256, createHash("sha256").update(readFileSync(join(DRIVER, m.ref), "utf8")).digest("hex"), `${one}: ${m.ref}`);
      }
      const block = a.wire.lastIndexOf("=== END MANUAL");
      assert.ok(commonPrefix(a.wire, b.wire) > block, `${one} and ${two}: the manuals are not the leading text both share`);
      assert.ok(!a.wire.includes("INVENTED-CASE-TWO") && !b.wire.includes("INVENTED-CASE-ONE"), `${one}: one case's material reached the other`);
    }
  });

  test(`${engine}: a Knockout stage carries its manuals, and a company's own copy of a manual is the one carried`, async () => {
    const ko = await dispatch(engine, "knockout-assess", "INVENTED-KO");
    for (const ref of MESSAGES.get("knockout-assess").declared) for (const line of witnessLines(ref)) assert.ok(ko.wire.includes(line), `knockout-assess: ${ref}`);
    const overlay = mkdtempSync(join(tmpdir(), "manuals-overlay-"));
    try {
      // The setting names the store's `skills` folder, as the portal derives it, and a manual sits at its own path under it.
      mkdirSync(join(overlay, "skills", "matter-frame"), { recursive: true });
      writeFileSync(join(overlay, "skills", "matter-frame", "SKILL.md"), "An invented firm's own framing manual.\nINVENTED-FIRM-SENTINEL sits in its middle.\nIts last line.\n");
      const own = await dispatch(engine, "matter-frame", "INVENTED-FRAME", { CLEAROTRON_INSTRUCTIONS_DIR: join(overlay, "skills") });
      assert.ok(own.wire.includes("INVENTED-FIRM-SENTINEL"), "the company's own copy was not carried");
      const [base] = witnessLines("skills/matter-frame/SKILL.md");
      assert.ok(!own.wire.includes(base), "the shipped copy was carried in place of the company's");
    } finally { rmSync(overlay, { recursive: true, force: true }); }
  });
}

test("a manual that cannot be read stays named in the read sentence, and a message with no read sentence is unchanged", () => {
  const read = (p) => { if (p.endsWith("gone.md")) throw new Error("absent"); return `Text of ${p}, with $& and $1 kept as written.`; };
  const r = inlineManuals("First, read and follow exactly: skills/a.md, skills/gone.md, skills/b.md.\nThe stage.", { resolve: (ref) => `/x/${ref}`, read });
  assert.deepEqual(r.inlined.map((m) => m.ref), ["skills/a.md", "skills/b.md"]);
  assert.deepEqual(r.missing, ["skills/gone.md"]);
  assert.match(r.text, /^Apply the following manuals to this stage, in the order given\.\n\n=== MANUAL: skills\/a\.md ===\nText of \/x\/skills\/a\.md, with \$& and \$1 kept as written\./);
  assert.ok(r.text.indexOf("skills/a.md ===") < r.text.indexOf("skills/b.md ==="), "the order named is kept");
  assert.match(r.text, /\n\nFirst, read and follow exactly: skills\/gone\.md\.\nThe stage\.$/);
  assert.equal(stageTextOf(r.text), "First, read and follow exactly: skills/a.md, skills/b.md, skills/gone.md.\nThe stage.");
  const none = inlineManuals("The stage, which names no manual.", { resolve: (ref) => `/x/${ref}`, read });
  assert.equal(none.text, "The stage, which names no manual.");
  const nothing = inlineManuals("First, read and follow exactly: skills/gone.md.\nThe stage.", { resolve: (ref) => `/x/${ref}`, read });
  assert.equal(nothing.text, "First, read and follow exactly: skills/gone.md.\nThe stage.", "with nothing readable the message is as composed");
});

test("the register stages' sentence keeps its exclusion, on its own line after the manuals", () => {
  const msg = "First, read and follow exactly: skills/s.md (the shared spine) then skills/u.md (MODE A — UNIT). Do NOT read skills/d.md.\nThe unit.";
  const r = inlineManuals(msg, { resolve: (ref) => ref, read: (p) => `Body of ${p}.` });
  assert.deepEqual(r.inlined.map((m) => m.ref), ["skills/s.md", "skills/u.md"]);
  assert.match(r.text, /=== END MANUAL: skills\/u\.md ===\n\nDo NOT read skills\/d\.md\.\nThe unit\.$/);
});

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a session resumed to patch its own file is not sent the manuals again, and a fresh retry is`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "manuals-inline-warm-"));
    try {
      mkdirSync(driverDir(dir), { recursive: true });
      const out = join(dir, "out.md");
      // The first turn writes a draft the check refuses for one bounded defect, which is the case a warm patch answers.
      const validate = (_p, c) => (/PATCHED|FRESH/.test(c) ? { ok: true } : { ok: false, reason: "connotation_quote_unbound:quote_unbound=3;Q-1F4YWF87 [x]" });
      await withEnv({ ...ENGINES[engine](dir, out), CLEAROTRON_RETRY_BACKOFF_MS: "0", MOCK_WARM_MODE: "draft", MOCK_COUNT_FILE: join(dir, "count") },
        () => runStage("matter-frame", { message: MESSAGES.get("matter-frame").message, model: "opus", sessionKey: `manuals-inline-warm-${engine}`,
          runDir: dir, expectFile: out, maxRetries: 1, timeoutSec: 30, validate }));
      const calls = readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      assert.equal(calls.length, 2, "one first turn and one retry");
      assert.ok(String(calls[0].wire).startsWith(MANUALS_SENTENCE), "the first turn does not carry its manuals");
      // The Claude adapter resumes the session for this defect; the Codex lane retries it in a fresh session.
      const resumed = /RESUMING your own session/.test(String(calls[1].wire));
      assert.equal(resumed, engine === "anthropic-agent", `${engine}: the retry was not the kind this lane makes`);
      if (resumed) assert.ok(!String(calls[1].wire).includes(MANUALS_SENTENCE) && !String(calls[1].wire).includes("=== MANUAL"), "the resumed session was sent the manuals again");
      else assert.ok(String(calls[1].wire).startsWith(MANUALS_SENTENCE), "the fresh retry does not carry its manuals");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
