// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// engine-pins.mjs — the engine pins a tree carries: the models the Codex engine asks for, and the program
// each engine runs, with the oldest version it accepts.
//
//   node scripts/engine-pins.mjs                # the tree this script sits in
//   node scripts/engine-pins.mjs --root <dir>   # another tree, judged by this script's rule
//
// WHY IT EXISTS. A change to a model or to an engine program's floor changes what a clearance reads and
// writes, while every test of the code around it stays green. Such a change asks for a replay of saved
// cases before the beta that carries it is cut. This is the one definition of "such a change": the push
// workflow compares a commit with its parent by it, the cut compares the last published version with
// main by it, and the replay reads it to see which engine moved. A second copy of the rule would drift.
//
// WHAT COUNTS. The three Codex model defaults in driver/engine/openai-agent.mjs (JUDGMENT, SWEEP and
// CHEAP), and the `package` and `floor` of both entries in ENGINE_BINARIES in driver/driver.config.mjs.
// The Claude engine asks for a tier by name and its program resolves it, so for Claude the program's
// floor IS the model choice. Values are parsed, not lines: an edited comment or a moved line is not a
// change. Left out on purpose: the tier each stage asks for, and anything a box's settings override.
//
// IT NEVER READS THE ENVIRONMENT. Each model default sits behind a setting that overrides it on a box;
// this reports the source's default, so two machines with different settings print the same pins for one
// tree. Judging an older tree with --root applies THIS script's rule to it, which is how a tree from
// before this script existed still gets an answer.
//
// OUTPUT: one line of JSON, keys sorted at every level, no spaces:
//   {"digest":"sha256:<hex>","pins":{"anthropic-agent":{"floor","package"},"openai-agent":{"floor","models":{"cheap","judgment","sweep"},"package"}},"schema":1}
// `digest` is the sha256 of `pins` alone in that same form, so equal digests are equal pins; `schema`
// sits outside it, so a change of format never reads as a change of pins.
//
// Exit 0: printed. Exit 2: could not look — a file missing, or a value not found exactly once. The reason
// goes to stderr and nothing to stdout, because a partial answer compared as a whole reads as a change or,
// worse, as none.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

export const SCHEMA = 1;
const MODELS_FILE = "driver/engine/openai-agent.mjs";
const BINARIES_FILE = "driver/driver.config.mjs";
const ENGINES = ["anthropic-agent", "openai-agent"];
const CODEX_MODELS = { judgment: "JUDGMENT", sweep: "SWEEP", cheap: "CHEAP" };

class CouldNotLook extends Error {}

/** Exactly one match of `re` in `text`, or could-not-look naming `what`. */
function one(text, re, what) {
  const found = [...text.matchAll(re)];
  if (found.length !== 1) throw new CouldNotLook(`${what}: found ${found.length} time(s), expected exactly 1`);
  return found[0];
}

/** The source with whole-line comments removed, so a commented-out value is not a value. */
const code = (text) => text.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

function read(root, rel) {
  try { return readFileSync(join(root, rel), "utf8"); }
  catch (e) { throw new CouldNotLook(`${rel}: ${e.code ?? e.message}`); }
}

/** The pins of the tree at `root`. Throws CouldNotLook when any value cannot be read exactly once. */
export function readPins(root) {
  const models = code(read(root, MODELS_FILE));
  const codex = {};
  for (const [key, name] of Object.entries(CODEX_MODELS)) {
    const re = new RegExp(`^const ${name}\\s*=\\s*process\\.env\\.CLEAROTRON_OPENAI_MODEL_${name}\\s*\\|\\|\\s*"([^"]+)"\\s*;`, "gm");
    codex[key] = one(models, re, `${MODELS_FILE} ${name}`)[1];
  }
  const binaries = code(read(root, BINARIES_FILE));
  const table = one(binaries, /^export const ENGINE_BINARIES = \{\n([\s\S]*?)^\};/gm, `${BINARIES_FILE} ENGINE_BINARIES`)[1];
  const pins = {};
  for (const engine of ENGINES) {
    const start = one(table, new RegExp(`^ {2}"${engine}":\\s*\\{`, "gm"), `${BINARIES_FILE} ${engine}`).index;
    const rest = table.slice(start + 1);
    const next = rest.search(/^ {2}"[a-z-]+":\s*\{/m);
    const entry = next === -1 ? rest : rest.slice(0, next);
    pins[engine] = {
      package: one(entry, /\bpackage:\s*"([^"]+)"/g, `${BINARIES_FILE} ${engine} package`)[1],
      floor: one(entry, /\bfloor:\s*"([^"]+)"/g, `${BINARIES_FILE} ${engine} floor`)[1],
    };
  }
  pins["openai-agent"].models = codex;
  return pins;
}

/** JSON with keys sorted at every level and no whitespace: one value, one string. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

export function pinState(root) {
  const pins = readPins(root);
  return { digest: `sha256:${createHash("sha256").update(canonical(pins)).digest("hex")}`, pins, schema: SCHEMA };
}

if (isEntrypoint(import.meta.url)) {
  const args = process.argv.slice(2);
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  if (args.length === 2 && args[0] === "--root") root = resolve(args[1]);
  else if (args.length) {
    process.stderr.write("usage: node scripts/engine-pins.mjs [--root <dir>]\n");
    process.exit(2);
  }
  try {
    process.stdout.write(`${canonical(pinState(root))}\n`);
  } catch (e) {
    if (!(e instanceof CouldNotLook)) throw e;
    process.stderr.write(`engine-pins: could not look — ${e.message}\n`);
    process.exit(2);
  }
}
