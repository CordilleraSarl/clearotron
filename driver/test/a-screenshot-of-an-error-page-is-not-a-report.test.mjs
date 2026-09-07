// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 227 — `report-screenshot.mjs` wrote the README's example frame and exited 0 whether or
// not it photographed the report.
//
// The only content assertion was `document.querySelector("h1")`. Chrome's `ERR_ACCESS_DENIED`
// interstitial HAS an `<h1>` — "Access to the file was denied" — so the anchor resolved, the clip was
// taken, and the run ended. 38 KB of grey error page over the README's example. The successful run and
// the failed one differed in the log by an anchor offset and a font count, neither asserted on.
//
// The scripts cannot check navigation the obvious way: three launch chrome with the URL as a COMMAND-LINE
// ARGUMENT and have no response at all. Four call `Page.navigate`, which RETURNS an `errorText` — and
// every one of them threw the result away. Six were saved from reporting a pass by an unrelated content
// assertion that happened to be specific enough. That is luck, per script.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pageVerdict, navigateOrRefuse, chromeErrorPage, CHROME_ERROR_SCHEME, START_PAGE, assertPageLoaded,
  cjkCharsIn, cjkVerdict, fontsCovering } from "../../scripts/headless-page.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const SHOT = join(REPO, "scripts", "report-screenshot.mjs");

// ── THE PURE HALF ───────────────────────────────────────────────────────────────────────────────────

test("227 chrome's own error page is refused, however good its content looks", () => {
  const v = pageVerdict({ href: `${CHROME_ERROR_SCHEME}//chromewebdata/`, expected: "file:///r.html", marker: true });
  assert.equal(v.ok, false);
  assert.equal(v.kind, "chrome-error");
  // MARKER TRUE AND STILL REFUSED. The address decides first, because an error page is an ordinary HTML
  // document and can carry anything a content check looks for.
  assert.match(v.why, /ITS OWN error page/);
});

test("227 a page that reports no address certifies nothing", () => {
  assert.equal(pageVerdict({ href: "", expected: "file:///r.html", marker: true }).kind, "silent");
});

test("227 a different document is caught even when it is a real one", () => {
  const v = pageVerdict({ href: "file:///other.html", expected: "file:///r.html", marker: true });
  assert.equal(v.kind, "wrong-document");
});

// THIS ASSERTION USED TO SIT IN THE ARM ABOVE AND EXPECTED `wrong-document` (tracker issue 273). It was
// wrong in the way that matters: the start page is not a document this run opened, so calling it "a
// redirect, a stale tab or a second page target" sent a reader looking for a page that never existed.
// Under a loaded box that is the message the arms produced, which is how a slow browser and a real defect
// became indistinguishable.
test("273 the browser's start page is a could-not-look, not a wrong document", () => {
  const v = pageVerdict({ href: START_PAGE, expected: "file:///r.html", marker: true });
  assert.equal(v.kind, "not-navigated",
    "the start page is still classified as a document, so a browser that never moved reads as a page that "
    + "was wrong");
  assert.ok(!v.ok, "a page that was never reached must not read as a pass");
  // AND THE MESSAGE MUST NOT PICK A CAUSE. A navigation that failed silently and one that has not
  // happened yet both land here, and the address cannot separate them. Claiming either is the same
  // over-reach one level down.
  assert.match(v.why, /had not happened yet/, "the message does not say the browser may simply not be ready");
  assert.match(v.why, /failed without saying so/, "the message does not admit a silent navigation failure");
  assert.ok(!/redirect|stale tab/.test(v.why),
    "the message still offers the wrong-document explanations, which is what sent readers hunting");
});

test("227 the right address with the wrong content is its own answer", () => {
  const v = pageVerdict({ href: "file:///r.html", expected: "file:///r.html", marker: false, markerName: "a run id" });
  assert.equal(v.kind, "not-the-artefact");
  assert.match(v.why, /a run id is not in it/,
    "the message does not name what was looked for, so a reader cannot tell which half failed");
});

test("227 asking for no marker at all is a could-not-look, not a pass", () => {
  // An address proves a file opened. It cannot tell an artefact from any other readable file, and a
  // verdict of `ok` there would be the original defect with a new spelling.
  assert.equal(pageVerdict({ href: "file:///r.html", expected: "file:///r.html", marker: null }).kind, "unmarked");
  assert.equal(pageVerdict({ href: "file:///r.html", expected: "file:///r.html", marker: null }).ok, false);
});

test("227 a path with a space is the same document, not a different one", () => {
  // Chrome resolves and percent-encodes the URL it was given, so a raw string comparison reports "the
  // wrong document" about the right one — a refusal that would send a reader looking for a redirect.
  assert.equal(pageVerdict({ href: "file:///a%20b.html", expected: "file:///a b.html", marker: true }).ok, true);
});

test("227 a navigation chrome refused throws, rather than returning something to ignore", async () => {
  // `Page.navigate` returns `{ errorText }` and every caller in this repository dropped it. A boolean
  // somebody forgets to read is the shape being fixed, so this throws.
  await assert.rejects(
    () => navigateOrRefuse(async () => ({ result: { errorText: "net::ERR_CONNECTION_REFUSED" } }), "http://127.0.0.1:1/portal", { what: "x" }),
    /ERR_CONNECTION_REFUSED/);
  const ok = await navigateOrRefuse(async () => ({ result: { frameId: "F" } }), "http://127.0.0.1:8/portal");
  assert.deepEqual(ok, { result: { frameId: "F" } }, "a clean navigation no longer returns the response its caller needs");
});

test("227 the dumped-DOM detector knows chrome's furniture from a report that says 'error'", () => {
  assert.equal(chromeErrorPage('<body id="neterror"><div id="main-frame-error">ERR_ACCESS_DENIED</div>'), true);
  // NARROW ON PURPOSE. A clearance report about a refused search says "error" and "denied" in prose, and
  // a detector that fired on those would refuse real reports — which is how a guard gets deleted.
  assert.equal(chromeErrorPage('<title>{"kept":["a"]}</title><h1>Clearance</h1><p>the search was refused, an error</p>'), false);
});

// ── AND THE SCRIPTS ACTUALLY ASK ────────────────────────────────────────────────────────────────────

test("227 every script that navigates reads the answer it gets back", () => {
  for (const f of ["ai-page-render-check", "clearances-render-check", "home-render-check", "revisit-render-check"]) {
    const src = readFileSync(join(REPO, "scripts", `${f}.mjs`), "utf8");
    const bare = [...src.matchAll(/cmd\(['"]Page\.navigate['"], \{ url: (.+?) \}\)/g)].map((m) => m[1]);
    const unchecked = bare.filter((u) => !/about:blank/.test(u));
    assert.deepEqual(unchecked, [],
      `${f}.mjs still navigates without reading errorText: ${unchecked.join(", ")}. A portal that was not `
      + "listening leaves the page showing whatever it had before, and the assertions after it measure that");
    assert.match(src, /navigateOrRefuse/, `${f}.mjs does not use the shared check`);
  }
});

test("227 the screenshot's proof of being a report is not a tag every page has", () => {
  const src = readFileSync(SHOT, "utf8");
  assert.match(src, /assertPageLoaded/, "the screenshot no longer asks whether it opened the report");
  assert.match(src, /const MARKER =[^\n]*data-run-id/,
    "the marker is not the run id — `h1` is the ANCHOR and is on chrome's error page too, so it cannot "
    + "also be the proof that this IS a report");
  assert.match(src, /wrote \$\{OUT\} of run \$\{runId/,
    "the success line does not name what it certified, so a run that photographed the wrong thing reads "
    + "the same as one that did not");
});

// ── DRIVEN AT THE DOOR ──────────────────────────────────────────────────────────────────────────────

const chromeHere = spawnSync("google-chrome", ["--version"], { encoding: "utf8" }).status === 0;

test("227 THE DRIVE — an unreadable report exits non-zero and says the page is not one", (ctx) => {
  if (!chromeHere) return ctx.skip("google-chrome is not on this box, so the door cannot be driven here");
  const dir = mkdtempSync(join(tmpdir(), "shot-227-"));
  try {
    const page = join(dir, "report.html");
    writeFileSync(page, '<html><body><h1>a report</h1><div data-run-id="r-1"></div></body></html>');
    chmodSync(page, 0o000);   // EXISTS and cannot be READ — `existsSync` passes, chrome does not
    const r = spawnSync(process.execPath, [SHOT, page, join(dir, "out.png")], { encoding: "utf8", timeout: 180_000 });
    assert.notEqual(r.status, 0,
      `report-screenshot exited ${r.status} on a file chrome cannot read:\n${r.stdout}\n${r.stderr}`);
    assert.match(`${r.stdout}${r.stderr}`, /error page|could not open/i,
      "the refusal does not say the captured page was not the report");
    assert.ok(!existsSync(join(dir, "out.png")),
      "an image was written for a page that was never the report — that file is what reaches the README");
  } finally { try { chmodSync(join(dir, "report.html"), 0o600); } catch {} rmSync(dir, { recursive: true, force: true }); }
});

test("227 THE CONTROL — a readable report still succeeds, and the log names the run it certified", (ctx) => {
  if (!chromeHere) return ctx.skip("google-chrome is not on this box, so the door cannot be driven here");
  const dir = mkdtempSync(join(tmpdir(), "shot-227-ok-"));
  try {
    const page = join(dir, "report.html");
    writeFileSync(page, '<html><body style="height:2000px"><h1>a report</h1>'
      + '<div data-run-id="run-abc123"></div></body></html>');
    const out = join(dir, "out.png");
    const r = spawnSync(process.execPath, [SHOT, page, out], { encoding: "utf8", timeout: 180_000 });
    assert.equal(r.status, 0, `a readable report was refused:\n${r.stdout}\n${r.stderr}`);
    assert.ok(existsSync(out), "no image was written for a report that opened");
    assert.match(r.stdout, /run run-abc123/,
      "the success line does not name the run it certified — without the control, the arm above only "
      + "proves the script can fail, not that it can still succeed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 227 CRITERIA 3 AND 4 · SILENT TOFU ──────────────────────────────────────────────────────────────
//
// The default demo product's report carries the mark's native-script renderings — ベンクリ, ベンコリ,
// ヴェンコリ — and they are load-bearing: the verdict sentence reads "A live Japanese class 9
// registration reading ベンクリ covers measuring and testing instruments". On a box with no CJK-capable
// font those render as empty boxes, twice in the captured frame, and nothing said so.
//
// The script already waited for `document.fonts.ready` against exactly this class of failure — its own
// comment says "the failure is a screenshot in the wrong typeface that nobody notices until it is in the
// README". That solved the TYPEFACE half and left the WRITING-SYSTEM half, in the same script.

test("227 the characters that need a CJK font are counted, and Latin text is not", () => {
  assert.equal(cjkCharsIn("A live Japanese class 9 registration reading ベンクリ covers"), 4);
  assert.equal(cjkCharsIn("VENQORI covers measuring and testing instruments"), 0);
  assert.ok(cjkCharsIn("商標") > 0, "Han characters are not counted, so a Chinese-script report reads as Latin");
  assert.ok(cjkCharsIn("상표") > 0, "Hangul is not counted");
});

test("227 CJK text with no font that can draw it is refused, and the message names the glyphs", () => {
  const v = cjkVerdict({ cjkChars: 42, covering: 0, sample: "ベンクリ" });
  assert.equal(v.ok, false);
  assert.equal(v.kind, "tofu");
  assert.match(v.why, /ベンクリ/, "the refusal does not show what would be lost, so a reader cannot judge it");
  assert.match(v.why, /fonts-noto-cjk|XDG_DATA_HOME/, "the refusal names no way out");
});

test("227 BOTH DIRECTIONS — the same text with a font that covers it is silent", () => {
  // A one-armed fix here is indistinguishable from deleting the check, which is this issue's own words.
  assert.equal(cjkVerdict({ cjkChars: 42, covering: 3 }).ok, true);
  assert.equal(cjkVerdict({ cjkChars: 42, covering: 3 }).kind, "covered");
  // AND A REPORT WITH NO CJK IS SILENT WHATEVER THE BOX HAS — the check must not fire on every report.
  assert.equal(cjkVerdict({ cjkChars: 0, covering: 0 }).kind, "no-cjk");
});

test("227 a box that could not be ASKED is not a box known to be missing fonts", () => {
  // `fc-list` absent is a could-not-look. Collapsing it into 0 would refuse a machine that may be fine —
  // and this script writes an image a human then puts in the README, so a false refusal is expensive.
  const v = cjkVerdict({ cjkChars: 42, covering: null });
  assert.equal(v.ok, true);
  assert.equal(v.kind, "unknown-coverage");
  assert.match(v.why, /could not ask/, "the could-not-look is reported as coverage rather than as a gap in the check");
  assert.equal(fontsCovering("ja", { run: () => { throw new Error("no fc-list"); } }), null,
    "a fontconfig that cannot be run answers 0, which reads as a finding");
});

test("227 THE DRIVE — a CJK report on a box with no CJK font refuses and writes nothing", (ctx) => {
  if (!chromeHere) return ctx.skip("google-chrome is not on this box, so the door cannot be driven here");
  const covering = fontsCovering("ja");
  if (covering !== 0) return ctx.skip(`this box reports ${covering} font(s) with Japanese coverage, so the `
    + "no-font direction cannot be produced here — drive it where `fc-list :lang=ja` is empty");
  const dir = mkdtempSync(join(tmpdir(), "shot-227-cjk-"));
  try {
    const page = join(dir, "report.html");
    writeFileSync(page, '<html><body style="height:1500px"><h1>a report</h1><div data-run-id="run-jp1"></div>'
      + "<p>A live Japanese class 9 registration reading ベンクリ covers measuring instruments</p></body></html>");
    const out = join(dir, "out.png");
    const r = spawnSync(process.execPath, [SHOT, page, out], { encoding: "utf8", timeout: 180_000 });
    assert.notEqual(r.status, 0, `the screenshot succeeded on a box that cannot draw the report's own glyphs:\n${r.stdout}`);
    assert.match(r.stderr, /ベンクリ/, "the refusal does not name the glyphs that would be lost");
    assert.ok(!existsSync(out),
      "an image was written anyway — that file is what a human copies into the README, and it would carry "
      + "empty boxes where the mark's native-script rendering should be");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── tracker issue 273: the wait that makes the verdict above reachable ────────────────────────────────
//
// Driven with `sleep` and `now` injected, so both paths run in microseconds and neither needs a browser.
// The exhausted path is the one worth having: it is what a loaded box produces, and it was previously
// reported as a wrong document.

/** An `evaluate` that reports the start page for the first `blankReads` asks, then the real address. */
function evaluateAfter(blankReads, href) {
  let asks = 0;
  return async (expr) => {
    if (expr !== "location.href") return true;
    asks++;
    return asks <= blankReads ? START_PAGE : href;
  };
}

test("273 a browser that arrives late is waited for, not failed", async () => {
  let slept = 0;
  const v = await assertPageLoaded(evaluateAfter(3, "file:///r.html"), {
    expected: "file:///r.html", marker: "true", markerName: "a run id",
    sleep: async (ms) => { slept += ms; }, now: () => slept,
  });
  assert.equal(v.kind, "loaded", `a browser that navigated on the fourth ask was failed: ${v.why}`);
  assert.ok(slept > 0, "nothing waited, so this arm proves nothing about the wait");
});

test("273 the wait is bounded, and running out is a could-not-look", async () => {
  let slept = 0;
  const v = await assertPageLoaded(async (expr) => (expr === "location.href" ? START_PAGE : true), {
    expected: "file:///r.html", marker: "true", graceMs: 1000, pollMs: 100,
    sleep: async (ms) => { slept += ms; }, now: () => slept,
  });
  assert.equal(v.kind, "not-navigated", "a browser that never moved was reported as something else");
  assert.ok(!v.ok, "an exhausted wait must not read as a pass");
  assert.ok(slept >= 1000 && slept <= 1200,
    `the wait did not respect its own bound — it slept ${slept}ms against a 1000ms grace`);
});

test("273 a page that IS wrong still fails at once, without spending the grace", async () => {
  // The wait is for the browser to become ready, never for the page to become correct. A wrong document
  // that waited would turn every real defect into a slow one.
  let slept = 0;
  const v = await assertPageLoaded(async (expr) => (expr === "location.href" ? "file:///other.html" : true), {
    expected: "file:///r.html", marker: "true",
    sleep: async (ms) => { slept += ms; }, now: () => slept,
  });
  assert.equal(v.kind, "wrong-document", "a genuinely wrong document is no longer caught");
  assert.equal(slept, 0, "a wrong document was waited on, so every real defect now costs the full grace");
});
