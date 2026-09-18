// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// clone-recipe-check.mjs — run README's Development recipe, as README prints it, on a fresh clone.
//
//   node scripts/clone-recipe-check.mjs [--keep]
//
// THE RECIPE IS READ OUT OF README, NEVER RETYPED HERE. A second copy of the steps is how a check comes
// to pass on commands nobody is told to run: README's clone recipe said to build with one spelling, two
// other documents said another, and the demo it led to answered 503 on every page because the recipe
// stopped before it. So this takes the fenced block under "## Development" and runs its lines in order.
//
// ONE SUBSTITUTION, AND IT IS THE CLONE. The recipe clones the public repository's default branch, which
// in CI is not the commit under test; the clone here is of the commit this runs in, into an empty
// directory, which is the same fresh tree a stranger gets. Every line after `cd` runs exactly as printed.
//
// THE DEMO IS THE LAST LINE AND IT DOES NOT RETURN — it serves until it is stopped. So it runs in the
// background, and the check passes only when the portal is listening and answering "not signed in"
// (401) within a bound; then it is stopped the way a reader stops it and must exit cleanly. Anything else
// — a 503 because no bundle was built, a refusal, a port that never opens — fails the check by name.
//
// AGENTS.md CARRIES THE SAME LINES, and that is checked here too: a coding agent dropped into a clone
// reads AGENTS.md, not README, and a recipe that drifts between the two is two recipes.
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { reapOnExit } from "../shared/reap-on-exit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const keep = process.argv.includes("--keep");
const fail = (msg) => { console.error(`clone-recipe-check: ${msg}`); process.exit(1); };

/** The command lines of the first fenced block under a heading, comments and blank lines dropped. PURE. */
export function recipeUnder(markdown, heading) {
  const at = markdown.indexOf(`\n${heading}\n`);
  if (at < 0) return null;
  const rest = markdown.slice(at + heading.length + 2);
  const next = rest.search(/\n## /);
  const section = next < 0 ? rest : rest.slice(0, next);
  const fence = section.match(/```[a-z]*\n([\s\S]*?)```/);
  if (!fence) return null;
  return fence[1].split("\n").map((l) => l.replace(/\s+#.*$/, "").trim()).filter((l) => l && !l.startsWith("#"));
}

const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const lines = recipeUnder(readme, "## Development");
if (!lines || lines.length < 3) fail("README.md has no fenced recipe under \"## Development\" — nothing was run.");
if (!/^git clone /.test(lines[0]) || !/^cd /.test(lines[1])) fail(`the recipe does not open with a clone and a cd: ${JSON.stringify(lines.slice(0, 2))}`);
const steps = lines.slice(2);
const demo = steps[steps.length - 1];
if (!/^npx clearotron demo\b/.test(demo)) fail(`the recipe's last line is not the demo: ${demo}`);

// THE SAME LINES IN AGENTS.md, in the same order.
const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8").split("\n").map((l) => l.replace(/\s+#.*$/, "").trim());
let from = 0;
for (const s of steps) {
  const i = agents.indexOf(s, from);
  if (i < 0) fail(`AGENTS.md does not carry README's recipe line \`${s}\` (in README's order) — the two front doors disagree.`);
  from = i + 1;
}

// A FRESH CLONE OF THIS COMMIT, WHERE A READER WOULD PUT ONE — in their home, never under the temp root.
// The suite's containment guards treat anything under a temp root as disposable, so a checkout sitting
// there turns one of their arms into a no-op and it fails: measured on the first CI run of this job, "a
// value genuinely outside every temp root is STILL refused" was not, because the checkout itself was
// inside one. Nobody clones a product into /tmp to try it.
const work = mkdtempSync(join(homedir(), "clearotron-recipe-"));
const tree = join(work, "clearotron");
const clone = spawnSync("git", ["clone", "--quiet", "--no-local", ROOT, tree], { stdio: "inherit" });
if (clone.status !== 0) fail(`could not clone ${ROOT}`);
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
spawnSync("git", ["checkout", "--quiet", head], { cwd: tree, stdio: "inherit" });
console.log(`clone-recipe-check: fresh clone of ${head.slice(0, 12)} in ${tree}`);

// THE ENVIRONMENT IS THE READER'S, UNCHANGED — a stranger runs these lines in their own shell, and the
// suite in particular has guards about the home directory that only mean something on a real one (a
// home moved under the temp root reads to them as disposable, and one of them then refuses nothing).
// The demo writes its folder into that home, so it must not meet one already there: a demo started over
// the top of an earlier one resets it, and that folder may be somebody's. Refused by name instead.
const env = process.env;
const demoFolder = join(process.env.HOME ?? "", "trademark-demo");
if (existsSync(demoFolder)) fail(`${demoFolder} already exists, and the recipe's demo would reset it. Run this where no demo has been left, or remove that folder.`);
const PORT = 19760;

for (const step of steps.slice(0, -1)) {
  console.log(`\n$ ${step}`);
  const r = spawnSync("sh", ["-c", step], { cwd: tree, stdio: "inherit", env });
  if (r.status !== 0) fail(`\`${step}\` exited ${r.status} on a fresh clone.`);
}

// THE DEMO, AS PRINTED, with the two flags a runner needs: no browser, and a port nothing else holds.
const demoCmd = `${demo} --no-open --port ${PORT}`;
console.log(`\n$ ${demoCmd}`);
// ITS OWN PROCESS GROUP, AND STOPPED THE WAY A TERMINAL STOPS IT. Ctrl-C reaches every process in the
// foreground group; a signal to one pid reaches one. The first version of this check sent SIGINT to the
// pid it spawned, which is `npm exec`, and npm does not pass it on — so the demo answered, was "stopped",
// and was still serving thirty seconds later with its folder in place. Measured: the same SIGINT sent to
// the demo's own launcher stopped all four of its processes and removed the folder in six seconds.
const child = spawn("sh", ["-c", `exec ${demoCmd}`], { cwd: tree, env, stdio: ["ignore", "inherit", "inherit"], detached: true });
reapOnExit(child);   // the group dies with this script on every path, including one nobody wrote a branch for
let exited = null;
child.on("exit", (code, signal) => { exited = { code, signal }; });
const groupAlive = () => { try { process.kill(-child.pid, 0); return true; } catch { return false; } };

const deadline = Date.now() + 180_000;
let answer = null;
while (Date.now() < deadline && exited === null) {
  try { answer = (await fetch(`http://127.0.0.1:${PORT}/portal`, { redirect: "manual" })).status; } catch { answer = null; }
  if (answer === 401) break;
  await new Promise((r) => setTimeout(r, 1000));
}
// Stopped when the whole group is gone, not when `npm exec` is: npm's own exit code on an interrupt says
// nothing about whether the demo shut down, so the verdict is the group, the ports and the folder.
// A group that outlives the bound is killed, so this check never leaves a demo running behind it.
const stop = async () => {
  try { process.kill(-child.pid, "SIGINT"); } catch { /* already gone */ }
  for (let i = 0; i < 60 && groupAlive(); i++) await new Promise((r) => setTimeout(r, 500));
  if (!groupAlive()) return true;
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* raced */ }
  return false;
};
if (answer !== 401) {
  await stop();
  if (!keep) rmSync(work, { recursive: true, force: true });
  fail(exited !== null
    ? `the demo exited (${JSON.stringify(exited)}) before its portal answered — nothing was listening.`
    : `the portal answered ${answer ?? "nothing"} within 180s, not 401 "not signed in" — a portal that is not listening, or one serving no bundle.`);
}
console.log(`\nclone-recipe-check: the portal answered 401 (not signed in) on 127.0.0.1:${PORT}.`);
if (!(await stop())) fail("the demo did not stop within 30s of an interrupt to its process group — it was killed.");
let bound = null;
try { await fetch(`http://127.0.0.1:${PORT}/portal`); bound = true; } catch { bound = false; }
if (bound) fail(`the demo's processes are gone but something still answers on ${PORT}.`);
if (existsSync(demoFolder)) fail(`the demo stopped but left ${demoFolder} behind — started with no flags, it removes what it made.`);
if (!keep) rmSync(work, { recursive: true, force: true });
console.log("clone-recipe-check: README's recipe ran on a fresh clone, the demo listened, and it stopped cleanly.");
