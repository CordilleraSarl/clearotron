// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// headless-page.mjs — did the browser open the page we asked for, or something of its own?
//
// ── WHY THIS EXISTS (tracker issue 227) ─────────────────────────────────────────────────────────────
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

/** Chrome's own error pages live under this scheme. Nothing a real document is served from does. */
export const CHROME_ERROR_SCHEME = "chrome-error:";

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
export async function assertPageLoaded(evaluate, { expected, marker = null, markerName = "the page's own content", what = "this page", errorText = null } = {}) {
  const href = await evaluate("location.href");
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
