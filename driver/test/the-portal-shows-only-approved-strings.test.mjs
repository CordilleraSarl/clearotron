// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// the-portal-shows-only-approved-strings.test.mjs — every sentence on a portal screen is one somebody
// approved, and the reader that finds them finds all of them.
//
// Two halves. The EXTRACTOR is held on synthetic sources, one arm per way a line-based reader goes wrong:
// a sentence with a value in it, JSX's whitespace rule, entities, a choice of words inside an expression.
// Measured 2026-09-18: a line-based extractor dropped a sentence that an owner review then found on the
// New clearance screen, because its line carried a brace.
//
// The CHECK refuses any string a list neither approves nor tolerates. The list lives outside this
// repository, with the designs it is checked against, so a string cannot be approved by the change that
// adds it. Without it this file runs the check against a synthetic list and says so; with
// CLEAROTRON_UI_STRINGS pointing at the real one it checks the real tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { stringsIn, portalStrings, sourceFiles, HOLE } from "../../scripts/portal-strings.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "portal-strings.mjs");
const texts = (src, file = "x.tsx") => stringsIn(src, file).map((r) => r.text);

// ── THE EXTRACTOR ───────────────────────────────────────────────────────────────────────────────────

test("a sentence with a value in it is read whole, the value shown as a hole", () => {
  const got = texts(`export const A = ({ n }) => <p>Searching {n} registers <b>right now</b>.</p>`);
  assert.deepEqual(got, [`Searching ${HOLE} registers right now.`],
    "the sentence a reader meets is one string; a reader that skips the braced line loses it whole");
});

test("JSX's whitespace rule is applied: a line break beside a value is not a space", () => {
  const src = "export const A = ({ c }) => (\n  <p>\n    about <b>{c}</b> search variant\n    {c === 1 ? '' : 's'} per pass\n  </p>\n)";
  assert.deepEqual(texts(src), [`about ${HOLE} search variant${HOLE} per pass`],
    "React renders \"variants\"; turning the break into a space would compare a word the reader never sees");
});

test("entities are decoded, as React decodes them", () => {
  assert.deepEqual(texts(`export const A = () => <p title="Background &amp; concerns">This company&rsquo;s framework</p>`).sort(),
    ["Background & concerns", "This company’s framework"]);
});

test("a choice of words inside an expression is read, each choice at any length", () => {
  const got = texts(`export const A = ({ busy }) => <button>{busy ? 'Saving now' : 'Save'}</button>`);
  assert.ok(got.includes("Saving now") && got.includes("Save"), `both words a button can show are read: ${JSON.stringify(got)}`);
});

test("a reader-facing attribute is read at any length; a token handed to one is not", () => {
  const got = texts(`export const A = () => <><input placeholder="Name" aria-label="Names to clear" /><X reason="notFound" /></>`);
  assert.ok(got.includes("Name") && got.includes("Names to clear"), JSON.stringify(got));
  assert.ok(!got.includes("notFound"), "a camelCase token in a reader-facing slot is machinery");
});

test("machinery is not read: class names, comparisons, imports, types, storage keys", () => {
  const got = texts([
    "import thing from 'some module path here'",
    "type Mode = 'queued and waiting' | 'running now'",
    "export const A = ({ s }) => <div className=\"row menu open-state\">{s === 'queued and waiting' ? 1 : 2}</div>",
    "localStorage.setItem('the blur choice key', '1')",
  ].join("\n"));
  assert.deepEqual(got, [], `none of these is a sentence a reader meets: ${JSON.stringify(got)}`);
});

test("prose built in code is read, and a string joined with + is read as one", () => {
  const got = texts(`export const m = (n) => 'That change could not be saved. ' + n + ' fields were refused.'`, "x.ts");
  assert.deepEqual(got, [`That change could not be saved. ${HOLE} fields were refused.`]);
});

test("the real tree is read, and every screen yields strings — a parser that stopped reading would not", () => {
  const rows = portalStrings(ROOT);
  assert.ok(rows.length >= 500, `only ${rows.length} strings read from the portal — the extractor has stopped seeing most of it`);
  const screens = sourceFiles(ROOT).filter((f) => f.startsWith("portal-ui/src/screens/"));
  assert.ok(screens.length >= 10, `only ${screens.length} screen files found — the walk is not reaching portal-ui/src/screens`);
  const silent = screens.filter((f) => !rows.some((r) => r.file === f));
  assert.deepEqual(silent, [], "a screen file yielded no string at all; a screen with no words is a parse that failed quietly");
});

// ── THE CHECK ───────────────────────────────────────────────────────────────────────────────────────

/** A throwaway tree with one screen, and a list; returns the check's exit code and output. */
function runCheck({ screen, list }) {
  const dir = mkdtempSync(join(tmpdir(), "portal-strings-"));
  try {
    mkdirSync(join(dir, "portal-ui", "src", "screens"), { recursive: true });
    writeFileSync(join(dir, "portal-ui", "src", "screens", "A.tsx"), screen);
    const listPath = join(dir, "approved.json");
    if (list !== undefined) writeFileSync(listPath, typeof list === "string" ? list : JSON.stringify(list));
    const r = spawnSync(process.execPath, [SCRIPT, "--check", listPath, "--root", dir], { encoding: "utf8" });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const SCREEN = "export const A = () => <main><h1>Review search</h1><p>A sentence nobody designed.</p></main>\n";

test("a string no list carries is refused, by file and line", () => {
  const r = runCheck({ screen: SCREEN, list: { approved: { "Review search": "boards/B.dc.html" }, pending: {} } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /portal-ui\/src\/screens\/A\.tsx:1\s+text\s+"A sentence nobody designed\."/, r.out);
  assert.doesNotMatch(r.out, /"Review search"/, "an approved string was refused");
});

test("an approved or pending string passes, and a pending string gone from the screens is named", () => {
  const r = runCheck({ screen: SCREEN, list: { approved: { "Review search": "boards/B.dc.html" },
    pending: { "A sentence nobody designed.": "none", "An old one already removed.": "none" } } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no longer on any screen[\s\S]*"An old one already removed\."/, "a stale pending line is not reported");
});

test("a list that cannot be read, or approves nothing, is could-not-look — never a pass", () => {
  assert.equal(runCheck({ screen: SCREEN }).code, 2, "a missing list");
  assert.equal(runCheck({ screen: SCREEN, list: "{ not json" }).code, 2, "a malformed list");
  assert.equal(runCheck({ screen: SCREEN, list: { approved: {}, pending: { "Review search": "x" } } }).code, 2,
    "an empty approved map would refuse nothing it was not told about");
});

test("the real list, when one is given: every string on the portal's screens is approved or pending", () => {
  const path = process.env.CLEAROTRON_UI_STRINGS;
  if (!path) {
    // SAID, not silent: without the list this file has checked the check, not the portal.
    console.error("[repo-guard] ui-strings mode=sentinel — CLEAROTRON_UI_STRINGS unset; the check was proved on a synthetic list");
    return;
  }
  console.error("[repo-guard] ui-strings mode=list");
  const r = spawnSync(process.execPath, [SCRIPT, "--check", path, "--root", ROOT], { encoding: "utf8" });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});
