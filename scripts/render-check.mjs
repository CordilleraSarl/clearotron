#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Does the report actually LAY OUT correctly? Ask a browser, not a regex.
//
//   node scripts/render-check.mjs [--run <runId>] [--pool <dir>] [--zoom 1.0,1.25] [--keep]
//   node scripts/render-check.mjs --fixture-pool [--keep]        ← needs no deployment at all
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────────
//
// The portal shipped a fix for "the report has two scrollbars" that produced a report with two
// scrollbars. It passed 1,500 unit tests and a full review, because every test in this repo asserts on
// STRINGS — that a class is absent from some HTML, that a function returns a number. Not one of them can
// observe a scrollbar, a sticky header, or a frame two pixels shorter than its contents. The bugs were
// all in that gap:
//
//   • a 1px border + `box-sizing:border-box` made the frame's viewport 2px shorter than the height set
//     on it, so the document overflowed by exactly 2px and grew its own scrollbar;
//   • that scrollbar stole ~15px of width, the narrower text reflowed TALLER, which posted a new height,
//     which resized the frame, which toggled the scrollbar — a loop, visible as a scrollbar that
//     twitches and goes nowhere;
//   • the header scrolled away with the page, taking the Export button with it.
//
// None of that is inferable from source. All of it is one measurement away.
//
// ── running it ───────────────────────────────────────────────────────────────────────────────────────
//
// Needs `google-chrome` on PATH. It MUST NOT run as a user with a virtual-memory ulimit (`ulimit -v`) —
// Chrome dumps core under one; run it as a user with `ulimit -v unlimited`. The dbus/UPower errors
// Chrome prints on a headless box are noise.
//
// It also needs a PUBLISHED RUN to measure, and that requirement is why this file was the only browser
// check CI never ran: every other one serves the built bundle or renders a report from the
// repo's own fixtures, and this one wanted a pool. `--fixture-pool` removes that asymmetry — it replays the
// committed frozen run in demo/ through bin/example.mjs into a throwaway directory, which
// produces exactly the `<runId>/report.html` + `meta.json` pair pickRun() looks for.
//
// The demo is SPAWNED rather than reimplemented, and that is a safety property, not a shortcut: it
// inherits bin/example.mjs's FORBIDDEN containment refusal, so a fixture pool can never resolve inside
// /srv/trademark-archive or this environment's CLEAROTRON_REPORTS_DIR. 's rule is untouched — there is
// still no default pool; `--fixture-pool` is an explicit request that writes only to a fresh temp dir
// and deletes it again unless `--keep`.
//
// Two traps, both hit while writing this, both cost an hour:
//   • ONE iframe per page. Chrome does not run scripts in a frame parked thousands of pixels offscreen,
//     so a page comparing two variants silently measures only the first.
//   • The report links external fonts, so its `load` event can be late or never fire. Nothing here is
//     driven off `load` alone: the shell waits for `document.fonts.ready` OR `load` OR an 8s ceiling,
//     whichever comes first, and RECORDS which one did as `readyBy`. A deadline that fires is a fact
//     about the page, and the output says so rather than substituting silently for the condition.
//
// ── what this does NOT cover ─────────────────────────────────────────────────────────────────────────
//
// The shell below is a REPLICA of what Result.tsx renders, not the component itself — there is no DOM
// test harness in this project and standing one up is a bigger change than this. So it pins base.css,
// the injected bridge, and the interaction between them. It does NOT see the iframe's inline styles,
// which live in Result.tsx: if someone puts a `border` back on the frame there, this stays green while
// the 2px-scrollbar bug returns. Keep the iframe attributes below in step with Result.tsx, and if that
// coupling ever bites, that is the moment to mount the real component instead of copying it.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { reapOnExit } from "../shared/reap-on-exit.mjs";   // — a detached group dies with this script
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { basename, extname } from "node:path";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { envFrom } from "../shared/env-aliases.mjs";   // — the name a reader is told to set is the one in force

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);

const ZOOMS = arg("zoom", "1.0,1.25").split(",").map((z) => z.trim()).filter(Boolean);
const WORK = join(tmpdir(), `render-check-${process.pid}`);

/**
 * Replay the committed frozen run into a fresh pool and return its path.
 *
 * Exported so it can be tested WITHOUT Chrome: the pool build and the browser measurement are separate
 * failures, and only one of them is reproducible off a CI runner. Callers own the returned directory.
 *
 * The child inherits this process's environment ON PURPOSE. bin/example.mjs reads CLEAROTRON_REPORTS_DIR and
 * CLEAROTRON_STAFF_POOL_ROOT to build its FORBIDDEN list, so stripping them would quietly disarm the very
 * guard this function is spawning the demo to borrow.
 */
export function buildFixturePool(dir = mkdtempSync(join(tmpdir(), "render-check-fixture-"))) {
  execFileSync(process.execPath, [join(REPO, "bin", "example.mjs"), "--no-open", "--once", "--pool", dir],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  return dir;
}

/**
 * Which pool to measure, and where it came from.
 *
 * — no literal fallback. `--pool`, CLEAROTRON_REPORTS_DIR, an explicit `--fixture-pool`, or refuse by
 * name: this reads a pool's published reports, and the old fallback silently pointed a local check at a
 * deployment's client archive — a check that reports on the wrong instance is worse than no check (the
 * same lesson the MCP_URL derivation below already carries). A BUILT fixture pool is not a fallback: it
 * is asked for, it is empty until this process fills it, and it is deleted on the way out.
 */
function resolvePool() {
  // — EVERY spelling. This file does not import shared/env-local.mjs, so nothing back-fills the
  // retired name here: an operator who set only the documented one read as having set no pool, and
  // the refusal below then told them to set the variable they had already set.
  const named = arg("pool", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") ?? null);
  if (named) return { pool: named, built: false };
  if (has("fixture-pool")) return { pool: buildFixturePool(), built: true };
  console.error(`render-check: no pool. Pass --pool <dir> or set CLEAROTRON_REPORTS_DIR — there is no default,`);
  console.error("  because the old one was /srv/trademark-archive, a deployed server's real client archive.");
  console.error("  Or pass --fixture-pool to replay demo/ into a throwaway pool.");
  process.exit(2);
}

// The height the bridge adds on top of the measured content — see EMBED_JS in driver/portal-report.mjs.
//
// Asserted as a RANGE, not a number. The property that matters is that the slack is never negative or
// zero — that is what starts the scrollbar loop — and never so large that the page carries obvious dead
// space. The exact figure moves by a pixel between documents because the measurement ceils a fractional
// box and the browser then rounds the frame to device pixels: measured 16 on one report and 17 on
// another, both correct. An `=== 16` assertion was over-fitted to whichever report happened to be
// largest on the day.
// 2026-07-28: the floor was 16 and it was over-fitted in the same direction the note above warns about,
// just downwards. The knockout report's body box measures 2804.1875px — a fractional height, which is
// ordinary for text. The bridge ceils that to 2805 and adds 16; the browser then rounds the FRAME to
// device pixels, and a pixel can be lost there as easily as gained. Measured: 16 and 17 on clearance
// reports, 15 on the knockout one, all three correct and none of them clipped.
//
// The invariant this check exists to protect is not the exact figure — it is that the frame is never
// SHORTER than its content, because "shorter" starts the scrollbar loop rather than merely clipping.
// That property is asserted directly by the inner-scrollbar check above; this range is the supporting
// sanity bound (never negative, never obvious dead space).
const MIN_SLACK = 15;
const MAX_SLACK = 24;
// .topbar is 56px and sticky at 0; the report header stacks under it.
const EXPECTED_HEADER_TOP = 56;

// Takes the pool rather than closing over it: the pool is now resolved inside main(), because a module
// that refuses at import time cannot export anything a test can call.
export function pickRun(POOL) {
  const named = arg("run", null);
  if (named) return named;
  const runs = readdirSync(POOL).filter((n) => existsSync(join(POOL, n, "report.html")) && existsSync(join(POOL, n, "meta.json")));
  if (!runs.length) throw new Error(`no run with a report.html under ${POOL}`);
  // The longest report is the most demanding: more content, more reflow, more chances to oscillate.
  return runs.map((n) => [n, readFileSync(join(POOL, n, "report.html")).length]).sort((a, b) => b[1] - a[1])[0][0];
}

function builtCss() {
  const dir = join(REPO, "portal-ui", "dist", "assets");
  const css = readdirSync(dir).find((f) => f.endsWith(".css"));
  if (!css) throw new Error("no built CSS — run `npm run build:ui` first");
  return join(dir, css);
}

const PROBE = `<script>
// Reports from INSIDE the frame, which is the only place the truth lives: the parent cannot read a
// cross-origin document.
//
// #1155 — MEASURED ON A LAYOUT EVENT, NEVER ON A CLOCK, and the reason is not style.
//
// This used to be \`setInterval(…, 400)\`, and it never fired once: the three assertions that depend on
// this script reported "no-probe" for the whole life of the check.
//
// MEASURED, in CI on a real Chrome:
//   • Messages from inside this frame DO reach the shell and DO pass its source filter. The report's
//     own height bridge travels the same postMessage path and its posts arrive; once this probe sent
//     on layout events instead of a timer, its posts arrived too, same-source, with no error.
//   • So the earlier reading — "\`file://\` plus a sandbox with no allow-same-origin means the message
//     never arrives" — was WRONG. It was written down as a mechanism and it did not survive being
//     measured. The sandbox is not the obstacle and relaxing it was never the fix.
//   • Every post still reports \`winInnerH\` 1400 while the frame element measures ~7456, at both zoom
//     levels, and the shell's settle loop exhausts all 40 tries waiting for the two to agree.
//
// INFERRED at the time, and it was never settled: under \`--virtual-time-budget\` the MAIN frame was
// serviced — the shell's own nested setTimeouts ran, which is why the header and scroll assertions
// always passed — and this subframe was not. Either its tasks never got dispatched or its layout never
// updated for them to read; the evidence did not separate the two.
//
// IT IS NOW MOOT RATHER THAN ANSWERED, and the difference matters to whoever reads this next. The
// harness no longer runs under virtual time (see harnessServer below), so the dependency is gone
// instead of the question being resolved. Nobody should later cite this block as having decided which
// of the two readings was true. Both are cured by real time, which is exactly why neither was proved.
//
// Layout events are the right signal regardless. The shell resizes this frame in response to the
// report's own height bridge; a ResizeObserver fires WHEN THE THING BEING MEASURED CHANGES, which a
// 400ms poll could only approximate. The synchronous post at evaluation is the floor, so a frame that
// never resizes still reports.
(function(){
  function send(){
    try {
      var b=document.body,d=document.documentElement;
      if(!b) return;
      parent.postMessage({probe:1,
        winInnerH:window.innerHeight,
        trueContent:Math.ceil(b.getBoundingClientRect().bottom),
        SCROLLABLE:d.scrollHeight>window.innerHeight,
        // #485: every assertion in this file was about HEIGHT, and the report was 26px too WIDE.
        hOverflowPx:d.scrollWidth-d.clientWidth,
        slackPx:window.innerHeight-Math.ceil(b.getBoundingClientRect().bottom)},'*');
    } catch (e) {
      try { parent.postMessage({probeError:String(e && e.message || e)},'*'); } catch (e2) {}
    }
  }
  // An error in here must not read as "no measurement" — that is the ambiguity #1155 was about.
  window.addEventListener('error', function(ev){
    try { parent.postMessage({probeError:String(ev && ev.message || ev)},'*'); } catch (e) {}
  });
  send();                                        // the floor: a frame that never resizes still reports
  window.addEventListener('resize', send);       // the shell resizing us
  window.addEventListener('load', send);         // images and fonts settling the layout
  try { new ResizeObserver(send).observe(document.documentElement); } catch (e) { /* older engines */ }
})();
</script>`;

/**
 * A DELIBERATE 26px sideways overflow, injected into the report on `--plant-overflow`.
 *
 * 's acceptance has two halves and this is the one that matters more: nine green assertions prove
 * nothing unless the same harness still REDDENS on a report that is actually broken. The old check
 * returned `stale-probe` for the sideways assertion in most runs, so it could not have caught this —
 * and a run of nine PASSes from an instrument that cannot fail is the exact false authority the whole
 * issue is about.
 *
 * 26px because that is the incident's own number: the report was 26px too wide, every assertion in
 * the file was about HEIGHT, and it shipped.
 *
 * THE REPORTED FIGURE IS NOT 26 and should not be — the assertion measures `scrollWidth - clientWidth`,
 * and this document sits 15px inside its frame when clean (`hOverflowPx: -15`). So the plant reads as
 * 11px of overflow, which is 26 minus that headroom. Anyone expecting the plant's own number back has
 * misread what the assertion measures.
 */
const OVERFLOW_PLANT = `<div style="position:relative;height:1px;width:calc(100% + 26px)"
  data-render-check-plant="26px of deliberate sideways overflow (#1155 acceptance)"></div>`;

const SHELL = `<!doctype html><html><head><meta charset="utf-8"><title>render-check</title>
<link rel="stylesheet" href="portal.css"><style>body{margin:0}</style></head>
<body><div class="app"><aside class="sidebar"></aside><div class="main">
  <header class="topbar"><h1>Clearances</h1></header>
  <div class="screen report">
    <div class="report-head" id="hdr"><div style="display:flex;align-items:center;gap:12px">
      <h1 style="font-size:19px;margin:0">Mark</h1><span style="flex:1"></span>
      <button class="nav-item" id="exp" style="width:auto">Export</button></div></div>
    <div data-anon="mark" style="margin-top:12px">
      <!-- The SAME sandbox Result.tsx sets, verbatim (#705). This shell exists to reproduce the portal's
           report frame in a real browser, and a harness that sandboxes it more tightly than production
           cannot see a defect that only production's permissions expose — it can only invent one. -->
      <iframe id="f" src="rep.html" scrolling="auto"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
        style="height:1400px;width:100%;border:0;display:block"></iframe>
    </div></div></div></div>
<script>
var f=document.getElementById('f'),st={heightMsgs:0},lastHeightAt=Date.now();
window.addEventListener('message',function(e){var d=e.data;
  // #1155 — COUNT EVERY MESSAGE BEFORE THE SOURCE FILTER, and keep the count.
  //
  // msgsAll minus probeMsgs minus heightMsgs is an accounting: it separates "nothing arrived from
  // inside the frame" from "something arrived and this handler discarded it", which a post-filter
  // count alone cannot do. That ambiguity is the one this issue was about — the check reported
  // no-probe for months and the word covered three different repairs.
  st.msgsAll=(st.msgsAll||0)+1;
  // An error inside the probe must not read as "no measurement" — same ambiguity, other end.
  if(d&&d.probeError){st.probeError=String(d.probeError).slice(0,200);}
  if(!d||e.source!==f.contentWindow)return;
  if(d.probe){st.probeMsgs=(st.probeMsgs||0)+1;st.inside=d;return;}
  if(d.source==='cordillera-report'&&d.type==='height'){st.heightMsgs++;lastHeightAt=Date.now();
    // WHAT height, not just how many: "two messages arrived" cannot distinguish a bridge posting the
    // wrong number from a shell failing to apply the right one.
    (st.heights=st.heights||[]).push(d.height);
    f.style.height=d.height+'px';
    (st.frameH=st.frameH||[]).push(f.getBoundingClientRect().height);}});

// ── READINESS, NOT A CLOCK ────────────────────────────────────────────────────────────────────────
// Every wait below is a real wait for a named condition, and each one RECORDS which way it ended. A
// deadline that fires is a fact about the page, not a silent substitute for the condition.
function after(ms,cb){setTimeout(cb,ms);}
function whenQuiet(ms,cap,cb){var t0=Date.now();(function w(){
  if(Date.now()-lastHeightAt>=ms)return cb('quiet');
  if(Date.now()-t0>=cap)return cb('still-posting');
  after(25,w);})();}
function whenLaidOut(cb){var done=false,how='';
  var go=function(w){if(done)return;done=true;how=w;cb(w);};
  try{document.fonts.ready.then(function(){go('fonts');});}catch(e){}
  window.addEventListener('load',function(){go('load');});
  after(8000,function(){go('deadline');});}

whenLaidOut(function(how){
  st.readyBy=how;
  // The report's height bridge posts more than once as layout converges. Waiting for it to go QUIET is
  // the condition the old fixed 11s clock was standing in for — and under real time the frame's own
  // timers run, so the quiet actually arrives instead of being fast-forwarded past.
  whenQuiet(400,15000,function(q){
    st.heightsQuiet=q;
    var se=document.scrollingElement,hdr=document.getElementById('hdr');
    window.scrollTo(0,3000);
    after(150,function(){
      st.headerTopAfterScroll=Math.round(hdr.getBoundingClientRect().top);
      st.exportVisible=document.getElementById('exp').getBoundingClientRect().top>0;
      st.scrollHeightAtScroll=se.scrollHeight;
      window.scrollTo(0,se.scrollHeight);
      after(150,function(){
        st.headerTopAtBottom=Math.round(hdr.getBoundingClientRect().top);
        st.borderSteals=f.offsetHeight-f.clientHeight;
        // SETTLE BEFORE YOU READ, and say so if it never settles. The probe reports the frame it was IN
        // when it posted; the shell resizes that frame from the bridge. Under virtual time this loop was
        // a coin flip — settleTries came back 0 or 40 and never between, because the subframe's tasks
        // were not being serviced at all. On real time it is an ordinary convergence wait.
        var settleTries=0;
        (function settle(){
          var frameH=Math.round(f.getBoundingClientRect().height);
          var agrees=st.inside&&Math.abs(st.inside.winInnerH-frameH)<=1;
          if(!agrees&&settleTries<120){settleTries++;return after(25,settle);}
          st.settleTries=settleTries;
          st.frameHAtRead=frameH;
          st.settled=!!agrees;
          st.innerScrollbar=st.inside?(agrees?st.inside.SCROLLABLE:'stale-probe'):'no-probe';
          st.hOverflowPx=st.inside?(agrees?st.inside.hOverflowPx:'stale-probe'):'no-probe';
          st.slackPx=st.inside&&agrees?st.inside.slackPx:null;
          // ── THE SCROLL IS RE-ISSUED AFTER THE SETTLE, AND THE MOVE IS RECORDED ────────────────
          // The scroll above happens BEFORE this settle loop, and the loop exists precisely because
          // the shell is still resizing the frame. A taller report takes more ticks to converge, so
          // scrollHeight grows AFTER scrollTop was set and reachedEnd reads false for a page that
          // did reach the end of the report as it then was. Measured on main 9bd4f8b: settleTries 3
          // at zoom 1.25 and reachedEnd false, with slack 16 (in range), no inner scrollbar and no
          // sideways overflow — every other assertion healthy. The same tree settles in 0 ticks on a
          // quiet box and passes, which is what makes this a load meter rather than a layout fault.
          //
          // So: scroll again now that the frame has stopped moving, and RECORD the growth either way.
          // frameGrewAfterScroll turns a silent race into a number in the artifact — a later red can
          // be told apart from this one without re-running it.
          st.scrollHeightAtSettle=se.scrollHeight;
          st.frameGrewAfterScroll=se.scrollHeight-(st.scrollHeightAtScroll||se.scrollHeight);
          window.scrollTo(0,se.scrollHeight);
          // ── THE EXPLICIT READINESS SIGNAL ──────────────────────────────────────────────────────
          // The page tells the harness it is done, rather than the harness guessing with a budget. If
          // this never arrives the run FAILS by name; it can no longer be confused with a measurement.
          after(60,function(){
            st.pageScrollbar=se.scrollHeight>se.clientHeight;
            st.reachedEnd=(se.scrollHeight-se.scrollTop-se.clientHeight)<3;
            var send=function(n){fetch('/ready',{method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify(st)}).catch(function(){if(n<3)after(200,function(){send(n+1);});});};
            send(0);
          });
        })();});});});});
</script></body></html>`;

/**
 * A loopback server over the work directory, and the READINESS SIGNAL the page sends back through it.
 *
 * — WHY THERE IS A SERVER AT ALL. The old harness ran Chrome under `--virtual-time-budget` and
 * read the answer out of `--dump-dom`. Virtual time services the MAIN frame and not the sandboxed
 * subframe, so the probe inside the report was never current when the shell read it: `settleTries` came
 * back 0 or 40 and never in between — the shell was winning or losing a race, not converging. Four
 * consecutive runs on one commit gave four different verdicts.
 *
 * Real time fixes the servicing. It also removes the way the answer used to get out, because nothing
 * tells the harness when a real-time page is finished. So the page says so itself: it POSTs its state
 * to `/ready` and the harness waits for that, with a deadline that FAILS BY NAME rather than falling
 * back to whatever the page happened to have. A budget guesses; a signal is told.
 *
 * The frame's origin moves from `file://` to loopback http, which is what the portal serves over in
 * production — closer to the real thing, not a workaround. already measured that the sandbox and
 * the file scheme were never the obstacle, so this transport is not standing in for a permission.
 *
 * `basename` on every request path is deliberate: this serves a directory to a browser, and a request
 * for `../../etc/passwd` must resolve inside the work directory or not at all.
 */
function harnessServer(dir) {
  let signal;
  const ready = new Promise((resolve) => { signal = resolve; });
  const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8" };
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/ready") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => { res.writeHead(204); res.end(); signal(body); });
      return;
    }
    const name = basename((req.url || "/").split("?")[0]) || "verify.html";
    const file = join(dir, name);
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[extname(name)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  const started = new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    ready,
    url: async () => { await started; return `http://127.0.0.1:${server.address().port}/verify.html`; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Load the shell once at one zoom and return the state the page reported.
 *
 * Returns `{ ok: false, why }` rather than throwing when the page never signals: "the page never
 * reported" is a RESULT this check must be able to state, and it is a different finding from any
 * measurement. The old code could not tell the two apart — a page that failed to report and a page
 * reporting a stale number both arrived as a number-shaped thing.
 */
async function measureAtZoom(zoom, deadlineMs = 90_000) {
  const site = harnessServer(WORK);
  const url = await site.url();
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
    `--user-data-dir=${join(WORK, `prof-${zoom}`)}`,
    "--window-size=1440,900", `--force-device-scale-factor=${zoom}`,
    url,
  // — DETACHED so Chrome LEADS A PROCESS GROUP. Its renderer, GPU and zygote processes are
  // separate PIDs; without a group there is nothing to signal them with, and the teardown below could
  // only ever reach the parent.
  ], { stdio: ["ignore", "ignore", "ignore"], detached: true });
  // — and the group dies with THIS script, on every exit it can observe.
  // The teardown below runs on the paths somebody wrote a branch for; a cancelled CI job (SIGTERM),
  // a Ctrl-C, or a throw elsewhere in this file are not among them — and that is where the measured
  // eighty-eight-minute orphan came from.
  reapOnExit(chrome);
  let timer;
  const expired = new Promise((resolve) => { timer = setTimeout(() => resolve(null), deadlineMs); });
  try {
    const body = await Promise.race([site.ready, expired]);
    if (body == null) return { ok: false, why: `the page never signalled /ready within ${deadlineMs / 1000}s` };
    try { return { ok: true, state: JSON.parse(body) }; }
    catch { return { ok: false, why: "the page signalled /ready with a body that is not JSON" }; }
  } finally {
    clearTimeout(timer);
    // WAIT FOR IT TO ACTUALLY BE GONE. `kill()` sends a signal; it does not mean Chrome has finished
    // writing its profile directory. Killing and moving straight on left the work-dir cleanup racing
    // those writes, and it lost: `ENOTEMPTY … prof-1.25/Default` on 1 run in 6 — after all eighteen
    // checks had PASSED. A teardown fault that surfaces as a non-zero exit reads exactly like the
    // flakiness this rewrite exists to remove.
    // — SIGNAL THE GROUP, NOT THE PROCESS. The wait below was never too short; it was a wait on
    // the wrong thing. `chrome.kill()` signals only the process spawned here, and the parent's `exit`
    // event says nothing about its children — a straggling renderer keeps `prof-<zoom>/Default`
    // non-empty and the cleanup then loses to it (`ENOTEMPTY`, after all eighteen checks had passed).
    // With the group killed, the parent's exit means what this wait has always claimed it meant.
    try { process.kill(-chrome.pid, "SIGKILL"); }
    catch { try { chrome.kill("SIGKILL"); } catch { /* already gone — nothing left to signal */ } }
    await new Promise((resolve) => {
      const done = setTimeout(resolve, 5_000);
      chrome.on("exit", () => { clearTimeout(done); resolve(); });
    });
    await site.close();
  }
}

async function main() {
  const { pool: POOL, built } = resolvePool();
  const runId = pickRun(POOL);
  mkdirSync(WORK, { recursive: true });

  const { readReport } = await import(join(REPO, "driver", "portal-report.mjs"));
  const html = readReport(join(POOL, runId), { staff: true, poolRoot: POOL });
  // chrome.css carries 35KB of typography; without it the layout is not the one users see. What must be
  // true is that NO external stylesheet link survives into the measured document — either it was inlined,
  // or the document never had one. The knockout report is the second case: it is the client deliverable,
  // so it ships fully self-contained. Asserting on `data-inlined` alone failed it for being MORE portable.
  if (/<link[^>]*rel="stylesheet"[^>]*href="\.\.\//i.test(html))
    throw new Error("a pool stylesheet link survived into the document — the measurement would not be faithful");
  const i = html.lastIndexOf("</body>");
  const planted = has("plant-overflow");
  writeFileSync(join(WORK, "rep.html"), html.slice(0, i) + (planted ? OVERFLOW_PLANT : "") + PROBE + html.slice(i));
  writeFileSync(join(WORK, "portal.css"), readFileSync(builtCss()));
  writeFileSync(join(WORK, "verify.html"), SHELL);

  let sawOverflowFailure = false;
  console.log(`render-check: ${runId}\n  pool ${POOL}\n  work ${WORK}\n`);
  if (planted) {
    console.log("  --plant-overflow: the report carries 26px of DELIBERATE sideways overflow.");
    console.log("  Expect the sideways assertion to FAIL. A clean run here means the instrument is blind.\n");
  }
  let failures = 0;

  for (const zoom of ZOOMS) {
    const measured = await measureAtZoom(zoom);
    if (!measured.ok) { console.log(`  zoom ${zoom}: FAILED — ${measured.why}`); failures++; continue; }
    const r = measured.state;

    const checks = [
      ["no border stealing from the frame's viewport", r.borderSteals === 0, r.borderSteals],
      ["the report has NO scrollbar of its own", r.innerScrollbar === false, r.innerScrollbar],
      //. The frame does NOT mask a sideways overflow — measured, 19px inside this very shell — so a
      // report that overflows here scrolls sideways for the client. 1px of tolerance because a fractional
      // box rounds; the incident this whole family of scripts exists for was 2px, so 1px still catches it.
      ["the report does not scroll SIDEWAYS inside the frame", r.hOverflowPx <= 1, r.hOverflowPx],
      [`the frame is ${MIN_SLACK}-${MAX_SLACK}px taller than its content`, r.slackPx >= MIN_SLACK && r.slackPx <= MAX_SLACK, r.slackPx],
      ["the page scrolls", r.pageScrollbar === true, r.pageScrollbar],
      ["scrolling reaches the end of the report", r.reachedEnd === true, r.reachedEnd],
      [`the header stays pinned at ${EXPECTED_HEADER_TOP}px`, r.headerTopAfterScroll === EXPECTED_HEADER_TOP, r.headerTopAfterScroll],
      ["the header is still pinned at the bottom of the page", r.headerTopAtBottom === EXPECTED_HEADER_TOP, r.headerTopAtBottom],
      ["Export is reachable after scrolling", r.exportVisible === true, r.exportVisible],
    ];
    // HOW it settled, on every run including a clean one. The old output printed its internals only on
    // failure, so a green said nothing about whether the page had actually converged or had merely
    // happened to agree — which is how a coin flip passed for a measurement. `readyBy` names which of
    // fonts/load/deadline ended the layout wait, and settleTries is now an ordinary small number
    // instead of the bimodal 0-or-40 that gave the race away.
    console.log(`  zoom ${zoom}:  (ready by ${r.readyBy}, heights ${r.heightsQuiet}, `
      + `settled after ${r.settleTries} × 25ms, ${r.heightMsgs} height post(s), ${r.probeMsgs} probe post(s))`);
    let zoomFailures = 0;
    for (const [what, ok, got] of checks) {
      if (!ok) { failures++; zoomFailures++; if (what.includes("SIDEWAYS")) sawOverflowFailure = true; }
      console.log(`    ${ok ? "PASS" : "FAIL"}  ${what}${ok ? "" : `  (got ${JSON.stringify(got)})`}`);
    }
    // — AN INSTRUMENT THAT CANNOT SAY WHAT IT SAW IS HALF AN INSTRUMENT.
    //
    // `no-probe` and `null` mean the shell never received the probe's message, and the three assertions
    // that read it then fail identically whatever the cause: the frame did not load, the frame loaded
    // and its scripts did not run, or the scripts ran and the message did not arrive. Those are three
    // different repairs and the output could not tell them apart.
    //
    // `heightMsgs` separates them and was already being collected. It counts messages from the REPORT'S
    // OWN height bridge, which travels the same postMessage path as the probe: non-zero means the frame
    // loaded, ran scripts, and reached the parent — so a missing probe is then the probe's problem.
    // Zero means nothing from inside arrived at all, and the probe is not the thing to look at.
    if (zoomFailures) console.log(`    ── raw state: ${JSON.stringify(r)}`);
  }

  if (!has("keep")) {
    // maxRetries for the same reason as the exit wait above: a browser profile directory can have a
    // straggling write. The measurement is already complete and printed by this point, so a teardown
    // that throws would report a clean run as a failure.
    rmSync(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    // Only a pool THIS process built. A --pool the caller named is theirs, and deleting it would be the
    // shape pointing the other way.
    if (built) rmSync(POOL, { recursive: true, force: true });
  }
  if (planted) {
    // Under the plant the SUCCESS condition is inverted, and it is specific: the sideways assertion in
    // particular must have failed. "Some assertion failed" is not the proof — a run that reds because
    // the page never reported would satisfy a naive count while telling us nothing about whether the
    // check can see an overflow.
    const caught = sawOverflowFailure;
    console.log(caught
      ? `\nrender-check: the planted 26px overflow was CAUGHT (${failures} assertion(s) failed). The instrument can see it.`
      : "\nrender-check: THE PLANTED OVERFLOW WAS NOT CAUGHT. The sideways assertion did not fail, so a "
        + "clean run of this check is not evidence the report is clean.");
    process.exit(caught ? 0 : 1);
  }
  console.log(failures ? `\nrender-check: ${failures} FAILED` : "\nrender-check: all checks passed");
  process.exit(failures ? 1 : 0);
}

// Entry guard: importing this file must not resolve a pool, spawn a demo or run a browser. Before
// the pool refusal sat at module scope and `main()` was called unconditionally, so there was no way to
// reach any of this from a test.
//
// The same form portal-service.mjs and profile-service.mjs use, and it is the defensive one on purpose:
// an entry check that wrongly answers "no" makes this script do nothing and exit 0 — a check that
// silently passes, which is worse than one that errors. That direction is proved by running it:
// `node scripts/render-check.mjs` with no pool still refuses with exit 2.
const isMain = isEntrypoint(import.meta.url);
if (isMain) main().catch((e) => { console.error(`render-check: ${e.message}`); process.exit(2); });
