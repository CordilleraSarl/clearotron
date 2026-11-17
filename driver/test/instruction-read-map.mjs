#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHICH MANUAL DOES WHICH STAGE READ, AND WHICH MANUAL DOES NOTHING READ.
//
//   node driver/test/instruction-read-map.mjs          the map, for a person
//   node driver/test/instruction-read-map.mjs --json   the same, as JSON
//
// Every file under `driver/skills/` is prompt payload, and a stage reads only the files its message names.
// So the map is composed the way a stage is composed: the opening messages come from the same composition
// the driver runs (model-stage-dispatches.mjs), under the house default, a matter in the pharma class and
// every profile in the tree. What is computed outside a message is added from where the driver computes it:
// the provider decks from PROVIDERS, the knockout lane's framework deck from the profile, the what-if memo's
// manual from its own dispatch.
//
// Not a test file. The checks that fail on it are in every-manual-is-read-and-names-what-exists.test.mjs.
import { existsSync, readFileSync, statSync } from "node:fs";
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
import { DRIVER, everyDispatchedLabel, everyModelStageDispatch } from "./model-stage-dispatches.mjs";

const ROOT = join(DRIVER, "..");
const RUN = "/nonexistent/read-map";
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

function main() {
  const map = readMap(ROOT);
  if (map === null) { console.error(`${GUARD}: no checkout to read the manuals from`); process.exit(2); }
  const size = (f) => statSync(join(ROOT, "driver", f)).size;
  const out = {
    stages: map.stages.map((r) => ({ ...r, bytes: bytesOf(ROOT, r.files) })),
    pointedAtOnly: [...map.pointed].sort().map((file) => ({ file, bytes: size(file) })),
    forAReader: [...map.forReader].sort(),
    unread: map.unread.map((file) => ({ file, bytes: size(file) })),
  };
  if (process.argv.includes("--json")) { console.log(JSON.stringify(out, null, 2)); return; }
  for (const r of out.stages) console.log(`${r.stage}\t${r.context}\t${r.bytes}\t${r.files.map((f) => f.slice("skills/".length)).join(" ")}`);
  console.log("\nPOINTED AT, NEVER TOLD:");
  for (const r of out.pointedAtOnly) console.log(`  ${r.file} ${r.bytes}`);
  console.log("\nWRITTEN FOR A PERSON:");
  for (const f of out.forAReader) console.log(`  ${f}`);
  console.log("\nREAD BY NOTHING:");
  for (const r of out.unread) console.log(`  ${r.file} ${r.bytes}`);
}

if (isEntrypoint(import.meta.url)) main();
