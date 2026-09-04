// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE ORDER AND THE SCHEMA MUST BE ABLE TO AGREE.
//
// A fourth direction for the agreement guard. checks that a stage's orders name tools the stage is
// GRANTED; this file checks that they name FIELDS the tool can EXPRESS. The two are not the same question
// and the gap between them cost a delivered report.
//
// THE MEASURED FAILURE, on the 2026-08-27 R2 run. All three repair composers instruct the synthesis
// seat, verbatim, to "send the correction with `record_synthesis`: a PATCH call carrying `findings_patch`
// … and nothing else". The tool's own schema said:
//
//     required: ["narrative", "findings"],
//     properties: { narrative: {...}, findings: {...} }        // no findings_patch
//
// Both halves required, no patch field. And the transport detects a patch by exactly the absence the
// schema forbade — `received.findings === undefined || received.narrative === undefined` — so NO
// SCHEMA-CONFORMING CALL COULD EVER BE ONE. `mergeSynthesisPatch` was unreachable in production: the
// ordinal replacement, the carry-through, the whole "what you do not name comes back byte-identical"
// promise the prompt makes.
//
// `findings` is the only object in that schema with no declared properties, so it is the one place an
// undeclared key rides while still conforming. The key went inside it, the call therefore carried both
// halves, the merge never ran, and the parser refused `findings_key_unknown:findings_patch`. The seat
// complied the only way left — a whole document holding the four findings it had corrected. Fifteen went,
// and it validated, so nothing downstream fired.
//
// EVERY ARM BELOW READS THE SERVER'S SOURCE TEXT rather than importing it, because `serve({...})` runs at
// module scope and importing starts a server. That is the sibling guards' established shape, not a
// shortcut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeSynthesisPatch, recordSynthesis, synthesisCallPaths, FINDINGS_FILE } from "../synthesis-record.mjs";

const SERVER = fileURLToPath(new URL("../engine/mcp/recording-server.mjs", import.meta.url));
const COMPOSERS = fileURLToPath(new URL("../repair-composers.mjs", import.meta.url));
const MODEL = fileURLToPath(new URL("../findings-model.mjs", import.meta.url));

/** The `record_synthesis` tool block, from `name:` to the next tool's `name:`. */
function synthesisToolBlock() {
  const src = readFileSync(SERVER, "utf8");
  const at = src.indexOf('name: "record_synthesis"');
  assert.notEqual(at, -1, "record_synthesis is not registered on the recording server — that is a finding");
  const next = src.indexOf("\n    name: \"", at + 10);
  // COMMENT LINES STRIPPED, and this is not tidiness. The first cut of this scan read the block WITH its
  // comments and found `required: ["narrative", "findings"]` — inside the comment that documents having
  // REMOVED it. The arm failed against the fixed tree and would have passed against a tree where somebody
  // deleted the comment and left the code. A guard that reads its own prose is measuring the wrong file.
  return src.slice(at, next === -1 ? src.length : next)
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
}

/** The findings document's own top-level registers, read from the model rather than restated here. */
function findingsTopKeys() {
  const src = readFileSync(MODEL, "utf8");
  // THE WHOLE LADDER, NOT THE BASE LIST. `const TOP_KEYS` is v3's; the registers a repair rung may
  // legitimately patch are spread across `TOP_KEYS_V4` (`rated_under_framework`) and `TOP_KEYS_V5`
  // (`ask_answers`, `four_answers`), each declared as a spread of the one below it. Reading only the base
  // reported `ask_answers` as unexpressible when it has been a top-level register since v5 — a false
  // refusal, and the kind that gets a real guard turned off.
  const decls = [...src.matchAll(/const TOP_KEYS(?:_V\d)? = \[([\s\S]*?)\]/g)];
  assert.ok(decls.length >= 2, `findings-model.mjs declares ${decls.length} TOP_KEYS list(s) — this scan `
    + "expects the version ladder, and finding fewer means it is reading a shape that has changed");
  const names = new Set();
  for (const d of decls) {
    for (const q of d[1].matchAll(/["']([a-z_][a-z0-9_]*)["']/g)) names.add(q[1]);
  }
  return [...names];
}

test("#1955 the schema can EXPRESS the call the repair prompts order", () => {
  const block = synthesisToolBlock();

  // 1. THE FIELD EXISTS. Ordering a field the tool cannot carry is an instruction with no mechanism.
  assert.match(block, /findings_patch:\s*\{/,
    "the repair composers order `findings_patch` and the schema must declare it — an order for a field "
    + "the tool cannot express is the defect that lost fifteen findings");

  // 2. BOTH HALVES ARE NOT REQUIRED. This is the half that actually blocked it: a patch is DETECTED by
  //    the absence of one of them, so requiring both makes the patch path unreachable however well the
  //    field is declared. Declaring the field and leaving `required` alone would read as a fix and be none.
  const required = /required:\s*\[([^\]]*)\]/.exec(block);
  if (required) {
    const names = required[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean);
    assert.ok(!(names.includes("narrative") && names.includes("findings")),
      `the tool requires ${JSON.stringify(names)} — requiring both halves makes a patch impossible to send, `
      + "because the transport detects a patch by one of them being absent");
  }
});

test("#1955 every record_synthesis field the repair composers ORDER is a field the tool declares", () => {
  // THE GENERAL DIRECTION, narrowly derived. Only backticked snake_case identifiers inside a composer
  // string that also names `record_synthesis` — not every backticked token in the file, which would sweep
  // up file names, tokens and prose and produce the false-positive pile a prose gate always produces.
  const src = readFileSync(COMPOSERS, "utf8");
  const block = synthesisToolBlock();
  // BOTH QUOTING CONVENTIONS, because the composers use both and a scan that knew only one found NOTHING
  // on its first run — every backtick in these template literals is ESCAPED (`\`findings_patch\``), so a
  // pattern anchored on a bare backtick matches none of the seven lines that name the tool. And three
  // rungs order their field in double quotes ("actions", "ask_answers") rather than backticks at all.
  const ordered = new Set();
  for (const line of src.split("\n")) {
    if (!line.includes("record_synthesis")) continue;
    for (const m of line.matchAll(/\\?`([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\\?`/g)) ordered.add(m[1]);
    for (const m of line.matchAll(/carrying only \\?"([a-z][a-z0-9_]*)\\?"/g)) ordered.add(m[1]);
  }
  ordered.delete("record_synthesis");
  // AN EMPTY POPULATION IS THE FINDING, NOT THE PASS. If the composers stop naming the tool, or the
  // backtick convention changes, this arm finds nothing and its silence would read as agreement.
  assert.ok(ordered.size > 0,
    "no ordered field names were extracted from the repair composers — the scan found nothing, which is "
    + "a failure to look rather than a clean result");
  // EXPRESSIBLE MEANS ONE OF TWO THINGS, and both are legitimate. Either the tool declares the field as a
  // top-level property, or it is a register of the findings DOCUMENT — which `mergeSynthesisPatch` copies
  // through from the top level of a patch on purpose, so "a PATCH call carrying only `actions`" is a real
  // shape. What is NOT legitimate is a field that is neither, which is a prompt ordering something the
  // contract cannot carry in either direction.
  const topKeys = new Set(findingsTopKeys());
  const undeclared = [...ordered]
    .filter((f) => !new RegExp(`\\b${f}:`).test(block) && !topKeys.has(f));
  assert.deepEqual(undeclared, [],
    `the repair prompts order field(s) the record_synthesis contract cannot express: ${undeclared.join(", ")}`);
});

// ── ARMS 3–5 PASS AGAINST THE UNFIXED TREE, AND THAT IS THE FINDING, NOT A WEAKNESS ──────────────────
//
// Measured: arms 1 and 2 are red on `origin/main` and green here. These three are green BOTH WAYS,
// because `mergeSynthesisPatch` was never wrong — it was UNREACHABLE. Every promise below held perfectly
// for a call that no schema-conforming seat could make.
//
// They are kept as characterization, not regression, and the distinction is stated so nobody later reads
// "five green arms" as five things this commit fixed. What they pin is the behaviour the schema change
// makes reachable: if a future edit breaks the merge, the repair path silently returns to resending whole
// documents, which is the shape that lost fifteen findings.
test("#1955 a patch merges by ordinal and carries every key it does not name", () => {
  // THE PROMISE THE PROMPT MAKES, asserted rather than trusted: "what you do not name comes back
  // byte-identical". This is what was unreachable.
  const stored = {
    narrative: { spine: "the original spine", verdict: "the original verdict" },
    findings: {
      schema_version: 7, rated_under_framework: "fw-1",
      findings: [{ ordinal: 1, mark: "ALPHA" }, { ordinal: 2, mark: "BETA" }, { ordinal: 3, mark: "GAMMA" }],
      coverage: [{ area: "CH", state: "confirmed-clean" }],
      corrections: { applied: false },
    },
  };
  const r = mergeSynthesisPatch(stored, { findings_patch: [{ ordinal: 2, mark: "BETA", fixed: true }] });
  assert.equal(r.ok, true, `a well-formed patch must merge: ${r.reason ?? ""}`);

  // NOTHING WAS LOST. This is the whole point — the failure being fixed removed fifteen findings.
  assert.equal(r.merged.findings.findings.length, 3, "a patch must not change how many findings there are");
  assert.deepEqual(r.merged.findings.findings.map((f) => f.mark), ["ALPHA", "BETA", "GAMMA"]);
  assert.equal(r.merged.findings.findings[1].fixed, true, "the named ordinal is the one replaced");
  assert.equal(r.merged.findings.rated_under_framework, "fw-1", "an unnamed key comes back byte-identical");
  assert.deepEqual(r.merged.findings.coverage, stored.findings.coverage, "and so does an unnamed register");
  assert.equal(r.merged.narrative.spine, "the original spine", "and the narrative the patch did not touch");

  // AND `findings_patch` DOES NOT SURVIVE INTO THE DOCUMENT. If it did, the parser would refuse the merged
  // record for an unknown top-level key — which is the exact refusal this run produced.
  assert.equal(r.merged.findings.findings_patch, undefined,
    "the merge must consume `findings_patch`, or the rendered document carries a key the parser refuses");
});

test("#1955 a FIRST call still cannot patch, and it is refused by name", () => {
  // Relaxing `required` does not open a door: a patch with nothing to patch is refused against the run's
  // own accepted-call record, which is older than this change and is why the schema could be relaxed.
  const r = mergeSynthesisPatch(null, { findings_patch: [{ ordinal: 1, mark: "ALPHA" }] });
  assert.equal(r.ok, false, "a patch with no stored base must be refused");
  assert.match(r.reason, /synthesis_patch_without_base/);
});

test("#1955 a patch cannot express a deletion at all", () => {
  // WHY THE SCHEMA FIX IS THE PRIMARY AND THE GUARDS ARE THE BACKSTOP. An ordinal names a finding to
  // REPLACE. There is no shape here that removes one, so once the correction is expressible this run's
  // loss is structurally impossible rather than merely detected.
  const stored = { narrative: { spine: "s", verdict: "v" },
    findings: { schema_version: 7, findings: [{ ordinal: 1, mark: "ALPHA" }, { ordinal: 2, mark: "BETA" }] } };
  for (const [what, patch] of [
    ["an empty patch array", { findings_patch: [] }],
    ["a patch naming one of two", { findings_patch: [{ ordinal: 1, mark: "ALPHA", fixed: true }] }],
  ]) {
    const r = mergeSynthesisPatch(stored, patch);
    assert.equal(r.ok, true, `${what} must merge`);
    assert.equal(r.merged.findings.findings.length, 2, `${what} must leave both findings standing`);
  }
  // An ordinal nobody holds is refused rather than appended — a patch is a correction, not a way in.
  const bad = mergeSynthesisPatch(stored, { findings_patch: [{ ordinal: 99, mark: "OMEGA" }] });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /synthesis_patch_ordinal_unknown:99/);
});

// ── THE WHOLE PATH, NOT THE MERGE IN ISOLATION ───────────────────────────────────────────────────────
//
// Every arm above tests `mergeSynthesisPatch` on its own or reads the schema as text. None of them proves
// that a patch-shaped call survives the path that actually failed in production:
//
//   recordSynthesis → isPatch → mergeSynthesisPatch → acceptSynthesis → both files written
//
// That distinction is not academic. `acceptSynthesis` re-renders the merged document and runs it back
// through the shipped parser, so a merge that is correct in isolation can still be refused there — for a
// coverage join, the narrative floor, a per-finding contract. Declaring the field in the schema and
// discovering afterwards that the validator refuses the merged result would be a fix that changes the
// refusal token and nothing else.
//
// GREEN BOTH WAYS, DELIBERATELY, and the reason is worth stating: the schema lives at the MCP boundary
// and `recordSynthesis` never enforced it, so this arm can reach the patch path on either tree. It is not
// a regression arm for this commit. It is the answer to "and does the document that comes out the far end
// actually validate" — measured, yes, with every finding intact.
test("#1955 a patch call survives recordSynthesis end to end and lands every finding on disk", () => {
  const runDir = mkdtempSync(join(tmpdir(), "synthesis-patch-"));
  const { dir, accepted } = synthesisCallPaths(runDir);
  mkdirSync(dir, { recursive: true });

  const meter = (token) => ({ token, basis: "verified-from-record" });
  const finding = (ordinal, mark) => ({
    ordinal, mark,
    owner: { name: `Owner ${mark}`, country: "US", registrations: [] },
    disposition: "off-field", off_field_ground: "different-field",
    meters: { mark_similarity: meter("low"), goods_proximity: meter("low"), use: meter("unknown"), enforcer: meter("unknown") },
    quadrant: { x: 1, y: 1 },
    source: { source_type: "register-euipo", resolved_link: "https://example.invalid/r" },
    legal_position: "No shared dominant element and no proximity under the framework definitions.",
    practical_position: "No commercial overlap in the searched channels and no enforcement history.",
    net: "No conflict, because the goods sit in an unrelated field.",
  });
  const stored = {
    narrative: {
      spine: "A spine long enough to clear the three-hundred character floor the validator applies. ".repeat(5),
      verdict: "A verdict that states what these findings together mean for this client. ".repeat(4),
    },
    findings: {
      schema_version: 7, rated_under_framework: "fw-test",
      findings: [finding(1, "ALPHA"), finding(2, "BETA"), finding(3, "GAMMA")],
      coverage: [{ area: "CH", state: "not-searched", note: "n" }],
    },
  };
  // The merge base is the run's own accepted-call record, which is what `lastAcceptedCall` reads.
  writeFileSync(accepted, JSON.stringify({ params: stored }, null, 2));

  const corrected = { ...finding(2, "BETA"), net: "CORRECTED net clause, because the patch replaced this row." };
  const r = recordSynthesis(runDir, { findings_patch: [corrected] });

  assert.equal(r.refused ?? null, null, `the patch was refused end to end: ${r.refused}`);
  assert.ok(r.written, "a patch that merges must WRITE — a merge that validates and stores nothing is not a repair");

  // THE FILE ON DISK, not the return value. This is the artifact the rest of the run reads.
  const doc = JSON.parse(readFileSync(join(runDir, FINDINGS_FILE), "utf8"));
  assert.equal(doc.findings.length, 3,
    `the corrective pass wrote ${doc.findings.length} findings where 3 were held — this is the exact shape `
    + "that delivered a report with fifteen findings missing");
  assert.deepEqual(doc.findings.map((f) => f.mark), ["ALPHA", "BETA", "GAMMA"], "and in their original order");
  assert.match(doc.findings.find((f) => f.ordinal === 2).net, /^CORRECTED/, "the named row is the one that changed");
  assert.match(doc.findings.find((f) => f.ordinal === 1).net, /^No conflict/, "and the rows it did not name are untouched");
  assert.equal(doc.rated_under_framework, "fw-test", "an unnamed top-level register comes back byte-identical");
});
