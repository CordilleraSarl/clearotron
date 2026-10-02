// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NO MANUAL AND NO STAGE MESSAGE NAMES A STEP THAT NO LONGER RUNS.
//
// Step 3's two model stages, placement and the register digest, were replaced by the judges, and with them
// their manuals, their files, their tools and the presence reconciliation. The owner ruled that every
// mention leaves what the engine's models read, with nothing written in its place (2026-10-01). A mention
// left behind tells a stage about a step it cannot reach, or sends it to read a file no run writes.
//
// THE POPULATION IS THE TREE, NOT A LIST: every file under driver/skills, and every stage's real message
// built from a generic context. A floor on each says the walk reached something.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGES } from "../stages.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(DRIVER, "skills");

// The removed steps by name, their files, their tools and their modes. Specific on purpose: the words
// "digest" and "placement" stay live elsewhere (a register unit's own digest note, where a card is placed).
const REMOVED = /placement-inquiry|register-digest|register-findings\.(?:md|json)|placement-recommendations|placements\.json|\bdigest\.md\b|presence[- ]reconciliation|record_register_digest|\brecord_coverage\b(?!_status)|Digest mode|Touchpoint 2/i;

// The frame-diff manual leaves whole when the mid-run reopening is removed (tracker work on the same line);
// until then it is the one manual this walk does not hold.
const LEAVES_WHOLE = new Set(["frame-diff/SKILL.md"]);

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

test("no manual the engine's models can read names a removed step, its file or its tool", () => {
  const files = walk(SKILLS).filter((p) => p.endsWith(".md")).filter((p) => !LEAVES_WHOLE.has(relative(SKILLS, p)));
  assert.ok(files.length >= 20, `the walk found ${files.length} manuals — the instrument reached nothing`);
  const hits = [];
  for (const p of files) {
    readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (REMOVED.test(line)) hits.push(`${relative(DRIVER, p)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, [], `manuals still name a removed step:\n${hits.join("\n")}`);
});

test("no stage's message names a removed step, its file or its tool", () => {
  const paths = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `<${k}>` : undefined) });
  const ctx = { paths, axes: [], intakeAsks: [], openDoubts: [], openAsks: [], registerOnly: false, framework: null,
    job: { mark: "VELTRIN", classes: [9], territories: ["CH"] }, profile: { key: "demo" }, run: { slug: "s", codename: "c" } };
  let built = 0;
  const hits = [];
  for (const [key, def] of Object.entries(STAGES)) {
    if (typeof def?.message !== "function") continue;
    let text;
    try { text = String(def.message(ctx)); } catch { continue; }
    built++;
    const m = text.match(REMOVED);
    if (m) hits.push(`${key}: …${text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, " ")}…`);
  }
  assert.ok(built >= 10, `only ${built} stage messages were built — the instrument reached nothing`);
  assert.deepEqual(hits, [], `stage messages still name a removed step:\n${hits.join("\n")}`);
});
