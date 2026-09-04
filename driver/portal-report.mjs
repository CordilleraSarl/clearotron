// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Serving a delivered report into the portal.
//
// There is ONE report now — the full one. The old client/internal split is gone: a client and a lawyer
// read the same document, which is the owner's decision and the right one. What the split used to buy
// along the way, and what still has to be bought some other way, is the subject of this file.
//
// The reports themselves are FROZEN artefacts on disk. render.mjs is not invoked at serve time and is
// pinned by content hash, so nothing here rewrites a file. What this does is prepare a frozen document
// to be embedded in the portal's shell — which is a different context from the standalone page it was
// rendered as, and one thing about that context is a tenancy boundary rather than a matter of taste.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SUMMARY_BLOCK_LINE } from "../shared/summary-blocks.mjs";

// ── the site nav ─────────────────────────────────────────────────────────────────────────────────────
//
// Every rendered report carries the shared cross-page navigation (shared/site-nav.mjs) baked into it —
// a brand lockup, links to the pool index, status, profiles, and a "Clients" dropdown listing
// EVERY customer by key:
//
//     <a href="../customer/zephyr/">…  <a href="../customer/aurora/">…
//
// That is correct for a file a lawyer opens from the archive, and it is a disclosure of the client list
// to anybody else. It has to come out before the document is embedded, and not because the nav is ugly:
// a client must never learn which other companies Cordillera acts for.
//
// It comes out for STAFF too, which is not a compromise — inside the portal the shell IS the
// navigation, so a second nav bar scrolling inside the report frame is redundant chrome.
//
// This does not modify the file on disk. The frozen artefact stays exactly as rendered; only the copy
// travelling to a browser is prepared for the frame it is going into.
const NAV_RE = /<nav class="sitenav">/gi;

// ── removing an ELEMENT, not a byte range ────────────────────────────────────────────────────────────
//
// Every rule below used to be `<tag …>[\s\S]*?</tag>` — non-greedy to the FIRST closing tag. Measured
// against a real delivered report (tmp8743-drivers-haven), two of them close in the wrong place:
//
//   • the Ask-your-AI block contains two nested `<details class="askai-steps">`, so the strip ended at
//     the first of them and left a "Set up ChatGPT" staff block, a stray `</div>` and a stray
//     `</details>` in a CLIENT's report;
//   • the "Internal review copy" bar is 1667 bytes and the regex removed 1658 of them.
//
// A non-greedy regex cannot express "this element and its subtree" — nesting is not a regular language.
// So the open tag is matched by regex and the close is found by BALANCING, which is what the intent was
// all along.
//
// The failure mode is chosen deliberately. If no balanced close is found the element is LEFT ALONE and
// the caller is told, because the alternative — deleting to the end of the document — would silently
// truncate a legal opinion to remove a button. A surviving button is visible and harmless; a truncated
// report is neither.
function stripBalanced(html, openRe, tag, onUnbalanced = () => {}) {
  const both = new RegExp(`<${tag}\\b|</${tag}\\s*>`, "gi");
  let out = "";
  let cursor = 0;
  let removed = 0;
  const finder = new RegExp(openRe.source, "gi");
  let m;
  while ((m = finder.exec(html)) !== null) {
    if (m.index < cursor) continue; // inside something already removed
    both.lastIndex = m.index;
    let depth = 0;
    let end = -1;
    let t;
    while ((t = both.exec(html)) !== null) {
      if (t[0][1] === "/") {
        depth -= 1;
        if (depth === 0) { end = t.index + t[0].length; break; }
      } else depth += 1;
    }
    if (end < 0) { onUnbalanced(tag); continue; } // unbalanced: leave the document intact
    out += html.slice(cursor, m.index);
    cursor = end;
    removed += 1;
    finder.lastIndex = end;
  }
  out += html.slice(cursor);
  return { html: out, removed };
}

// ── the rest of the staff chrome ─────────────────────────────────────────────────────────────────────
//
// What actually differs between the old internal and client renderings is instrumentation, not
// analysis — measured on a real delivered report, the internal file is ~11KB larger and the whole
// difference is: the nav above, an "Internal review copy" bar, a link to the audit spreadsheet, the
// the quality-capture controls, and a flag button on each finding. The words a reader reads are the
// same. That is why "one report" is the right call: there was never a lesser document, only a document
// with fewer buttons.
//
// These are stripped because they do not WORK outside the archive — the capture controls post to a service
// a client cannot reach, and the audit link points at a file the portal does not serve — and because
// the Excel export is internal by standing policy. Leaving dead buttons on a client's report would be a
// worse answer than removing them.
//
// Unlike the nav, none of this is a security boundary. If one of these misses, the consequence is a
// button that does nothing, not a disclosure — so only the nav gets a post-strip assertion.
//
// Match classes by TOKEN, never by exact attribute value. The real markup is
// `class="cardflag-pop no-print"`, so a `class="cardflag-pop"` pattern matches nothing at all — and
// does it silently, reporting success while every button ships.
const CHROME_RES = [
  // The report's OWN sticky header — the wrapper that carries the site nav (row 1) and `.topbar`
  // (row 2: back · risk band · matter · issued · Export).
  //
  // Every field in it is already on the screen above the frame, said by the PORTAL and said from the
  // run rather than from the document: AppShell's topbar names the screen, Result's header carries the
  // mark, the brand owner, the date and the band. Rendering it again inside the frame put the identity
  // strip on the page three times over and pushed the document itself below the fold — which is what a
  // reader means by "the top header takes up loads of space and says the same things".
  //
  // With this gone the embedded document begins where the report proper begins: "Privileged &
  // Confidential · Attorney Work Product · Preliminary Clearance". The Export menu it used to host is
  // reproduced by the portal in the master header and driven through the bridge below — the functions
  // it calls (exportPDF/pickAll/openAll) act only on `.card`, `input.pickbox` and `details.*` inside
  // `.wrap`, so they are unaffected by the removal of the bar that used to invoke them.
  //
  // ORDER MATTERS: this entry runs AFTER the NAV_RE strip above, and must keep doing so. `strippedNav`
  // is a leak canary — the nav lists every customer by key, and a zero count is how we learn the strip
  // has stopped matching. Removing the wrapper first would take the nav with it, drive the count to
  // zero, and turn a security assertion into a permanent false alarm.
  { tag: "div", open: /<div class="[^"]*\brep-stickyhead\b[^"]*"[^>]*>/ },
  // the "Internal review copy — stripped on export" bar, which hosted the quality-capture controls
  { tag: "div", open: /<div class="[^"]*\breview\b[^"]*\binternal\b[^"]*"[^>]*>/ },
  // per-finding flag buttons and their popovers
  { tag: "button", open: /<button[^>]*class="[^"]*\bcardflag\b[^"]*"[^>]*>/ },
  { tag: "span", open: /<span class="[^"]*\bcardflag-pop\b[^"]*"[^>]*>/ },
  // the floating "← All reports" pill: it points back into the archive, which is not a place the
  // portal navigates to. Removed rather than defused — a dead button is its own kind of wrong.
  { tag: "a", open: /<a[^>]*class="[^"]*\bhomebtn\b[^"]*"[^>]*>/ },
  // The audit spreadsheet link — REPLACED, not removed, and the distinction is the whole justification.
  //
  // This comment used to claim the workbook was withheld by policy and unserved by the portal. Both
  // halves were false: portal-service.mjs serves it at /portal/report/<runId>/audit.xlsx, and
  // portal-ui's Result.tsx renders its own "Download full audit (Excel)" control pointing there. The
  // strip is correct because the portal offers a better affordance in its own chrome, not because the
  // workbook is withheld — and the stale wording was read as evidence of an unfixed leftover by the
  // next person to look, which is exactly what a wrong comment costs.
  //
  // depends on this being true: a Signa record's card names the workbook in the words that
  // control uses, so a reader who follows the pointer finds it.
  { tag: "a", open: /<a[^>]*href="[^"]*\.xlsx"[^>]*>/ },

  // ── the engine's own scaffolding: out of the report, for EVERY reader ───────────────────────────────
  //
  // Owner ruling, 2026-07-27: "none of this should surface to anyone — only to the internal logs for
  // analysis." Not a client cut and a staff cut; there is ONE report, and this material was never meant to
  // be in it for anybody. It reads as machinery in a document whose whole job is a legal opinion.
  //
  // WHERE IT STILL LIVES, because removing it from the served document must not mean losing it: the
  // `::p::`-marked reasoning is in the run's own report.md, the coverage read is in the coverage judgment
  // sidecar, and the provenance rows are in the frozen search-policy and profile sidecars. All of it is in
  // the run dir and reachable through the ops MCP, which is exactly the "internal logs for analysis" the
  // ruling points at. The reviewer's HTML loses it; the record does not.
  //
  // Element-shaped by luck rather than design — the renderer tags each of these with a class of its own —
  // so they come out through the same balanced strip as every other block, which reports drift instead of
  // mangling markup when the shape moves.
  //
  // A wholly-internal <ul> can be left empty by this; an empty list renders as nothing, which is the right
  // outcome and cheaper than reasoning about which parent to take with it.
  { tag: "li", open: /<li[^>]*class="[^"]*\bint-note\b[^"]*"[^>]*>/ },
  { tag: "p", open: /<p[^>]*class="[^"]*\bint-note\b[^"]*"[^>]*>/ },
  // P5 (four-answers panel, added on the rebase onto one report): a wholly-internal answer `read`
  // classes its row `div.fa-row int-note`, and the two rules above are tag-specific, so nothing here
  // covered it. The mid-line [internal] cut below is NOT a substitute: it removes the tail TEXT and
  // leaves the row's own furniture standing — the row rendered as "Third-party rights · Strong —" with a
  // dangling em-dash and nothing after it. That empty-labelled-row defect is exactly what P5's review
  // round pinned for the legal/practical paragraph (which is a <p> and was therefore already covered);
  // the four-answers twin is a <div>, so it needs this rule to get the same outcome. Kept general
  // (any int-note div) rather than keyed to fa-row: the class is the contract, the container is not.
  { tag: "div", open: /<div[^>]*class="[^"]*\bint-note\b[^"]*"[^>]*>/ },
  // "Coverage read (internal)" — the engine's own note on why coverage landed where it did.
  { tag: "p", open: /<p[^>]*class="[^"]*\bcov-read\b[^"]*"[^>]*>/ },
  // "Configuration provenance (internal)" — the heading and the settings table under it. Two entries
  // because they are siblings, not nested: stripping only the heading would leave a bare, unlabelled table
  // of internal setting origins, which is worse than leaving both.
  { tag: "p", open: /<p[^>]*class="[^"]*\bscoperead\b[^"]*"[^>]*>/ },
  { tag: "table", open: /<table[^>]*class="[^"]*\borigins\b[^"]*"[^>]*>/ },
  // the floating theme toggle. siteFab appends this fab-stack AFTER </nav> (site-nav.mjs), so NAV_RE
  // — which balances the <nav> element and stops there — never reached it. The report therefore
  // shipped its own theme button into the iframe, fully styled (inlineStylesheet pastes chrome.css,
  // which carries THEME_BTN_CSS and the .fab-stack rules), sitting bottom-right on top of the
  // portal's own header toggle. Two controls, and NOT two views of one setting: the iframe is
  // sandboxed without allow-same-origin, so its localStorage throws and the portal's choice can
  // never reach it. The duplicate is removed here rather than in siteFab because the standalone
  // archive report still needs its toggle — there it is the reader's only theme control.
  { tag: "div", open: /<div class="[^"]*\bfab-stack\b[^"]*"[^>]*>/ },
];

// ── labelled internal tails: the MID-LINE form the element strip cannot see ──────────────────────────
//
// publish/parse.mjs is the authority on what `[internal] ` means: stripInternal({client:false}) labels
// each `::p::` tail with it on the way to report.md, and dropLabelledInternals documents the semantic for
// reading that labelled form back on a client surface — everything from the label to the end of its LINE
// is internal reasoning; a public head survives; a wholly-internal bullet disappears. This mirrors that
// semantic rather than importing it, because the two work on different material: dropLabelledInternals
// walks markdown, where the unit is a line; here the document is rendered HTML, where the unit is the
// containing block element. `- **Enforcer.** ::p:: …` has become `<li><b>Enforcer.</b> [internal] …</li>`
// by the time it reaches this file, so "label to end of line" translates to "label to the close of the
// element that contains it".
//
// WHY the int-note strip above does not catch these: the renderer classes a bullet `int-note` only when
// the label LEADS the line. A mid-line label — public head first, then `[internal] `, then the reasoning
// — renders as a plain <li> with no class at all, and frozen archived runs in the pool carry exactly that
// shape (a 2026-07-31 sweep of the pool through readReport found six such bullets across four runs). The
// head is client product; the tail is reviewer reasoning ("this is an inference, not an established
// fact") that the one-report ruling sends to the internal logs, not to any reader surface it was never
// meant for.
//
// The tail is cut to the CLOSE OF THE CONTAINING ELEMENT, found by the same balancing discipline as
// stripBalanced: inline markup inside the tail (<i>, <a>, quotes) opens and closes in pairs, so the first
// close tag that outnumbers the opens is the container's. Cutting to the next "<" instead would leave the
// rest of the tail standing whenever it carries any inline tag.
//
// Client branch ONLY. On the staff surface the labelled form is the DESIGNED rendering of this material
// (parse.mjs client:false — "readable on the internal surfaces, never a raw token"), and the staff bytes
// of every frozen report stay untouched.
const LABELLED_INTERNAL_RE = /\[internal\]/gi;

// Elements with no close tag must not count as depth when balancing across a tail.
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

function dropLabelledInternalTails(html, onUnbalanced = () => {}) {
  let out = "";
  let cursor = 0;
  let dropped = 0;
  const finder = new RegExp(LABELLED_INTERNAL_RE.source, "gi");
  const tagRe = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?:"[^"]*"|'[^']*'|[^>"'])*?(\/?)>/g;
  let m;
  while ((m = finder.exec(html)) !== null) {
    if (m.index < cursor) continue; // inside something already removed
    tagRe.lastIndex = m.index;
    let depth = 0;
    let cut = -1;
    let t;
    while ((t = tagRe.exec(html)) !== null) {
      if (t[1] === "/") {
        if (depth === 0) { cut = t.index; break; } // the containing element's own close
        depth -= 1;
      } else if (!VOID_TAGS.has(t[2].toLowerCase()) && t[3] !== "/") {
        depth += 1;
      }
    }
    // No balanced close: leave the document intact and say so, the stripBalanced ruling. Worth naming
    // that the trade differs here — what survives is a disclosure, not a dead button — but the renderer
    // always closes its elements, and truncating a legal opinion on malformed markup is still the worse
    // failure. The count makes the survival loud instead of silent.
    if (cut < 0) { onUnbalanced("labelled-internal"); continue; }
    // The head keeps its prose but not its trailing whitespace — the same trim parse.mjs applies.
    let start = m.index;
    while (start > cursor && /\s/.test(html[start - 1])) start -= 1;
    // "A wholly-internal bullet disappears": if nothing but the element's own open tag precedes the
    // label, dropping only the tail would leave an empty shell that renders as a stray bullet point —
    // take the element instead. (The renderer classes the line-leading form int-note, so this arm is
    // belt and braces for markup the classer missed.)
    const head = html.slice(cursor, start);
    const shell = /<([A-Za-z][A-Za-z0-9-]*)(?:"[^"]*"|'[^']*'|[^>"'])*>\s*$/.exec(head);
    const close = /^<\/\s*([A-Za-z][A-Za-z0-9-]*)\s*>/.exec(html.slice(cut, cut + 40));
    if (shell && close && shell[1].toLowerCase() === close[1].toLowerCase()) {
      out += html.slice(cursor, cursor + shell.index);
      cursor = cut + close[0].length;
    } else {
      out += html.slice(cursor, start);
      cursor = cut;
    }
    dropped += 1;
    finder.lastIndex = cursor;
  }
  out += html.slice(cursor);
  return { html: out, dropped };
}

// ── the pre-v4 reviewer shorthand: "Level C · Composite 3" ───────────────────────────────────────────
//
// render.mjs riskChip ( T6, wp50): the internal chip reads
// `MEDIUM · <span class="lv">Level C</span>Composite 3 · Horse trade`, and the raw Level/Composite codes
// were never meant to reach a client — the renderer's own comment says so, and the pre-v4 footer calls
// them "the internal legal shorthand" by name. The retired client export carried the same chip as
// `MEDIUM risk · Horse trade`; serving the one report, the codes come out and the tier word and dispute
// type — which that export always showed — stay.
//
// Pre-v4 archives ONLY, by construction: "No Level/Composite shorthand exists on a v4 record"
// (render.mjs, doc-50 band mode). The v4 chip's band word and disposition suffix ("Manageable ·
// Distinguished") are the framework's own rating vocabulary, not reviewer shorthand, and stay untouched —
// the no-over-strip control in the tests pins that.
//
// Three rendered shapes, each anchored on the renderer's exact output rather than on the words alone:
//   • the chip, taking ONE adjoining "·" separator with it (leading when a tier word precedes, else
//     trailing) so no chip is left reading "MEDIUM · · Horse trade";
//   • oneFallback's parenthesised form "(Level C · Composite 3)" in a one-line summary;
//   • the footer legend that NAMES the codes — the clause and the "Internal notes are review-only"
//     sentence go, and the client-vocabulary sentence around them closes on its own full stop.
const REVIEWER_CODE_RE =
  /\s*·\s*<span class="lv">Level [^<]*<\/span>Composite\s*\d+|<span class="lv">Level [^<]*<\/span>Composite\s*\d+\s*(?:·\s*)?/g;
const REVIEWER_PAREN_RE = /\s*\(Level [A-E] · Composite \d\)/g;
const REVIEWER_LEGEND_RE =
  /;\s*the <span class="mono">Level A–E<\/span> · <span class="mono">Composite 1–5<\/span> codes beside them are the internal legal shorthand\.\s*Internal notes are review-only and removed on export\./g;

// ── the Ask-your-AI block: STAFF ONLY, and this one IS a boundary ────────────────────────────────────
//
// The report embeds a "paste this into your own AI" connector URL. ONE report (spec 2026-07-30 §5):
// the renderer has one path and always bakes the STAFF surface — CLEAROTRON_MCP_URL plus a run-scoped
// read-only token — or FAILS CLOSED and omits the block entirely when the env is unset, rather than
// falling back to a placeholder host. That is critic finding 4, written into the renderer as
// a comment.
//
// So serving `report.html` raw to a client would hand them the STAFF host, and even where a deployment
// happens to point staff and client connectors at the same address, that is an accident, not a
// guarantee. The block therefore comes out for every non-staff reader here, at serve time — staff keep
// it, whose tool and whose host it is. The client's connector path is the portal's own
// /portal/api/mcp-access (CLEAROTRON_CLIENT_MCP_URL, served live, no baked credential).
//
// The token embedded alongside is run-scoped and read-only — the token is not the problem. The
// hostname is.
const ASKAI_RE = /<details class="[^"]*\baskband\b[^"]*"[^>]*>/gi;
const MCP_HOST_RE = /https?:\/\/[A-Za-z0-9.-]+\/mcp/gi;

// ── the connector credential, which the served report should not be carrying at all ──────────────────
//
// The renderer bakes a scoped token into that connector URL at PUBLISH time, with a 30-day life
// (shared/scope.mjs: `ttlSec = 30 * 24 * 3600`). Nothing refreshes it. Thirty days after a report is
// issued its "Ask your AI" address starts answering with an authorisation error, and the reader's only
// recourse is to ask for the report to be republished. The first reports to cross that line are the
// 2026-06-30 batch, on 2026-07-30.
//
// The obvious repair is to re-mint at serve time. This process cannot: the portal unit carries NO
// EnvironmentFile and no token secret, deliberately and load-bearingly (an AUD from the shared .env would
// silently make it verify the wrong Cloudflare application), and client-access states the same
// least-privilege posture in its own unit — "reads NO production secret … never mints/verifies inner
// tokens". Minting here would mean handing a serving process the authority to issue run-bound
// credentials, which is a bigger change than the defect.
//
// It is also the wrong repair, because the product already answered this question elsewhere and answered
// it better. /portal/api/mcp-access hands out the connector with NO credential in it, and says why:
// "client MCP access is the caller's OWN Cloudflare Access login plus the grants entry that already
// governs this portal. Nothing to mint, nothing to paste, nothing to leak — and revoking portal access
// revokes the connector with it." A reader looking at a report through the portal has ALREADY made that
// sign-in; the token adds nothing to their reach and subtracts a expiry date from their report.
//
// So the token comes out on the way through, and the address stays. The reader authenticates as
// themselves, exactly as the Use-your-AI screen already tells them to, and there is nothing left in the
// document to expire — or to forward. That last part is not incidental: a report is a document people
// send onwards, and a bearer credential pasted into one travels with it.
//
// Only the `v1.<body>.<sig>` scoped-token shape is touched, and only as a query parameter. A URL that
// carries something else keeps it: this removes a credential we minted, not any parameter we find.
// The footer's "Rated under:" line — the ONE piece of engine scaffolding that is not element-shaped.
//
// It renders inline in the confidentiality footer as `<br>Rated under: <span class="mono">…</span>.` and
// carries the account key, the framework name and a profile content hash ("Sim Praxis (sim-praxis) · house
// default framework · profile 133826183db4"). The hash is a fingerprint of an internal config file: it
// means nothing to a reader, identifies an internal artefact, and travels in a document designed to be
// forwarded. Same ruling as the blocks above; a different removal only because the markup gives nothing
// balanced to strip.
//
// Anchored on the exact rendered shape rather than on the words alone, and it takes the <br> that
// introduces it and the full stop that closes it — leaving either behind puts a stray break or an orphan
// "." in the footer of every report.
const RATED_UNDER_RE = /<br\s*\/?>Rated under:\s*<span class="mono">[^<]*<\/span>\./gi;

const CONNECTOR_TOKEN_RE = /([?&])token=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(&)?/g;

function dropConnectorToken(html) {
  let dropped = 0;
  // The separator arithmetic, which is the only fiddly part: a parameter is removed together with ONE
  // adjoining separator, and which one depends on whether anything follows. `?token=X` → nothing (no query
  // left at all); `?token=X&b=2` → `?b=2` (the "?" is inherited by what follows); `&token=X` → nothing;
  // `&token=X&b=2` → `&b=2`. Getting this wrong leaves `url?` or `url?a=1&&b=2` — both of which still
  // "work" in a browser and would sail through any test that only asserted the token was gone.
  const out = html.replace(CONNECTOR_TOKEN_RE, (_m, lead, next) => {
    dropped += 1;
    return next ? lead : "";
  });
  return { html: out, dropped };
}

// ── the report's own stylesheet ──────────────────────────────────────────────────────────────────────
//
// Every report carries `<link rel="stylesheet" href="../assets/chrome.css">` — RELATIVE, and correct
// for a file sitting in the archive next to that directory. Served from `/portal/report/<runId>/` it
// resolves to `/portal/report/assets/chrome.css`, where `assets` is read as a run id, no meta.json is
// found, and the answer is 404. The document then renders with its inline `<style>` alone.
//
// That is not a subtle degradation. chrome.css is 35KB of shared typography and layout, and among the
// rules that went missing was `.lk-flag{width:10px;height:10px}` — sizing a lockup element that has
// since been retired ( applied 's ruling to this lockup too), an SVG with no intrinsic size
// falling back to the browser default for a replaced element and painting at 300x150. The reported
// symptoms — "a huge flag at the bottom", "font sizings inconsistent, multiple font types" — were one
// cause: this file did not load. The example is historical; the failure mode is not, and any sizing
// rule in chrome.css can reproduce it.
//
// It is INLINED rather than served from a new route. A route would mean the portal serving files out of
// the archive directory again, addressed by a path from the URL, which is precisely the shape of the
// bypass that shipped every customer's report to any signed-in identity. One known filename, read from
// the pool root and pasted in, has no path for a caller to influence at all. The cost is ~35KB on a
// document that is already 130KB, on a frame that cannot cache cross-origin anyway.
//
// If it is missing, the link is left exactly as it was. A report that renders badly is worth more than
// one that fails to render, and the caller is told.
const STYLESHEET_RE = /<link[^>]*rel="stylesheet"[^>]*href="\.\.\/assets\/([A-Za-z0-9._-]+\.css)"[^>]*>/gi;

function inlineStylesheet(html, poolRoot, onMissing) {
  return html.replace(STYLESHEET_RE, (tag, name) => {
    // `name` comes from the DOCUMENT, not from a request, and the character class above admits no
    // separator and no dots-only name — so this cannot address anything but a file in that directory.
    try {
      const css = readFileSync(join(poolRoot, "assets", name), "utf8");
      return `<style data-inlined="${name}">\n${css}\n</style>`;
    } catch {
      onMissing(name);
      return tag;
    }
  });
}

// ── the embed layer: width, and a bridge to the frame ────────────────────────────────────────────────
//
// Two things a frozen document cannot know about the frame it ends up in.
//
// WIDTH. The report caps itself at `.wrap{max-width:1120px}`, which is right for a standalone page and
// wrong inside a panel that is already narrower than the window. A previous attempt widened the portal's
// frame alone and nothing moved — the note at base.css:95 records the conclusion "the document never
// used the space", which was true and was a property of THIS rule, not of the content. The content is
// fluid: the report has no tables at all and every grid below `.wrap` is fr-based (.heroGrid 1.32fr 1fr,
// .landwrap 1.5fr 1fr, .meters repeat(4,1fr), .cov 1fr 1fr). Uncapping here and setting the measure once
// on the portal's `.screen.report` therefore widens real content rather than adding margin.
//
// `.sub{max-width:700px}` is deliberately left alone. That is a prose measure — a paragraph set to the
// full width of a wide monitor is harder to read, not easier.
//
// HEIGHT. The frame has no allow-same-origin, so the portal cannot measure the document it is showing.
// Without a measurement it must guess, and the old guess was "fill the viewport and let the frame
// scroll" — which gave the report its own scrollbar inside a page that also scrolled. The document
// reports its own height instead, and the portal sizes the frame to it, so the PAGE scrolls exactly like
// every other screen while the sandbox stays exactly as it was.
//
// The observer is not optional. Expand-all, collapse-all and every <details> toggle change the content
// height after load, and a load-time measurement alone would leave the frame clipped or trailing blank
// space for the rest of the session.
const EMBED_CSS = `
/* injected for the portal embed — see driver/portal-report.mjs */
.wrap{max-width:none}
/* THE EXPAND FLICKER (Reviewer, 2026-07-30 — "expand Full detail & provenance → flicker", also on Scope).
   Measured in a real browser: opening a large <details> grows the content BEFORE the height post is
   applied, so for a few frames the frame is shorter than its document and a transient inner scrollbar
   appears. On classic-scrollbar platforms that scrollbar steals ~15px of width, the WHOLE document
   reflows narrower-and-taller, the bridge posts THAT height, the frame grows past it, the scrollbar
   goes, the document reflows back and posts again — two full-document reflows and a 90-140px height
   bounce per toggle (measured 11181→11094 and 13990→13848 on a delivered report). Reserving the
   scrollbar gutter makes the layout width identical with and without the transient scrollbar: one
   measurement, one post, no reflow. scrolling="auto" stays — if the bridge fails the frame degrades
   to scrollable rather than truncating the document (Result.tsx depends on that). */
html{scrollbar-gutter:stable}

`;

// The command allowlist is closed and the arguments are coerced, so a message can only ever reach one of
// three functions the document already exposes to its own buttons. `openAll`/`pickAll` take a boolean and
// nothing else; `exportPDF` takes no argument at all.
const FEEDBACK_CSS = `
/* #260 — the per-finding flag. Injected here rather than in render.mjs, which is frozen and produces
   every report ever delivered: putting the control at SERVE time means it reaches reports baked long
   before feedback existed, and the document on disk stays exactly what was delivered. */
.pf-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;padding-top:9px;border-top:1px solid var(--line,#e5ded4)}
.pf-b{font:inherit;font-size:11.5px;line-height:1.3;padding:3px 9px;border:1px solid var(--line,#ccc);border-radius:999px;background:transparent;color:var(--muted,#6b5d50);cursor:pointer}
.pf-b:hover,.pf-b:focus-visible{border-color:var(--crimson,#860F09);color:var(--crimson,#860F09)}
.pf-b[aria-pressed="true"]{border-color:var(--crimson,#860F09);color:var(--crimson,#860F09);font-weight:700}
.pf-pop{flex-basis:100%;order:9}
.pf-why{width:100%;box-sizing:border-box;font:inherit;font-size:12.5px;border:1px solid var(--line,#ccc);border-radius:8px;padding:7px}
.pf-send{margin-top:6px}
.pf-msg{font-size:11.5px;color:var(--muted,#6b5d50);margin-left:8px}
@media print{.pf-bar{display:none!important}}
`;

const EMBED_JS = `
(function(){
  var TAG='cordillera-report';
  // MEASURE THE BODY, NEVER documentElement.
  //
  // document.documentElement.scrollHeight is bounded BELOW by the viewport, and inside an iframe the
  // viewport is the frame we are trying to size. That makes it a feedback loop rather than a
  // measurement: a report shorter than the frame reports the frame's own height, so the frame never
  // shrinks and a two-page report sits in a 1400px box forever. Adding any safety margin on the parent
  // side turns the same loop into a runaway — each post makes the viewport taller, which makes the next
  // measurement taller again.
  //
  // The body's own box has no such floor, so it is a real content height, and the small margin added
  // here is safe precisely because it does not feed back into it.
  //
  // THE +16 IS LOAD-BEARING, AND 2 WAS NOT ENOUGH.
  //
  // The frame must end up slightly TALLER than its content, never shorter, because "shorter" starts a
  // loop rather than just clipping: a frame 1px short shows its own scrollbar, the scrollbar steals
  // ~15px of width, the narrower text reflows TALLER, that posts a new height, the frame resizes, the
  // scrollbar toggles — round and round. Measured in Chrome as 3-5 height messages per load instead of
  // one, which on screen is a scrollbar that appears, twitches and scrolls a few pixels.
  //
  // The previous value was 2, which cancelled the frame's 1px top+bottom border EXACTLY — a coincidence,
  // not a margin, and it stopped being true at any browser zoom. The border is gone now (Result.tsx) and
  // this is a real margin: 16px of page background under the last line, which nobody can see, in
  // exchange for a scrollbar that can never appear. Verified to hold at zoom 1.0 and 1.25.
  function height(){
    var b=document.body;
    if(!b)return 0;
    var r=b.getBoundingClientRect();
    return Math.ceil(Math.max(r.bottom,b.scrollHeight,b.offsetHeight))+16;
  }
  var last=0;
  function post(){
    var h=height();
    // A 1px threshold rather than equality: sub-pixel layout and browser zoom otherwise produce an
    // endless trickle of posts that differ in the last decimal and never settle.
    if(!h||Math.abs(h-last)<=1)return;
    last=h;
    try{parent.postMessage({source:TAG,type:'height',height:h},'*');}catch(e){}
  }
  var queued=false;
  function schedule(){
    if(queued)return;
    queued=true;
    requestAnimationFrame(function(){queued=false;post();});
  }
  // WHICH CONTROLS THIS DOCUMENT ACTUALLY HAS (tracker issue 1922).
  //
  // The command handler below answers "this report has no <verb>" for a verb the document does not
  // define. That reply is honest and it arrives too late: the shell had already drawn a menu item, the
  // reader had already pressed it, and what they learn is that the product is broken. Every one of the
  // five Export-menu items did exactly that on every knockout ever published, because the knockout
  // template defined none of the three verbs.
  //
  // So the document says what it has, and the shell draws only that. Asked of the document itself
  // rather than derived from the run's kind: a kind is a second table that has to be updated whenever a
  // renderer gains or loses a control, and nothing fails when it is not — which is how this shipped.
  // A document cannot disagree with itself about which functions it defines.
  //
  // Posted on load, before anyone can open a menu, and re-posted with nothing else attached so a shell
  // that missed the first one is not left with a permanently empty menu.
  function controls(){
    try{
      var have=[];
      var names=['exportPDF','pickAll','openAll'];
      for(var i=0;i<names.length;i++) if(typeof window[names[i]]==='function') have.push(names[i]);
      parent.postMessage({source:TAG,type:'controls',commands:have},'*');
    }catch(e){}
  }
  window.addEventListener('load',controls);
  document.addEventListener('DOMContentLoaded',controls);
  window.addEventListener('load',schedule);
  document.addEventListener('DOMContentLoaded',schedule);
  document.addEventListener('toggle',schedule,true);
  window.addEventListener('resize',schedule);
  if(typeof ResizeObserver==='function'){
    try{new ResizeObserver(schedule).observe(document.body);}catch(e){}
  }
  window.addEventListener('message',function(e){
    if(e.source!==parent)return;
    var d=e.data;
    if(!d||d.source!==TAG||d.type!=='command')return;
    // A FAILED COMMAND SAYS SO. This used to be catch(err){} — a button that did nothing, told nobody,
    // and left no console trace, which is how "Export does not work" went unnoticed through a whole
    // round of testing. The portal now hears about it and can say so.
    var fn = d.command==='exportPDF' ? (typeof exportPDF==='function'?exportPDF:null)
           : d.command==='pickAll'   ? (typeof pickAll==='function'?pickAll:null)
           : d.command==='openAll'   ? (typeof openAll==='function'?openAll:null)
           : undefined;
    if(fn===undefined)return;                       // not a verb we answer: ignore, as before
    function fail(msg){
      try{parent.postMessage({source:TAG,type:'commandFailed',command:d.command,message:String(msg)},'*');}catch(e){}
    }
    if(fn===null){ fail('this report has no '+d.command); schedule(); return; }
    try{ fn(d.command==='exportPDF'?undefined:!!d.value); }
    catch(err){ fail(err&&err.message||err); }
    schedule();
  });
  // IN-PAGE ANCHORS CANNOT WORK FROM INSIDE THIS FRAME (B2, measured 2026-07-30 in a real browser):
  // the frame is sized 16px TALLER than its content, so its own scrollport has nowhere to go, and
  // element.scrollIntoView() does not propagate across the null-origin boundary — a click on a
  // rights-holder row or an "and N more" link moved NOTHING (parent scrollY unchanged, target ~2000px
  // below the viewport). The document's own click handler still opens the target's collapsed
  // ancestors (that part works); this hands the SCROLL to the only party that can perform it — the
  // parent page — as a document-relative offset. The parent subtracts its sticky chrome so the
  // clicked target lands VISIBLY below the header (Result.tsx), never under it.
  //
  // Registered AFTER the document's own script by construction (this block is appended at the end of
  // <body>), so by the time it runs for an '#c<ordinal>' link the ancestors are already open and the
  // measured offset is the revealed position. preventDefault stops the frame's dead-end fragment
  // navigation for the links the document's handler does not claim (#common-law, #only-you).
  // #735 — AND WHEN THERE IS NO PARENT, DO NOT CANCEL THE CLICK.
  //
  // Everything above is right INSIDE the portal's Result screen. Un-framed it is a dead link: parent is
  // window, the message is posted to this same document, and the only 'message' listener here requires
  // type==='command', so 'scrollTo' is dropped — after preventDefault has already cancelled the jump the
  // browser would have made perfectly well on its own. Nothing moves, silently, because posting to a
  // window with no matching listener is not an error and the post sits inside a try/catch anyway.
  //
  // Three surfaces serve this document un-framed: npm run example (bin/example.mjs prints a top-level
  // report.html URL and it goes through readReport), a report saved and opened from disk, and — per
  // prepareReportForEmbed's own note — the client-access host, which has neither the parent-side listener
  // nor the write endpoint. The demo is the artifact the README leads with.
  //
  // A cross-origin parent can throw on the comparison; treating a throw as FRAMED keeps the portal path
  // (the one that measurably needs the delegation) working, and only ever degrades to native scrolling
  // when we can positively see there is no other window.
  var framed=false; try{framed=window.parent!==window;}catch(err){framed=true;}
  function revealTarget(el){var p=el.parentElement;while(p){if(p.tagName==='DETAILS'&&!p.open)p.open=true;p=p.parentElement;}}
  document.addEventListener('click',function(e){
    var a=e.target.closest?e.target.closest('a[href^="#"]'):null;
    if(!a)return;
    var id=(a.getAttribute('href')||'').slice(1);
    if(!id)return;
    var el=document.getElementById(id);
    if(!el)return;
    // Reveal FIRST and synchronously either way: a target inside a closed <details> has no layout, so
    // the browser's own fragment jump would land on a collapsed ancestor if this ran after.
    revealTarget(el);
    if(!framed){ schedule(); return; }   // let the browser do the thing it is good at
    e.preventDefault();
    var top=Math.max(0,Math.ceil(el.getBoundingClientRect().top+window.scrollY));
    try{parent.postMessage({source:TAG,type:'scrollTo',top:top},'*');}catch(e){}
    schedule();
  });
  schedule();
})();
`;


// — the per-finding flag, in its OWN block, injected only when the caller opts in.
//
// Separate from EMBED_JS on purpose. That block is the frame bridge — height, commands, anchors — and it
// has to reach every embedded report, including the ones the client-access portal serves. This one needs
// a parent that listens and an endpoint to write to, and only the staff portal has either.
const FEEDBACK_JS = `
(function(){
  var TAG='cordillera-report';
  function schedule(){ try{ parent.postMessage({source:TAG,type:'height',height:document.body.scrollHeight+16},'*'); }catch(e){} }
  // #260 — PER-FINDING FEEDBACK, and why it posts outward instead of fetching.
  //
  // This frame has NO allow-same-origin (Result.tsx), so its origin is "null": it holds no portal
  // session, a credentials:'include' fetch sends nothing, and a request from here arrives unauthenticated.
  // The predecessor system's in-report Flag button only ever worked because the report was served
  // standalone from the archive rather than framed. So the control collects the reader's words and hands them to
  // the PAGE, which is the only party holding a session; the page posts and reports back.
  //
  // The message carries a POSITION and the reader's own words — never a mark, a band or an account. The
  // service reads those from the run's own artifacts, so nothing typed inside this frame can decide
  // which finding a flag lands on or whose matter it is labelled with.
  //
  // #487 — THE POSITION IS TWO NUMBERS ON THE KNOCKOUT LANE, and it used to be none.
  //
  // The clearance report numbers its findings once across the document and hangs each on a
  // div.card with id "c<ordinal>". The knockout report has neither: its conflicts render as div.ko-find,
  // and #471 restarts ordinals at 1 FOR EACH MARK. So this selector matched nothing on a knockout report
  // and the control was never drawn — the channel was not merely resolving wrong, it was absent. A
  // reader could not flag a knockout finding at all.
  //
  // The data-ko-mark and data-ko-ord attributes (render-knockout.mjs) are that lane's position. Sending
  // the ordinal alone would land every flag on the FIRST mark's finding of that number, which is worse
  // than sending nothing: it would attach a lawyer's correction to a different mark, silently.
  function pfBar(card){
    var ord=card.getAttribute('data-ko-ord')||(card.id||'').slice(1);
    if(!/^[0-9]+$/.test(ord))return;
    var bar=document.createElement('div');
    bar.className='pf-bar no-print';
    bar.innerHTML='<span class="pf-msg">Is this finding right?</span>'
      +'<button type="button" class="pf-b pf-good" aria-pressed="false">Right</button>'
      +'<button type="button" class="pf-b pf-bad" aria-pressed="false">Wrong</button>'
      +'<span class="pf-pop" hidden>'
      +'<textarea class="pf-why" rows="2" placeholder="What is right or wrong about it? Your own words."></textarea>'
      +'<button type="button" class="util primary pf-send">Send</button>'
      +'<span class="pf-said"></span></span>';
    card.appendChild(bar);
  }
  document.querySelectorAll('.card[id^="c"],.ko-find[data-ko-ord]').forEach(pfBar);

  document.addEventListener('click',function(e){
    var t=e.target;
    var pick=t.closest?t.closest('.pf-good,.pf-bad'):null;
    var send=t.closest?t.closest('.pf-send'):null;
    if(!pick&&!send)return;
    var bar=(pick||send).closest('.pf-bar'), pop=bar.querySelector('.pf-pop');
    if(pick){
      var isGood=pick.classList.contains('pf-good');
      bar.querySelector('.pf-good').setAttribute('aria-pressed',String(isGood));
      bar.querySelector('.pf-bad').setAttribute('aria-pressed',String(!isGood));
      bar.setAttribute('data-verdict',isGood?'good':'bad');
      pop.hidden=false;
      var ta=pop.querySelector('.pf-why'); if(ta)ta.focus();
      schedule();
      return;
    }
    var verdict=bar.getAttribute('data-verdict');
    if(!verdict)return;
    var ta=pop.querySelector('.pf-why'), why=(ta&&ta.value||'').trim();
    var said=pop.querySelector('.pf-said');
    if(!why){ if(said)said.textContent=' Say what is right or wrong about it first.'; return; }
    var card=bar.closest('.card,.ko-find');
    var koOrd=card.getAttribute('data-ko-ord');
    var ord=koOrd!==null?parseInt(koOrd,10):parseInt((card.id||'').slice(1),10);
    // null on the clearance lane, where the ordinal is unique across the document and there is no mark
    // axis. The service branches on the SHAPE of report-data.json rather than on this being present.
    var koMark=card.getAttribute('data-ko-mark');
    var mi=koMark!==null?parseInt(koMark,10):null;
    if(said)said.textContent=' sending…';
    bar.setAttribute('data-pending','1');
    try{parent.postMessage({source:TAG,type:'feedback',ordinal:ord,markIndex:mi,verdict:verdict,why:why},'*');}catch(err){
      if(said)said.textContent=' could not send from here.';
    }
    schedule();
  });

  // The page answers. It is the only party that knows whether the POST landed, so it is the only party
  // that may say so — a control that says "saved" on its own would be claiming a fact it cannot check.
  window.addEventListener('message',function(e){
    if(e.source!==parent)return;
    var d=e.data;
    if(!d||d.source!==TAG||d.type!=='feedbackResult')return;
    var bar=document.querySelector('.pf-bar[data-pending="1"]');
    if(!bar)return;
    bar.removeAttribute('data-pending');
    var pop=bar.querySelector('.pf-pop'), said=pop&&pop.querySelector('.pf-said');
    if(d.ok){
      var ta=pop&&pop.querySelector('.pf-why'); if(ta)ta.value='';
      if(pop)pop.hidden=true;
      if(said)said.textContent='';
      var msg=bar.querySelector('.pf-msg'); if(msg)msg.textContent='Thank you — noted.';
      bar.querySelectorAll('.pf-b').forEach(function(b){b.disabled=true;});
    } else if(said){ said.textContent=' '+(d.message||'not saved — try again'); }
    schedule();
  });

  schedule();
})();
`;

// Appended at the very end of <body>: the stylesheet is inlined into <head>, so a rule placed here wins
// the cascade on equal specificity without needing !important, and the script runs with the document's
// own functions already defined.
function injectEmbedLayer(html, { feedback = false } = {}) {
  const block = `<style data-embed="portal">${EMBED_CSS}</style><script data-embed="portal">${EMBED_JS}</script>`
    + (feedback ? `<style data-embed="feedback">${FEEDBACK_CSS}</style><script data-embed="feedback">${FEEDBACK_JS}</script>` : "");
  const i = html.lastIndexOf("</body>");
  // No </body> means markup we do not recognise; appending is still correct and still parses.
  return i < 0 ? html + block : html.slice(0, i) + block + html.slice(i);
}

// After stripping, no link to another customer's area, or to a staff-only page, may survive. This is
// the assertion rather than the strip — if the nav's markup ever changes shape and the regex above
// stops matching, silence would be a leak. Anything caught here is neutralised rather than trusted.
//
// The staff half matches the SHAPE, not a list of page names: a report sits at <pool>/<runId>/report.html,
// so any "../<name>.html" is a pool-root sibling, and every pool-root sibling is a staff surface. An
// enumeration would keep catching the pages someone remembered and silently pass the next one added —
// including a page named after a retired subsystem, which is how the old list came to carry a dead name
// long after the page was deleted. Deliberately NOT../<dir>/<file> and not other extensions:
// ../assets/chrome.css and ../run-audit.xlsx are the report's own resources and must survive.
const LEAKY_HREF_RE = /href="(\.\.\/customer\/[^"]*|\.\.\/[a-z0-9-]+\.html)"/gi;

/**
 * Prepare a frozen report for embedding.
 *
 * Returns `{ html, strippedNav, neutralised }` so a caller can log what happened. The neutralised count
 * should be zero in normal operation — a non-zero value means the nav markup drifted and the regex is
 * no longer matching the whole block, which is worth noticing rather than silently surviving.
 */
/**
 * @param {object} [opts]
 * @param {boolean} [opts.feedback] Inject the per-finding flag control. DEFAULT OFF, and the
 *   default is load-bearing: this same function prepares reports for the CLIENT-ACCESS portal
 *   (clients.example.com calls readReport from here), and that host has neither the parent-side
 *   listener nor the write endpoint the control posts to. Injected there, an external client would see
 *   a control that sends into nothing and sits on "sending…" for ever — a dead target on the one
 *   surface where a stranger sees it. Opted into by the staff portal route only.
 */
export function prepareReportForEmbed(html, { staff = false, poolRoot = null, feedback = false } = {}) {
  const unbalanced = [];
  const note = (tag) => unbalanced.push(tag);
  const missingCss = [];

  const nav = stripBalanced(html, NAV_RE, "nav", note);
  let out = nav.html;
  const strippedNav = nav.removed;

  for (const { open, tag } of CHROME_RES) out = stripBalanced(out, open, tag, note).html;

  // The baked connector credential comes out for EVERYONE, before the audience branch below decides
  // whether the block itself survives. Ordering matters: a client's whole block is removed a few lines
  // down, so doing this only in the staff branch would leave the token in the one document that gets
  // forwarded outside the firm the moment that strip is ever relaxed.
  const { html: detokenised, dropped: tokensDropped } = dropConnectorToken(out);
  out = detokenised;

  // The footer fingerprint. Counted like the rest so a renderer change that moves it shows up as a zero
  // rather than as a line that quietly starts shipping again.
  let ratedUnderDropped = 0;
  out = out.replace(RATED_UNDER_RE, () => { ratedUnderDropped += 1; return ""; });

  // Staff keep their own connector block; a client must not see the staff host it points at.
  let mcpLeaks = 0;
  let internalTailsDropped = 0;
  let reviewerCodesDropped = 0;
  if (!staff) {
    out = stripBalanced(out, ASKAI_RE, "details", note).html;
    // Assert, do not assume. `.askband` markup is nested, so a non-greedy match could stop early and
    // leave the host behind in a sibling node. Anything surviving is redacted and counted.
    out = out.replace(MCP_HOST_RE, () => {
      mcpLeaks += 1;
      return "";
    });
    // The mid-line labelled internals, and the pre-v4 reviewer codes. Client branch only, and that is a
    // considered asymmetry rather than an oversight: for staff the `[internal] ` label is the designed
    // rendering of this material and the Level/Composite codes are their working shorthand — the frozen
    // staff bytes do not move. See the comment blocks above for both semantics.
    const tails = dropLabelledInternalTails(out, note);
    out = tails.html;
    internalTailsDropped = tails.dropped;
    out = out.replace(REVIEWER_CODE_RE, () => { reviewerCodesDropped += 1; return ""; });
    out = out.replace(REVIEWER_PAREN_RE, () => { reviewerCodesDropped += 1; return ""; });
    out = out.replace(REVIEWER_LEGEND_RE, () => { reviewerCodesDropped += 1; return "."; });
  }

  // Belt and braces. Any cross-customer or staff-page link that survived the strip has its target
  // removed — the text stays (removing it could mangle the document) but it stops being a destination
  // and stops naming a customer in the markup.
  let neutralised = 0;
  out = out.replace(LEAKY_HREF_RE, () => {
    neutralised += 1;
    return 'href="#"';
  });

  // Last, so the stylesheet is not a candidate for any strip above and cannot be eaten by one.
  if (poolRoot) out = inlineStylesheet(out, poolRoot, (n) => missingCss.push(n));

  // After the stylesheet, so the injected rule sits later in the cascade than the sheet it overrides —
  // and after every strip, so nothing above can match the injected markup and eat it.
  out = injectEmbedLayer(out, { feedback });

  return {
    html: out, strippedNav, neutralised, mcpLeaks, tokensDropped, ratedUnderDropped,
    internalTailsDropped, reviewerCodesDropped, unbalanced, missingCss,
  };
}

/**
 * Read a run's report from the pool and prepare it.
 *
 * ONE file: `report.html`, the full report. The cutover is complete (spec 2026-07-30 §5):
 * `report.client.html` is no longer produced at publish, the per-customer index pages link
 * `report.html`, and the client-access service at clients.example.com serves reports through THIS
 * function (staff:false) rather than reading any file by path. Old pool dirs may still hold a stale
 * `report.client.html`; nothing reads it.
 */
/** The documents a published run holds, as `[{mark, slug, file}]` — read off its meta, never recomposed.
 *
 *  ONE RULE, ONE PLACE. The knockout publisher decides the filenames (one mark ⇒ `report.html`,
 *  several ⇒ `report-<slug>.html`) and writes the list it produced onto `meta.reports`. Every reader that
 *  has to open, serve or link a report takes it from here. A second copy of the naming rule is how a
 *  serving path and a publishing path come to disagree about where a document is, and the reader that
 *  loses is always the client's.
 *
 *  `meta.reports` ABSENT means a run published before this existed, or a clearance — both of which have
 *  exactly one document, at `report.html`. That is not a fallback to a legacy code path: it is the
 *  archive's own shape, and reading it correctly is the whole reason the retired rows exist.
 */
export function reportsOf(meta) {
  const listed = Array.isArray(meta?.reports) ? meta.reports : null;
  // — a batch published before the slug rode in its meta is HEALED off its own filename rather than
  // left unlinkable. The publisher's name for a per-mark document is `report-<slug>.html` and always has
  // been, so the slug is recoverable exactly, with no guess: batches already in the pool link correctly
  // without a republish, which matters because a republish is not something a reader of a delivered
  // report can ask for.
  const slugOf = (r) => r?.slug ?? (String(r?.file ?? "").match(/^report-(.+)\.html$/)?.[1] ?? null);
  if (listed?.length) return listed.map((r) => ({ mark: r.mark ?? null, slug: slugOf(r), file: r.file }));
  return [{ mark: meta?.markName ?? null, slug: null, file: "report.html" }];
}

/**
 * THE CROSS-MARK PARAGRAPH, out of the one file that carries it.
 *
 * A knockout over several names publishes one document per name and NO combined document, because the
 * assess chunk's paragraph names every mark in the chunk and putting it on each per-mark report is batch
 * residue (`driver/publish/knockout.mjs` blanks it there, and that stays). So the paragraph is written
 * once, into `report.md`, which says of itself: "There is no combined report: this summary is the only
 * place the marks appear together."
 *
 * NOTHING COULD REACH IT. `meta.reports` lists the per-mark HTMLs only, so `resolveReportFile` below
 * matches nothing for it and the portal route 404s; the pool path is not one the edge serves either
 * (test/edge-routes.mjs — one legacy filename, and it is `report.html`). Good prose, composed on every
 * multi-mark run, delivered to nobody. Owner ruling 2026-08-26: the grouped page carries it.
 *
 * Returns PARAGRAPHS, split the way the document renderer splits them, with inline markdown left in
 * place — the model writes markdown because every surface it feeds renders markdown, and the client
 * renders these the same way the reports do. Returns [] for every kind of absence: no file, no Summary
 * heading, an empty section. An empty array is "there is none", which the caller answers as such rather
 * than rendering a blank panel.
 *
 * @param {string} dir  the run's pool directory
 * @returns {string[]}  paragraphs, or [] when the run has no cross-mark summary
 */
export function batchSummaryOf(dir) {
  let raw;
  try { raw = readFileSync(join(dir, "report.md"), "utf8"); } catch { return []; }
  // ANCHORED ON THE HEADING AT BOTH ENDS, which is also what keeps the YAML front matter — title,
  // matter, band, for archive greps — away from a reader: it sits BEFORE `# Summary`, so the slice
  // never reaches it. A strip of that block stood here as well and was measurably dead code: removing
  // it changed no answer on any fixture, because this line had already excluded everything above it.
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#\s+Summary\s*$/.test(l));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  // TERMINATED BY THE NEXT SECTION — an H1, which is what `# Documents` (knockoutDocumentRoutes) now is.
  // It lists FILENAMES in the pool: addresses no client can use and no client should be handed, so
  // reading to the end of the file would ship that list and this boundary is load-bearing.
  //
  // — IT USED TO TERMINATE ON ANY HEADING, /^#{1,6}\s/, AND THAT SILENTLY TRUNCATED THE PAGE.
  // The writer now emits sub-headers INSIDE the summary (owner ruling 2026-08-31, "keep the length, add
  // the structure"). Measured on a ten-line structured summary before the fix: the section ended at the
  // first `## <MARK>` and the grouped page — the report's entry point — rendered ONE sentence, with
  // every following mark dropped and nothing anywhere reporting a loss. Depth cannot mark this boundary
  // while the summary is allowed to use depth of its own; the section boundary marks it.
  // TWO SPELLINGS, AND THE OLD ONE IS STILL ON DISK. Runs delivered before this change wrote the
  // documents list as `## Documents`, and an ARCHIVED run is re-read through this function every time
  // its page is opened. Terminating on H1 alone would sail past that heading and hand a client the pool
  // FILENAMES — the exact leak this boundary exists to stop, introduced by fixing the boundary. So the
  // section ends at the next SECTION (an H1) or at a Documents heading at any depth, whichever is first.
  const end = rest.findIndex((l) => /^#[ \t]/.test(l) || /^#{1,6}[ \t]+Documents[ \t]*$/i.test(l));
  const section = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  if (!section) return [];
  // Same split as render-knockout's mdParagraphs — a blank line is a block break. Inside a PROSE block a
  // line break is a wrap, not a break, so it collapses; inside a block carrying sub-headers or bullets
  // it is the structure itself, and collapsing it turned a bullet list into one line of hyphens.
  return section.split(/\n{2,}/)
    .map((p) => (SUMMARY_BLOCK_LINE.test(p) ? p.trim() : p.replace(/\s+/g, " ").trim()))
    .filter(Boolean);
}

/** Which file a request resolves to, or null.
 *
 *  A batch has no run-level document, so a slug-less request for one resolves to NOTHING rather than to
 *  its first mark. Serving mark one of eight as "the report" is the exact defect  removed; a 404 says
 *  the caller asked for something that does not exist, which is true.
 */
export function resolveReportFile(meta, slug = null) {
  const all = reportsOf(meta);
  if (slug) return all.find((r) => r.slug === slug)?.file ?? null;
  return all.length === 1 ? all[0].file : null;
}

export function readReport(dir, { log = () => {}, staff = false, poolRoot = null, feedback = false, file = "report.html" } = {}) {
  const raw = readFileSync(join(dir, file), "utf8");
  const { html, strippedNav, neutralised, mcpLeaks, tokensDropped, ratedUnderDropped, unbalanced, missingCss } =
    prepareReportForEmbed(raw, { staff, poolRoot, feedback });
  if (missingCss?.length) {
    // Worth a line at whatever volume it happens: every report on the box shares this one file, so if it
    // is gone, every report renders wrong at once and nothing else says so.
    log(`report-embed: stylesheet(s) not found beside the pool — ${missingCss.join(", ")} — reports will render unstyled`);
  }
  if (unbalanced.length > 0) {
    // The element was left in the document on purpose (see stripBalanced). Say so loudly: a staff
    // control shipping to a client is worth knowing about, and it will not announce itself.
    log(`report-embed: ${unbalanced.length} chrome element(s) left in place in ${dir} — no balanced close for <${[...new Set(unbalanced)].join(">, <")}>; markup drifted`);
  }
  if (mcpLeaks > 0) {
    log(`report-embed: ${mcpLeaks} MCP host reference(s) survived the Ask-your-AI strip in ${dir} — markup may have drifted`);
  }
  if (neutralised > 0) {
    log(`report-embed: ${neutralised} cross-tenant link(s) survived the nav strip in ${dir} — nav markup may have drifted`);
  }
  if (strippedNav === 0) {
    // Not fatal: a report rendered without the shared nav is legitimate (some publish paths omit it).
    // Worth a line, because the other explanation is that the strip stopped working.
    log(`report-embed: no site nav found in ${dir} (fine if it was rendered without one)`);
  }
  if (tokensDropped === 0) {
    // Every report the current renderer publishes carries exactly one. Zero means either a run published
    // before connector tokens existed (fine, and common in the archive) or that the renderer changed shape
    // and this strip is now a no-op — which would put a bearer credential back into a served document with
    // nothing else to catch it. Said at INFO rather than asserted, because the benign case is real.
    log(`report-embed: no connector token found in ${dir} (fine on a pre-connector run; otherwise the renderer's URL shape moved)`);
  }
  return html;
}
