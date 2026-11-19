#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHICH MANUAL DOES WHICH STAGE READ, AND WHICH MANUAL DOES NOTHING READ.
//
//   node driver/test/instruction-read-map.mjs          the map, for a person
//   node driver/test/instruction-read-map.mjs --json   the same, as JSON
//   node driver/test/instruction-read-map.mjs --stable each stage's rule text composed in code, by block
//
// Every file under `driver/skills/` is prompt payload, and a stage reads only the files its message names.
// So the map is composed the way a stage is composed: the opening messages come from the same composition
// the driver runs (model-stage-dispatches.mjs), under the house default, a matter in the pharma class and
// every profile in the tree. What is computed outside a message is added from where the driver computes it:
// the provider decks from PROVIDERS, the knockout lane's framework deck from the profile, the what-if memo's
// manual from its own dispatch.
//
// AND HOW MUCH THE MODEL IS HANDED BESIDE THE MANUALS. A stage's opening message is composed in stage code, and
// each stage that records through a tool is handed that tool's schema; neither lives under `driver/skills/`, so the
// manual bytes alone undercount what a seat reads. `houseDefault` gives, per stage under the house default, the
// manual bytes, the composed message bytes, and the bytes of the stage's own recording tools as `tools/list` hands
// them to an engine. Tools from the shared servers (band, register, research, coverage) are not the stage's own and
// are not counted. Text the driver composes later in a run, repair and follow-up messages, is not counted either:
// some of it is log text no model reads, and telling the two apart is not done here.
//
// Not a test file. The checks that fail on it are in every-manual-is-read-and-names-what-exists.test.mjs.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";

import { STAGES, paths, resolveAlsoReads, resolveSkillReads } from "../stages.mjs";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";
import { TRIAGE_FRAMEWORK } from "../pipeline-knockout.mjs";
import { DEFAULT_FRAMEWORK, frameworkFor } from "../framework.mjs";
import { PROVIDERS } from "../driver.config.mjs";
import { VOCABULARY } from "../contract-vocabulary.mjs";
import { REGISTER_SERVERS, RECORDING_TOOLS, allowedToolsFor, toolGroupsForStage } from "../engine/mcp/gather-config.mjs";
import { skillRefsIn } from "../methodology-witness.mjs";
import { publishedOf } from "../../shared/reference-guard-classes.mjs";
import { trackedFiles } from "../../shared/tracked-files.mjs";
import { isEntrypoint } from "../../shared/is-entrypoint.mjs";
import { ANOTHER_RUN, DRIVER, everyDispatchedLabel, everyModelStageDispatch } from "./model-stage-dispatches.mjs";

const ROOT = join(DRIVER, "..");
const RUN = "/nonexistent/read-map";
const OTHER_RUN = "/nonexistent/read-map-other";
export const GUARD = "instruction-read-map";

/** Files under `skills/` written for a person, never for a seat. Each carries the sentence that makes that true. */
export const NOT_INSTRUCTION_LOAD = Object.freeze({
  "skills/README.md": "the map of this tree for whoever maintains it; no stage is pointed at it",
  "skills/clearance-register/providers/README.md": "the rules a new provider deck must meet, for whoever writes one",
  "skills/case-law-citation/evals.md": "the scenarios the case-law manual is verified against, for whoever changes it",
});

/** What is committed under `pathspec`, without a private tree laid over the checkout; null when there is no checkout. */
function publishedFiles(root, pathspec) {
  const files = trackedFiles(GUARD, { root, pathspec: [pathspec] });
  if (files === null) return null;
  const p = publishedOf(files, root);
  if (p.error) throw new Error(`${GUARD}: ${p.error}`);
  return p.files;
}

/** Every committed `.md` under `driver/skills/`, as `skills/…`; null when there is no checkout to list. */
export function manualPopulation(root = ROOT) {
  const files = publishedFiles(root, "driver/skills");
  if (files === null) return null;
  return files.filter((f) => f.endsWith(".md")).map((f) => f.slice("driver/".length)).sort();
}

/** The profiles in the tree that choose their own framework or worked examples: { file, profile }. */
function profilesChoosingManuals(root) {
  const files = publishedFiles(root, "driver/profiles") ?? [];
  const out = [];
  for (const file of files.filter((f) => /^driver\/profiles\/[^/]+\.json$/.test(f))) {
    const profile = JSON.parse(readFileSync(join(root, file), "utf8"));
    if (profile.frameworkPath || profile.workedExamplesPath) out.push({ file, profile });
  }
  return out;
}

/** One row per stage and context: { stage, context, files }, each file the stage is told to read. */
export function stageReads(root = ROOT) {
  const rows = everyModelStageDispatch(RUN).map((d) => ({
    stage: d.name, context: d.label, files: [...new Set([...d.declared, ...skillRefsIn(d.message)])].sort(),
  }));
  for (const { file, profile } of profilesChoosingManuals(root)) {
    const context = posix.basename(file, ".json");
    for (const [name, def] of Object.entries(STAGES)) {
      const ctx = { profile, job: {} };
      const message = def.message({ ...ctx, paths: paths(RUN), axis: "primary-sweep", half: "a",
        finding: { ordinal: 1 }, run: { slug: "invented", codename: "invented" } });
      rows.push({ stage: name, context, files: [...new Set([...resolveSkillReads(name, ctx), ...skillRefsIn(message)])].sort() });
    }
    // The knockout lane takes the profile's deck when the profile names one (pipeline-knockout.mjs).
    const configured = frameworkFor(profile);
    const deck = configured !== DEFAULT_FRAMEWORK ? configured : TRIAGE_FRAMEWORK;
    for (const name of ["knockout-assess", "knockout-correct", "knockout-review"]) {
      rows.push({ stage: name, context, files: [...new Set([...(KO_STAGES[name].skillReads ?? []), deck])].sort() });
    }
  }
  for (const [provider, meta] of Object.entries(PROVIDERS)) {
    if (!meta.skillDoc) continue;
    rows.push({ stage: "register-unit", context: `provider ${provider}`, files: [meta.skillDoc] });
    rows.push({ stage: "knockout-register-read", context: `provider ${provider}`, files: [meta.skillDoc] });
  }
  // Read from disk and handed over inline by the memo's own dispatch (whatif-memo-run.mjs), so no message names it.
  rows.push({ stage: "whatif-memo", context: "post-delivery", files: ["skills/whatif-memo/SKILL.md"] });
  return rows;
}

const LINK = /\]\(([^)#\s]+\.md)/g;
const TICKED_MD = /`([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.md)`/g;

/** The files a manual points its reader at, as `skills/…`, keeping only those in `known`. */
export function pointersIn(text, file, known) {
  const dir = posix.dirname(file);
  const out = new Set();
  for (const re of [LINK, TICKED_MD]) {
    for (const m of text.matchAll(re)) {
      const p = posix.normalize(posix.join(dir, m[1]));
      if (known.has(p)) out.add(p);
    }
  }
  return out;
}

/** The manuals that reach no seat: not told, not pointed at, and not written for a person. */
export function unreadOf({ population, told, pointed, forReader }) {
  return population.filter((f) => !told.has(f) && !pointed.has(f) && !forReader.has(f));
}

/** The whole map: per-stage rows, what is told, what is only pointed at, what nothing reaches. */
export function readMap(root = ROOT) {
  const population = manualPopulation(root);
  if (population === null) return null;
  const known = new Set(population);
  const stages = stageReads(root);
  const told = new Set(stages.flatMap((r) => r.files));
  const forReader = new Set(Object.keys(NOT_INSTRUCTION_LOAD));
  const pointed = new Set();
  for (const f of told) {
    if (!known.has(f)) continue;
    for (const p of pointersIn(readFileSync(join(root, "driver", f), "utf8"), f, known)) pointed.add(p);
  }
  for (const name of Object.keys(STAGES)) for (const p of resolveAlsoReads(name, {})) pointed.add(p);
  for (const f of [...told, ...forReader]) pointed.delete(f);
  return { population, stages, told, pointed, forReader, unread: unreadOf({ population, told, pointed, forReader }) };
}

const TICKED = /`([^`\n]+)`/g;
const TOOL_SHAPE = /^(?:(?:record|register|band|perplexity)_[a-z0-9_]+|search_run_artifacts|read_register_list|fetch_url)$/;
const MD_SHAPE = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.md$/;
// Tool-shaped and not a tool: the argument the register's record tools take.
const NOT_A_TOOL = new Set(["record_id"]);

/** Every tool a stage can be granted, under the name a manual uses, plus the failure tokens that share its shape. */
export function knownToolNames() {
  const out = new Set(VOCABULARY.map((v) => v.token));
  for (const { tools } of Object.values(REGISTER_SERVERS)) for (const t of tools) out.add(t);
  const granted = [...Object.values(RECORDING_TOOLS).flat(),
    // The register groups resolve through the deployment's chosen vendor, and every vendor's tools are listed above.
    ...everyDispatchedLabel().flatMap((label) => allowedToolsFor(toolGroupsForStage(label).filter((g) => !g.startsWith("register"))).split(" "))];
  for (const t of granted) out.add(t.split("__").pop());
  return out;
}

/** The file names a run writes: a manual that names one is naming an artifact, not a manual. */
export function runArtifactNames() {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === "string") out.add(posix.basename(v.replaceAll("\\", "/")));
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(paths(RUN));
  walk(koPaths(RUN));
  return out;
}

/** The tools and `.md` files `text` names in backticks that do not exist. */
export function identifierFindingsIn(text, file, { tools, known, artifacts }) {
  const dir = posix.dirname(file);
  const out = new Set();
  for (const [, token] of text.matchAll(TICKED)) {
    if (TOOL_SHAPE.test(token)) {
      if (!tools.has(token) && !NOT_A_TOOL.has(token)) out.add(token);
    } else if (MD_SHAPE.test(token)) {
      // Beside the manual, one folder up (a provider deck names its skill's own files), or from the tree's root.
      const candidates = [posix.join(dir, token), posix.join(dir, "..", token), posix.join("skills", token), token];
      if (!candidates.some((c) => known.has(posix.normalize(c))) && !artifacts.has(posix.basename(token))) out.add(token);
    }
  }
  return [...out].sort();
}

/** Every read manual's findings, as { file: [token, …] }, omitting a file with none. */
export function identifierFindings(map, root = ROOT) {
  const known = new Set(map.population);
  const lists = { tools: knownToolNames(), known, artifacts: runArtifactNames() };
  const out = {};
  for (const file of [...map.told, ...map.pointed].filter((f) => known.has(f)).sort()) {
    const found = identifierFindingsIn(readFileSync(join(root, "driver", file), "utf8"), file, lists);
    if (found.length) out[file] = found;
  }
  return out;
}

const bytesOf = (root, files) => files.reduce((a, f) => {
  const p = join(root, "driver", f);
  return a + (existsSync(p) ? statSync(p).size : 0);
}, 0);

/**
 * Each recording tool as an engine is handed it: name → bytes of its `tools/list` entry (name, description, input
 * schema, annotations). Asked of the server itself, the way an engine asks, because a tool may state its schema for
 * the run it serves; here that is an empty run folder. Throws when the server does not answer.
 */
export function recordingToolBytes() {
  const run = mkdtempSync(join(tmpdir(), "read-map-tools-"));
  try {
    const r = spawnSync(process.execPath, [join(DRIVER, "engine", "mcp", "recording-server.mjs")], {
      input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`, encoding: "utf8",
      env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: run }, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    const answer = String(r.stdout ?? "").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((m) => m?.id === 1);
    const tools = answer?.result?.tools;
    if (!Array.isArray(tools) || !tools.length) throw new Error(`${GUARD}: the recording server listed no tools (${String(r.stderr ?? "").slice(0, 200)})`);
    return new Map(tools.map((t) => [t.name, Buffer.byteLength(JSON.stringify(t))]));
  } finally { rmSync(run, { recursive: true, force: true }); }
}

/** A stage's own recording tools: its row's tools on its own `recording-<stage>` server. */
const ownRecordingTools = (stage) => (RECORDING_TOOLS[stage] ?? [])
  .filter((t) => t.startsWith(`mcp__recording-${stage}__`)).map((t) => t.split("__").pop());

// ── THE PART OF A STAGE'S MESSAGE NO RUN CHANGES ────────────────────────────────────────────────────────────────────
//
// Some of what stage code composes is rule text: the same words whatever the run, which could sit in a manual instead,
// where the session starts holding it (B9, tracker issue 1385; the moves are design's). Composing each stage again under
// another run's folder, name and finding and another matter (model-stage-dispatches.mjs ANOTHER_RUN) separates it: the
// lines both messages carry, in the same order, are text no run changes. A line that names a path, the mark or the
// classes differs between the two and is not counted. A rule that only some matters get is not either, so the count is
// a floor for the house default.

/**
 * The lines `a` and `b` share in order (a longest common subsequence of lines): `{ bytes, blocks }`, where each block is
 * a run of shared consecutive lines of `a`, `{ line, bytes, head }`, `line` 1-based. PURE.
 */
export function stableText(a, b) {
  const A = String(a).split("\n"), B = String(b).split("\n");
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const shared = new Array(n).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (A[i] === B[j]) { shared[i] = true; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  const blocks = [];
  let bytes = 0;
  for (let i = 0; i < n; i++) {
    if (!shared[i]) continue;
    const size = Buffer.byteLength(A[i]) + (i < n - 1 ? 1 : 0);
    bytes += size;
    const last = blocks.at(-1);
    if (last && last.end === i - 1) { last.end = i; last.bytes += size; }
    else blocks.push({ line: i + 1, end: i, bytes: size, head: A[i].trim().slice(0, 80) });
  }
  return { bytes, blocks: blocks.map(({ end, ...b }) => b) };
}

/** Each stage's opening message under the house default, and the same stage composed for another run. */
function houseDefaultPairs() {
  const other = new Map(everyModelStageDispatch(OTHER_RUN, ANOTHER_RUN).map((d) => [`${d.name}\u0000${d.label}`, d.message]));
  return everyModelStageDispatch(RUN).filter((d) => d.label === "house default" || d.label === "knockout")
    .map((d) => ({ d, other: other.get(`${d.name}\u0000${d.label}`) ?? "" }));
}

/** Per stage, the blocks of its message no run changes, largest first: { stage, blocks }. */
export function stableBlocks() {
  return houseDefaultPairs().map(({ d, other }) => ({ stage: d.name, blocks: stableText(d.message, other).blocks.sort((x, y) => y.bytes - x.bytes) }));
}

/** Per stage under the house default: { stage, manualBytes, messageBytes, stableMessageBytes, toolSchemaBytes, tools }. */
export function houseDefaultFigures(root = ROOT, toolBytes = recordingToolBytes()) {
  return houseDefaultPairs().map(({ d, other }) => {
    const tools = ownRecordingTools(d.name);
    const missing = tools.filter((t) => !toolBytes.has(t));
    if (missing.length) throw new Error(`${GUARD}: ${d.name}'s recording tools ${missing.join(", ")} are not on the recording server`);
    return {
      stage: d.name,
      manualBytes: bytesOf(root, [...new Set([...d.declared, ...skillRefsIn(d.message)])]),
      messageBytes: Buffer.byteLength(d.message),
      stableMessageBytes: stableText(d.message, other).bytes,
      toolSchemaBytes: tools.reduce((a, t) => a + toolBytes.get(t), 0),
      tools,
    };
  });
}

function main() {
  const map = readMap(ROOT);
  if (map === null) { console.error(`${GUARD}: no checkout to read the manuals from`); process.exit(2); }
  const size = (f) => statSync(join(ROOT, "driver", f)).size;
  const out = {
    stages: map.stages.map((r) => ({ ...r, bytes: bytesOf(ROOT, r.files) })),
    pointedAtOnly: [...map.pointed].sort().map((file) => ({ file, bytes: size(file) })),
    forAReader: [...map.forReader].sort(),
    unread: map.unread.map((file) => ({ file, bytes: size(file) })),
    houseDefault: houseDefaultFigures(ROOT),
  };
  if (process.argv.includes("--stable")) {
    // The rule text each stage's code composes, its largest blocks first: what a move into a manual would carry.
    for (const { stage, blocks } of stableBlocks()) {
      console.log(`${stage}\t${blocks.reduce((a, b) => a + b.bytes, 0)} bytes in ${blocks.length} block(s)`);
      for (const b of blocks.filter((x) => x.bytes >= 200)) console.log(`  line ${b.line}\t${b.bytes}\t${b.head}`);
    }
    return;
  }
  if (process.argv.includes("--json")) { console.log(JSON.stringify(out, null, 2)); return; }
  for (const r of out.stages) console.log(`${r.stage}\t${r.context}\t${r.bytes}\t${r.files.map((f) => f.slice("skills/".length)).join(" ")}`);
  console.log("\nPOINTED AT, NEVER TOLD:");
  for (const r of out.pointedAtOnly) console.log(`  ${r.file} ${r.bytes}`);
  console.log("\nWRITTEN FOR A PERSON:");
  for (const f of out.forAReader) console.log(`  ${f}`);
  console.log("\nREAD BY NOTHING:");
  for (const r of out.unread) console.log(`  ${r.file} ${r.bytes}`);
  console.log("\nHOUSE DEFAULT, BYTES PER STAGE: manuals, composed message, of it the text no run changes, own recording tools");
  for (const r of out.houseDefault) console.log(`  ${r.stage}\t${r.manualBytes}\t${r.messageBytes}\t${r.stableMessageBytes}\t${r.toolSchemaBytes}`);
  const sum = (k) => out.houseDefault.reduce((a, r) => a + r[k], 0);
  console.log(`  all ${out.houseDefault.length} stages\t${sum("manualBytes")}\t${sum("messageBytes")}\t${sum("stableMessageBytes")}\t${sum("toolSchemaBytes")}`);
}

if (isEntrypoint(import.meta.url)) main();
