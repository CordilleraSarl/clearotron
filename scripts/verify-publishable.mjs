#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// verify-publishable.mjs — install the tarball somewhere with no checkout and type the verbs.
//
//   node scripts/verify-publishable.mjs [--keep]
//
// THE ONLY EVIDENCE THAT COUNTS FOR A PUBLISHABLE PACKAGE is a tree that has never seen this
// repository. Every cheaper check passes on a machine with the checkout still around it: the suite
// runs from source, `npm pack --dry-run` lists files without resolving anything, and the dispatcher
// finds its targets by relative path whether or not they were shipped.
//
// What this catches that nothing else does, measured 2026-08-23 on the plain `npm pack` output:
//
//     npm error Unable to resolve reference $buffers
//
// The install died before a single file was written, and no test in the suite could see it.
//
// It also holds the licence substitution end to end. `buffers@0.1.1` on the registry is unlicensed
// and this package ships a clean-room replacement. The repo's `overrides` protects a
// RESOLUTION and cannot travel; `bundleDependencies` protects the SHIPPED tree and does. Only an
// installed tree can tell you which one the consumer actually got, so that is what is asserted.
import { execFileSync, spawn } from "node:child_process";
import { reapOnExit } from "../shared/reap-on-exit.mjs";   // — a detached group dies with this script
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (m) => { console.error(`  FAIL  ${m}`); process.exitCode = 1; };
const ok = (m) => console.log(`  ok    ${m}`);

/** Every directory named `buffers` under a tree. PURE given the filesystem. */
export function buffersDirs(root, out = []) {
  let entries = [];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = join(root, e.name);
    if (e.name === "buffers") out.push(p);
    buffersDirs(p, out);
  }
  return out;
}

const keep = process.argv.includes("--keep");
const staging = mkdtempSync(join(tmpdir(), "clearotron-verify-"));
const consumer = join(staging, "consumer");
try {
  console.log("packing (publishable manifest)…");
  execFileSync("node", [join(ROOT, "scripts/pack-publishable.mjs"), "--out", staging],
    { stdio: ["ignore", "inherit", "inherit"] });
  const tgz = readdirSync(staging).find((f) => f.endsWith(".tgz"));
  if (!tgz) { fail("pack produced no tarball"); process.exit(1); }

  execFileSync("mkdir", ["-p", consumer]);
  execFileSync("npm", ["init", "-y"], { cwd: consumer, stdio: "ignore" });
  console.log(`installing ${tgz} into a tree with no checkout…`);
  execFileSync("npm", ["install", join(staging, tgz), "--no-audit", "--no-fund"],
    { cwd: consumer, stdio: ["ignore", "ignore", "inherit"] });
  ok("the tarball installs");

  // ── the licence substitution, in the tree the consumer actually gets ──
  const dirs = buffersDirs(join(consumer, "node_modules"));
  if (!dirs.length) fail("no `buffers` in the installed tree at all — the bundle did not travel");
  for (const d of dirs) {
    const mf = join(d, "package.json");
    if (!existsSync(mf)) { fail(`${d} has no package.json`); continue; }
    const m = JSON.parse(readFileSync(mf, "utf8"));
    if (m.license !== "AGPL-3.0-only" || !/[Cc]lean-room/.test(m.description ?? "")) {
      fail(`${d} is NOT the clean-room replacement (license=${m.license}) — the unlicensed buffers@0.1.1 `
         + "reached a consumer tree, which is the whole reason vendor/buffers exists (#854)");
    }
  }
  if (dirs.length && process.exitCode !== 1) ok(`all ${dirs.length} \`buffers\` in the tree are the clean-room replacement`);

  // ── the verbs, typed at the installed command ──
  const cli = join(consumer, "node_modules", ".bin", "clearotron");
  if (!existsSync(cli)) { fail("`clearotron` is not on the installed .bin — the `bin` field did not travel"); }
  else {
    const help = execFileSync(cli, ["--help"], { encoding: "utf8" });
    const missing = ["install", "doctor", "demo", "start", "run", "drain", "grant", "sync"]
      .filter((v) => !new RegExp(`^\\s+${v}\\s`, "m").test(help));
    if (missing.length) fail(`--help does not list: ${missing.join(", ")}. It printed ${help.length} byte(s).`);
    else ok("--help lists every verb");

    try { execFileSync(cli, ["doctor"], { stdio: "ignore", timeout: 120_000 }); ok("doctor runs and exits 0"); }
    catch (e) { fail(`doctor exited ${e.status ?? e.code}`); }

    // ── — `--once`, AND THAT IS A NARROWING SAID OUT LOUD ──────────────────
    //
    // This spawned a serving `demo` and waited for the URL it printed. `demo` now brings up the REAL
    // portal rather than the dev cockpit, and that changes two things this check cannot live with:
    //
    //   • it binds the product's fixed ports (INSTALL.md calls 18802 and 18790 fixed defaults), and this
    //     script spawns its child DETACHED, killing the group only from the success path and the timeout.
    //     Any other way out — a cancelled job, a killed tool, a Ctrl-C — leaves a serving portal, engine
    //     door and watching runner reparented to init, holding those ports until somebody notices.
    //
    //     THE CAUSE HERE IS CORRECTED FROM WHAT THIS COMMENT FIRST SAID, because the wrong one is easy
    //     to reach and was reached. `127.0.0.1:18802 in use` was not a concurrent job and not an
    //     operator's portal. It was THIS SCRIPT's own orphan from an earlier run: three processes,
    //     PPID 1, eighty-eight minutes old, still running product code out of an install tree that had
    //     already been deleted. On a self-hosted runner one such run poisons every later one, and the
    //     failure reads exactly like two jobs colliding.. `--once` publishes and
    //     exits, so this call site stops producing them; the detached-group pattern is filed, not fixed.
    //   • the line it keyed on is gone. The real portal prints its own address, not `report: http…`.
    //
    // So it runs the publish-and-exit path, which is what this check was always about: a packaged
    // install can replay a frozen example through the ordinary publisher. WHAT IS NO LONGER COVERED
    // HERE, stated rather than lost: that the demo SERVES. That is now `bin/start.mjs`'s supervisor,
    // held by driver/test/start-command.test.mjs and by driving it — and it was never the thing a
    // publishability check could honestly assert while sharing a box with other runs.
    await new Promise((resolve) => {
      const child = spawn(cli, ["demo", "--once"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
      // — and the group dies with THIS script, on every exit it can observe.
      // The teardown below runs on the paths somebody wrote a branch for; a cancelled CI job (SIGTERM),
      // a Ctrl-C, or a throw elsewhere in this file are not among them — and that is where the measured
      // eighty-eight-minute orphan came from.
      reapOnExit(child);
      let out = "", done = false;
      const finish = (good, why) => {
        if (done) return; done = true;
        try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
        good ? ok("demo replays the sample through the ordinary publisher") : fail(why);
        resolve();
      };
      const t = setTimeout(() => finish(false, `demo never published within 180s. Output so far:\n${out.slice(-600)}`), 180_000);
      const read = (c) => {
        out += c;
        // Both halves, as before: the publisher's own line AND the artifact it names. `--once` prints
        // the report's PATH rather than a URL, so keying on `http` would have been keying on the server
        // this deliberately no longer starts.
        if (/report:\s+\S/.test(out) && /published:/.test(out)) { clearTimeout(t); finish(true); }
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.on("error", (e) => { clearTimeout(t); finish(false, `demo could not start: ${e.message}`); });
    });
  }

  // ── — THE CONSUMER'S AUDIT, WHICH IS THE ONLY ONE THAT REACHES ANYBODY ──────────────────────
  //
  // `npm audit` in this repository reports on the tree a CHECKOUT resolves. A consumer never resolves
  // that tree: `bundleDependencies` ships `exceljs` PRE-RESOLVED inside the tarball, and npm does not
  // re-resolve a bundled dependency on install. So whatever `uuid` sat in node_modules when the tarball
  // was built is the `uuid` every consumer gets, permanently — and no `overrides` entry can reach it,
  // because the field is root-only and a bundled tree is not re-resolved at all.
  //
  // MEASURED, 2026-08-24. The override is NOT broken; the packing tree was stale:
  //
  //   fresh `npm install` in a scratch clone   uuid 11.1.1   audit: 0 vulnerabilities
  //   tarball packed FROM that tree            uuid 11.1.1   bundled inside package/node_modules
  //   consumer installing that tarball         uuid 11.1.1   audit: 0 vulnerabilities
  //
  // Packed from a STALE tree the same commit shipped uuid 8.3.2 and three moderate advisories. So the
  // guarantee is a BUILD-ORDER rule, and a build-order rule that is remembered rather than checked is
  // the one that gets forgotten on the release nobody has time for.
  //
  // IT TOLERATES A NON-ZERO EXIT THAT STILL PRODUCED THE REPORT. `npm audit` exits 1 when it finds
  // anything and prints the JSON anyway — measured: a tree with uuid@8.3.2 exits 1 with total 1. Dying
  // on the status would turn "the consumer is vulnerable" into "the check crashed".
  const auditTotal = (cwd, what) => {
    let out;
    try { out = execFileSync("npm", ["audit", "--omit=dev", "--json"], { cwd, encoding: "utf8" }); }
    catch (e) { out = e?.stdout; }
    if (typeof out !== "string" || !out.trim()) { fail(`could not audit ${what} — npm produced no report`); return null; }
    try { return JSON.parse(out)?.metadata?.vulnerabilities?.total ?? null; }
    catch { fail(`could not audit ${what} — npm's report did not parse`); return null; }
  };

  const repoVulns = auditTotal(ROOT, "this checkout");
  const consumerVulns = auditTotal(consumer, "the installed package");
  if (repoVulns === null || consumerVulns === null) {
    fail("the audit comparison could not run, which is not the same as it passing");
  } else if (consumerVulns > repoVulns) {
    fail(`the INSTALLED package audits ${consumerVulns} vulnerabilit${consumerVulns === 1 ? "y" : "ies"} `
      + `where this checkout reports ${repoVulns}. A bundled dependency ships pre-resolved, so this is `
      + "almost certainly a tarball packed from a stale node_modules: run `npm install` here and pack "
      + "again. No `overrides` entry can fix it after the fact.");
  } else {
    ok(`installed package audits ${consumerVulns} vs ${repoVulns} in this checkout — the consumer is no worse off`);
  }

} finally {
  if (keep) console.log(`kept: ${staging}`);
  else rmSync(staging, { recursive: true, force: true });
}
console.log(process.exitCode === 1 ? "\nverify-publishable: FAILED" : "\nverify-publishable: all checks passed");
