// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// html-escape.mjs — a value placed into HTML, in the two forms a page needs.
//
// Every page writer here kept its own escaper: eighteen definitions with six different bodies, some printing "null"
// for an absent value and one leaving `>` raw. There are two places a value can sit, so there are two functions:
// between tags, and between an attribute's quotes. The attribute form is a superset and is also correct as text, so a
// writer that does not keep the two apart uses it everywhere. An href also needs its scheme checked, which is
// driver/publish/attr.mjs's hrefAttr, built on escapeAttr.
//
// Neither is for a <script> or <style> block, where the browser does not decode an entity. Dependency-free, so shared/
// and driver/ both import it.

/** Text between HTML tags: & < > encoded. An absent value is empty. PURE. */
export const escapeText = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A value between an attribute's quotes, either kind, and safe as text too: & < > " ' encoded. An absent value is empty. PURE. */
export const escapeAttr = (s) => escapeText(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
