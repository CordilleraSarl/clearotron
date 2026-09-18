// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE IDENTIFIER SWEEP RUNS HERE, AND ITS ZERO IS EARNED.
//
// The matcher ships on this tree; the table of real names does not and must not. So the sweep runs with
// synthetic sentinels, and the only interesting question is whether it can still fire at all. A sweep
// that has never been shown finding something reports the same clean zero as a sweep whose table is
// empty, whose glob broke, or whose regex stopped matching.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanCorpus, firesOn } from "../../shared/identifier-scan.mjs";
import { SENTINELS, SUFFIXABLE, SENTINEL_MODE_MARKER, TABLE_MODE_MARKER } from "../../shared/identifier-sentinels.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const GUARD = "identifier sweep (synthetic sentinels)";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const opts = { retired: SENTINELS, suffixable: SUFFIXABLE };

test("the sweep FIRES on a planted line — this is what makes the zero below mean anything", () => {
  const planted = new Map([
    ["invented/a.mjs", "// a note naming Vantis Orriden in passing"],
    ["invented/b.md", "Thalvic Reach was the counterparty."],
  ]);
  const hits = scanCorpus([...planted.keys()], (f) => planted.get(f) ?? null, opts);
  assert.equal(hits.length, 2, `the sweep missed a planted sentinel: ${JSON.stringify(hits)}`);
  assert.ok(hits.some((h) => /Vantis Orriden/.test(h)), "a hit must NAME what it matched");
  assert.ok(hits.some((h) => /Northwind Partners/.test(h)),
    "…and the twin, because a hit a writer cannot act on is a hit they will route around");
});

test("the suffixable row fires past its trailing boundary, and the ordinary row does not", () => {
  assert.ok(firesOn("Brindlow", "the Brindlows filing", SUFFIXABLE),
    "the suffixable entry stopped matching past its boundary — the option is declared and not working");
  assert.ok(!firesOn("Thalvic Reach", "the ThalvicReachly filing", SUFFIXABLE),
    "a non-suffixable entry matched inside a longer word, which is how a sweep starts crying wolf");
});

test("CONTROL — a line naming none of them is not a hit", () => {
  const clean = new Map([["invented/c.mjs", "// an ordinary comment about nothing in particular"]]);
  assert.deepEqual(scanCorpus([...clean.keys()], (f) => clean.get(f) ?? null, opts), []);
});

// THE TWO FILES THAT ARE MEANT TO NAME THEM. The table declares the sentinels and this file plants
// them, so both contain every string the sweep looks for. They are exempted by literal path and by
// nothing else: a rule like "skip anything that looks like a fixture" would skip the next real one
// too, and a sweep that flagged its own instrument could never be run at all.
const DECLARES_THEM = [
  "shared/identifier-sentinels.mjs",
  "driver/test/the-identifier-sweep-fires-on-its-sentinels.test.mjs",
];

test("the tracked tree names no sentinel", (ctx) => {
  const files = trackedFiles(GUARD, { root: ROOT });
  if (files === null) return ctx.skip(skipReason(GUARD));
  // WHICH TABLE THIS RAN AGAINST, printed only once the corpus is actually in hand. The affirmative
  // `[repo-guard] ok` above says a guard looked; this says which roster it looked WITH, and the two are
  // different claims — a sweep armed with nothing reports the same zero as one armed with everything.
  // The workflow requires this line across the shard logs, so the arm being deleted or quietly skipped
  // reds rather than passing in silence.
  console.log(SENTINEL_MODE_MARKER);
  // A FLOOR ON THE CORPUS. Zero files swept is the shape in which this arm passes over a tree it never
  // opened, and it reports exactly the same green as a clean one.
  assert.ok(files.length > 100, `only ${files.length} tracked file(s) swept — the corpus is broken, not the tree`);
  // AND THE EXEMPTION IS HELD TO THE TREE, not taken on trust. If either file is renamed or dropped,
  // this fails by name — rather than the exemption quietly covering nothing while the arm reports the
  // same green, which is how a stale allow-list outlives the reason it was written.
  for (const f of DECLARES_THEM) {
    assert.ok(files.includes(f), `${f} is not a tracked file — the sentinel exemption names a path that is gone`);
  }
  const read = (f) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return null; } };
  const swept = files.filter((f) => !DECLARES_THEM.includes(f));
  // AND A FLOOR ON WHAT SURVIVES THE EXEMPTION, not just on what the tree offered. The floor above is
  // measured before the two paths come out; an exemption that grew to cover the tree would pass it and
  // then sweep nothing.
  assert.ok(swept.length > 100,
    `the exemption leaves only ${swept.length} file(s) to sweep — it has grown to cover the tree`);
  assert.deepEqual(scanCorpus(swept, read, opts), [],
    "a synthetic sentinel appears in the tracked tree — it was invented for the two files above and "
    + "should be nowhere else, so either somebody used it as a fixture name or the table has drifted "
    + "into real use");
});

// THIS CONTROL DOES NOT SKIP, AND THAT IS THE POINT OF IT. The arm above skips when the tree cannot be
// listed, and a control that skipped on the same condition would be absent from exactly the run where
// the arm went quiet — reporting the same green as one that checked. Everything below reads the two
// paths directly, so it needs no file listing and runs everywhere the suite does.
test("CONTROL — the exemption is two paths, and both of them really do carry sentinels", () => {
  assert.equal(DECLARES_THEM.length, 2,
    "the sentinel exemption has grown past the table and its own test — every path added here is a file "
    + "the sweep no longer reads, and that is the failure this whole file exists to catch");
  // The exempted files must be the ones that ACTUALLY carry sentinels, not a pair of quiet paths: sweep
  // them alone and the sweep has to fire. Otherwise the exemption is covering something else.
  const read = (f) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return null; } };
  assert.ok(scanCorpus(DECLARES_THEM, read, opts).length > 0,
    "the exempted files name no sentinel — the exemption is pointed at the wrong files, and the ones "
    + "that do carry them are being swept or are gone");
});

test("the sentinel table is not empty, and every row is a pair", () => {
  assert.ok(SENTINELS.length >= 3, `only ${SENTINELS.length} sentinel(s) — an empty table sweeps clean over anything`);
  for (const row of SENTINELS) {
    assert.equal(row.length, 2, `a sentinel row is [name, twin]; got ${JSON.stringify(row)}`);
    assert.ok(row[0].trim() && row[1].trim(), `a sentinel row carries an empty half: ${JSON.stringify(row)}`);
  }
});

// ── AND THE WORKFLOW REQUIRES THE LINE, or none of the above is load-bearing ─────────────────────────
//
// The arm above prints which roster it swept with. That is worth nothing on its own: a marker nobody
// reads can stop being printed — because the arm was deleted, renamed out of the collection glob, or
// quietly skipped — and every run stays green. It is the same argument the workflow already accepts for
// the two `[repo-guard]` markers it does read, and this one had been stated and never read.
//
// Asserted here rather than only in the private tier's own arm, because that tier runs under the overlay
// and this runs on every push. A demand that is only checked where somebody remembers to check it is the
// shape this whole file exists to argue against.
test("the workflow demands the mode line, so the sweep cannot stop running unnoticed", () => {
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert.ok(ci.includes(SENTINEL_MODE_MARKER),
    `.github/workflows/ci.yml does not require "${SENTINEL_MODE_MARKER}". Without that step the arm above `
    + "can stop running and nothing reds — the affirmative marker is only worth what reads it.");
  // AND IT MUST BE REQUIRED, not merely mentioned. A marker named in a comment satisfies a substring
  // test while asserting nothing, which is this defect with an extra step.
  // The quiet flag is bundled with the others (`grep -rqF`), so this matches a q ANYWHERE in the flag
  // cluster rather than a literal `-q`. Written the narrow way first, it failed against a workflow that
  // was correct — a matcher too tight to recognise the thing it guards is a red nobody can act on.
  const demanded = ci.split("\n").some((l) => /grep\s+-[a-zA-Z]*q/.test(l) && l.includes(SENTINEL_MODE_MARKER));
  assert.ok(demanded,
    "the mode line appears in the workflow but nothing requires it — a mention is not an assertion");
});

// THE OTHER DIRECTION. Requiring the sentinel line is satisfied forever by a run that prints it, so the
// workflow must also refuse the table line: on a public runner that line means the private roster was
// loaded into a public log. Driven, not read: the step's own script runs over logs holding each line.
test("the workflow refuses a table-mode line, and passes a sentinel-only run", () => {
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const at = ci.indexOf(`grep -rqF '${SENTINEL_MODE_MARKER}' logs`);
  assert.ok(at >= 0, "the step reading the mode line was not found — this arm could not look");
  const from = ci.lastIndexOf("run: |", at);
  const body = ci.slice(from + "run: |".length).split("\n").slice(1);
  const lines = [];
  for (const l of body) { if (l.trim() && !l.startsWith("          ")) break; lines.push(l.slice(10)); }
  const script = lines.join("\n");
  assert.ok(script.includes(TABLE_MODE_MARKER), "the step does not name the table-mode line");
  const drive = (logLine) => {
    const dir = mkdtempSync(join(tmpdir(), "mode-step-"));
    try {
      // The layout the artifact download leaves: one directory per shard, each holding its suite.log, and
      // every marker the step also reads, so only the mode line differs between the two drives.
      for (const [i, n] of ["1", "2", "3", "4"].entries()) {
        mkdirSync(join(dir, "logs", `suite-log-${n}`), { recursive: true });
        writeFileSync(join(dir, "logs", `suite-log-${n}`, "suite.log"),
          (i === 0 ? ["[repo-guard] ok", SENTINEL_MODE_MARKER, logLine] : ["[repo-guard] ok"]).join("\n"));
      }
      return spawnSync("bash", ["-c", script], { cwd: dir, encoding: "utf8" }).status;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  assert.equal(drive(""), 0, "a run that swept on sentinels only was refused");
  assert.equal(drive(`${TABLE_MODE_MARKER}: 12 sentinel + 40 roster name(s)`), 1, "a run that read the private roster passed");
});
