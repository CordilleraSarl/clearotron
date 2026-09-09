// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// headless-page.mjs — did the browser open the page we asked for, or something of its own?
//
// (and, since criteria 3-4, whether this box can draw what that page says)
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────
//
// Seven scripts drive headless Chrome and none of them asked. They cannot ask the obvious way: Chrome is
// launched with the file URL as a COMMAND-LINE ARGUMENT, so there is no navigation call whose response
// could be checked. The page simply becomes whatever Chrome ends up showing.
//
// What it ends up showing, when the file cannot be read, is Chrome's own interstitial — and that page
// has an `<h1>`. `report-screenshot.mjs` asserted `document.querySelector("h1")` and nothing else, so it
// photographed `ERR_ACCESS_DENIED`, wrote 38 KB of grey error page over the README's example frame, and
// exited 0. Measured: the successful run and the failed one differed in the log by an anchor offset and
// a font count, neither of which was asserted on.
//
// Six of the seven were saved only by an unrelated content assertion that happened to be specific enough.
// That is luck, and it is per-script: the next assertion somebody writes to be tolerant removes it.
//
// ── THE DISCRIMINATOR IS THE ADDRESS, NOT THE CONTENT ───────────────────────────────────────────────
//
// `location.href` reads `chrome-error://chromewebdata/` on the interstitial and the requested `file://`
// URL on a real load. It is the one thing the error page cannot fake, because it is not part of the
// document — an `<h1>`, a `<title>`, a body class are all things an arbitrary HTML page can carry, and an
// error page IS an arbitrary HTML page.
//
// A MARKER IS STILL REQUIRED, because the address only proves Chrome opened the file. A file that exists,
// is readable, and is not the artefact this script is about would pass the address check — an empty
// render, a stale page, a half-written document. So the caller names one thing that only its own artefact
// carries, and the verdict says which of the two failed.

import { execFileSync } from "node:child_process";

/** Chrome's own error pages live under this scheme. Nothing a real document is served from does. */
export const CHROME_ERROR_SCHEME = "chrome-error:";
/** What Chrome shows before it has navigated. Not a document, and not a wrong one. */
export const START_PAGE = "about:blank";
/** How long `assertPageLoaded` will wait for the browser to leave its start page. */
export const NAVIGATION_GRACE_MS = 5000;
/** How often it asks, inside that grace. */
export const NAVIGATION_POLL_MS = 100;

/**
 * PURE. Given what the page says about itself, is it the document we asked for?
 *
 * Separated from the evaluation so every branch can be driven — the whole finding here is a check that
 * returned a verdict about a page it never identified, and an arm that could only exercise this through
 * a real browser would be the same shape one level up.
 *
 * @param {string}  href       `location.href` as the page reports it
 * @param {string}  expected   the `file://` URL the caller asked Chrome to open
 * @param {boolean|null} marker  did the caller's own content marker resolve? `null` means not asked
 * @param {string}  markerName  what the marker is, for the message
 */
export function pageVerdict({ href = "", expected = "", marker = null, markerName = "the page's own content", errorText = null } = {}) {
  const said = String(href ?? "");
  // ── THE TWO SHAPES IN THIS REPOSITORY ───────────────────────────────────────────────────────────
  //
  // Four of these scripts call `Page.navigate`, which RETURNS an `errorText` on failure and which none
  // of them read. Three launch Chrome with the URL as an argument and have no response at all. One
  // verdict serves both: `errorText` is checked when the caller has one, and the address is checked
  // either way — because a failed `Page.navigate` can also leave the page at `about:blank`, which no
  // error text describes and which a content check reads as an empty document rather than a failure.
  if (errorText) {
    return { ok: false, kind: "navigate-failed",
      why: `chrome refused to navigate to ${expected}: ${errorText}. The page is whatever it was showing `
        + "before, so anything measured now is about the wrong document." };
  }
  if (!said) {
    return { ok: false, kind: "silent",
      why: "the page reported no address at all, so nothing here identifies what was captured. A "
        + "screenshot taken now certifies an unknown document." };
  }
  if (said.startsWith(CHROME_ERROR_SCHEME)) {
    return { ok: false, kind: "chrome-error",
      why: `chrome could not open ${expected} and is showing ITS OWN error page (${said}). Whatever was `
        + "captured is Chrome's interstitial, not the artefact — and that page carries an `<h1>`, a "
        + "`<title>` and a body, so a content check alone reads it as a success." };
  }
  // ── THE BROWSER'S START PAGE IS NOT A WRONG DOCUMENT ────────────────────────────────────────────
  //
  // `about:blank` is what Chrome shows before it has navigated anywhere. Reaching the check below, it
  // compares unequal to the expected URL and was reported as `wrong-document` — "a redirect, a stale tab
  // or a second page target" — which is a finding about a page. It is not one. Nothing was ever loaded,
  // so nothing about the target document has been measured either way.
  //
  // This mattered because it is what a LOADED BOX produces: three of these scripts launch Chrome with the
  // URL as a command-line argument and cannot wait for a navigation event, so under load the address is
  // read before the browser has moved. A real defect and a slow browser then arrived as the same message,
  // and the arms that exist to catch a wrong page were the ones that fired.
  if (said === START_PAGE || said.startsWith(`${START_PAGE}?`) || said.startsWith(`${START_PAGE}#`)) {
    return { ok: false, kind: "not-navigated",
      why: `chrome is on its start page (${said}) and never reached ${expected}. Nothing about that `
        + "document has been measured, so this is not a finding about the page. TWO THINGS LOOK LIKE "
        + "THIS and the address cannot tell them apart: a navigation that failed without saying so, and "
        + "one that had not happened yet. That is why the caller waits before asking — a verdict of this "
        + "kind means it waited and the browser never left the start page." };
  }
  // NORMALISED ON BOTH SIDES. Chrome resolves and percent-encodes a `file://` argument, so a raw string
  // comparison fails on a path with a space and reports "the wrong document" about the right one.
  const norm = (u) => { try { return new URL(u).href; } catch { return String(u); } };
  if (expected && norm(said) !== norm(expected)) {
    return { ok: false, kind: "wrong-document",
      why: `chrome is showing ${said}, and this run asked for ${expected}. A redirect, a stale tab or a `
        + "second page target — whichever it is, the frame is not of the document this script names." };
  }
  if (marker === false) {
    return { ok: false, kind: "not-the-artefact",
      why: `chrome opened ${said} and ${markerName} is not in it. The address is right and the CONTENT is `
        + "not what this script is about — an empty render, a stale file, or a document half written." };
  }
  if (marker === null) {
    return { ok: false, kind: "unmarked",
      why: "no content marker was asked for, so this run proves only that a file opened. Name one thing "
        + "the artefact carries and nothing else does — an address alone cannot tell an artefact from any "
        + "other readable file." };
  }
  return { ok: true, kind: "loaded", why: `${said} is open and ${markerName} is in it.` };
}

/**
 * Ask the live page, then judge. `evaluate` runs an expression and returns its value.
 *
 * The caller passes its own CDP `Runtime.evaluate` wrapper, because each of these scripts built its own
 * handshake before this file existed and rewriting seven of them to share one is a bigger change than the
 * defect warrants. What they must share is the QUESTION.
 */
export async function assertPageLoaded(evaluate, { expected, marker = null, markerName = "the page's own content", what = "this page", errorText = null,
  graceMs = NAVIGATION_GRACE_MS, pollMs = NAVIGATION_POLL_MS,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  // ── WAIT FOR THE BROWSER TO LEAVE ITS START PAGE, THEN JUDGE ─────────────────────────────────────
  //
  // Three of these scripts launch Chrome with the URL as an argument and get no response to wait on, so
  // the first read of `location.href` can land before the browser has moved. On an idle box it never
  // does; under a full parallel suite it did, repeatedly, and the arms reported the start page as a
  // wrong document.
  //
  // BOUNDED, AND THE BOUND IS THE POINT. This waits for the browser to become ready — it does not wait
  // for the page to become correct. If the address is anything other than the start page it is judged
  // immediately, so a genuinely wrong document still fails on the first read and fails as fast as it did
  // before. Only the "nothing has happened yet" case costs time, and only up to the grace.
  //
  // When the grace runs out the verdict is `not-navigated`, which is a could-not-look and says so.
  // Deadline arithmetic is the caller's to drive: `sleep` and `now` are injected so the exhausted path
  // can be exercised without a browser and without waiting.
  let href = await evaluate("location.href");
  if (String(href ?? "") === START_PAGE) {
    const until = now() + graceMs;
    while (String(href ?? "") === START_PAGE && now() < until) {
      await sleep(pollMs);
      href = await evaluate("location.href");
    }
  }
  const found = marker == null ? null : Boolean(await evaluate(`Boolean(${marker})`));
  const verdict = pageVerdict({ href, expected, marker: found, markerName, errorText });
  if (!verdict.ok) {
    console.error(`${what}: ${verdict.why}`);
    return { ...verdict, href };
  }
  return { ...verdict, href };
}

/**
 * Navigate, and refuse if chrome says it could not.
 *
 * `Page.navigate` RETURNS `{ frameId, loaderId, errorText }`, and every caller in this repository threw
 * the result away. So a portal that was not listening, a DNS failure, a refused connection — each left
 * the page showing whatever it had before, and the assertions that followed measured the previous page
 * or an empty one. Six of these scripts were saved from reporting a pass by an unrelated content
 * assertion that happened to be specific enough; that is luck, per script, and the next person to write
 * a more tolerant assertion removes it.
 *
 * THROWS rather than returning a verdict, because there is nothing sensible for a caller to do with a
 * navigation that did not happen, and the alternative — a boolean somebody forgets to read — is the
 * shape this fixes.
 */
export async function navigateOrRefuse(cmd, url, { what = "this page" } = {}) {
  const r = await cmd("Page.navigate", { url });
  const errorText = r?.result?.errorText ?? r?.errorText ?? null;
  if (errorText) {
    const verdict = pageVerdict({ errorText, expected: url });
    throw new Error(`${what}: ${verdict.why}`);
  }
  return r;
}

/**
 * Does this dumped DOM belong to chrome's own error page?
 *
 * For the callers that use `--dump-dom` rather than CDP: there is no `location.href` to ask, only the
 * bytes chrome printed. Chrome's interstitial is recognisable by the error-code element it always
 * carries and by its `neterror`/`chrome-error` markers — none of which a document we authored has.
 *
 * DELIBERATELY NARROW. A page that merely CONTAINS the words "error" or "denied" is not this; a report
 * about a refused search would say both. What is matched is chrome's own furniture.
 */
export function chromeErrorPage(dom = "") {
  const t = String(dom);
  return /chrome-error:\/\//.test(t)
    || /id="?main-frame-error"?/.test(t)
    || /jstcache=|<body[^>]*\bid="?neterror"?/.test(t);
}

// ── CAN THIS BOX DRAW WHAT THE PAGE SAYS? (criteria 3 and 4) ─────────────────────────────────────────
//
// The default demo product is a full-country search, and its report carries the mark's native-script
// renderings — ベンクリ, ベンコリ, ヴェンコリ. They are LOAD-BEARING: the verdict sentence reads "A live
// Japanese class 9 registration reading ベンクリ covers measuring and testing instruments".
//
// On a box with no CJK-capable font those render as `□□□`, twice in the captured frame, and nothing
// says so. The script's own comment already names this class of failure — "the failure is a screenshot
// in the wrong typeface that nobody notices until it is in the README" — and it waits for
// `document.fonts.ready` to prevent it. That solved the TYPEFACE problem and left the WRITING-SYSTEM one,
// in the same script, with the same failure mode.
//
// ASKED OF FONTCONFIG, not of the page. `document.fonts` reports the faces a page ASKED for and got; it
// says nothing about whether the glyphs exist. `fc-list :lang=ja` answers the question actually being
// asked — can anything on this box draw these characters — and it is the same source a reader would
// check by hand.

/** Han, Hiragana, Katakana, Hangul — the ranges a Latin-only font set leaves as tofu. */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/gu;

/** How many characters in this text need a CJK-capable font. */
export function cjkCharsIn(text = "") {
  return (String(text).match(CJK) ?? []).length;
}

/**
 * PURE. Given what the page needs and what the box has, is the frame trustworthy?
 *
 * `covering` is the number of fonts fontconfig reports for the writing system — `null` means the caller
 * could not ask, which is NOT zero: a box where `fc-list` is missing is a box this cannot judge, and
 * reporting it as "no coverage" would refuse a machine that may be fine.
 */
export function cjkVerdict({ cjkChars = 0, covering = 0, sample = "" } = {}) {
  if (!cjkChars) return { ok: true, kind: "no-cjk", why: "the page carries no CJK characters." };
  if (covering === null) {
    return { ok: true, kind: "unknown-coverage",
      why: `the page carries ${cjkChars} CJK character(s) and this run could not ask fontconfig what can `
        + "draw them. Not a refusal — a box that cannot be asked is not a box known to be missing fonts — "
        + "but the frame is unverified on that point." };
  }
  if (covering > 0) {
    return { ok: true, kind: "covered",
      why: `the page carries ${cjkChars} CJK character(s) and ${covering} installed font(s) cover them.` };
  }
  return { ok: false, kind: "tofu",
    why: `the page carries ${cjkChars} CJK character(s)${sample ? ` (${sample})` : ""} and NO installed `
      + "font can draw them — `fc-list :lang=ja` reports none. They render as empty boxes, and the frame "
      + "would go out with the mark's own native-script rendering missing. Install a CJK font (on Debian "
      + "and Ubuntu: `fonts-noto-cjk`), or set XDG_DATA_HOME to a directory holding one." };
}

/**
 * How many installed fonts cover a writing system, per fontconfig — or `null` if we could not ask.
 *
 * `null` IS THE POINT. `fc-list` missing, or a fontconfig that errors, is a box this cannot judge, and
 * collapsing that into 0 would refuse a machine that may be perfectly able to draw the page. The caller
 * treats the two differently, which is the whole reason this returns three values and not a number.
 */
export function fontsCovering(lang = "ja", { run } = {}) {
  try {
    const out = run
      ? run(["-f", "%{file}\\n", `:lang=${lang}`])
      : execFileSync("fc-list", ["-f", "%{file}\\n", `:lang=${lang}`], { encoding: "utf8", timeout: 20_000 });
    return String(out).split("\n").map((l) => l.trim()).filter(Boolean).length;
  } catch {
    return null;
  }
}
