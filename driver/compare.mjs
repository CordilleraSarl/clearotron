// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// compare.mjs — pure-code A/B for stage outputs (no LLM, no network). Diffs a stage's output between two
// locations (canonical / a _history snapshot / an _experiments sandbox) and prints a telemetry-delta table
// (model · wall · tokens · output fingerprint · which inputs changed). Powers the fine-tuning loop: re-run a
// portion on a different model or prompt (--experiment in pipeline.mjs) then `compare` it to before.
//
//   node compare.mjs --run-dir <dir> --stage <stage> [--axis <a>] [--a <ref>] [--b <ref>]
//     <ref> = canonical | _history/<name> | _experiments/<name> | an absolute path/dir
//     default: --a canonical  --b <newest _history snapshot for that stage>

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename, isAbsolute } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { STAGES, paths } from "./stages.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

const labelFor = (stage, axis) => stage + (axis ? `:${axis}` : "");
const outBasename = (stage, axis) => {
  const out = STAGES[stage]?.out?.(paths("/x"), axis);
  return out ? basename(out) : `${stage}.md`;
};

// ---- LCS line diff (textbook DP; stage outputs are small markdown — O(n·m) is fine) -------------------
function lcsDiff(aLines, bLines) {
  const n = aLines.length, m = bLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) { out.push({ tag: " ", line: aLines[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ tag: "-", line: aLines[i] }); i++; }
    else { out.push({ tag: "+", line: bLines[j] }); j++; }
  }
  while (i < n) out.push({ tag: "-", line: aLines[i++] });
  while (j < m) out.push({ tag: "+", line: bLines[j++] });
  return out;
}

// Render the diff with ±`context` unchanged lines around each change block; collapse long unchanged runs.
function renderDiff(rows, context = 2) {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, k) => {
    if (r.tag !== " ") for (let d = -context; d <= context; d++) if (rows[k + d]) keep[k + d] = true;
  });
  const lines = [];
  let gap = false;
  rows.forEach((r, k) => {
    if (keep[k]) { lines.push(`${r.tag} ${r.line}`); gap = false; }
    else if (!gap) { lines.push("…"); gap = true; }
  });
  return lines.join("\n");
}

// Public, unit-testable: unified-ish diff of two strings.
export function diffStageOutputs(aText, bText) {
  return renderDiff(lcsDiff(String(aText ?? "").split("\n"), String(bText ?? "").split("\n")));
}

// ---- telemetry delta ---------------------------------------------------------------------------------
const fmtTok = (u) => (u && (u.inputTokens ?? u.input) != null ? `${u.inputTokens ?? u.input} in / ${u.outputTokens ?? u.output} out` : "—");

/**
 * The engine an arm ran on, or null —.
 *
 * An arm whose engine cannot be named is an arm this table cannot tell apart from the other one. The
 * receipt used to record a model resolved from a TIER through an engine-blind alias table, so a codex arm
 * and an Anthropic arm both read `anthropic/claude-opus-5` and an A/B between engines was silently
 * self-refuting. Names only what is recorded; infers nothing.
 */
export const engineOf = (x) => String(x?.engine ?? "").trim() || null;

/**
 * Why these two arms cannot be compared, or null —.
 *
 * A table is a claim that two things differ in the ways it lists and agree elsewhere. Rendering one over
 * arms whose engines are unknown asserts exactly the thing that was wrong.
 */
export function refuseToCompare(a = {}, b = {}) {
  // INDISTINGUISHABLE, not merely incomplete — and the difference is the whole scope of this rule.
  //
  // A first version refused whenever either side lacked an engine. That is too wide: comparing two
  // attempts of one stage in one run is a legitimate use where the engine is constant and older records
  // carry no such field, and refusing there is noise that gets the check turned off.
  //
  // The defect this exists for is narrower and worse: two arms that read THE SAME. The receipt resolved a
  // tier through an engine-blind table, so a codex arm and an Anthropic arm both said
  // `anthropic/claude-opus-5` — same model, no engine, nothing to tell them apart. That is what is
  // refused. Two records naming different models are distinguishable BY MODEL and are compared.
  if (engineOf(a) || engineOf(b)) return null;
  const modelOf = (x) => String(x?.modelUsed ?? x?.model ?? "").trim();
  if (modelOf(a) !== modelOf(b)) return null;
  return "REFUSING TO COMPARE — neither record names an engine and both name the same model "
    + `(${modelOf(a) || "none"}), so there is nothing here that tells these two apart (tracker issue 1967). `
    + "A model id resolved from a tier is not the answer: it maps through the Anthropic table whichever "
    + "engine ran, so two arms on different engines read identically.\n"
    + "  The per-attempt `_driver/<stage>.jsonl` records `engine` and `modelUsed` — compare from there.";
}

// Public, unit-testable: a side-by-side table from two per-stage telemetry objects.
export function telemetryDelta(a = {}, b = {}) {
  const refusal = refuseToCompare(a, b);
  if (refusal) return refusal;
  const row = (k, av, bv) => `  ${k.padEnd(13)} ${String(av ?? "—").padEnd(26)} ${String(bv ?? "—")}`;
  const inA = JSON.stringify((a.inputs ?? []).map((x) => `${x.name}:${x.sha}`));
  const inB = JSON.stringify((b.inputs ?? []).map((x) => `${x.name}:${x.sha}`));
  return [
    row("field", "A", "B"),
    // ENGINE FIRST, and above the model: it is the fact that decides whether the model line means
    // anything. Two arms on different engines are a different comparison from two arms on one.
    row("engine", engineOf(a), engineOf(b)),
    row("model", a.modelUsed ?? a.model, b.modelUsed ?? b.model),
    row("trigger", a.trigger, b.trigger),
    row("wall (s)", a.wall, b.wall),
    row("tokens", fmtTok(a.usage), fmtTok(b.usage)),
    row("output sha", a.output?.sha, b.output?.sha),
    row("output size", a.output?.size, b.output?.size),
    row("inputs", inA === inB ? "(unchanged)" : inA, inA === inB ? "(unchanged)" : inB),
  ].join("\n");
}

// ---- ref resolution + CLI ----------------------------------------------------------------------------
function refDir(ref, runDir) {
  if (!ref || ref === "canonical") return runDir;
  if (isAbsolute(ref)) return ref;
  return join(runDir, ref);                       // "_history/<name>" or "_experiments/<name>"
}
function outPath(dir, stage, axis) {
  // canonical/_history hold the file at <dir>/<basename> (register-units flat in snapshots); experiments keep
  // the run layout, so try the nested register-units path too.
  const bn = outBasename(stage, axis);
  const flat = join(dir, bn);
  if (existsSync(flat)) return flat;
  const nested = STAGES[stage]?.out?.(paths(dir), axis);   // e.g. <dir>/register-units/<axis>.md
  return nested && existsSync(nested) ? nested : flat;
}
// last JSONL line of a stage's telemetry, tried at <dir>/<label>.jsonl (snapshot) and <dir>/_driver/<label>.jsonl.
function readTel(dir, stage, axis) {
  const label = labelFor(stage, axis);
  for (const p of [join(dir, `${label}.jsonl`), driverDir(dir, `${label}.jsonl`)]) {
    try {
      const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
      if (lines.length) return JSON.parse(lines[lines.length - 1]);
    } catch { /* try next */ }
  }
  return {};
}
function newestHistorySnapshot(runDir, stage, axis) {
  const bn = outBasename(stage, axis);
  let dirs = [];
  try { dirs = readdirSync(join(runDir, "_history")).sort(); } catch { return null; }
  for (let k = dirs.length - 1; k >= 0; k--) if (existsSync(join(runDir, "_history", dirs[k], bn))) return join("_history", dirs[k]);
  return null;
}

const USAGE = [
  "usage: node compare.mjs --run-dir <dir> --stage <stage> [--axis <a>] [--a <ref>] [--b <ref>]",
  "  <ref> = canonical | _history/<name> | _experiments/<name> | an absolute path/dir",
  "  default: --a canonical  --b <newest _history snapshot for that stage>",
].join("\n");

/**
 * — the same lenient parser fixed in pipeline.mjs, in the second CLI that carries it.
 *
 * `if (k) o[k] = argv[++i]` skipped anything not in the table, so a typo left its flag at the default and
 * the tool answered a question nobody asked. Milder here than in pipeline.mjs — the body is a pure read,
 * nothing is written and nothing is spent, and `--run-dir`/`--stage` already refuse when absent — so the
 * exposure was confined to `--axis`, `--a` and `--b` silently reverting to `a=canonical` and `b=newest
 * snapshot`. Mild is not the same as harmless: the whole purpose of this file is to say whether two
 * versions of a stage differ, and comparing the wrong pair answers that with confidence.
 *
 * Same shape as enqueue.mjs's parseArgs, which is the pattern this repo already settled on: a value table,
 * an explicit refusal, and the missing-value guard (a trailing flag used to bind `undefined`).
 *
 * The programmatic callers are untouched — `mcp-server/lib/driver.mjs` → the `diff_artifact` tool,
 * `whatif.mjs`, and the operability test all call the exported `compareCmd(opts)` with an object and never
 * enter this function. Every documented flag keeps working; only an UNLISTED one now fails, which is the
 * point.
 */
export function parseArgv(argv) {
  const o = {};
  const flags = { "--run-dir": "runDir", "--stage": "stage", "--axis": "axis", "--a": "a", "--b": "b" };
  for (let i = 0; i < argv.length; i++) {
    const k = flags[argv[i]];
    if (!k) throw new Error(`unknown flag ${argv[i]}`);
    const v = argv[++i];
    if (v === undefined) throw new Error(`${argv[i - 1]} needs a value`);
    o[k] = v;
  }
  return o;
}

export function compareCmd(opts) {
  const { runDir, stage, axis } = opts;
  if (!runDir || !stage) throw new Error("compare: --run-dir and --stage are required");
  if (!STAGES[stage]) throw new Error(`compare: unknown stage "${stage}"`);
  const bRef = opts.b ?? newestHistorySnapshot(runDir, stage, axis) ?? "canonical";
  const aRef = opts.a ?? "canonical";
  const aDir = refDir(aRef, runDir), bDir = refDir(bRef, runDir);
  const aOut = outPath(aDir, stage, axis), bOut = outPath(bDir, stage, axis);
  const aText = existsSync(aOut) ? readFileSync(aOut, "utf8") : "";
  const bText = existsSync(bOut) ? readFileSync(bOut, "utf8") : "";
  const diff = diffStageOutputs(aText, bText);
  const table = telemetryDelta(readTel(aDir, stage, axis), readTel(bDir, stage, axis));
  return { aRef, bRef, aOut, bOut, diff, table };
}

if (isEntrypoint(import.meta.url)) {
  let a;
  //: the refusal must print the usage, or "unknown flag --experiement" leaves the reader guessing
  // which spelling was wanted. Same wiring as enqueue.mjs:155.
  try { a = parseArgv(process.argv.slice(2)); }
  catch (e) { console.error(`error: ${e.message}\n\n${USAGE}`); process.exit(2); }
  try {
    const r = compareCmd(a);
    process.stdout.write(`# compare ${a.stage}${a.axis ? `:${a.axis}` : ""}\n#   A = ${r.aRef}\n#   B = ${r.bRef}\n\n`);
    process.stdout.write(`## telemetry\n${r.table}\n\n## diff (A → B)\n${r.diff || "(identical)"}\n`);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }
}
