// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The skeptic's sanctioned read surface — search_run_artifacts. Three properties carry the weight:
//   · SCOPE — the run's own artifact tree and nothing else. Absolute paths, `..` segments, `_driver/`
//     internals and symlink escapes are each refused BY TOKEN, and the symlink case is proved with a
//     real link pointing out of the tree — a scope claim tested only on well-formed input is a scope
//     claim, not a scope.
//   · BOUNDS — matches, line length, term count/length and file size are all capped, so no call can
//     become an unbounded dump. The caps are injectable here so the truncation arm drives real
//     truncation instead of manufacturing a 5MB fixture.
//   · LITERALS — terms are substrings, never regex. The measured greps this tool replaces (O3c:
//     skeptic's 7 Bash reads) were alternations of literal tokens with `-i` and `-n`; a dot in a term
//     must match a dot, and the case-insensitive default matches the measured `-i`.
// A zero is evidence only if the instrument can show non-zero, so the empty-match arm runs beside a
// non-empty match of the same file through the same call shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import { searchRunArtifacts, SEARCH_LIMITS, isPermissionError } from "../skeptic-search.mjs";

/** A run dir with the artifact shapes the measured reads actually targeted. */
function runDir() {
  const d = mkdtempSync(join(tmpdir(), "sks-"));
  writeFileSync(join(d, "register-findings.md"), [
    "# Register findings",
    "row 1: the alpha-mark citation",
    "row 2: BAND_LOOKUP served the frozen record",
    "row 3: nothing of note",
    "row 4: the alpha-mark again, lower in the file",
  ].join("\n") + "\n");
  writeFileSync(join(d, "common-law-findings.md"), [
    "# Common-law findings",
    "channel sweep: delta-market.example was searched",
    "the omega channel was NOT searched",
  ].join("\n") + "\n");
  mkdirSync(driverDir(d), { recursive: true });
  writeFileSync(driverDir(d, "skeptic.jsonl"), "{\"key\":\"prelim-x\"}\n");
  return d;
}

test("a well-formed search answers like grep -n -i: 1-based lines, OR across terms, case-insensitive by default", () => {
  const d = runDir();
  const a = searchRunArtifacts(d, { file: "register-findings.md", terms: ["alpha-mark", "band_lookup"] });
  assert.equal(a.refused, undefined);
  assert.equal(a.file, "register-findings.md");
  assert.deepEqual(a.matches.map((m) => m.line), [2, 3, 5], "line numbers are 1-based and ordered, like grep -n");
  assert.match(a.matches[1].text, /BAND_LOOKUP/, "case-insensitive by default — the measured greps all carried -i");
  assert.equal(a.total_matches, 3);
  assert.equal(a.truncated, false);
  assert.ok(a.lines_scanned >= 5, "the answer says how much was looked at, so a zero is a measured zero");
});

test("case_sensitive: true narrows the same call — the default is a choice, not the only behaviour", () => {
  const d = runDir();
  const a = searchRunArtifacts(d, { file: "register-findings.md", terms: ["band_lookup"], case_sensitive: true });
  assert.deepEqual(a.matches, [], "BAND_LOOKUP must not match a case-sensitive lower-case term");
  const b = searchRunArtifacts(d, { file: "register-findings.md", terms: ["BAND_LOOKUP"], case_sensitive: true });
  assert.deepEqual(b.matches.map((m) => m.line), [3]);
});

test("an empty result is a MEASURED zero, shown beside the same instrument finding non-zero", () => {
  const d = runDir();
  const zero = searchRunArtifacts(d, { file: "common-law-findings.md", terms: ["tmall-like-token-not-present"] });
  assert.equal(zero.refused, undefined, "found-nothing is an answer, not a refusal");
  assert.deepEqual(zero.matches, []);
  assert.equal(zero.total_matches, 0);
  assert.ok(zero.lines_scanned > 0, "the zero names how many lines were scanned — an unread file would be 0 here");
  // …and the same call shape on the same file CAN show non-zero, so the zero above is evidence.
  const nonzero = searchRunArtifacts(d, { file: "common-law-findings.md", terms: ["NOT searched"] });
  assert.equal(nonzero.total_matches, 1);
});

test("terms are LITERAL substrings, never regex — a dot matches a dot and only a dot", () => {
  const d = runDir();
  writeFileSync(join(d, "probe.md"), "line with delta-market.example\nline with delta-marketXexample\n");
  const a = searchRunArtifacts(d, { file: "probe.md", terms: ["delta-market.example"] });
  assert.deepEqual(a.matches.map((m) => m.line), [1],
    "the dot matched the X-line too — the term was compiled as a regex, and the measured `jd\\.com`-shaped tokens would over-match");
});

// ── SCOPE — each refusal by its own token, and the refusal is the answer, never a throw ─────────────

test("an absolute path is refused by token — the run is not the seat's to name", () => {
  const d = runDir();
  const a = searchRunArtifacts(d, { file: join(d, "register-findings.md"), terms: ["x"] });
  assert.match(a.refused, /^search_file_absolute/);
});

test("a `..` segment is refused by token before any filesystem look", () => {
  const d = runDir();
  const a = searchRunArtifacts(d, { file: "../outside.md", terms: ["x"] });
  assert.match(a.refused, /^search_file_traversal/);
  const b = searchRunArtifacts(d, { file: "sub/../../outside.md", terms: ["x"] });
  assert.match(b.refused, /^search_file_traversal/);
});

test("_driver internals are refused by token — driver bookkeeping is not a run artifact", () => {
  const d = runDir();
  const a = searchRunArtifacts(d, { file: "_driver/skeptic.jsonl", terms: ["x"] });
  assert.match(a.refused, /^search_file_driver_internal/);
});

test("a symlink that resolves OUT of the run tree is refused — the scope holds at the resolved path", () => {
  const d = runDir();
  const outside = mkdtempSync(join(tmpdir(), "sks-out-"));
  writeFileSync(join(outside, "secret.md"), "not the run's\n");
  symlinkSync(join(outside, "secret.md"), join(d, "innocent.md"));
  const a = searchRunArtifacts(d, { file: "innocent.md", terms: ["not"] });
  assert.match(a.refused, /^search_file_escapes_run/,
    "a symlink inside the tree reached a file outside it — the input-string checks alone cannot see this");
});

test("a symlink that resolves INTO _driver is refused as driver-internal — the exclusion holds at the resolved path too", () => {
  const d = runDir();
  symlinkSync(driverDir(d, "skeptic.jsonl"), join(d, "alias.md"));
  const a = searchRunArtifacts(d, { file: "alias.md", terms: ["x"] });
  assert.match(a.refused, /^search_file_driver_internal/,
    "the _driver exclusion checked only the input string; a link routed around it");
});

test("a missing file is an ABSENCE with its own token — distinct from a search that found nothing", () => {
  const d = runDir();
  const a = searchRunArtifacts(d, { file: "no-such-artifact.md", terms: ["x"] });
  assert.match(a.refused, /^search_file_not_found/);
  assert.ok(a.refused.includes("no-such-artifact.md"), "the refusal names the file so the seat can correct it");
});

test("a directory is refused by token — a directory read is a listing, which this surface does not serve", () => {
  const d = runDir();
  mkdirSync(join(d, "report-cards"), { recursive: true });
  const a = searchRunArtifacts(d, { file: "report-cards", terms: ["x"] });
  assert.match(a.refused, /^search_file_not_a_file/);
});

test("an unwired run dir refuses rather than guessing — the module holds the contract even called directly", () => {
  const a = searchRunArtifacts("", { file: "register-findings.md", terms: ["x"] });
  assert.match(a.refused, /^search_no_run/);
});

// ── BOUNDS — nothing this tool returns is unbounded ─────────────────────────────────────────────────

test("matches are capped and the truncation is STATED with the remainder counted", () => {
  const d = runDir();
  writeFileSync(join(d, "many.md"), Array.from({ length: 9 }, (_, i) => `hit number ${i}`).join("\n") + "\n");
  const a = searchRunArtifacts(d, { file: "many.md", terms: ["hit"] }, { limits: { ...SEARCH_LIMITS, maxMatches: 3 } });
  assert.equal(a.matches.length, 3);
  assert.equal(a.total_matches, 9);
  assert.equal(a.truncated, true, "a capped answer that does not say so reads as the whole answer");
});

test("a matched line is sliced to the line cap — one long line cannot become the dump the cap exists to stop", () => {
  const d = runDir();
  writeFileSync(join(d, "long.md"), "needle " + "x".repeat(2000) + "\n");
  const a = searchRunArtifacts(d, { file: "long.md", terms: ["needle"] });
  assert.ok(a.matches[0].text.length <= SEARCH_LIMITS.maxLineChars);
});

test("an oversized file is refused by token, naming the cap — refused loudly, not scanned partially", () => {
  const d = runDir();
  writeFileSync(join(d, "big.md"), "0123456789012345678901234567890\n");
  const a = searchRunArtifacts(d, { file: "big.md", terms: ["x"] }, { limits: { ...SEARCH_LIMITS, maxFileBytes: 16 } });
  assert.match(a.refused, /^search_file_too_large/);
});

test("the term list is validated by token: missing, empty, too many, multiline, overlong, non-string", () => {
  const d = runDir();
  assert.match(searchRunArtifacts(d, { file: "register-findings.md" }).refused, /^search_terms_missing/);
  assert.match(searchRunArtifacts(d, { file: "register-findings.md", terms: [] }).refused, /^search_terms_empty/);
  assert.match(searchRunArtifacts(d, { file: "register-findings.md", terms: Array(SEARCH_LIMITS.maxTerms + 1).fill("x") }).refused, /^search_terms_too_many/);
  assert.match(searchRunArtifacts(d, { file: "register-findings.md", terms: ["a\nb"] }).refused, /^search_term_multiline:0/);
  assert.match(searchRunArtifacts(d, { file: "register-findings.md", terms: ["x".repeat(SEARCH_LIMITS.maxTermChars + 1)] }).refused, /^search_term_too_long:0/);
  assert.match(searchRunArtifacts(d, { file: "register-findings.md", terms: [42] }).refused, /^search_term_empty:0/);
  assert.match(searchRunArtifacts(d, { file: 7, terms: ["x"] }).refused, /^search_file_missing/);
});

// ── READ-ONLY BY CONSTRUCTION — pinned at the module's imports ──────────────────────────────────────

// item 3 — THE PIN HAD TWO BLIND SPOTS, and neither would have announced itself.
//
// The scan matched only BRACED `node:fs` imports. Two shapes walked past it:
//
//   · `import fs from "node:fs"` — a default import carries writeFileSync, rmSync, everything. The
//     braced-only pattern sees no named list and simply matches nothing, so the loop that checks each
//     name iterates zero times and the assertion passes.
//   · `node:fs/promises` — a different specifier entirely, with the same write capability on it.
//
// Both are narrow holes rather than a broken instrument: the scan IS non-vacuous today (it asserts it
// found something before checking anything). But "the pattern happens to match what is written now" is
// not the property this test claims, which is that the surface CANNOT write. The evasion shapes are
// planted below so the widening is measured rather than asserted.
const READ_ONLY_FS = ["readFileSync", "realpathSync", "statSync"];

/** Every `node:fs`-family import in a source text, as {specifier, named, isDefault}. */
function fsImportsIn(src) {
  // ANCHORED TO A LINE START, AND NO NEWLINES IN THE CLAUSE. The first draft used /import\s+([^;]+?)/
  // and matched from the word "import" inside a COMMENT thirty lines above the real one, swallowing the
  // whole block as its import clause and reporting the module as taking a default fs import. A scanner
  // that reads prose as code fails in the confident direction — it reported a violation that is not
  // there, and the same looseness would have let a real one hide behind a comment.
  return [...src.matchAll(/^import\s+([^;\n]+?)\s+from\s+"(node:fs(?:\/promises)?)"/gm)].map((m) => {
    const clause = m[1].trim();
    const braced = /^\{([^}]*)\}$/.exec(clause);
    return { specifier: m[2], isDefault: !braced, named: braced ? braced[1].split(",").map((s) => s.trim()).filter(Boolean) : [] };
  });
}

test("the module imports no write capability — read-only is a property of the import list, not a promise", () => {
  const src = readFileSync(new URL("../skeptic-search.mjs", import.meta.url), "utf8");
  const imports = fsImportsIn(src);
  assert.ok(imports.length > 0, "the scan found no node:fs import — it broke; the module certainly reads files");
  for (const imp of imports) {
    assert.equal(imp.specifier, "node:fs",
      `the module imports from ${imp.specifier} — the promises family carries the same write capability, and `
      + "this surface is read-only by construction");
    assert.ok(!imp.isDefault,
      "the module takes a DEFAULT fs import, which carries writeFileSync and everything else. Read-only "
      + "has to be visible in the import list, or this test is checking a shape rather than a property");
    for (const name of imp.named)
      assert.ok(READ_ONLY_FS.includes(name),
        `${name} is imported from node:fs — this surface is read-only by construction and may import nothing that writes`);
  }
  assert.ok(!/node:child_process|node:net|node:http|fetch\(/.test(src),
    "the module reaches for a process or the network — this surface reads the run's own files and does nothing else");
});

test("#1245 the pin CATCHES both evasion shapes — planted, not assumed", () => {
  // A guard whose evasions are never exercised is a guard nobody has measured. These are the two the
  // braced-only pattern used to walk past, and each is asserted to be SEEN now.
  const asDefault = fsImportsIn(`import fs from "node:fs";\n`);
  assert.equal(asDefault.length, 1, "a default fs import is invisible to the scan — the hole is still open");
  assert.equal(asDefault[0].isDefault, true);

  const promises = fsImportsIn(`import { writeFile } from "node:fs/promises";\n`);
  assert.equal(promises.length, 1, "node:fs/promises is invisible to the scan — the hole is still open");
  assert.equal(promises[0].specifier, "node:fs/promises");

  // …and the ordinary shape still parses to its names, so the widening did not cost the original check.
  const braced = fsImportsIn(`import { readFileSync, statSync } from "node:fs";\n`);
  assert.deepEqual(braced[0].named, ["readFileSync", "statSync"]);
});
// ── items 1 and 2 — TWO WAYS THIS SURFACE USED TO MANUFACTURE A FALSE ANSWER ──────────────────

test("#1245 an UNREADABLE artifact is not an absence — the DECISION, checked where the fault cannot be injected", () => {
  // Item 1, the severity leader. Every realpathSync failure answered `search_file_not_found`, whose own
  // text tells the seat "An absence is a finding: say so in your flags if you expected it". So a file
  // the seat could not READ was reported as one that does not EXIST, and the tool then instructed the
  // seat to write that non-existence into a client-facing finding — a privilege fault manufacturing a
  // finding, in the direction of confidence, out of a question nobody answered.
  //
  // CHECKED AS A PURE DECISION, and that is not a convenience. Every container this suite runs in is
  // uid 0, and ROOT READS THROUGH MODE 000: the obvious test chmods a directory, gets a successful read,
  // and asserts nothing at all. I wrote that test first and measured it doing exactly that.
  assert.equal(isPermissionError("EACCES"), true);
  assert.equal(isPermissionError("EPERM"), true);
  for (const code of ["ENOENT", "ENOTDIR", "ELOOP", undefined, null, ""])
    assert.equal(isPermissionError(code), false,
      `${String(code)} means there is nothing at that path — reporting it as unreadable would hide a real absence`);
});

test("#1245 …and the unreadable refusal tells the seat what NOT to conclude", () => {
  // The wording is the fix. A token that merely renames the failure would leave the seat's standing
  // instruction ("an absence is a finding") pointing at a question nobody answered.
  const src = readFileSync(new URL("../skeptic-search.mjs", import.meta.url), "utf8");
  const at = src.indexOf("search_file_unreadable:");
  assert.ok(at > 0, "the unreadable refusal is gone — a permission fault answers as an absence again");
  const line = src.slice(at, src.indexOf("\n", at));
  assert.match(line, /DO NOT treat this as an absence/,
    "the refusal must say what not to conclude, not merely name a different token");
  assert.ok(!/An absence is a finding/.test(line),
    "the unreadable refusal carries the ABSENCE instruction — the defect wearing the new token");
});

test("#1245 the unreadable path is reachable end-to-end where the fault CAN be injected", (ctx) => {
  // The integration half. It is honest about its own limit rather than passing silently: under root the
  // fault cannot be injected, so this SKIPS with a stated reason and shows up in the suite log as a skip
  // rather than as a pass. The decision above is what carries the property everywhere else.
  const d = runDir();
  const locked = join(d, "locked");
  mkdirSync(locked, { recursive: true });
  writeFileSync(join(locked, "secret.md"), "row 1: the alpha-mark citation\n");
  chmodSync(locked, 0o000);
  try {
    const r = searchRunArtifacts(d, { file: "locked/secret.md", terms: ["alpha-mark"] });
    if (!r.refused) return ctx.skip("root reads through mode 000 — the permission fault cannot be injected here");
    assert.match(r.refused, /^search_file_unreadable:/,
      `an unreadable artifact answered ${String(r.refused).slice(0, 60)}`);
  } finally { chmodSync(locked, 0o755); }
});
test("#1245 a NESTED _driver is refused too — the exclusion is not first-segment-only", () => {
  // Item 2. The check read `split(sep)[0]`, so `_driver/` was excluded only at the top. None exists
  // deeper in the tree today, which is exactly why it would never announce itself if one appeared —
  // so one is planted rather than trusted not to exist.
  const d = runDir();
  const nested = driverDir(join(d, "artifacts"));
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "notes.md"), "row 1: the alpha-mark citation\n");
  const r = searchRunArtifacts(d, { file: "artifacts/_driver/notes.md", terms: ["alpha-mark"] });
  assert.match(String(r.refused), /^search_file_driver_internal:/,
    "a nested _driver/ was searchable — the driver's own bookkeeping is the driver's wherever it sits");
});

test("#1245 …and an ordinary path containing the word driver is still searchable", () => {
  // The control for the widening. `includes("_driver")` is over SEGMENTS, not over the string, so a
  // directory merely named `my_driver_notes` must not be caught — a widened guard that over-refuses
  // costs the seat evidence it is entitled to, silently.
  const d = runDir();
  mkdirSync(join(d, "driver-notes"), { recursive: true });
  writeFileSync(join(d, "driver-notes", "x.md"), "row 1: the alpha-mark citation\n");
  const r = searchRunArtifacts(d, { file: "driver-notes/x.md", terms: ["alpha-mark"] });
  assert.equal(r.refused, undefined, `an ordinary path was refused: ${String(r.refused).slice(0, 80)}`);
  assert.equal(r.total_matches, 1);
});
