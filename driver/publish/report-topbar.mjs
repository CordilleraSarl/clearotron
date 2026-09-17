// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// report-topbar.mjs — THE EXPORT MENU, ONCE, FOR BOTH REPORT TEMPLATES.
//
// Two templates draw a report: the clearance renderer and the knockout renderer. Each emits its own top
// bar, which is right — the boards draw two different bars, with different items in a different order.
// What they must not each own is the EXPORT MENU: the toggle, the popover it opens, the aria wiring that
// says it is a menu, and the two listeners that open and close it. Those are one control, and until this
// module they were two copies of one control, in two files, with nothing to say when they drifted.
//
// ── WHAT IS SHARED AND WHAT IS NOT, AND WHY THE LINE IS THERE ───────────────────────────────────────
//
// The SHELL is shared: the button, the panel, the behaviour. The ENTRIES are not. The clearance report
// filters its export to the findings a reader has ticked, so its menu says so and offers a select-all;
// the knockout has no tick boxes at all, deliberately, because it has nothing to filter, and a menu
// offering to tick there would name a control that cannot exist. An entry list is a statement about what
// a template can do, and the two templates can do different things.
//
// ── THE BYTES DO NOT MOVE ───────────────────────────────────────────────────────────────────────────
//
// `driver/publish/render.mjs` is frozen at a content hash, and the freeze's checklist asks whether a
// change is reachable from a republish. This one is: pool-admin re-renders archived runs through that
// module. So the contract here is stricter than "it looks the same" — the composed markup is the bytes
// the two templates already emitted, character for character, and the commit that introduces this module
// records a real archived run rendered through both the old module and the new one and byte-compared, in
// the internal pass and the client pass. A shared definition that changed a delivered report while
// tidying it up would be the worst of both.

/**
 * The button that opens the export menu. One spelling, both templates.
 *
 * `aria-haspopup` and `aria-expanded` are part of the control rather than decoration: the listener below
 * keeps `aria-expanded` in step, and a second copy of this button that forgot either would announce
 * itself to a screen reader as an ordinary button that does nothing.
 */
export const EXPORT_TOGGLE = '<button type="button" class="tbbtn primary tb-exp-toggle" aria-haspopup="true" aria-expanded="false">⬇ <span class="tb-lbl">Export</span> ▾</button>';

/**
 * The panel the toggle opens, around whatever entries a template offers. PURE.
 *
 * @param {string} entries  the template's own menu contents, already escaped
 * @returns {string}
 */
export const exportPopover = (entries) => `<div class="tb-pop tb-exp-pop" hidden>${entries}</div>`;

/**
 * Open on the button, close on a click outside and on Escape.
 *
 * GLOBAL, NOT WRAPPED, and that is the same reason the templates' own verbs are global: the portal
 * frames a served report and drives it by looking names up on the page. These two listeners need no
 * name, but they sit in the same script as the verbs that do, and a wrapper around the pair would be one
 * more difference between the two files for no gain.
 *
 * NO BACKTICK IN THIS STRING. It is interpolated into a template literal in both templates, and a
 * backtick ends that literal — the failure arrives at import time naming a token nobody wrote.
 */
export const EXPORT_MENU_JS = `document.addEventListener('click',function(e){var t=e.target.closest('.tb-exp-toggle'),pop=document.querySelector('.tb-exp-pop');if(t){if(pop){pop.hidden=!pop.hidden;t.setAttribute('aria-expanded',String(!pop.hidden));}return;}if(pop&&!pop.hidden&&!e.target.closest('.tb-exp-pop')){pop.hidden=true;var b=document.querySelector('.tb-exp-toggle');if(b)b.setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){var pop=document.querySelector('.tb-exp-pop');if(pop&&!pop.hidden){pop.hidden=true;var b=document.querySelector('.tb-exp-toggle');if(b)b.setAttribute('aria-expanded','false');}}});`;
