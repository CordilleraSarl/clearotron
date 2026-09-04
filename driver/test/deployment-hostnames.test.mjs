// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// deployment-hostnames.test.mjs — a forgotten deployment hostname must never LOOK configured.
//
// The 2026-07-17 repo split genericised this repo's hostname defaults to example.com placeholders. A
// deployment that sets only some of the overrides composes trademark.example.com report links, renders
// a mcp.example.com staff connector, and tells the reader to "sign in with a example.com account" —
// every one of them looking configured and resolving nowhere.
//
// The rule these tests pin: unset ⇒ OMITTED (or a loud pre-spend abort), never a placeholder. Source-level
// assertions are deliberate — the defect was a literal in the source, so a behavioural test alone would
// pass again the moment someone reintroduces one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { preflightDeploymentUrls } from "../driver.config.mjs";
import { accessNoteMd, accessNoteHtml } from "../publish/index.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");

// — THE WALKER REACHES `scripts/` AND TEST FILES NOW.
//
// It started at DRIVER and skipped `test`, `skills` and dotdirs, so it swept neither `scripts/` nor any
// test file — and reported green, which reads as "no executable fallbacks exist" rather than "none in
// the directories I looked at". That is the absence-as-pass shape, in a guard whose whole job is to
// stop a silent default.
//
// `skills` and `node_modules` stay out on purpose: the doctrine tree is prose a seat reads, and vendored
// code is not ours to police. Everything a person in this repo writes and runs is now in scope.
//
// SECOND WIDENING. The same absence-as-pass shape recurred one level out: a real operator home
// path shipped in mcp-server/remote/cloudflared-ingress.example.yml and this guard was green, because
// mcp-server/ was not a root AND .yml was not an extension. It was outside on both counts, so neither
// half of the miss was visible. The roots below now cover every tree a person writes in, and the
// extensions cover the deployment artifacts we SHIP as examples -- which is precisely where a real path
// is most costly, because a reader is meant to copy the file.
const REPO = join(DRIVER, "..");
// — THE ANTI-VACUITY CHECK SITS ON THE WALK'S RESULT, NOT ON EACH READ.
//
// It used to wrap every recursive readdirSync, so ONE empty leaf directory anywhere beneath the seven
// roots threw before a single file was read. `driver/profiles/` is BOTH a tracked source tree and a
// runtime write target (`driver/profiles.mjs`, PROJECTS_SUBDIR), so a deployed box grows an empty
// `driver/profiles/projects/<key>/` the moment a run resolves a profile that has no project files —
// and all six arms below were red on the test box for a reason with nothing to do with deployment
// defaults. Deleting the directory is not a fix: the next run recreates it.
//
// CI is structurally blind to this. Git stores no empty directory, so a fresh clone never has an empty
// leaf and this guard is green there forever — red only on a deployed box, the one place it could ever
// be exercised against real deployment state.
//
// An empty LEAF is not a lost corpus; an empty WALK is. is asked the second question, once, on
// the aggregate — see guardedFiles below.
function sourceFiles(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "skills" || e === "dist" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    // —.sh JOINED THIS LIST, and the reason is worth keeping: the repo tracked exactly one
    // shell script and it happened to name no home, so the omission cost nothing and was invisible.
    // Then set out to track the test box's deploy script, which names an operator's home in four
    // places — and would have landed it through a blind spot rather than past a check.
    else if (/\.(mjs|js|ts|tsx|yml|yaml|service|sh)$/.test(e)) out.push(p);
  }
  return out;
}
const ROOTS = [DRIVER, join(REPO, "scripts"), join(REPO, "bin"), join(REPO, "mcp-server"),
  join(REPO, "providers"), join(REPO, "portal-ui"), join(REPO, "shared")];
/**
 * Every executable or shipped-config file a person in this repo writes.
 *
 * `roots` is a parameter so the empty-walk direction can be DRIVEN rather than argued: point it at a
 * tree with nothing in it and must still throw. A guard rescoped without that arm is a guard
 * deleted.
 */
const guardedFiles = (roots = ROOTS) => nonEmpty(
  roots.filter((d) => { try { return statSync(d).isDirectory(); } catch { return false; } })
    .flatMap((d) => sourceFiles(d)),
  "the walked source corpus");
const rel = (f) => f.replace(`${REPO}/`, "");
// A `//` or `*` line is PROSE ABOUT the rule, and eleven of them document the 2026-07-19 ledger-split
// incident by naming the very paths this guard forbids. The policy has said so since the guard was
// written; widening the walker must not turn into a blanket path scrub.
const executableLines = (f) => readFileSync(f, "utf8").split("\n")
  .map((ln, i) => ({ ln, n: i + 1 }))
  // `#` joins the comment prefixes with the yaml/service files: in those a `#` line is prose about the
  // rule exactly as `//` is in a .mjs, and in a .mjs the only `#` line is a shebang, which is not
  // something this guard has any business flagging.
  .filter(({ ln }) => !/^\s*(\/\/|\*|\/\*|#)/.test(ln));

test("no source file falls back to an example.com host when a deployment env is unset", () => {
  // Matches `process.env.X || "…example.com…"` and the ?? form. Comments are fine (they explain the rule);
  // only executable fallbacks are the bug.
  const re = /process\.env\.[A-Z_]+\s*(?:\|\||\?\?)\s*["'][^"']*example\.com[^"']*["']/;
  // COMMENT-FILTERED, like the arms below. The policy has always been "comments are fine (they explain
  // the rule)"; it was only enforceable by accident while the walker could not see the files that
  // document the rule. Widening the walker makes it explicit here too.
  const offenders = [];
  for (const f of guardedFiles())
    for (const { ln, n } of executableLines(f))
      if (re.test(ln)) offenders.push(`${rel(f)}:${n} ${ln.trim().slice(0, 100)}`);
  assert.deepEqual(offenders, [], `placeholder host defaults must not ship:\n${offenders.join("\n")}`);
});

test("no source file falls back to a hardcoded /home/<user> path when an env var is unset", () => {
  // Same defect class as the example.com hosts, path edition: two ledger readers defaulted to a literal
  // /home/operator/… while every other read site of the same var used join(homedir(), …) — under any
  // other service account the two silently read DIFFERENT files, splitting the billing-grade provider
  // ledger. Fallbacks must derive from homedir()/config, never name a specific account's home.
  const re = /process\.env\.[A-Z_]+\s*(?:\|\||\?\?)\s*["']\/home\//;
  const offenders = [];
  for (const f of guardedFiles())
    for (const { ln, n } of executableLines(f))
      if (re.test(ln)) offenders.push(`${rel(f)}:${n} ${ln.trim().slice(0, 100)}`);
  assert.deepEqual(offenders, [], `hardcoded home-path defaults must not ship:\n${offenders.join("\n")}`);
});

// — AND A BARE ONE, not only a fallback. The two arms above match `process.env.X || "/home/…"`,
// which is the shape that split the provider ledger. A literal `/home/<user>/…` written straight into
// executable code is the same fact one syntax over: it names one operator's account, and it is wrong
// under every other service account and in every public clone. Three lived in `test/` and one in
// `scripts/`, where nothing was looking.
test("#644 no executable line names a specific account's home directory", () => {
  // TWO patterns, because the same leak has two spellings and the quoted one cannot see the other.
  // In source a real path is a string literal, so the quote is what distinguishes it from a regex
  // literal like /\/home\/(azureuser|devuser)\b/ -- which is how the scrubbers NAME the thing they
  // detect, and must not be flagged. In yaml and unit files there are no string literals and no regex
  // literals: `credentials-file: /home/someone/...` is bare, and a quoted-only pattern reads it as
  // clean. That is exactly how a real operator home shipped in an .example.yml under mcp-server/
  // while this guard was green.
  // .sh sits with the CONFIG spellings, not the source ones: shell has no string-literal requirement,
  // so `cd /home/someone/x` is bare exactly as `WorkingDirectory=/home/someone/x` is, and the
  // quoted-only pattern reads both as clean.
  const CONFIG = /\.(yml|yaml|service|sh)$/;
  const reSource = /["'`]\/home\/[a-z][a-z0-9_-]*\//;
  const reConfig = /(?:^|[\s=:])\/home\/[a-z][a-z0-9_-]*\//;
  const reFor = (f) => (CONFIG.test(f) ? reConfig : reSource);
  // ONE residual, declared with its reason and keyed on CONTENT rather than a line number — the
  // convention register-ledger-rename.test.mjs set, for the same reason: a numeric pin either rots into
  // a false failure or drifts onto a different line and excuses a real one.
  //
  // freeze-example-run.test.mjs PLANTS an operator home path because the rule it is testing is the
  // scrub's `operator-home` detector. A fixture whose subject IS the forbidden pattern cannot be
  // scrubbed without deleting the test. Everything else in the sweep is a path something actually used.
  const ALLOWED = [{ file: "driver/test/freeze-example-run.test.mjs", contains: "operator home path" }];
  const allowed = (r, ln) => ALLOWED.some((a) => r === a.file) && /azureuser/.test(ln)
    && readFileSync(join(REPO, r), "utf8").includes("an operator home path");
  const offenders = [];
  for (const f of guardedFiles())
    for (const { ln, n } of executableLines(f))
      if (reFor(f).test(ln) && !allowed(rel(f), ln)) offenders.push(`${rel(f)}:${n} ${ln.trim().slice(0, 100)}`);
  assert.deepEqual(offenders, [], `a specific operator's home is not a path any code may name:\n${offenders.join("\n")}`);
  // and the allowlist is not a hiding place: the file it names must still carry the fixture it excuses
  for (const a of ALLOWED)
    assert.match(readFileSync(join(REPO, a.file), "utf8"), new RegExp(a.contains),
      `${a.file} no longer contains "${a.contains}" — the exemption has outlived its reason`);
});

test("#644 the walker really reaches scripts/ and test files, and the comments still pass", () => {
  // A guard that reports green about directories it never opened is the defect this arm exists to stop
  // recurring. Both facts are asserted by VALUE, because "the walker was widened" is not observable.
  const files = guardedFiles().map(rel);
  assert.ok(files.some((f) => f.startsWith("scripts/")), "scripts/ is swept");
  assert.ok(files.some((f) => f.startsWith("driver/test/")), "test files are swept");
  assert.ok(files.some((f) => f.startsWith("bin/")), "bin/ is swept");
  assert.ok(!files.some((f) => f.includes("/skills/")), "the doctrine tree is prose, not code, and stays out");
  assert.ok(files.length > 200, `files swept: ${files.length} — a walker that returns little reports green`);

  // …and the eleven explanatory comments survive: the policy is "comments are fine (they explain the
  // rule); only executable fallbacks are the bug", and a widened walker must not become a path scrub.
  const commentsNamingHomes = guardedFiles()
    .flatMap((f) => readFileSync(f, "utf8").split("\n").filter((ln) => /^\s*(\/\/|\*)/.test(ln) && /\/home\/[a-z]/.test(ln)));
  assert.ok(commentsNamingHomes.length >= 5,
    `explanatory comments naming a home path: ${commentsNamingHomes.length} — they document the 2026-07-19 incident and must survive`);
});

test("#2018 an empty directory under a walked root is not a lost corpus", () => {
  // THE CASE THAT PRODUCED THE ISSUE, driven. `driver/profiles/` is a tracked source tree AND a runtime
  // write target, so a deployed box grows an empty `driver/profiles/projects/<key>/` the first time a
  // run resolves a profile with no project files. Every arm above threw there — before reading a file.
  //
  // TWO plants, not one, and the second is deliberately not the member this arm was written against: a
  // leaf directly under the issue's own directory, and one nested two levels under a DIFFERENT root.
  // "One empty leaf anywhere beneath the seven roots" is the claim; one plant cannot make it.
  const stems = [
    join(DRIVER, "profiles", "projects", `b2018-${process.pid}`),
    join(REPO, "shared", `b2018-${process.pid}`),
  ];
  const leaves = [stems[0], join(stems[1], "deeper", "deeper-still")];
  const baseline = guardedFiles().map(rel).sort();
  try {
    for (const d of leaves) mkdirSync(d, { recursive: true });
    // The walk completes AND returns exactly what it returned before: this is a scope correction to the
    // vacuity check, not a change to the corpus the guard reads.
    assert.deepEqual(guardedFiles().map(rel).sort(), baseline,
      "an empty directory under a walked root changed the set of files this guard reads");
  } finally {
    for (const d of stems) rmSync(d, { recursive: true, force: true });
  }
});

test("#2018 #1010 still fires when the walk genuinely finds nothing", () => {
  // THE OTHER DIRECTION, and it is the whole reason the arm above is not sufficient. A guard rescoped
  // and a guard deleted read identically on a healthy tree; only an empty tree tells them apart.
  const tmp = mkdtempSync(join(tmpdir(), "b2018-empty-"));
  try {
    mkdirSync(join(tmp, "a", "b"), { recursive: true });
    assert.throws(() => guardedFiles([tmp]), /#1010 VACUOUS/,
      "a walk that descended a whole tree and found no file reported a corpus instead of refusing");
    assert.throws(() => guardedFiles([join(tmp, "not-here")]), /#1010 VACUOUS/,
      "a root that is not on disk is not a corpus either");
    assert.throws(() => guardedFiles([]), /#1010 VACUOUS/, "no roots at all is not a corpus");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  // POSITIVE CONTROL: the real roots still produce one, so the two refusals above are about emptiness
  // and not about the guard refusing everything it is handed.
  assert.ok(guardedFiles().length > 200, "the real roots stopped producing a corpus");
});

test("the git-tracked systemd unit pins no deployment hostname", () => {
  // A hostname baked into the unit becomes every deployment's hostname — and a PLACEHOLDER pinned there is
  // worse than unset, because the fail-closed branches key on the var being EMPTY. That is exactly how the
  // client export shipped a dead clients-mcp.example.com link.
  const unit = readFileSync(join(DRIVER, "systemd", "prelim-driver.service"), "utf8");
  const pinned = unit.split("\n").filter((l) => /^Environment=CLEAROTRON_\w*(URL|DOMAIN)=/.test(l.trim()));
  assert.deepEqual(pinned, [], `deployment hostnames belong in the EnvironmentFile, not the unit:\n${pinned.join("\n")}`);
});

test("an unset pool URL is reported as MISSING — loudly, but it never gates the queue", () => {
  // Never throws: a missing hostname costs a LINK, not the deliverable. Aborting would suppress a sound
  // report over a config typo — the opposite of how delivery is meant to fail.
  const r = preflightDeploymentUrls({});
  assert.equal(r.missing.length, 1);
  assert.match(r.missing[0], /CLEAROTRON_REPORTS_URL/);
  assert.equal(preflightDeploymentUrls({ CLEAROTRON_REPORTS_URL: "   " }).missing.length, 1, "whitespace is not configuration");
});

test("the optional connectors warn, and a fully configured deployment is silent", () => {
  const r = preflightDeploymentUrls({ CLEAROTRON_REPORTS_URL: "https://trademark.test" });
  assert.equal(r.poolUrl, "https://trademark.test");
  assert.deepEqual(r.missing, []);
  assert.equal(r.warnings.length, 3);
  assert.ok(r.warnings.some((w) => w.includes("CLEAROTRON_MCP_URL")));
  assert.ok(r.warnings.some((w) => w.includes("CLEAROTRON_CLIENT_MCP_URL")));
  assert.ok(r.warnings.some((w) => w.includes("CLEAROTRON_ACCESS_DOMAIN")));
  const clean = preflightDeploymentUrls({
    CLEAROTRON_REPORTS_URL: "https://trademark.test", CLEAROTRON_MCP_URL: "https://mcp.test/mcp",
    CLEAROTRON_CLIENT_MCP_URL: "https://clients-mcp.test/mcp", CLEAROTRON_ACCESS_DOMAIN: "test.example",
  });
  assert.deepEqual(clean.warnings, []);
  assert.deepEqual(clean.missing, []);
});

test("the email access note is omitted when no identity domain is configured", () => {
  // Silence beats confidently wrong sign-in instructions: a named domain the reader has no account on is
  // worse than no instruction at all.
  assert.equal(accessNoteMd(""), "");
  assert.equal(accessNoteHtml("font:x", ""), "");
  assert.match(accessNoteMd("acme.test"), /sign in with a \*\*acme\.test\*\* account/);
  assert.match(accessNoteHtml("font:x", "acme.test"), /<b>acme\.test<\/b>/);
});

test("#1014 the SECOND widening is pinned by value, on the trees it actually added", () => {
  // asserts scripts/, driver/test/ and bin/, and backstops with `files.length > 200`. Neither
  // reaches the four trees 's widening added — driver/ alone is ~825 files, so it clears that
  // backstop on its own and every one of mcp-server/, providers/, portal-ui/ and shared/ could fall
  // out together in silence. The operator path in a .yml under mcp-server/ that survived until
  // ef475931 is what that gap costs, and "the walker was widened" is not observable.
  const files = guardedFiles().map(rel);
  for (const tree of ["mcp-server/", "providers/", "portal-ui/", "shared/"]) {
    assert.ok(files.some((f) => f.startsWith(tree)), `${tree} is not swept — the widening is not in effect`);
  }
  // And the extensions the widening added, for the same reason: the file that survived was a .yml,
  // and a walker restricted back to source extensions would report green over exactly that class.
  assert.ok(files.some((f) => /\.(yml|yaml|service)$/.test(f)),
    "no shipped-config file is swept — the operator path that survived until ef475931 was in one");
});

test("#1381 the #644 walker reaches shell scripts, which it did not until a shell script mattered", () => {
  // A guard's blind spots are invisible until something moves into one. This repo tracked a single .sh,
  // it named no home, and so the walker's silence about shell looked like coverage for months.
  // then proposed tracking a 160-line deploy script carrying /home/<account> in four places.
  //
  // Asserted on the WALKER, not on today's corpus: "no tracked .sh offends" passes just as well when the
  // walker cannot see .sh at all, which is the state this arm exists to make impossible.
  const files = guardedFiles().map((f) => rel(f));
  assert.ok(files.some((f) => f.endsWith(".sh")),
    "the walker returned no shell script at all — either the repo tracks none (then this arm needs "
    + "re-deriving) or .sh has fallen out of the walker and the #644 arms silently stopped covering it");
  assert.ok(files.includes("scripts/deploy-test.sh"),
    "the tracked deploy script is not in the guarded set — it is the file with the most operator-home "
    + "pressure on it in the repo");
});

test("#1381 the tracked deploy script names no account's home on any executable line", () => {
  // The specific claim rests on. The four literals the live copy carries became env lookups
  // defaulting off $HOME, which is generic — under the service account that runs the timer it resolves
  // to precisely what the literals said, and under any other account it is still right.
  const src = readFileSync(join(REPO, "scripts", "deploy-test.sh"), "utf8");
  const offenders = src.split("\n")
    .map((ln, i) => ({ ln, n: i + 1 }))
    .filter(({ ln }) => !/^\s*#/.test(ln))
    .filter(({ ln }) => /(?:^|[\s=:"'])\/home\/[a-z][a-z0-9_-]*\//.test(ln));
  assert.deepEqual(offenders.map((o) => `${o.n}: ${o.ln.trim().slice(0, 80)}`), []);
  // and it still reads its three locations from somewhere, rather than having lost them in the edit
  for (const v of ["DEPLOY_TEST_REPO", "DEPLOY_TEST_QUEUE", "DEPLOY_TEST_ENV"])
    assert.match(src, new RegExp(v), `${v} is gone — the script cannot be pointed anywhere`);
});
