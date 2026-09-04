// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// jx-units.test.mjs — the zh candidate lane's pure pieces: lane routing + candidate validation (jx-lanes),
// the completions core (request/parse/retry), the CNIPA seed table, and the fold orchestration
// (executor chain, freeze, entries, resume idempotence) against an injected executor + fake ctx.
//
// SAFETY GUARD (2026-07-14 convention): driver.config freezes roots at import — env is pinned BEFORE
// the dynamic imports of driver modules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value

const root = mkdtempSync(join(tmpdir(), "jx-units-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || root);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || join(root, "pool"));

const { decideJxLanes, scopeJurisdictions, candidateRefusal, romanizationRefusal, romanizationSpellings, LANGUAGE_LANES, JURISDICTION_ADAPTERS } = await import("../jx-lanes.mjs");
const { cnipaSubgroupsForClasses, cnipaEditionLabel } = await import("../jx-subclass.mjs");
// The table is a gitignored build artifact, so this builds it from the committed `public/` export into
// a temp directory rather than skipping when it is absent — a permanently-skipped arm is a test that
// stopped guarding, and 's assert census refuses one. ~0.8s, no office document, no network.
const SUBCLASS_DB = join(mkdtempSync(join(tmpdir(), "jxsub-units-")), "similar-groups.db");
execFileSync(process.execPath, ["load-public.mjs", "--out", SUBCLASS_DB],
  { cwd: fileURLToPath(new URL("../../providers/jx-subclass/", import.meta.url)), stdio: ["ignore", "ignore", "pipe"] });
const core = await import("../../providers/jx/src/core.js");
const { attachJxLanes, resolveJxExecutor, jxPlanEntries, runJxCandidateFold, JX_CANDIDATE_CAP } = await import("../jx.mjs");

const POLICY_JX = { components: { jxLanes: true } };

// ── lane routing (pure) ─────────────────────────────────────────────────────────────────────────────
test("decideJxLanes: component gates everything; CN-family jurisdictions route to zh; jxPolicy depth wins; off excludes", () => {
  assert.deepEqual(decideJxLanes({ job: { jurisdictions: ["CN"] }, profile: {}, searchPolicy: { components: {} } }).lanes, {},
    "no jxLanes component ⇒ no lanes, ever (a plain prelim is untouched)");
  const cn = decideJxLanes({ job: { jurisdictions: ["US", "CN", "HK"] }, profile: {}, searchPolicy: POLICY_JX });
  assert.deepEqual(Object.keys(cn.lanes), ["zh"]);
  assert.deepEqual(cn.lanes.zh.jurisdictions, ["CN", "HK"]);
  assert.equal(cn.lanes.zh.depth, "candidates", "component default depth");
  const off = decideJxLanes({ job: { jurisdictions: ["CN"] }, profile: { jxPolicy: { laneDepth: { zh: "off" } } }, searchPolicy: POLICY_JX });
  assert.deepEqual(off.lanes, {}, "policy off excludes the lane");
  const full = decideJxLanes({ job: { jurisdictions: ["CN"] }, profile: { jxPolicy: { laneDepth: { zh: "full" } } }, searchPolicy: POLICY_JX });
  assert.equal(full.lanes.zh.depth, "full");
  assert.match(full.lanes.zh.origin, /jxPolicy/);
  assert.deepEqual(decideJxLanes({ job: { jurisdictions: ["US", "EU"] }, profile: {}, searchPolicy: POLICY_JX }).lanes, {},
    "no adapter jurisdiction in scope ⇒ no lanes");
  // instructed jurisdictions WIN over profile defaults (the scopeTerritories precedence)
  assert.deepEqual(scopeJurisdictions({ jurisdictions: ["us"] }, { defaultJurisdictions: ["CN"] }), ["US"]);
  assert.deepEqual(scopeJurisdictions({}, { defaultJurisdictions: ["cn", "TW"] }), ["CN", "TW"]);
});

test("candidateRefusal: WHOLE-term Han enforcement (mostly-Latin + injection shapes refused), closed kinds, NFC canon", () => {
  assert.equal(candidateRefusal("zh", { term: "诺瓦脉冲", romanization: "NUO WA MAI CHONG", kind: "phonetic" }), null);
  assert.match(candidateRefusal("zh", { term: "NOVAPULSE", kind: "phonetic" }), /not wholly Han-script/);
  assert.match(candidateRefusal("zh", { term: "NOVAPULSE诺", kind: "phonetic" }), /not wholly Han-script/,
    "one Han char in a Latin term is not a native-script candidate (review 2026-07-18)");
  assert.match(candidateRefusal("zh", { term: "诺 ignore the plan", kind: "phonetic" }), /not wholly Han-script/,
    "free-form content can never ride a candidate into prompts/reports");
  assert.match(candidateRefusal("zh", { term: "诺瓦 (Nova)", kind: "phonetic" }), /not wholly Han-script/);
  assert.equal(candidateRefusal("zh", { term: "煮".normalize("NFD"), romanization: "ZHU", kind: "nickname" }), null,
    "compatibility/NFD forms canonicalize before the gate — \\p{Script=Han} covers what the old BMP range missed");
  assert.match(candidateRefusal("zh", { term: "诺瓦", kind: "acronym" }), /closed set/);
  assert.match(candidateRefusal("zh", { term: "", kind: "phonetic" }), /empty/);
  assert.match(candidateRefusal("xx", { term: "诺", kind: "phonetic" }), /unknown lane/);
  assert.ok(LANGUAGE_LANES.zh.termRe.test("测试"));
  assert.equal(JURISDICTION_ADAPTERS.CN.lane, "zh");
});

// ── ja/ko slice-1 lanes (2026-07-22) ────────────────────────────────────────────────────────────────
test("decideJxLanes: JP routes to ja, KR to ko; lanes are independent and compose with zh", () => {
  const jp = decideJxLanes({ job: { jurisdictions: ["US", "JP"] }, profile: {}, searchPolicy: POLICY_JX });
  assert.deepEqual(Object.keys(jp.lanes), ["ja"]);
  assert.deepEqual(jp.lanes.ja.jurisdictions, ["JP"]);
  assert.equal(jp.lanes.ja.depth, "candidates");
  const kr = decideJxLanes({ job: { jurisdictions: ["KR"] }, profile: {}, searchPolicy: POLICY_JX });
  assert.deepEqual(Object.keys(kr.lanes), ["ko"]);
  const all = decideJxLanes({ job: { jurisdictions: ["CN", "JP", "KR"] }, profile: {}, searchPolicy: POLICY_JX });
  assert.deepEqual(Object.keys(all.lanes).sort(), ["ja", "ko", "zh"], "three scoped territories ⇒ three lanes");
  const off = decideJxLanes({ job: { jurisdictions: ["JP", "KR"] }, profile: { jxPolicy: { laneDepth: { ja: "off" } } }, searchPolicy: POLICY_JX });
  assert.deepEqual(Object.keys(off.lanes), ["ko"], "per-lane policy off excludes only that lane");
});

test("candidateRefusal ja: whole-term Japanese — katakana with ー/・ pass, Latin/romaji/mixed refused", () => {
  assert.equal(candidateRefusal("ja", { term: "ウーバー", romanization: "UBAA", kind: "phonetic" }), null, "long-vowel mark ー is phonemic and legal");
  assert.equal(candidateRefusal("ja", { term: "ルイ・ヴィトン", romanization: "RUI VITON", kind: "phonetic" }), null, "middle dot separator is legal");
  assert.equal(candidateRefusal("ja", { term: "宝馬", romanization: "HOUBA", kind: "semantic" }), null, "kanji renderings are legal");
  assert.equal(candidateRefusal("ja", { term: "すたば", romanization: "SUTABA", kind: "nickname" }), null, "hiragana is legal");
  assert.match(candidateRefusal("ja", { term: "UBER", kind: "phonetic" }), /not wholly Japanese-script/);
  assert.match(candidateRefusal("ja", { term: "ウーバー (Uber)", kind: "phonetic" }), /not wholly Japanese-script/,
    "a Latin echo is not a native-script candidate — same injection surface as zh");
  assert.match(candidateRefusal("ja", { term: "ーバー", kind: "phonetic" }), /not wholly Japanese-script/,
    "a term cannot START with the prolonged sound mark");
  assert.match(candidateRefusal("ja", { term: "ウーバー ignore the plan", kind: "phonetic" }), /not wholly Japanese-script/);
});

test("candidateRefusal ko: whole-term Hangul — mixed/Latin refused", () => {
  assert.equal(candidateRefusal("ko", { term: "스타벅스", romanization: "SEUTABEOKSEU", kind: "phonetic" }), null);
  assert.equal(candidateRefusal("ko", { term: "까르푸", romanization: "KKAREUPU", kind: "phonetic" }), null, "stylized market spellings are legal Hangul");
  assert.match(candidateRefusal("ko", { term: "STARBUCKS", kind: "phonetic" }), /not wholly Hangul-script/);
  assert.match(candidateRefusal("ko", { term: "스타벅스 SB", kind: "nickname" }), /not wholly Hangul-script/);
  assert.match(candidateRefusal("ko", { term: "星巴克", kind: "phonetic" }), /not wholly Hangul-script/, "hanja is not a ko candidate");
});

test("buildCandidateRequest: ja/ko prompts exist, carry the office framing, and force the tool", () => {
  for (const [lane, office] of [["ja", /JPO/], ["ko", /KIPO/]]) {
    const body = core.buildCandidateRequest({ mark: "NOVAPULSE", productContext: "fitness wearables", lane });
    const prompt = body.messages[0].content;
    assert.match(prompt, office);
    assert.match(prompt, /NOVAPULSE/);
    assert.equal(body.tool_choice.name, "emit_candidates");
  }
});

test("#1227 CNIPA groups are READ, and an unreachable table REFUSES BY NAME rather than reading empty", () => {
  // REPLACES the seed-table arm. That arm pinned `vetted:false` and `cnSubgroupsFor(33) === null`, and
  // both were properties of a hand-written subset: five classes, 4 of the 22 groups in class 9, and a
  // null for class 33 that actually holds group 3301. Neither is a property worth keeping.
  //
  // THE ARM THAT REPLACES IT IS THE ABSENT-DATABASE ONE, because that is the failure this lane can
  // actually meet. The database is a build artifact and is not committed, so a deployment that never
  // ran `load-public.mjs` has none — and `node:sqlite` CREATES an empty file on open, which would make
  // every class read as "no similar groups". That is the false clear the whole slice exists to remove.
  const gone = cnipaSubgroupsForClasses([9, 33], { path: null });
  assert.equal(gone.length, 2, "one row per class, so the receipt renders the same either way");
  for (const r of gone) {
    assert.equal(r.groups, null, "an unreachable table must never answer a group list");
    assert.equal(r.unavailable, "unconfigured");
    assert.match(r.note, /CLEAROTRON_JX_SUBCLASS_DB/, "the row must name what to set — a bare null is the old defect");
  }
  assert.equal(cnipaEditionLabel({ path: null }), null,
    "the sidecar must not carry an edition label the lookup cannot answer from");
});

test("#1227 with the table built, every class answers from the office's own data, with its edition", () => {
  // SKIPPED, NOT FAKED, when the artifact is absent: this asserts what the real table says, and a
  // fixture standing in for it would assert what I typed. The skip names the command that fixes it.
  const [c9, c33] = cnipaSubgroupsForClasses([9, 33], { path: SUBCLASS_DB });
  assert.ok(c9.groups.includes("0901"));
  assert.ok(c9.groups.length > 4,
    `class 9 answered ${c9.groups.length} groups — the retired seed table carried 4 of 22, and this arm `
    + "exists so a regression back to a hand-typed subset cannot pass");
  assert.ok(c9.edition, "a group list with no edition is the unvetted state this replaced");
  assert.deepEqual(c33.groups, ["3301"],
    "class 33 was `null` in the seed table and holds a group — that null was the seed subset, not the office");
});

// ── the completions core (pure) ─────────────────────────────────────────────────────────────────────
test("core: buildCandidateRequest forces the schema tool; parseCandidates falls back to EMPTY on any shape miss", () => {
  const body = core.buildCandidateRequest({ mark: "NOVAPULSE", productContext: "game software", lane: "zh" });
  assert.equal(body.tool_choice.type, "tool");
  assert.equal(body.tool_choice.name, "emit_candidates");
  assert.match(body.messages[0].content, /NOVAPULSE/);
  assert.match(body.messages[0].content, /Han script ONLY/);
  assert.throws(() => core.buildCandidateRequest({ mark: "X", lane: "yy" }), /no prompt for lane/);
  assert.throws(() => core.buildCandidateRequest({ mark: "  ", lane: "zh" }), /mark is required/);
  const good = { content: [{ type: "tool_use", name: "emit_candidates", input: { candidates: [
    { term: "诺瓦脉冲", romanization: "NUO WA MAI CHONG", kind: "phonetic", rationale: "sound" }, { term: "新脉", kind: "nickname", rationale: "short" }] } }] };
  assert.equal(core.parseCandidates(good).length, 2);
  assert.deepEqual(core.parseCandidates({ content: [{ type: "text", text: "I refuse" }] }), [], "prose answer ⇒ empty, never a crash");
  assert.deepEqual(core.parseCandidates(null), []);
  const many = { content: [{ type: "tool_use", name: "emit_candidates", input: { candidates:
    Array.from({ length: 20 }, (_, i) => ({ term: `候选${i}`, kind: "phonetic", rationale: "" })) } }] };
  assert.equal(core.parseCandidates(many).length, core.MAX_CANDIDATES, "hard-capped");
});

// — the retry/backoff arm that lived here is GONE with `callMessagesAPI`. It was the last thing
// keeping the direct Anthropic transport alive: the function had no production caller after e49868e3
// re-plumbed these lanes through `engine.runTurn()`, and a test is not a caller. Kept as a note rather
// than deleted silently, because "this suite got smaller" and "this suite stopped covering something"
// are different facts — the retry ladder that matters now is the engine's, covered at its own door.

// ── orchestration (injected executor + fake ctx) ───────────────────────────────────────────────────
const mkCtx = ({ policy = POLICY_JX, profile = {}, plan = null, job = { markName: "NOVAPULSE", jurisdictions: ["CN"], goods: "game software", classes: [9] } } = {}) => {
  const runDir = mkdtempSync(join(tmpdir(), "jx-run-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const registerPlan = plan ?? { schema_version: 1, plan_version: 1, job_key: "t", entries: [
    { qid: "primary-sweep:exact:novapulse", axis: "primary-sweep", predicate: "exact", term: "NOVAPULSE", nice_classes: ["9"], regions: ["CN"], expected_kind: "enumerate" }] };
  return { ctx: { run: { runDir }, paths: { registerPlan: driverDir(runDir, "register-plan.json") },
    job, profile, searchPolicy: policy, registerPlan }, runDir, job };
};

test("attachJxLanes: minted once, read verbatim on resume (never re-decided), corrupt = loud", () => {
  const { ctx } = mkCtx();
  const first = attachJxLanes(ctx);
  assert.equal(first.minted, true);
  assert.deepEqual(Object.keys(ctx.jxLanes.lanes), ["zh"]);
  // a resume with a DIFFERENT job (jurisdictions changed) still reads the FROZEN decision
  const ctx2 = { ...ctx, job: { ...ctx.job, jurisdictions: ["US"] }, jxLanes: undefined };
  const second = attachJxLanes(ctx2);
  assert.equal(second.minted, false);
  assert.deepEqual(Object.keys(ctx2.jxLanes.lanes), ["zh"], "frozen decision wins — a resume never re-decides");
  writeFileSync(driverDir(ctx.run.runDir, "jx-lanes.json"), "{corrupt");
  assert.throws(() => attachJxLanes({ ...ctx, jxLanes: undefined }), /corrupt/);
});

test("jxPlanEntries: deterministic jx-zh qids carry BOTH forms — native term + romanizedTerms; refusals returned, cap enforced", () => {
  const laneDecision = { depth: "candidates", jurisdictions: ["CN"] };
  const candidates = [
    { term: "诺瓦脉冲", romanization: "NUO WA MAI CHONG", kind: "phonetic", rationale: "sound" },
    { term: "NOVAPULSE", romanization: "NOVAPULSE", kind: "phonetic", rationale: "latin echo" },   // refused: script
    { term: "诺瓦脉冲", romanization: "NUO WA MAI CHONG", kind: "semantic", rationale: "dup key" },        // refused: duplicate research key
    ...Array.from({ length: 10 }, (_, i) => ({ term: `新脉${"冲".repeat(i + 1)}`, romanization: `XIN MAI${" CHONG".repeat(i + 1)}`, kind: "nickname", rationale: "" })),
  ];
  const { entries, accepted, refused } = jxPlanEntries({ lane: "zh", laneDecision, candidates, inScopeClasses: ["9"] });
  assert.equal(entries.length, JX_CANDIDATE_CAP);
  assert.equal(accepted.length, JX_CANDIDATE_CAP);
  // The native term and `exact` are UNCHANGED — that is what corsearch answers correctly (小米 = 553),
  // and widening it there costs the slice (default = 127414, past corsearch's 5000 ceiling).
  assert.ok(entries.every((e) => e.axis === "transliteration-numeric" && e.predicate === "exact" && e.qid.startsWith("jx-zh-")));
  assert.equal(entries[0].term, "诺瓦脉冲", "the characters stay the searched term for a native-script index");
  // …and the Latin equivalent rides alongside for the provider that has no character index.
  assert.deepEqual(entries[0].romanizedTerms, ["NUO WA MAI CHONG", "NUOWAMAICHONG"]);
  assert.deepEqual(entries[0].regions, ["CN"]);
  assert.ok(refused.some((r) => /not wholly Han-script/.test(r.reason)));
  assert.ok(refused.some((r) => /duplicate research key/.test(r.reason)));
  assert.ok(refused.some((r) => /cap/.test(r.reason)));
  // determinism: same candidates ⇒ same qids
  const again = jxPlanEntries({ lane: "zh", laneDecision, candidates, inScopeClasses: ["9"] });
  assert.deepEqual(again.entries.map((e) => e.qid), entries.map((e) => e.qid));
});

test("jxPlanEntries: the existing plan seeds dedup + cap — NFC/NFD one key; compiled terms refused; prior folds count (review 2026-07-18)", () => {
  const laneDecision = { depth: "candidates", jurisdictions: ["CN"] };
  // NFC/NFD variants of one term = ONE research key
  const nfcnfd = jxPlanEntries({ lane: "zh", laneDecision, inScopeClasses: ["9"], candidates: [
    { term: "煮".normalize("NFC"), romanization: "ZHU", kind: "phonetic", rationale: "" },
    { term: "煮".normalize("NFD"), romanization: "ZHU", kind: "semantic", rationale: "" }] });
  assert.equal(nfcnfd.entries.length, 1);
  assert.ok(nfcnfd.refused.some((r) => /duplicate research key/.test(r.reason)));
  // a candidate the COMPILED plan already enumerates never becomes a second paid query
  const existing = [{ qid: "transliteration-numeric:exact:x", axis: "transliteration-numeric", predicate: "exact", term: "诺瓦脉冲", nice_classes: ["9"], regions: [], expected_kind: "enumerate" }];
  const dedup = jxPlanEntries({ lane: "zh", laneDecision, inScopeClasses: ["9"], existingEntries: existing,
    candidates: [{ term: "诺瓦脉冲", romanization: "NUO WA MAI CHONG", kind: "phonetic", rationale: "" }, { term: "新脉", romanization: "XIN MAI", kind: "nickname", rationale: "" }] });
  assert.equal(dedup.entries.length, 1);
  assert.ok(dedup.refused.some((r) => /compiled plan already enumerates/.test(r.reason)));
  // prior jx folds count against the per-plan cap — a re-fold can never double past it
  const priorJx = Array.from({ length: JX_CANDIDATE_CAP }, (_, i) => ({ qid: `jx-zh-prior${i}`, axis: "transliteration-numeric", predicate: "exact", term: `旧${i}`, nice_classes: ["9"], regions: [], expected_kind: "enumerate" }));
  const capped = jxPlanEntries({ lane: "zh", laneDecision, inScopeClasses: ["9"], existingEntries: priorJx,
    candidates: [{ term: "新脉", romanization: "XIN MAI", kind: "nickname", rationale: "" }] });
  assert.equal(capped.entries.length, 0);
  assert.ok(capped.refused.some((r) => /prior folds included/.test(r.reason)));
  // over-long injected rationales are capped in the receipt row
  const longR = jxPlanEntries({ lane: "zh", laneDecision, inScopeClasses: ["9"],
    candidates: [{ term: "新脉", romanization: "XIN MAI", kind: "nickname", rationale: "x".repeat(5000) }] });
  assert.ok(longR.accepted[0].rationale.length <= 300, "fixture/injected rationale never bloats the sidecar unbounded");
});

test("runJxCandidateFold: folds run-local, receipts + ledger written; resume never re-bills; env kill = no-op", async () => {
  process.env.CLEAROTRON_JX_LANES = "1";
  try {
    const { ctx, runDir } = mkCtx();
    let calls = 0;
    const jxExecutor = async ({ lane }) => { calls++; return { ok: true, candidates: [{ term: "诺瓦脉冲", romanization: "NUO WA MAI CHONG", kind: "phonetic", rationale: "r" }], tookMs: 5, usage: { input: 100, output: 50 } }; };
    const r = await runJxCandidateFold(ctx, ctx.job, { jxExecutor }, { inScopeClasses: ["9"] });
    assert.equal(r.folded, 1);
    assert.equal(calls, 1);
    const plan = JSON.parse(readFileSync(ctx.paths.registerPlan, "utf8"));
    assert.equal(plan.plan_version, 2, "fold bumps the run-local plan version");
    assert.ok(plan.entries.some((e) => e.qid === "jx-zh-诺瓦脉冲".normalize() || e.qid.startsWith("jx-zh-")), "jx entry folded");
    const sidecar = JSON.parse(readFileSync(driverDir(runDir, "jx-lanes.json"), "utf8"));
    assert.equal(sidecar.fold.lanes.zh.accepted.length, 1);
    assert.ok(sidecar.fold.foldedAt);
    assert.ok(Array.isArray(sidecar.fold.lanes.zh.cnipaSubgroups), "the CNIPA awareness note rides the receipt");
    const ledger = readFileSync(driverDir(runDir, "jx-completions.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(ledger.length, 1);
    assert.deepEqual(ledger[0].usage, { input: 100, output: 50 }, "tokens-only telemetry — never currency");
    // resume: the frozen fold receipt short-circuits — no second executor call, no re-bill
    const r2 = await runJxCandidateFold(ctx, ctx.job, { jxExecutor }, { inScopeClasses: ["9"] });
    assert.equal(calls, 1, "already-folded (frozen) ⇒ the executor is never re-invoked");
    assert.match(r2.cause ?? "", /already folded/);
  } finally { delete process.env.CLEAROTRON_JX_LANES; }

  // Lane kill: nothing folded, no spend, plan byte-identical. The leg that used to be tested here was
  // CLEAROTRON_JX_LANES (retired 2026-07-27 — it gated shipped machinery and read as OFF wherever there was no
  // engine environment). CLEAROTRON_NATIVE_LANGUAGE_ZH is the surviving kill, and it is fail-open, so it means the same
  // thing everywhere.
  const { ctx: ctx2 } = mkCtx();
  const before = JSON.stringify(ctx2.registerPlan);
  process.env.CLEAROTRON_NATIVE_LANGUAGE_ZH = "0";
  try {
    const r3 = await runJxCandidateFold(ctx2, ctx2.job, { jxExecutor: async () => { throw new Error("must not run"); } }, { inScopeClasses: ["9"] });
    assert.equal(r3.folded, 0);
    assert.match(r3.cause, /no lanes in scope|frozen decision has no lanes/);
    assert.equal(JSON.stringify(ctx2.registerPlan), before, "the register plan is never rewritten with the lane killed");
  } finally { delete process.env.CLEAROTRON_NATIVE_LANGUAGE_ZH; }
});

test("runJxCandidateFold: a degraded lane logs + receipts and the run continues (never-kill); CLEAROTRON_NATIVE_LANGUAGE_ZH=0 kills just zh", async () => {
  process.env.CLEAROTRON_JX_LANES = "1";
  try {
    const { ctx, runDir } = mkCtx();
    const r = await runJxCandidateFold(ctx, ctx.job, { jxExecutor: async () => ({ ok: false, cause: "no api key" }) }, { inScopeClasses: ["9"] });
    assert.equal(r.folded, 0);
    const sidecar = JSON.parse(readFileSync(driverDir(runDir, "jx-lanes.json"), "utf8"));
    // — `degraded` is the BOOLEAN (whether); the cause rides `degradedCause`. It used to be the
    // cause string, which no reader could type-check, so the scorer read it as "not stated".
    assert.equal(sidecar.fold.lanes.zh.degraded, true);
    assert.match(sidecar.fold.lanes.zh.degradedCause, /no api key/, "the cause survives on its own field");
    assert.ok(!existsSync(ctx.paths.registerPlan), "a fully-degraded lane folds nothing — the run-dir plan is never rewritten");
    process.env.CLEAROTRON_NATIVE_LANGUAGE_ZH = "0";
    const { ctx: c2, runDir: rd2 } = mkCtx();
    const r2 = await runJxCandidateFold(c2, c2.job, { jxExecutor: async () => { throw new Error("must not run"); } }, { inScopeClasses: ["9"] });
    assert.equal(r2.folded, 0);
    assert.match(r2.cause, /no lanes/);
    void rd2;
  } finally { delete process.env.CLEAROTRON_JX_LANES; delete process.env.CLEAROTRON_NATIVE_LANGUAGE_ZH; }
});

test("resolveJxExecutor: injected wins; fixtures dir serves canned candidates; missing fixture degrades loudly", async () => {
  const inj = resolveJxExecutor({ jxExecutor: async () => ({ ok: true, candidates: [] }) });
  assert.equal(inj.source, "injected");
  const fixDir = mkdtempSync(join(tmpdir(), "jx-fix-"));
  writeFileSync(join(fixDir, "novapulse.zh.json"), JSON.stringify({ candidates: [{ term: "诺瓦", kind: "phonetic", rationale: "f" }] }));
  process.env.CLEAROTRON_JX_FIXTURES = fixDir;
  try {
    const fx = resolveJxExecutor({});
    assert.match(fx.source, /^fixtures:/);
    const hit = await fx.exec({ mark: "NOVAPULSE", lane: "zh" });
    assert.equal(hit.ok, true);
    assert.equal(hit.candidates[0].term, "诺瓦");
    const miss = await fx.exec({ mark: "GHOST", lane: "zh" });
    assert.equal(miss.ok, false);
    assert.match(miss.cause, /fixture missing/);
  } finally { delete process.env.CLEAROTRON_JX_FIXTURES; }
});

// ── review 2026-07-18: the per-lane fold state machine ──────────────────────────────────────────────
test("crash-window repair: plan folded but receipt missing ⇒ NO re-bill, receipt rebuilt from the plan (provenance closed)", async () => {
  process.env.CLEAROTRON_JX_LANES = "1";
  try {
    const { ctx, runDir } = mkCtx();
    // simulate the crash: the plan already carries jx entries, but the sidecar has lanes + NO fold receipt
    ctx.registerPlan = { ...ctx.registerPlan, plan_version: 2, entries: [...ctx.registerPlan.entries,
      { qid: "jx-zh-诺瓦脉冲", axis: "transliteration-numeric", predicate: "exact", term: "诺瓦脉冲", nice_classes: ["9"], regions: ["CN"], expected_kind: "enumerate" }] };
    writeFileSync(driverDir(runDir, "jx-lanes.json"), JSON.stringify({
      schema: 1, lanes: { zh: { depth: "candidates", jurisdictions: ["CN"], origin: "component default (candidates)" } }, scope: ["CN"], frozenAt: "2026-07-18T00:00:00Z" }));
    let calls = 0;
    const r = await runJxCandidateFold(ctx, ctx.job, { jxExecutor: async () => { calls++; return { ok: true, candidates: [] }; } }, { inScopeClasses: ["9"] });
    assert.equal(calls, 0, "the paid executor is NEVER re-invoked when the plan already carries the lane");
    assert.equal(r.folded, 1, "the resume reports the plan's real fold count, not 0");
    const sidecar = JSON.parse(readFileSync(driverDir(runDir, "jx-lanes.json"), "utf8"));
    assert.match(sidecar.fold.lanes.zh.repaired ?? "", /rebuilt from the frozen plan/, "the audit gap closes");
    assert.equal(sidecar.fold.lanes.zh.accepted[0].qid, "jx-zh-诺瓦脉冲");
    // — the paid work LANDED, so the rebuilt receipt states health rather than leaving it blank.
    // Without this the scorer prints "(not stated)" for a lane whose candidates are in the frozen plan.
    assert.equal(sidecar.fold.lanes.zh.degraded, false, "a repaired receipt is a HEALTHY lane and must say so");
    assert.equal(sidecar.fold.lanes.zh.degradedCause, null);
  } finally { delete process.env.CLEAROTRON_JX_LANES; }
});

// ──: every fold-lane writer states `degraded` as a boolean ────────────────────────────────────
test("#525 SHAPE SWEEP: every record in fold.lanes states `degraded` as a BOOLEAN, whichever writer built it", async () => {
  // Three writers build a fold-lane record and before not one of them stated a boolean. A test per
  // path would pass while a fourth writer went on omitting the field, so this walks EVERY value in
  // fold.lanes and type-checks it — one assertion that covers whatever wrote the record.
  process.env.CLEAROTRON_JX_LANES = "1";
  try {
    // CN⇒zh, JP⇒ja, KR⇒ko: one lane folds successfully, one lane's executor fails, and one arrives via
    // the crash-window repair (its qids are already in the frozen plan, so it is never re-billed).
    const { ctx, runDir } = mkCtx({ job: { markName: "NOVAPULSE", jurisdictions: ["CN", "JP", "KR"], goods: "game software", classes: [9] } });
    ctx.registerPlan = { ...ctx.registerPlan, entries: [...ctx.registerPlan.entries,
      { qid: "jx-ko-노바", axis: "transliteration-numeric", predicate: "exact", term: "노바", nice_classes: ["9"], regions: ["KR"], expected_kind: "enumerate" }] };
    const r = await runJxCandidateFold(ctx, ctx.job, { jxExecutor: async ({ lane }) => lane === "zh"
      ? { ok: true, candidates: [{ term: "诺瓦脉冲", romanization: "NUO WA MAI CHONG", kind: "phonetic", rationale: "sound" }] }
      : { ok: false, cause: "ANTHROPIC_API_KEY absent from driver env" } }, { inScopeClasses: ["9"] });
    void r;
    const sidecar = JSON.parse(readFileSync(driverDir(runDir, "jx-lanes.json"), "utf8"));
    const built = Object.entries(sidecar.fold?.lanes ?? {});
    assert.ok(built.length >= 3, `all three writers must have produced a record — saw ${built.map(([k]) => k).join(", ")}`);
    for (const [lane, rec] of built) {
      assert.equal(typeof rec.degraded, "boolean", `fold.lanes.${lane}.degraded must be a boolean, got ${JSON.stringify(rec.degraded)}`);
      // and the cause is a string exactly when degraded, null exactly when not — never the two crossed
      if (rec.degraded) assert.equal(typeof rec.degradedCause, "string", `a degraded lane must name its cause (${lane})`);
      else assert.equal(rec.degradedCause, null, `a healthy lane carries no cause (${lane})`);
    }
    // and each writer is the one we think it is
    assert.equal(sidecar.fold.lanes.zh.degraded, false, "the success writer");
    assert.equal(sidecar.fold.lanes.ja.degraded, true, "the executor-failure writer");
    assert.match(sidecar.fold.lanes.ja.degradedCause, /absent from driver env/);
    assert.equal(sidecar.fold.lanes.ko.degraded, false, "the crash-window repair writer");
    assert.match(sidecar.fold.lanes.ko.repaired ?? "", /rebuilt from the frozen plan/);
  } finally { delete process.env.CLEAROTRON_JX_LANES; }
});

test("degraded lanes are RETRYABLE on resume (repairable-not-terminal) with a hard attempt cap", async () => {
  process.env.CLEAROTRON_JX_LANES = "1";
  try {
    const { ctx } = mkCtx();
    let calls = 0;
    const failing = async () => { calls++; return { ok: false, cause: "no api key" }; };
    await runJxCandidateFold(ctx, ctx.job, { jxExecutor: failing }, { inScopeClasses: ["9"] });
    assert.equal(calls, 1);
    // operator fixes the key; the resume RETRIES (the old single foldedAt froze this terminal)
    let fixedCalls = 0;
    const fixed = async () => { fixedCalls++; return { ok: true, candidates: [{ term: "诺瓦", romanization: "NUO WA", kind: "nickname", rationale: "r" }] }; };
    const r2 = await runJxCandidateFold(ctx, ctx.job, { jxExecutor: fixed }, { inScopeClasses: ["9"] });
    assert.equal(fixedCalls, 1, "a degraded lane retries after repair");
    assert.equal(r2.folded, 1);
    // and a successfully-folded lane never re-runs
    const r3 = await runJxCandidateFold(ctx, ctx.job, { jxExecutor: fixed }, { inScopeClasses: ["9"] });
    assert.equal(fixedCalls, 1);
    assert.match(r3.cause, /already folded/);
    // attempt cap: a lane that keeps failing goes receipted-terminal after MAX_LANE_ATTEMPTS
    const { ctx: c2 } = mkCtx();
    const { MAX_LANE_ATTEMPTS } = await import("../jx.mjs");
    let n = 0;
    for (let i = 0; i < MAX_LANE_ATTEMPTS + 2; i++) await runJxCandidateFold(c2, c2.job, { jxExecutor: async () => { n++; return { ok: false, cause: "still broken" }; } }, { inScopeClasses: ["9"] });
    assert.equal(n, MAX_LANE_ATTEMPTS, "the retry budget is hard-capped");
  } finally { delete process.env.CLEAROTRON_JX_LANES; }
});

test("empty in-scope classes: the fold SKIPS (receipted cause) — it must never mint entries parseRegisterPlan would reject", async () => {
  process.env.CLEAROTRON_JX_LANES = "1";
  try {
    const { ctx } = mkCtx();
    const r = await runJxCandidateFold(ctx, ctx.job, { jxExecutor: async () => { throw new Error("must not run"); } }, { inScopeClasses: [] });
    assert.equal(r.folded, 0);
    assert.match(r.cause, /no in-scope classes/);
  } finally { delete process.env.CLEAROTRON_JX_LANES; }
});

test("core: a truncated turn DEGRADES loudly, and an unreadable one never reads as zero candidates", async () => {
  const turnOf = (r) => async () => ({ vendor: "anthropic", authMode: "subscription", model: "claude-haiku-4-5",
    usage: { input: 9, output: 2048 }, truncationObservable: true, ...r });

  const truncated = await core.generateCandidates({ mark: "X", lane: "zh", turn: turnOf({ ok: true, text: '{"candidates":[]}', truncated: true }) });
  assert.equal(truncated.ok, false);
  assert.match(truncated.cause, /truncated at the output ceiling/);

  // — the transport moved off the Messages API, so `stop_reason: "max_tokens"` is gone and the
  // engine's output-ceiling fault carries it instead. What must NOT move is the reason the check exists:
  // core.js's own words, "a max_tokens truncation is byte-indistinguishable from a legitimate empty
  // result at the candidate level — surface it as a DEGRADE, never a quiet recall loss".
  const unreadable = await core.generateCandidates({ mark: "X", lane: "zh", turn: turnOf({ ok: true, text: "Sorry, I can't." }) });
  assert.equal(unreadable.ok, false, "an unreadable answer is a degrade — this is what replaced tool_choice");
  assert.match(unreadable.cause, /no readable answer object/);
  assert.equal(unreadable.vendor, "anthropic", "and it still names who spent the tokens");

  const empty = await core.generateCandidates({ mark: "X", lane: "zh", turn: turnOf({ ok: true, text: '{"candidates":[]}' }) });
  assert.equal(empty.ok, true, "an empty array IS an answer and must be believed, or the guard above is a refusal machine");
  assert.deepEqual(empty.candidates, []);
});


// ---- display-name scope (portal vocabulary) — sibling of the copper-bastion register incident ------
// The portal composer submits jurisdictions by display name; lane adapters key on codes. Without
// canonicalization, a customer who paid for zh deepening and wrote "China" got no lane and no
// disclosure row — a silently skipped paid feature.

test("scopeJurisdictions: display names canonicalize to codes; unknown names keep uppercased form", () => {
  assert.deepEqual(scopeJurisdictions({ jurisdictions: ["China", "United States"] }, {}), ["CN", "US"]);
  assert.deepEqual(scopeJurisdictions({ jurisdictions: ["Japan", "South Korea"] }, {}), ["JP", "KR"]);
  assert.deepEqual(scopeJurisdictions({ jurisdictions: ["Worldwide", "Latin America"] }, {}), ["WORLDWIDE", "LATIN AMERICA"]);
});

test("decideJxLanes: a portal job saying 'China' fires the zh lane exactly like 'CN'", () => {
  const named = decideJxLanes({ job: { jurisdictions: ["United States", "China", "Hong Kong"] }, profile: {}, searchPolicy: POLICY_JX });
  assert.ok(named.lanes.zh, "zh lane must fire for display-name scope");
  assert.deepEqual(named.lanes.zh.jurisdictions, ["CN", "HK"]);
  assert.deepEqual(named.scope, ["US", "CN", "HK"]);
});

// ── The romanisation contract ─────────────────────────────────────────────────────────────────────
// Compumark indexes a non-Latin filing by its transliteration and holds NO character index: 华威豹
// answers 0 while HUA WEI BAO answers 32 of the same records (probed 2026-07-29, on records fetched
// and read). A candidate with no romanisation is therefore unsearchable, and searching its characters
// instead returns 0 — which reads as CLEAN. That is the failure this whole contract exists to stop.

test("candidateRefusal: a candidate with no usable romanization is REFUSED, not folded into the plan", () => {
  const ok = { term: "诺瓦脉冲", romanization: "NUO WA MAI CHONG", kind: "phonetic" };
  assert.equal(candidateRefusal("zh", ok), null);
  assert.match(candidateRefusal("zh", { ...ok, romanization: undefined }), /no romanization/,
    "searching the characters instead would return 0 and read as CLEAN");
  assert.match(candidateRefusal("zh", { ...ok, romanization: "   " }), /no romanization/);
  assert.match(candidateRefusal("zh", { ...ok, romanization: "诺瓦脉冲" }), /not plain ASCII/,
    "the native script leaking into the romanization field is the same silent zero by another route");
  assert.match(candidateRefusal("zh", { ...ok, romanization: "NUÒ WǍ" }), /not plain ASCII/,
    "tone marks are diacritics — the vendor's own unsearchable set");
  assert.match(candidateRefusal("zh", { ...ok, romanization: "x".repeat(61) }), /too long/);
});

test("romanizationRefusal / romanizationSpellings: plain ASCII, and BOTH spellings ride to the wire", () => {
  assert.equal(romanizationRefusal("HUA WEI BAO"), null);
  assert.equal(romanizationRefusal("ZIKIMI"), null);
  assert.equal(romanizationRefusal("al bank al arabi"), null, "lower case is fine — the field is case-insensitive");
  assert.match(romanizationRefusal(""), /no romanization/);
  assert.match(romanizationRefusal("HUA  WEI"), /single spaces/, "a double space is not how the record writes it");
  // Spaced AND run-together: identical counts on CN/TW/GR/KR/TH but EG differs (7 vs 10), so both go.
  assert.deepEqual(romanizationSpellings("HUA WEI BAO"), ["HUA WEI BAO", "HUAWEIBAO"]);
  assert.deepEqual(romanizationSpellings("ZIKIMI"), ["ZIKIMI"], "single token — no second spelling to add");
  assert.deepEqual(romanizationSpellings("  al  bank  "), ["al bank", "albank"]);
  assert.deepEqual(romanizationSpellings(""), []);
});

test("the TWO minting lanes agree: jx candidates and manifest variants state the romanisation identically", async () => {
  // Both lanes push onto the same transliteration-numeric axis and both are read by the same executor
  // seam, so a second, privately-shaped emitter would be a false clean waiting to happen: one lane's
  // entries would carry a form the substituting provider recognises and the other's would not. They
  // take the shape from ONE helper (providers/_shared/script-form.mjs romanizationSpellings, re-exported
  // by jx-lanes for this lane's callers), and this test is what keeps that true.
  const { parseVariantManifestModel } = await import("../variant-manifest-model.mjs");
  const { compileRegisterPlan } = await import("../register-plan.mjs");
  const ROMAN = "NUO WA MAI CHONG", TERM = "诺瓦脉冲";

  const jx = jxPlanEntries({ lane: "zh", laneDecision: { depth: "candidates", jurisdictions: ["CN"] }, inScopeClasses: ["9"],
    candidates: [{ term: TERM, romanization: ROMAN, kind: "phonetic", rationale: "sound" }] }).entries[0];

  const plan = compileRegisterPlan({
    manifest: parseVariantManifestModel(JSON.stringify({ schema_version: 1, mark: "NOVAPULSE", dominant_element: "NOVAPULSE",
      elements: [{ value: "NOVAPULSE", kind: "distinctive" }],
      variants: [{ value: TERM, category: "transliteration", rationale: "zh", romanization: ROMAN }] })),
    job: { jobKey: "j", classes: ["9"], jurisdictions: ["CN"] }, skillVersion: "t" });
  const fromManifest = plan.entries.find((e) => e.term === TERM);

  assert.equal(jx.axis, fromManifest.axis, "same axis");
  assert.deepEqual(jx.romanizedTerms, fromManifest.romanizedTerms);
  assert.deepEqual(jx.romanizedTerms, romanizationSpellings(ROMAN), "…and both are the shared helper's output, not a private spelling");
});
