// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE DEMO SAYS WHAT IT IS BEFORE ANYTHING ELSE.
//
// Measured on the published beta, 2026-09-19: after the two-line header, the first thing
// `clearotron demo --no-open --once` printed was the publisher's own tallies (`[record-links] …`,
// `knockout receipts: …`) and Node's warning that SQLite is experimental. The sentence saying the report is
// real engine output for a fictional mark came after them. And the knockout sample's line read "0 finding(s)
// with citations traced…", which a stranger takes as "the demo found nothing".
//
// Driven the way a reader runs it, through the launcher, into a folder of its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function demo(entry, args) {
  const home = mkdtempSync(join(tmpdir(), "demo-first-"));
  const base = join(home, "demo");
  const env = { PATH: process.env.PATH, HOME: home, CLEAROTRON_NO_ENV_FILE: "1" };
  const r = spawnSync(process.execPath, [join(ROOT, entry), ...args, "--no-open", "--once", "--base", base], { encoding: "utf8", env });
  let log = null;
  try { log = readFileSync(join(base, "replay.log"), "utf8"); } catch { /* read below as an absence */ }
  rmSync(home, { recursive: true, force: true });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, log };
}

test("the first screen is the header and the sentence saying what the demo is, and no diagnostics", () => {
  const { status, out, log } = demo("bin/clearotron.mjs", ["demo"]);
  assert.equal(status, 0, out);
  const head = out.split("\n").slice(0, 8).join("\n");
  assert.match(head, /— demo\n/, `the header is not first:\n${head}`);
  assert.match(head, /Real engine output for the fictional mark VENQORI[\s\S]*It is an example, not advice\./,
    `the sentence saying what the demo is is not in the first eight lines:\n${head}`);
  for (const noise of [/\[record-links\]/, /knockout receipts:/, /ExperimentalWarning/])
    assert.doesNotMatch(out, noise, `${noise} reached the reader's screen`);
  // THE DIAGNOSTICS WENT SOMEWHERE, which is the difference between moving them and losing them.
  assert.ok(log, "no replay.log in the demo's folder, so the diagnostics were dropped rather than moved");
  assert.match(log, /\[record-links\]/);
  assert.match(log, /knockout receipts:/);
  // And through the launcher, Node's warning is not raised at all.
  assert.doesNotMatch(log, /ExperimentalWarning/, "the launcher did not switch Node's experimental warning off for the demo");
});

test("run without the launcher, the warning is raised and lands in the log — so the check above can see it", () => {
  // THE CONTROL. `bin/example.mjs` run directly gets no flag from the launcher, so Node raises the warning;
  // the replay still keeps it off the screen. If this stops finding the warning, the arm above proves nothing.
  const { status, out, log } = demo("bin/example.mjs", []);
  assert.equal(status, 0, out);
  assert.doesNotMatch(out, /ExperimentalWarning/, "the warning reached the screen on a direct run");
  assert.match(log ?? "", /ExperimentalWarning/, "Node raised no warning at all, so this arm cannot tell the flag works");
});

test("every published line has one shape, and the knockout line says what was screened and how it was rated", () => {
  const { status, out } = demo("bin/clearotron.mjs", ["demo"]);
  assert.equal(status, 0, out);
  const lines = [...out.matchAll(/published: \S+\n\s+(\S+) — ([\s\S]*?)(?=\n {2}published:|\n\n)/g)].map((m) => ({ name: m[1], text: m[2].replace(/\s+/g, " ") }));
  assert.equal(lines.length, 4, `expected four published lines:\n${out}`);
  for (const l of lines) assert.match(l.text, /^\d+ .+; the report shows .+$/, `${l.name} breaks the shape: ${l.text}`);
  assert.equal(lines.find((l) => l.name === "knockout-search")?.text, "1 name screened: VENQORI, rated Low; the report shows why");
  assert.doesNotMatch(out, /with citations traced/, "the knockout line still counts citations it never has");
});
