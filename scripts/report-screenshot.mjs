// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// report-screenshot.mjs — decision 4. One frame of the example report, for the public README.
//
// HOW TO REGENERATE IT (the report is not tracked — it is RENDERED from the tracked run):
//
//     npm run example -- --once            # publishes examples/sample-run through the real publisher
//     node scripts/report-screenshot.mjs <the report.html path it printed>
//
// The demo prints the path it wrote. There is no committed `report.html` anywhere in this repository —
// `examples/sample-run/` holds the run's ARTIFACTS and the publisher renders the page from them, which
// is the whole point of the sample: it proves the real publisher works, rather than shipping a file
// somebody could have hand-written.
//
// NETWORK IS ALLOWED HERE, AND THAT IS THE OPPOSITE OF THE RENDER CHECKS. `clearances-render-check.mjs`
// blocks DNS on purpose — a layout check must fail the way CI fails, in fallback fonts, because that is
// when a cell wraps and a table overflows. This is not a layout check. It is a picture of what a client
// receives, so it loads the brand webfonts the client's browser loads. Two scripts, two intents; do not
// "fix" either to match the other.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(process.argv[3] ?? join(ROOT, "docs", "assets", "example-report.png"));
const WIDTH = 1280, HEIGHT = 1040;
// The frame starts here rather than at the top of the document — see the scroll block below.
const ANCHOR = process.argv.includes("--anchor") ? process.argv[process.argv.indexOf("--anchor") + 1] : "h1";

const src = process.argv[2];
if (!src) { console.error("usage: node scripts/report-screenshot.mjs <report.html> [out.png]"); process.exit(2); }
const page = resolve(src);
if (!existsSync(page)) {
  console.error(`report-screenshot: ${page} does not exist.`);
  console.error("  It is RENDERED, not tracked — run `npm run example -- --once` and pass the path it prints.");
  process.exit(2);
}

const userDir = mkdtempSync(join(tmpdir(), "report-shot-"));
const chrome = spawn("google-chrome", [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--user-data-dir=${userDir}`, `--window-size=${WIDTH},${HEIGHT}`,
  "--remote-debugging-port=0", `file://${page}`,
], { stdio: ["ignore", "pipe", "pipe"] });

let stderr = "";
const wsUrl = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`chrome reported no devtools endpoint in 60s. Its stderr:\n${stderr || "(nothing)"}`)), 60000);
  chrome.stderr.on("data", (c) => { stderr += c; const m = stderr.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); res(m[0]); } });
});

const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener("open", r));
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });

// ATTACH TO THE PAGE TARGET FIRST. The devtools URL chrome prints is the BROWSER endpoint, and
// `Page.*` does not exist there — it answers "'Page.captureScreenshot' wasn't found", which reads like a
// version problem and is not one. Same handshake clearances-render-check.mjs uses.
const { result: targets } = await send("Target.getTargets");
const target = targets.targetInfos.find((t) => t.type === "page");
if (!target) { console.error("report-screenshot: chrome opened no page target"); chrome.kill(); process.exit(1); }
const { result: sess } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
const sessionId = sess.sessionId;
const cmd = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, sessionId, method, params })); });

await cmd("Page.enable");
// The fonts are the point of allowing the network at all, so wait for them rather than for a fixed
// sleep: a timer long enough on this box is a timer too short on a slower one, and the failure is a
// screenshot in the wrong typeface that nobody notices until it is in the README.
await cmd("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
await new Promise((r) => setTimeout(r, 1200));   // layout settle after the faces swap in

// CLIP, DO NOT SCROLL. The first viewport of a delivered report is a full-bleed cover — the house
// mark and nothing else — and captured raw this produced a picture of a logo, which says nothing about
// what the engine makes. The obvious fix does not work either: `window.scrollTo` is a no-op on this
// page (measured — scrollY stays 0), because the document scrolls an inner element rather than the
// window. So the frame is taken as a CLIP in document coordinates, which does not care what scrolls.
const box = await cmd("Runtime.evaluate", { returnByValue: true, expression: `(() => {
  const h = document.querySelector(${JSON.stringify(ANCHOR)});
  if (!h) return null;
  const r = h.getBoundingClientRect();
  return { top: r.top + (document.scrollingElement ? document.scrollingElement.scrollTop : 0) };
})()` });
const top = box?.result?.result?.value?.top;
if (typeof top !== "number") {
  console.error(`report-screenshot: no element matched ${JSON.stringify(ANCHOR)} — nothing to anchor the frame to.`);
  chrome.kill(); process.exit(1);
}
const y = Math.max(top - 56, 0);   // a little air above the title, so the page does not read as cropped
const shot = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
  clip: { x: 0, y, width: WIDTH, height: HEIGHT, scale: 1 } });
if (!shot?.result?.data) { console.error(`report-screenshot: chrome returned no image. ${JSON.stringify(shot).slice(0, 300)}`); chrome.kill(); process.exit(1); }
writeFileSync(OUT, Buffer.from(shot.result.data, "base64"));
const loaded = await cmd("Runtime.evaluate", { expression: "document.fonts.size + ':' + [...document.fonts].filter(f=>f.status==='loaded').length", returnByValue: true });
chrome.kill();
console.log(`report-screenshot: wrote ${OUT} (${WIDTH}x${HEIGHT}, anchor ${JSON.stringify(ANCHOR)} at y=${Math.round(y)}, fonts ${loaded?.result?.result?.value ?? "?"})`);
