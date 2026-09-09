// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// report-screenshot.mjs — decision 4. One frame of the example report, for the public README.
//
// HOW TO REGENERATE IT (the report is not tracked — it is RENDERED from the tracked run):
//
//     npm run example -- --once            # publishes demo through the real publisher
//     node scripts/report-screenshot.mjs <the report.html path it printed>
//
// The demo prints the path it wrote. There is no committed `report.html` anywhere in this repository —
// `demo/` holds the run's ARTIFACTS and the publisher renders the page from them, which
// is the whole point of the sample: it proves the real publisher works, rather than shipping a file
// somebody could have hand-written.
//
// NETWORK IS ALLOWED HERE, AND THAT IS THE OPPOSITE OF THE RENDER CHECKS. `clearances-render-check.mjs`
// blocks DNS on purpose — a layout check must fail the way CI fails, in fallback fonts, because that is
// when a cell wraps and a table overflows. This is not a layout check. It is a picture of what a client
// receives, so it loads the brand webfonts the client's browser loads. Two scripts, two intents; do not
// "fix" either to match the other.
import { spawn } from "node:child_process";
import { assertPageLoaded, cjkCharsIn, cjkVerdict, fontsCovering } from "./headless-page.mjs";   // did chrome open the report, or its own error page?
import { writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserRun } from "../shared/browser-temp-root.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(process.argv[3] ?? join(ROOT, "docs", "assets", "example-report.png"));
const WIDTH = 1280, HEIGHT = 1040;
// The frame starts here rather than at the top of the document — see the scroll block below.
const ANCHOR = process.argv.includes("--anchor") ? process.argv[process.argv.indexOf("--anchor") + 1] : "h1";
// WHAT ONLY A REPORT CARRIES. `h1` is the ANCHOR — where to start the frame — and it is on every HTML
// page including Chrome's error interstitial, so it cannot also be the proof that this IS a report.
const MARKER = process.argv.includes("--marker") ? process.argv[process.argv.indexOf("--marker") + 1] : "[data-run-id]";

const src = process.argv[2];
if (!src) { console.error("usage: node scripts/report-screenshot.mjs <report.html> [out.png]"); process.exit(2); }
const page = resolve(src);
if (!existsSync(page)) {
  console.error(`report-screenshot: ${page} does not exist.`);
  console.error("  It is RENDERED, not tracked — run `npm run example -- --once` and pass the path it prints.");
  process.exit(2);
}

// The profile goes inside a run root whose TMPDIR the browser inherits, so the singleton
// lock it writes there leaves with the root instead of accumulating in the shared one.
const { profile: userDir, env: chromeEnv } = browserRun("report-shot-");
const chrome = spawn("google-chrome", [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--user-data-dir=${userDir}`, `--window-size=${WIDTH},${HEIGHT}`,
  "--remote-debugging-port=0", `file://${page}`,
], { stdio: ["ignore", "pipe", "pipe"], env: chromeEnv });

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

// ── IS THIS THE REPORT, OR CHROME'S OWN ERROR PAGE? ──────────────────────────────────────────────────
//
// Chrome is launched with the file URL as an ARGUMENT, so there is no navigation response to check and
// nothing here ever asked. When the file could not be read, Chrome showed `ERR_ACCESS_DENIED` — a page
// with an `<h1>` — the anchor below resolved against it, the clip was taken, and this exited 0 having
// written 38 KB of grey error page over the README's example frame. The successful run and the failed
// one differed in the log by an anchor offset and a font count, neither of which was asserted on.
//
// `existsSync` above does not cover it: a file that EXISTS and cannot be READ passes that check and
// fails in Chrome. So does a file that is readable and is not a report.
//
// THE MARKER IS THE RUN ID, not a tag. `h1` is what the error page has; `[data-run-id]` is what only a
// rendered report has, and naming it in the log is what makes the success line say what it certified
// rather than "an h1 was found".
const evaluate = async (expression) => {
  const r = await cmd("Runtime.evaluate", { expression, returnByValue: true });
  return r?.result?.result?.value;
};
const loaded = await assertPageLoaded(evaluate, {
  expected: `file://${page}`,
  marker: `document.querySelector(${JSON.stringify(MARKER)})`,
  markerName: `a report element (${MARKER})`,
  what: "report-screenshot",
});
if (!loaded.ok) { chrome.kill(); process.exit(1); }
const runId = await evaluate(`(document.querySelector(${JSON.stringify(MARKER)})?.getAttribute("data-run-id") ?? "")`);

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
// ── CAN THIS BOX DRAW WHAT THE PAGE SAYS? ───────────────────────────────────────────────────────────
//
// The default demo product's report carries the mark's native-script renderings — ベンクリ, ベンコリ,
// ヴェンコリ — and they are load-bearing: the verdict sentence reads "A live Japanese class 9
// registration reading ベンクリ covers measuring and testing instruments". With no CJK-capable font
// those render as empty boxes, twice in the captured frame, and nothing said so.
//
// The wait for `document.fonts.ready` above was written against exactly this class — "the failure is a
// screenshot in the wrong typeface that nobody notices until it is in the README" — and solved the
// TYPEFACE half. This is the WRITING-SYSTEM half, in the same script.
//
// REFUSES rather than warns. This writes an image that goes into the README by hand; a warning on a
// terminal nobody is reading when the file is already written is the shape that produced the defect
// above it. `--allow-tofu` is there for a reader who genuinely wants the frame anyway and has been told
// what is in it.
const pageText = await evaluate("document.body ? document.body.innerText : ''");
const cjkChars = cjkCharsIn(pageText);
const glyphs = cjkVerdict({ cjkChars, covering: fontsCovering("ja"),
  sample: (String(pageText).match(/[\u3040-\u30ff\u4e00-\u9fff]{2,8}/u) ?? [])[0] ?? "" });
if (!glyphs.ok && !process.argv.includes("--allow-tofu")) {
  console.error(`report-screenshot: ${glyphs.why}`);
  console.error("  Pass --allow-tofu to capture it anyway, knowing the frame is missing those glyphs.");
  chrome.kill(); process.exit(1);
}
if (!glyphs.ok) console.error(`report-screenshot: WARNING — ${glyphs.why} Capturing anyway (--allow-tofu).`);

const y = Math.max(top - 56, 0);   // a little air above the title, so the page does not read as cropped
const shot = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
  clip: { x: 0, y, width: WIDTH, height: HEIGHT, scale: 1 } });
if (!shot?.result?.data) { console.error(`report-screenshot: chrome returned no image. ${JSON.stringify(shot).slice(0, 300)}`); chrome.kill(); process.exit(1); }
writeFileSync(OUT, Buffer.from(shot.result.data, "base64"));
const fonts = await cmd("Runtime.evaluate", { expression: "document.fonts.size + ':' + [...document.fonts].filter(f=>f.status==='loaded').length", returnByValue: true });
chrome.kill();
// NAMES WHAT IT CERTIFIED. "an h1 was found" is true of the error page this used to photograph; the
// run id is read out of the document and is the thing a reader can check against the report they meant.
console.log(`report-screenshot: wrote ${OUT} of run ${runId || "(no run id in the page)"} (${WIDTH}x${HEIGHT}, anchor ${JSON.stringify(ANCHOR)} at y=${Math.round(y)}, fonts ${fonts?.result?.result?.value ?? "?"}, ${glyphs.kind})`);
