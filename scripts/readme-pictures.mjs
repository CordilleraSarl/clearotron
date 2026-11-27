#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// readme-pictures.mjs — retake the README's three portal pictures from this checkout's own demo.
//
//     npm run build:ui && node scripts/readme-pictures.mjs [--out <dir>]
//
// Writes, light theme, 1,332 × 778 CSS pixels at device scale 1.5 (1,998 × 1,167, the size and type scale of the
// pictures it replaces):
//   portal-new-clearance.png       New clearance as it opens
//   portal-clearance-report.jpg    the demo's Global preliminary search report, at its top
//   portal-conflict-landscape.jpg  the same report's conflict landscape
// into docs/assets/ unless --out names another folder, and prints the provenance line for
// docs/assets/README.md.
//
// WHEN TO RUN IT: a release that changes New clearance, the report page or the conflict landscape, and
// every regeneration of demo/. docs/RELEASES.md names it as a step of the checklist.
//
// ONLY THE PUBLIC DEMO IS ON SCREEN. The demo is SPAWNED (bin/example.mjs, the replay `npx clearotron demo`
// serves) in a throwaway home with a minimal environment, so no setting of this machine, no pool and no
// profile store reaches it, and bin/example.mjs's own containment refusal still applies. The sign-in is a
// passphrase minted for that home alone; it is never printed and leaves with the home.
//
// NETWORK IS ALLOWED, as in report-screenshot.mjs: these are pictures of what a reader sees, so the brand
// webfonts load. The render checks block it on purpose; the two intents differ.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { establishCredential } from "../driver/portal-local-auth.mjs";
import { browserRun } from "../shared/browser-temp-root.mjs";
import { reapOnExit } from "../shared/reap-on-exit.mjs";   // a detached group dies with this script

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const OUT = resolve(argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : join(ROOT, "docs", "assets"));
const WIDTH = 1332, HEIGHT = 778, SCALE = 1.5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (msg) => { console.error(`readme-pictures: ${msg}`); cleanup(); process.exit(1); };

const home = mkdtempSync(join(tmpdir(), "readme-pictures-"));
let demo = null, chrome = null;
function cleanup() {
  for (const child of [chrome, demo]) {
    if (!child?.pid) continue;
    try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* already gone */ } }
  }
  try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a stray temp folder is not a result */ }
}
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// ── the demo, in a home of its own ────────────────────────────────────────────────────────────────────
const port = await new Promise((r) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const passphrase = randomBytes(18).toString("base64url");
// THE DEMO SIGNS IN WITH THE CREDENTIAL IN ITS OWN BASE (bin/start.mjs sets PORTAL_LOCAL_CREDENTIAL to it). It
// replaces that credential on every start and prints the passphrase only to a terminal, so once it is up this
// script resets it the way `clearotron passphrase --reset` does, remove then mint, and the portal reads the
// file on each sign-in. The demo's own address is kept (bin/start.mjs signs a demo in as demo@localhost).
const credential = join(home, "trademark-demo", "portal-local-credential.json");
// A MINIMAL ENVIRONMENT, named field by field: nothing this machine's own install reads is inherited.
const demoEnv = { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: home, LANG: "en_US.UTF-8" };
demo = spawn(process.execPath, [join(ROOT, "bin", "example.mjs"), "--no-open", "--port", String(port)],
  { cwd: ROOT, env: demoEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
reapOnExit(demo);
let demoLog = "";
demo.stdout.setEncoding("utf8"); demo.stderr.setEncoding("utf8");
demo.stdout.on("data", (c) => { demoLog += c; }); demo.stderr.on("data", (c) => { demoLog += c; });
const origin = `http://127.0.0.1:${port}`;
const up = await (async () => {
  for (const t0 = Date.now(); Date.now() - t0 < 180000; await sleep(500)) {
    if (demo.exitCode != null) return false;
    try { const r = await fetch(`${origin}/portal/login`, { headers: { accept: "text/html" } }); if (r.status === 200) return true; } catch { /* not yet */ }
  }
  return false;
})();
if (!up) die(`the demo did not serve its sign-in page on ${origin}. Its output:\n${demoLog.replace(passphrase, "[passphrase]").slice(-1500)}`);

rmSync(credential, { force: true });
establishCredential({ path: credential, email: "demo@localhost", passphrase });
const login = await fetch(`${origin}/portal/login`, { method: "POST", redirect: "manual",
  headers: { "content-type": "application/x-www-form-urlencoded", origin, accept: "text/html" },
  body: new URLSearchParams({ passphrase }).toString() });
const cookieLine = (login.headers.getSetCookie?.() ?? []).find((c) => /=/.test(c));
if (!cookieLine) die(`signing in to the demo returned ${login.status} and no session cookie: ${((await login.text()).match(/(No passphrase is set[^<]*|That passphrase[^<]*|could not be read[^<]*|not available[^<]*)/) ?? ["(no reason on the page)"])[0]}\n${demoLog.replaceAll(passphrase, "[passphrase]").slice(-1200)}`);
const [cookieName, ...rest] = cookieLine.split(";")[0].split("=");
const cookieValue = rest.join("=");

// The demo's Global preliminary search, the report the README has always shown.
const runs = await (await fetch(`${origin}/portal/api/runs?scope=mine`, { headers: { cookie: `${cookieName}=${cookieValue}`, accept: "application/json" } })).json().catch(() => null);
const all = Array.isArray(runs?.runs) ? runs.runs : [];
const report = all.find((r) => /global-preliminary/.test(String(r.product ?? r.productKey ?? r.level ?? "")) || /Global preliminary/.test(String(r.productName ?? "")));
if (!report?.runId) die(`the demo lists no Global preliminary search (it lists ${all.length} runs${all[0] ? `; the first carries ${Object.keys(all[0]).join(", ")}` : ""})`);

// ── the browser ──────────────────────────────────────────────────────────────────────────────────────
const { profile, env: chromeEnv } = browserRun("readme-pictures-");
chrome = spawn("google-chrome", ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--user-data-dir=${profile}`, `--window-size=${WIDTH},${HEIGHT}`, "--remote-debugging-port=0", "about:blank"], {
  stdio: ["ignore", "pipe", "pipe"], env: chromeEnv, detached: true });
reapOnExit(chrome);
let chromeErr = "";
const wsUrl = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`chrome reported no devtools endpoint in 60s:\n${chromeErr || "(nothing)"}`)), 60000);
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (c) => { chromeErr += c; const m = chromeErr.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); res(m[0]); } });
}).catch((e) => die(e.message));
const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map();
// The report's frame attaches as a target of its own (see inFrame); the newest one is the document on screen.
let frameSession = null;
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data);
  if (m.method === "Target.attachedToTarget" && m.params?.targetInfo?.type === "iframe") frameSession = m.params.sessionId;
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener("open", r));
const send = (method, params = {}, sessionId) => new Promise((r) => { const n = ++id; pending.set(n, r);
  ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })); });
const target = (await send("Target.getTargets")).result.targetInfos.find((t) => t.type === "page");
if (!target) die("chrome opened no page target");
const sessionId = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).result.sessionId;
const cmd = (method, params = {}) => send(method, params, sessionId);
const evaluate = async (expression) => (await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))?.result?.result?.value;
await cmd("Page.enable");
await cmd("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await cmd("Network.enable");
await cmd("Network.setCookie", { name: cookieName, value: cookieValue, url: origin, httpOnly: true });
await cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await cmd("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false });

// THE REPORT IS A SANDBOXED FRAME with a null origin, so the page cannot read into it, and Chrome runs it as a
// target of its own. DevTools attaches to that target and reads its document without changing it.
const inFrame = async (expression) => frameSession
  ? (await send("Runtime.evaluate", { expression, returnByValue: true }, frameSession))?.result?.result?.value ?? null
  : null;
const open = async (path, ready, what, prepare = null) => {
  await cmd("Page.navigate", { url: `${origin}${path}` });
  for (const t0 = Date.now(); Date.now() - t0 < 30000; await sleep(300)) {
    if (prepare) await evaluate(prepare);
    if (typeof ready === "function" ? await ready() : await evaluate(ready)) {
      await evaluate("document.documentElement.removeAttribute('data-theme'); document.fonts.ready.then(() => true)");
      await sleep(1200);   // layout settles after the faces swap in
      return;
    }
  }
  die(`${what} never appeared at ${path}; the page reads: ${String(await evaluate("location.pathname + ' | ' + (document.body ? document.body.innerText : '')")).replace(/\s+/g, " ").slice(0, 300)}`);
};
const shoot = async (file) => {
  const jpg = file.endsWith(".jpg");
  const shot = await cmd("Page.captureScreenshot", { format: jpg ? "jpeg" : "png", ...(jpg ? { quality: 88 } : {}) });
  if (!shot?.result?.data) die(`chrome returned no image for ${file}`);
  writeFileSync(join(OUT, file), Buffer.from(shot.result.data, "base64"));
};
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// THE DEMO'S COMPANY, chosen in the sidebar as a reader chooses it: a person who sees every company is
// otherwise asked to pick one first, and the shell holds the choice in memory only.
const pickDemoCompany = `(() => {
  const s = document.querySelector('select[aria-label="Company"]');
  if (!s || s.value === 'demo-brand-owner' || ![...s.options].some((o) => o.value === 'demo-brand-owner')) return false;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'demo-brand-owner');
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;
await open("/portal/new", "Boolean(document.querySelector('textarea[aria-label=\"Names to clear\"]'))", "New clearance", pickDemoCompany);
// WHAT THE README'S CAPTION NAMES: the company's classes and marketplaces, and the four searches. The company line
// states the first two; the four searches sit behind "All four searches", opened as a reader opens it. The line
// is brought just under the top bar.
const folds = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const b = [...document.querySelectorAll('button')].find((x) => /^All four searches$/.test((x.innerText || '').trim()));
  if (b) b.click();
  await sleep(400);
  const line = document.querySelector('.nc-company-line');
  const bar = document.querySelector('.topbar, header');
  const below = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
  if (line) window.scrollBy(0, line.getBoundingClientRect().top - below - 20);
  return { four: Boolean(b), line: Boolean(line), searches: document.querySelectorAll('.pick-row').length };
})()`);
if (!folds?.four || !folds?.line || folds.searches !== 4) die(`New clearance did not show its company line and four searches: ${JSON.stringify(folds)}`);
await sleep(600);
await shoot("portal-new-clearance.png");

const reportPath = `/portal/result/${encodeURIComponent(report.runId)}`;
// Ready when the frame holds THIS run's report with its sections drawn, and has posted its height to the page.
const frameReady = async () => (await inFrame(`location.pathname.includes(${JSON.stringify(`/${encodeURIComponent(report.runId)}`)}) && document.querySelectorAll('h2').length > 3`)) === true
  && (await evaluate("(document.querySelector('iframe')?.getBoundingClientRect().height ?? 0) > 1000")) === true;
await open(reportPath, frameReady, "the demo report");
// WHAT THE CAPTION NAMES: the verdict, the risk band and the four answers, which the report's summary holds
// (`.heroGrid` inside `#summary`). Brought just under the header that stays on screen.
const placeUnderHeader = async (frameY, what) => {
  if (typeof frameY !== "number") die(`the demo report has no ${what}`);
  for (let pass = 0; pass < 3; pass++) {
    await evaluate(`(() => {
      const f = document.querySelector('iframe').getBoundingClientRect();
      const head = document.querySelector('.report-head');
      const below = head ? Math.max(0, head.getBoundingClientRect().bottom) : 0;
      window.scrollBy(0, f.top + ${frameY} - below - 24);
      return true;
    })()`);
    await sleep(500);
  }
};
await placeUnderHeader(await inFrame(`(() => { const g = document.querySelector('#summary .heroGrid'); return g ? g.getBoundingClientRect().top + window.scrollY : null; })()`),
  "verdict and risk band (#summary .heroGrid)");
await shoot("portal-clearance-report.jpg");

// The conflict landscape, brought to the top of the view the way a reader's section link brings it.
const headingTop = await inFrame(`(() => {
  const h = [...document.querySelectorAll('h2, h3')].find((e) => /conflict landscape/i.test(e.textContent || ''));
  return h ? h.getBoundingClientRect().top + window.scrollY : null;
})()`);
// The frame is as tall as the report, so the page scrolls; the header that stays on screen changes height once
// the page has scrolled, so the placement is measured again after each move.
await placeUnderHeader(headingTop, "conflict landscape heading");
await sleep(800);
await shoot("portal-conflict-landscape.jpg");

let commit = "";
try { const { execFileSync } = await import("node:child_process"); commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { /* not a checkout */ }
const { version } = JSON.parse(await (await import("node:fs/promises")).readFile(join(ROOT, "package.json"), "utf8"));
cleanup();
console.log(`readme-pictures: wrote portal-new-clearance.png, portal-clearance-report.jpg and portal-conflict-landscape.jpg to ${OUT}`);
console.log(`  from the demo's run ${report.runId}, at ${WIDTH}×${HEIGHT} CSS px, device scale ${SCALE}, light theme`);
console.log(`  provenance: Clearotron ${version}${commit ? ` (${commit})` : ""}, \`node scripts/readme-pictures.mjs\``);
process.exit(0);
