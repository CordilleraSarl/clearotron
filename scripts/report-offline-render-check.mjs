#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// report-offline-render-check.mjs — opening a report contacts no one, measured in a real browser.
//   node scripts/report-offline-render-check.mjs [--keep]
//
// A report used to fetch its typefaces from two font services, so opening one told them the reader's
// address and that a report had been opened. It now carries its fonts inside itself. This opens every
// report the demo publishes, and every pool index beside them, and records EVERY request each page makes:
//   • from disk, as a report opened from an email or a download is;
//   • served over HTTP with the portal's own report policy, as the portal frames it.
// A request to any other machine fails the check. So does a report whose embedded faces did not load, or
// a policy violation while it was drawn.
//
// WHAT THE REQUESTS ARE READ FROM. Chrome's own record of what the page asked for (Network.requestWillBeSent
// on the page's session), not what reached a server: the network is blocked, so a request that was made
// fails where it would have left, and it is still recorded. Chrome's background traffic is not the page's
// and is not on this session.
//
// THE CONTROLS, because a blind instrument reads exactly like a clean page. Before any real page is
// judged, one report is opened with a font service's stylesheet put back in its head, and the check must
// see that request; and one with its embedded faces taken out, and the check must see no face loaded. If
// either control passes, nothing measured after it means anything, and the check stops with exit 2.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reapOnExit } from "../shared/reap-on-exit.mjs";
import { browserRun } from "../shared/browser-temp-root.mjs";
import { reportCsp } from "../driver/portal-static.mjs";
import { TEXT_FACE, CODE_FACE, REPORT_FONT_STYLE } from "../shared/brand-fonts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const keep = process.argv.includes("--keep");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

// ── THE PAGES ────────────────────────────────────────────────────────────────────────────────────────
const pool = mkdtempSync(join(tmpdir(), "offline-check-pool-"));
const published = spawnSync(process.execPath, [join(ROOT, "bin", "example.mjs"), "--once", "--pool", pool], { encoding: "utf8" });
if (published.status !== 0) { console.error(`the demo publisher failed:\n${published.stderr || published.stdout}`); process.exit(2); }
const pages = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith(".html")) pages.push(p); } };
walk(pool);
const reports = pages.filter((p) => p.endsWith("/report.html"));
if (reports.length !== 4) { console.error(`the demo published ${reports.length} reports, not one per product (4) — nothing to measure`); process.exit(2); }

// The two controls, written beside a real report so its relative paths still resolve.
const sample = readFileSync(reports[0], "utf8");
if (!sample.includes(REPORT_FONT_STYLE)) { console.error("the sample report does not carry the embedded faces, so the controls cannot be built"); process.exit(2); }
const leak = join(dirname(reports[0]), "control-leak.html");
writeFileSync(leak, sample.replace("</title>", '</title><link href="https://api.fontshare.com/v2/css?f[]=satoshi@400&display=swap" rel="stylesheet">'));
const bare = join(dirname(reports[0]), "control-no-faces.html");
writeFileSync(bare, sample.replace(REPORT_FONT_STYLE, ""));

// ── THE SERVER: the pool as the portal would serve a report, with the portal's report policy ─────────
const server = createServer((req, res) => {
  const file = join(pool, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(pool) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  const headers = { "content-type": TYPES[extname(file)] ?? "application/octet-stream" };
  if (file.endsWith(".html")) headers["content-security-policy"] = reportCsp();
  res.writeHead(200, headers);
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

// ── THE BROWSER ──────────────────────────────────────────────────────────────────────────────────────
const { root: browserRoot, profile, env: chromeEnv, keep: keepRoot } = browserRun("report-offline-check-");
if (keep) keepRoot();
const chrome = spawn("google-chrome", [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  // Nothing leaves the machine. A request the page makes still appears in the record below and fails
  // where it would have left; that is how a leak is caught without one being made.
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  `--user-data-dir=${profile}`, "--window-size=1280,900", "--remote-debugging-port=0", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"], detached: true, env: chromeEnv });
reapOnExit(chrome);
const wsUrl = await new Promise((resolve, reject) => {
  let devtools = "";
  const t = setTimeout(() => reject(new Error(`chrome reported no devtools endpoint in 60s:\n${devtools || "(nothing)"}`)), 60000);
  chrome.stderr.on("data", (c) => { devtools += c; const m = devtools.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); resolve(m[0]); } });
});
const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
let requested = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Network.requestWillBeSent") requested.push(m.params.request.url);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener("open", r));
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
const { result: targets } = await send("Target.getTargets");
const target = targets.targetInfos.find((t) => t.type === "page");
const sessionId = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).result.sessionId;
const cmd = (method, params) => send(method, params, sessionId);
const value = async (expr) => (await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value ?? null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await cmd("Page.enable");
await cmd("Network.enable");
// Before any script of the page's own, so a violation raised while the head is parsed is not missed.
await cmd("Page.addScriptToEvaluateOnNewDocument", { source: "window.__violations=[];document.addEventListener('securitypolicyviolation',function(e){window.__violations.push(e.violatedDirective+' '+e.blockedURI)});" });

/** Open one page and report what it asked for, which faces it drew with, and any policy it broke. */
async function open(url) {
  requested = [];
  await cmd("Page.navigate", { url });
  const end = Date.now() + 15000;
  while (Date.now() < end && (await value("document.readyState")) !== "complete") await wait(100);
  await value("document.fonts.ready.then(() => true)");
  await wait(300);
  const faces = await value("JSON.stringify([...document.fonts].map((f) => ({ family: f.family.replace(/[\"']/g, ''), status: f.status })))");
  const violations = await value("JSON.stringify(window.__violations || [])");
  const away = requested.filter((u) => /^https?:/i.test(u) && !u.startsWith(origin));
  return { away, faces: JSON.parse(faces ?? "[]"), violations: JSON.parse(violations ?? "[]"), requested: requested.length };
}
const loaded = (faces, family) => faces.some((f) => f.family === family && f.status === "loaded");

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✕ ${m}`); };
let exit = 0;
try {
  // ── THE CONTROLS FIRST ──────────────────────────────────────────────────────────────────────────────
  const leaked = await open(pathToFileURL(leak).href);
  if (!leaked.away.some((u) => URL.canParse(u) && new URL(u).hostname === "api.fontshare.com")) {
    console.error("report-offline-render-check: a report with a font service put back made no request this check could see. The instrument is blind; nothing below would mean anything.");
    exit = 2;
  }
  const noFaces = await open(pathToFileURL(bare).href);
  if (exit === 0 && (loaded(noFaces.faces, TEXT_FACE) || loaded(noFaces.faces, CODE_FACE))) {
    console.error("report-offline-render-check: a report with its embedded faces taken out still reports them loaded. The font reading is blind; nothing below would mean anything.");
    exit = 2;
  }
  if (exit === 0) {
    console.log(`controls: a planted font stylesheet was caught (${leaked.away.length} request(s)), and a report without its faces loaded none`);
    // ── EVERY PAGE ───────────────────────────────────────────────────────────────────────────────────
    const runs = [];
    for (const page of pages.filter((p) => p !== leak && p !== bare)) {
      const rel = relative(pool, page);
      runs.push([`${rel} (from disk)`, pathToFileURL(page).href, page.endsWith("/report.html")]);
      if (page.endsWith("/report.html")) runs.push([`${rel} (served, report policy)`, `${origin}/${rel}`, true]);
    }
    for (const [name, url, isReport] of runs) {
      const got = await open(url);
      if (!got.requested) { fail(`${name}: the page made no request at all, not even for itself — it was not opened`); continue; }
      for (const u of got.away) fail(`${name}: asked another machine for ${u}`);
      if (!loaded(got.faces, TEXT_FACE)) fail(`${name}: the ${TEXT_FACE} face it carries did not load (${JSON.stringify(got.faces)})`);
      if (isReport && !loaded(got.faces, CODE_FACE)) fail(`${name}: the ${CODE_FACE} face it carries did not load (${JSON.stringify(got.faces)})`);
      for (const v of got.violations) fail(`${name}: broke its content policy: ${v}`);
      if (!got.away.length && !got.violations.length) {
        const size = url.startsWith("file:") ? ` · ${statSync(fileURLToPath(url)).size} bytes` : "";
        console.log(`${name}: no other machine asked, ${got.faces.filter((f) => f.status === "loaded").map((f) => f.family).join(" + ")} loaded${size}`);
      }
    }
    if (failures) { console.error(`\nreport-offline-render-check: ${failures} problem(s).`); exit = 1; }
    else console.log(`\nreport-offline-render-check: ${runs.length} page opening(s), none asked another machine for anything.`);
  }
} finally {
  try { ws.close(); } catch { /* the browser may already be gone */ }
  try { process.kill(-chrome.pid, "SIGTERM"); } catch { /* already exited */ }
  server.close();
  if (keep) console.log(`  kept: ${browserRoot} and the pool at ${pool}`);
  else rmSync(pool, { recursive: true, force: true });
}
process.exit(exit);
