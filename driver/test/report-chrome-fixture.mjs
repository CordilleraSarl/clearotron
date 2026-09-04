// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Chrome markup lifted VERBATIM from a real delivered report.
//
// Provenance: tmp8743-drivers-haven-2026-07-19-quartz-anvil/report.html, the run the owner opened on
// 2026-07-19. Nothing about the STRUCTURE was touched — the nesting depths, class attributes, tag
// shapes and whitespace are the renderer's own output. Four kinds of value were substituted, none of
// which the strip logic looks at: the run id, the customer name and matter ref, the customer keys in
// the nav dropdown, and the run-scoped token. The logo's SVG path data was collapsed (12KB of
// coordinates; the <svg> ELEMENT is kept because the balanced walk has to step over it).
//
// This exists because an invented fixture would have certified the bug. The old strip regexes were
// non-greedy to the first closing tag, and the two blocks below are the two that actually nest in
// production: `askband` holds two `<details class="askai-steps">`, and the review bar holds a nested
// `<div>`. A hand-written fixture without that nesting passes against the broken code.
//
// Verified to bite: against the previous non-greedy regexes this fixture leaves "Set up ChatGPT" and
// a stray `</div>` behind, so the tests fail on the old code rather than merely passing on the new.
//
// It is a SNAPSHOT, and the pool it came from is root-owned, so no test can re-read the real thing in
// CI. Drift is therefore caught at RUNTIME instead: prepareReportForEmbed counts what it could not
// strip (`unbalanced`), what survived the strip (`mcpLeaks`) and what it had to neutralise
// (`neutralised`), and readReport logs each one. Those counters are the live check; this file is only
// the regression pin.

export const NAV = "<nav class=\"sitenav\"><div class=\"navinner\"><span class=\"brand\"><span class=\"lockup\"><span class=\"lk-mark\" style=\"width:36px;height:36px\" aria-hidden=\"true\"><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1446 1446\" width=\"100%\" height=\"100%\"><path fill=\"currentColor\" transform=\"scale(1.41211 1.41211)\" d=\"M0 0 L1 1 Z\"></path>\n        <path fill=\"currentColor\" transform=\"scale(1.41211 1.41211)\" d=\"M0 0 L1 1 Z\"></path>\n        <path fill=\"currentColor\" transform=\"scale(1.41211 1.41211)\" d=\"M0 0 L1 1 Z\"></path>\n        <path fill=\"currentColor\" transform=\"scale(1.41211 1.41211)\" d=\"M0 0 L1 1 Z\"></path>\n        <path fill=\"currentColor\" transform=\"scale(1.41211 1.41211)\" d=\"M0 0 L1 1 Z\"></path>\n        <path fill=\"currentColor\" transform=\"scale(1.41211 1.41211)\" d=\"M0 0 L1 1 Z\"></path>\n        <path fill=\"currentColor\" transform=\"scale(1.41211 1.41211)\" d=\"M0 0 L1 1 Z\"></path></svg></span><span class=\"lk-text\"><span class=\"lk-word\">Clearotron</span></span></span></span><input type=\"checkbox\" id=\"tmnav\" class=\"navcheck\" hidden><label for=\"tmnav\" class=\"navburger\" aria-label=\"Menu\" title=\"Menu\">\u2630</label><div class=\"navmenu\"><a href=\"../index.html\">Clearance reports</a><a href=\"../status.html\">Run status</a><a href=\"../quality.html\">Quality</a><a href=\"../profiles.html\">Profiles</a><details class=\"climenu\"><summary>Clients<span class=\"chev\" aria-hidden=\"true\">\u25be</span></summary><div class=\"clipop\"><span class=\"clihd\">Clients</span><a class=\"cli\" data-anon-href data-anon-key=\"zephyr\" href=\"../customer/ownerkey/\"><span data-anon=\"client\" data-anon-key=\"zephyr\">zephyr</span></a><a class=\"cli\" data-anon-href data-anon-key=\"generic\" href=\"../customer/ownerkey/\"><span data-anon=\"client\" data-anon-key=\"generic\">generic</span></a><a class=\"cli\" data-anon-href data-anon-key=\"aurora\" href=\"../customer/ownerkey/\"><span data-anon=\"client\" data-anon-key=\"aurora\">aurora</span></a><a class=\"cli\" data-anon-href data-anon-key=\"petcary\" href=\"../customer/ownerkey/\"><span data-anon=\"client\" data-anon-key=\"petcary\">petcary</span></a></div></details></div></div></nav>";

export const REVIEW = "<div class=\"review internal no-print\">\n    <div class=\"rv-bar\"><span class=\"rv-head\">Internal review copy</span><span class=\"rv-tag\">stripped on export</span><span class=\"rv-spacer\"></span><div class=\"qcctl\" data-run=\"RUNID\" data-qc=\"https://trademark.example.com\" data-customer=\"Example Owner Ltd\" data-matter=\"MATTER1\" data-overall=\"Manageable\" style=\"display:inline-flex;gap:8px;align-items:center;position:relative\">\n    <button type=\"button\" class=\"util qc-flag-toggle\">\ud83c\udff3 Flag</button>\n    <button type=\"button\" class=\"util qc-etch\">\u2713 Save as correct example</button>\n    <div class=\"qc-pop\" hidden style=\"position:absolute;top:110%;left:0;z-index:5;background:var(--card,#fffaf0);border:1px solid var(--line,#ccc);border-radius:10px;padding:10px;width:320px;box-shadow:0 6px 24px rgba(0,0,0,.12)\">\n      <textarea class=\"qc-flag-text\" rows=\"3\" placeholder=\"What's off? In your own words \u2014 no jargon needed.\" style=\"width:100%;box-sizing:border-box;font:inherit;border:1px solid var(--line,#ccc);border-radius:6px;padding:6px\"></textarea>\n      <select class=\"qc-flag-kind\" style=\"width:100%;box-sizing:border-box;margin-top:6px;font:inherit;border:1px solid var(--line,#ccc);border-radius:6px;padding:5px\"><option value=\"\">sentiment (optional)</option><option value=\"negative\">\ud83d\udc4e something's off</option><option value=\"positive\">\ud83d\udc4d known-good</option></select>\n      <button type=\"button\" class=\"util primary qc-flag-send\" style=\"margin-top:6px\">Send flag</button>\n    </div>\n    <span class=\"qc-msg\" role=\"status\" style=\"font-size:12px;color:var(--muted,#6b5d50)\"></span>\n  </div></div>\n  </div>";

export const ASK = "<details class=\"askband no-print\">\n    <summary>\n      <div class=\"askband-ic\" aria-hidden=\"true\">\ud83d\udcac</div>\n      <div class=\"askband-main\">\n        <div class=\"askband-title\">Ask your AI about this run <span class=\"askband-exp\" aria-hidden=\"true\">\u25be</span></div>\n        <div class=\"askband-sub\">Connect once and interrogate the findings in the Claude or ChatGPT you already use \u2014 read-only.</div>\n      </div>\n    </summary>\n    <div class=\"askband-body\">\n      <button type=\"button\" class=\"util primary askai-copy\" data-copy=\"Brief me on trademark clearance run RUNID.\">\ud83d\udccb Copy question</button>\n      <p class=\"askai-hint\">Paste into the Claude or ChatGPT you already use \u2014 read-only. New chat: <a href=\"https://claude.ai/new\" target=\"_blank\" rel=\"noopener\">Claude \u2192</a> \u00b7 <a href=\"https://chatgpt.com/\" target=\"_blank\" rel=\"noopener\">ChatGPT \u2192</a></p>\n      <div class=\"askai-field\"><code class=\"askai-url\">https://mcp.internal.example/mcp?token=v1.eyJzY29wZSI6InVzZXIiLCJydW5JZCI6IlJVTklEIiwiZXhwIjoxNzg1MTk0ODAwLCJqdGkiOiI5YWYzYzEifQ.k7Qw3nR2xVb9tYcL0pJhM4sZaD8eF1gU6oIvN5rTqXw</code><button type=\"button\" class=\"util askai-copy\" data-copy=\"https://mcp.internal.example/mcp?token=v1.eyJzY29wZSI6InVzZXIiLCJydW5JZCI6IlJVTklEIiwiZXhwIjoxNzg1MTk0ODAwLCJqdGkiOiI5YWYzYzEifQ.k7Qw3nR2xVb9tYcL0pJhM4sZaD8eF1gU6oIvN5rTqXw\">Copy</button></div>\n      <details class=\"askai-steps\"><summary>Set up Claude</summary><ol><li>Settings \u2192 Connectors \u2192 Add custom connector</li><li>Paste the address above</li><li>Connect \u2192 sign in (clearotron email)</li></ol></details>\n      <details class=\"askai-steps\"><summary>Set up ChatGPT</summary><ol><li>Settings \u2192 Connectors \u2192 Advanced \u2192 Developer mode</li><li>Add MCP server \u2192 paste the address</li><li>Sign in (clearotron email)</li></ol></details>\n    </div>\n  </details>";

export const POP = "<span class=\"cardflag-pop no-print\" data-ord=\"4\" data-level=\"Low\" hidden style=\"flex-basis:100%;order:99;margin-top:6px\"><textarea class=\"cardflag-text\" rows=\"2\" placeholder=\"What's off with finding #4? In your own words.\" style=\"width:100%;box-sizing:border-box;font:inherit;border:1px solid var(--line);border-radius:6px;padding:6px\"></textarea><select class=\"cardflag-kind\" style=\"width:100%;box-sizing:border-box;margin-top:5px;font:inherit;border:1px solid var(--line);border-radius:6px;padding:5px\"><option value=\"\">sentiment (optional)</option><option value=\"negative\">\ud83d\udc4e something's off</option><option value=\"positive\">\ud83d\udc4d known-good</option></select><span style=\"display:flex;align-items:center;gap:8px;margin-top:5px\"><button type=\"button\" class=\"util primary cardflag-send\" style=\"font-size:12px\">Send flag for #4</button><span class=\"cardflag-msg\" style=\"font-size:11px;color:var(--muted)\"></span></span></span>";

export const BTN = "<button type=\"button\" class=\"cardflag no-print\" title=\"Flag this finding\" style=\"margin-left:auto;border:1px solid var(--line);background:#fff;border-radius:6px;cursor:pointer;font-size:11.5px;line-height:1.3;padding:2px 8px\">\ud83c\udff3 Flag</button>";

// The report's own sticky header \u2014 the block whose removal lets the embedded document begin at the
// opinion instead of at a second copy of its own identity (risk band, matter, issued date, Export).
//
// It is COMPOSED from NAV rather than pasted flat, because in the real document `.rep-stickyhead`
// CONTAINS the site nav and the theme fab, and both of those have strip rules of their own. That nesting
// is the whole hazard: `strippedNav` is a leak canary for the customer list, and a strip that removed the
// wrapper BEFORE the nav would take the nav with it, drive the canary to zero, and report a permanent
// false alarm on every report. A flat fixture cannot fail that way, so it would certify the bug \u2014 the
// same trap this file was written to avoid.
//
// Substituted per the note above: the run id, the matter ref and the mark. Structure is verbatim.
export const STICKY =
  '<div class="rep-stickyhead no-print">\n' +
  NAV +
  '<div class="fab-stack"><button type="button" class="theme-toggle" aria-pressed="false" title="Switch light / dark theme"><span class="tt-ic" aria-hidden="true">\u25d0</span><span class="tt-lbl">Theme</span></button></div>\n' +
  '<div class="topbar no-print">\n' +
  '  <a class="homebtn tb-back no-print" href="../index.html" title="All reports"><span aria-hidden="true">\u2190</span> <span class="tb-back-lbl">All reports</span></a>\n' +
  '  <span class="sp"></span>\n' +
  '  <span class="tb-risk" style="background:var(--low)">Manageable</span>\n' +
  '  <span class="mono tb-matter" style="font-size:11px;color:var(--faint)">MATTER1 / Example Mark</span>\n' +
  '  <span class="mono tb-issued"><span aria-hidden="true">\ud83d\uddd3 </span>Issued 2026-07-19 \u00b7 13:08 GMT+2</span>\n' +
  '  <div class="tb-menu">\n' +
  '    <button type="button" class="tbbtn primary tb-exp-toggle" aria-haspopup="true" aria-expanded="false">\u2b07 <span class="tb-lbl">Export</span> \u25be</button>\n' +
  '    <div class="tb-pop tb-exp-pop" hidden>\n' +
  '      <div class="tb-pop-title">Export &amp; audit</div>\n' +
  '      <button class="util primary" onclick="exportPDF()">\u2b07 Export PDF (ticked findings)</button>\n' +
  '      <a class="util" href="RUNID-audit.xlsx" download>\u2b07 Download full audit (Excel)</a>\n' +
  '      <div class="tb-sep"></div>\n' +
  '      <div class="tb-row"><button class="util" onclick="pickAll(true)">Select all</button><button class="util" onclick="pickAll(false)">Select none</button></div>\n' +
  '      <div class="tb-row"><button class="util" onclick="openAll(true)">Expand all</button><button class="util" onclick="openAll(false)">Collapse all</button></div>\n' +
  '      <p class="tb-hint">Tick a finding to keep it in the exported PDF; untick to drop it. Internal (review-only) notes are removed on export.</p>\n' +
  '    </div>\n' +
  '  </div>\n' +
  '</div>\n' +
  '</div>';
