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
// The CHECK refuses any string that is neither approved nor in the committed backlog. The approved list
// lives outside this repository, with the designs it is checked against, so a string cannot be approved
// by the change that adds it; the backlog lives here and may only shrink. Without the approved list this
// file runs the check on a synthetic one and says so; with CLEAROTRON_UI_STRINGS it checks the real tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { stringsIn, portalStrings, sourceFiles, backlogFrom, HOLE, BACKLOG, htmlSentences, serverPageStrings, SERVER_PAGES } from "../../scripts/portal-strings.mjs";

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

/** A throwaway tree with one screen, a backlog and an approved list; returns the check's exit and output. */
function runCheck({ screen, approved, backlog = {}, server = null }) {
  const dir = mkdtempSync(join(tmpdir(), "portal-strings-"));
  try {
    mkdirSync(join(dir, "portal-ui", "src", "screens"), { recursive: true });
    writeFileSync(join(dir, "portal-ui", "src", "screens", "A.tsx"), screen);
    if (server !== null) { mkdirSync(join(dir, "driver")); writeFileSync(join(dir, SERVER_PAGES), server); }
    if (backlog !== null) writeFileSync(join(dir, BACKLOG), JSON.stringify({ backlog }));
    const listPath = join(dir, "approved.json");
    if (approved !== undefined) writeFileSync(listPath, typeof approved === "string" ? approved : JSON.stringify({ approved }));
    const r = spawnSync(process.execPath, [SCRIPT, "--check", listPath, "--root", dir], { encoding: "utf8" });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const SCREEN = "export const A = () => <main><h1>Review search</h1><p>A sentence nobody designed.</p></main>\n";
const APPROVED = { "Review search": "boards/B.dc.html" };

test("a string neither list carries is refused, by file and line", () => {
  const r = runCheck({ screen: SCREEN, approved: APPROVED });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /portal-ui\/src\/screens\/A\.tsx:1\s+text\s+"A sentence nobody designed\."/, r.out);
  assert.doesNotMatch(r.out, /\s"Review search"/, "an approved string was refused");
});

test("a backlog string passes, and a backlog line no screen shows is named for deletion", () => {
  const r = runCheck({ screen: SCREEN, approved: APPROVED,
    backlog: { "A sentence nobody designed.": "none", "An old one already removed.": "none" } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no screen shows any more[\s\S]*"An old one already removed\."/, "a stale backlog line is not reported");
});

test("a list that cannot be read, approves nothing, or a missing backlog, is could-not-look — never a pass", () => {
  assert.equal(runCheck({ screen: SCREEN }).code, 2, "a missing approved list");
  assert.equal(runCheck({ screen: SCREEN, approved: "{ not json" }).code, 2, "a malformed approved list");
  assert.equal(runCheck({ screen: SCREEN, approved: {} }).code, 2, "an approved list that approves nothing");
  assert.equal(runCheck({ screen: SCREEN, approved: APPROVED, backlog: null }).code, 2, "no backlog file");
});

test("the shrink check runs where nothing is installed, and the extractor says so instead of finding no strings", () => {
  // THE JOB THAT RUNS THIS CHECK INSTALLS NOTHING, by design: it answers in seconds off git. The reader's
  // parser is a dependency, so importing it at the top killed the step with ERR_MODULE_NOT_FOUND on the
  // runner — on the first run that ever reached it, an earlier guard in the job having refused first every
  // time before. Driven here with the script copied where its parser cannot be resolved, which is the
  // runner's shape; a plant that only read the source would pass on a lazily-imported parser that then
  // returned nothing.
  const dir = mkdtempSync(join(tmpdir(), "portal-nodeps-"));
  try {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    mkdirSync(join(dir, "shared"), { recursive: true });
    mkdirSync(join(dir, "repo", "portal-ui"), { recursive: true });
    for (const f of ["scripts/portal-strings.mjs", "shared/is-entrypoint.mjs"]) {
      writeFileSync(join(dir, f), readFileSync(join(ROOT, f), "utf8"));
    }
    const repo = join(dir, "repo"), script = join(dir, "scripts", "portal-strings.mjs");
    const g = (...a) => spawnSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", ...a], { encoding: "utf8" });
    g("init", "-q", "-b", "main");
    const backlog = (b) => writeFileSync(join(repo, BACKLOG), JSON.stringify({ backlog: b }));
    backlog({ "First.": "none", "Second.": "none" });
    g("add", "-A"); g("commit", "-qm", "base");
    const shrinks = (b) => {
      backlog(b);
      const r = spawnSync(process.execPath, [script, "--backlog-shrinks", "--base", "HEAD", "--root", repo], { encoding: "utf8" });
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    };
    const smaller = shrinks({ "First.": "none" });
    assert.equal(smaller.code, 0, `the shrink check could not run without the portal's dependencies:\n${smaller.out}`);
    assert.equal(shrinks({ "First.": "none", "Second.": "none", "Third.": "none" }).code, 1,
      "the check that runs without dependencies stopped refusing a grown backlog");

    // AND THE HALF THAT KEEPS THAT HONEST: reading the portal with no parser finds no strings, which is
    // exactly what a fully approved tree looks like. It must be a could-not-look, and say what to run.
    mkdirSync(join(repo, "portal-ui", "src", "screens"), { recursive: true });
    writeFileSync(join(repo, "portal-ui", "src", "screens", "A.tsx"), SCREEN);
    const list = join(dir, "approved.json");
    writeFileSync(list, JSON.stringify({ approved: APPROVED }));
    const r = spawnSync(process.execPath, [script, "--check", list, "--root", repo], { encoding: "utf8" });
    assert.equal(r.status, 2, `an unreadable portal passed as approved:\n${r.stdout}${r.stderr}`);
    assert.match(`${r.stdout}${r.stderr}`, /npm ci/, "the refusal does not say what is missing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── THE BACKLOG ONLY SHRINKS ────────────────────────────────────────────────────────────────────────

/** A git repository whose base commit carries `before` as the backlog and whose tree carries `now`. */
function growth(before, now) {
  const dir = mkdtempSync(join(tmpdir(), "portal-backlog-"));
  try {
    const g = (...a) => spawnSync("git", ["-C", dir, "-c", "user.email=a@b.c", "-c", "user.name=t", ...a], { encoding: "utf8" });
    g("init", "-q", "-b", "main");
    mkdirSync(join(dir, "portal-ui"), { recursive: true });
    if (before) { writeFileSync(join(dir, BACKLOG), JSON.stringify({ backlog: before })); g("add", "-A"); }
    else { writeFileSync(join(dir, "seed"), "x"); g("add", "seed"); }
    g("commit", "-qm", "base");
    writeFileSync(join(dir, BACKLOG), JSON.stringify({ backlog: now }));
    const r = spawnSync(process.execPath, [SCRIPT, "--backlog-shrinks", "--base", "HEAD", "--root", dir], { encoding: "utf8" });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("a backlog line the base did not have is refused; losing lines is fine; introducing the file is fine", () => {
  const two = { "First.": "none", "Second.": "none" };
  const grown = growth(two, { ...two, "A new one.": "none" });
  assert.equal(grown.code, 1, grown.out);
  assert.match(grown.out, /"A new one\."/, "the added line is not named");
  assert.equal(growth(two, { "First.": "none" }).code, 0, "a shrinking backlog was refused");
  const first = growth(null, two);
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /introduces it/);
});

test("the committed backlog parses, and every line carries one of the classes the audit uses", () => {
  const b = backlogFrom(readFileSync(join(ROOT, BACKLOG), "utf8"), BACKLOG);
  assert.ok(b.size > 0, "the backlog is empty — either every string was approved, or the file stopped being read");
  const classes = new Set(["none", "fragment", "data", "longer-than-board", "spec-prose", "command", "values"]);
  const odd = [...b].filter(([, c]) => !classes.has(c));
  assert.deepEqual(odd, [], "a backlog line carries a class nobody defined");
});

test("the real approved list, when one is given: every string on a screen is approved or in the backlog", () => {
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

// ── THE SIGN-IN PAGE, WHICH THE SERVER BUILDS ───────────────────────────────────────────────────────
//
// `loginPage()` renders HTML on the server, so the screen reader above never saw it and a changed
// sentence on it passed. It is read as served: rendered in each state, with every value it is handed
// shown as a hole, `<code>` shown as a hole, and the product's name as the name.

test("a served page is read as a browser shows it", () => {
  const rows = htmlSentences(`<!doctype html><html><head><title>Sign in — Acme</title><style>p{color:red}</style></head>
<body><h1>Sign in</h1><p>This Acme has one user: <b></b>. Enter its passphrase.</p>
<p>Run <code>acme passphrase --reset</code> on the machine &amp; wait.</p>
<svg aria-hidden="true"><title>an icon</title></svg><input placeholder="Your passphrase"><button>Go</button></body></html>`);
  assert.deepEqual(rows, [
    { kind: "title", text: "Sign in — Acme" },
    { kind: "text", text: "Sign in" },
    { kind: "text", text: `This Acme has one user: ${HOLE}. Enter its passphrase.` },
    { kind: "text", text: `Run ${HOLE} on the machine & wait.` },
    { kind: "attr:placeholder", text: "Your passphrase" },
    { kind: "text", text: "Go" },
  ]);
});

test("the real sign-in page is read, in every state it is served in", async () => {
  const rows = await serverPageStrings(ROOT);
  const texts = rows.map((r) => r.text);
  assert.ok(rows.every((r) => r.file === SERVER_PAGES && r.line > 0), "every row names the file and a line");
  // The three sentences the owner approved for this page, as the approved list writes them.
  for (const s of [
    `This Clearotron has one user: ${HOLE}. Enter its passphrase.`,
    `The passphrase was printed once when this Clearotron first started. Lost it? Run ${HOLE} on the machine running this portal. It prints a new one, once, for the same user.`,
    `A key from ${HOLE} is for an AI assistant, not for this page.`,
  ]) assert.ok(texts.includes(s), `not read from the sign-in page: ${s}\nread: ${texts.join(" | ")}`);
  assert.ok(texts.includes(`You are signed in as ${HOLE}.`), "the signed-in state is not read");
  assert.ok(texts.some((s) => /was set aside/.test(s)), "the set-aside state is not read");
  assert.ok(texts.some((s) => /passphrase is not correct/.test(s)), "the handler's error sentences are not read");
});

const SERVER = (sentence) => `export function loginPage({ email, error = null }) {
  return \`<!doctype html><html><head><title>Sign in</title></head><body>
<p>${sentence.replace("{…}", "<b>${email}</b>")}</p>
\${error ? \`<p class="err">\${error}</p>\` : ""}</body></html>\`;
}
const WRONG = "That is not it.";
export const handle = () => [loginPage({ email: "x", error: WRONG }), loginPage({ email: "x", error: "Too many tries." })];
`;
const SIGNED_OUT = "This install has one user: {…}. Enter its passphrase.";
const SERVER_APPROVED = { ...APPROVED, "A sentence nobody designed.": "boards/B.dc.html", "Sign in": "boards/S.dc.html",
  [SIGNED_OUT]: "boards/S.dc.html", "That is not it.": "boards/S.dc.html", "Too many tries.": "boards/S.dc.html" };

test("an approved sign-in sentence passes, and the same sentence changed is refused by file and line", () => {
  const ok = runCheck({ screen: SCREEN, approved: SERVER_APPROVED, server: SERVER(SIGNED_OUT) });
  assert.equal(ok.code, 0, `the control: the approved sign-in page was refused\n${ok.out}`);
  const changed = runCheck({ screen: SCREEN, approved: SERVER_APPROVED, server: SERVER("This install has one user: {…}. Type its passphrase.") });
  assert.equal(changed.code, 1, changed.out);
  assert.match(changed.out, /driver\/portal-service\.mjs:3\s+text\s+"This install has one user: \{…\}\. Type its passphrase\."/, changed.out);
});

test("an error sentence the handler passes in is checked, and one this reader cannot resolve is could-not-look", () => {
  const edited = runCheck({ screen: SCREEN, approved: SERVER_APPROVED, server: SERVER(SIGNED_OUT).replace("Too many tries.", "Too many goes.") });
  assert.equal(edited.code, 1, edited.out);
  assert.match(edited.out, /driver\/portal-service\.mjs:7\s+text\s+"Too many goes\."/, edited.out);
  const opaque = runCheck({ screen: SCREEN, approved: SERVER_APPROVED, server: SERVER(SIGNED_OUT).replace('error: WRONG', "error: whyNot()") .replace("const WRONG", "const whyNot = () => \"x\"; const WRONG") .replace('error: "Too many tries."', "error: ERR_FROM_ELSEWHERE") });
  assert.equal(opaque.code, 2, `an error handed over by a name nobody can resolve was not reported as could-not-look\n${opaque.out}`);
});
