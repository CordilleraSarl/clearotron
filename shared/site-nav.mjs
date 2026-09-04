// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// site-nav.mjs — ONE floating, cross-page top nav shared by every INTERNAL staff surface (the archive index,
// Run status, Quality, Feedback, Profiles) so they navigate like a proper website. Sticky at the top of the
// viewport; the current page is marked .active. NEVER rendered on a client-facing per-customer index.
//
// Layout (single row, never wraps): brand lockup · page links … [Clients ▾]. The theme + privacy toggles are
// NOT in the bar — they ride a floating bottom-right .fab-stack (siteFab), icon-only, matching the house site design.
// The per-customer list is collapsed into a native <details> "Clients ▾" dropdown so long descriptive
// aliases (demo privacy mode) can't overflow and wrap the bar. Below 760px the page links + Clients collapse
// behind a ☰ hamburger (a CSS checkbox-hack); the FABs stay pinned bottom-right. Everything is pure CSS.
//
// The CSS uses the warm brand tokens already present on both surface families (WARM_ROOT on the index,
// BASE_CSS on the staff pages, their own :root) — so NAV_CSS is dropped into each of those <style> blocks
// and the bar looks identical everywhere. siteNav() does the fs existence-gating (no dead links) and is called
// by the page WRITERS (which have poolDir), keeping the pure render functions fs-free.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { anonClient, anonToggle } from "./anon-overlay.mjs";
import { logoLockup, themeButton, THEME_BTN_CSS, CHROME_CSS } from "./brand.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Brand-token-driven so it inherits each surface's palette. Full-bleed crimson bar; inner column aligns to the
// same 1000px content width as the pages. Sticky so it floats as you scroll. The page-links group (.navmenu)
// grows to fill, pushing the Clients dropdown + toggle to the right; below 760px .navmenu collapses behind the
// ☰ (a :checked checkbox reveals it as an absolute panel) while the toggle stays on the bar.
// The website's blurred lockup header, ported to the tool tokens (themes light/dark). Inner column aligns to
// the 1000px page width. CHROME_CSS rides along so the lockup + glow + watermark are available on every staff
// surface that embeds this nav. Page links use the site's underline-wipe; the crimson-bar look is retired.
export const NAV_CSS = `
${CHROME_CSS}
 .sitenav{position:sticky;top:0;z-index:100;background:color-mix(in srgb,var(--bg) 82%,transparent);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
 .sitenav .navinner{position:relative;max-width:1000px;margin:0 auto;padding:10px 22px;min-height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px}
 .sitenav .brand{display:inline-flex;align-items:center}
 .sitenav .navmenu{display:flex;align-items:center;gap:clamp(18px,3vw,36px)}
 .sitenav a{position:relative;color:var(--muted);font-size:.72rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;padding:6px 0;text-decoration:none;white-space:nowrap}
 .sitenav a::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--crimson);transform:scaleX(0);transform-origin:left;transition:transform .32s cubic-bezier(.2,.7,.2,1)}
 .sitenav a:hover{color:var(--ink)}
 .sitenav a:hover::after{transform:scaleX(1)}
 .sitenav a.active{color:var(--ink)}
 .sitenav a.active::after{transform:scaleX(1)}
 .sitenav .climenu{position:relative}
 .sitenav .climenu>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:.72rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;padding:6px 0;user-select:none;white-space:nowrap}
 .sitenav .climenu>summary::-webkit-details-marker{display:none}
 .sitenav .climenu>summary:hover{color:var(--ink)}
 .sitenav .climenu[open]>summary{color:var(--ink)}
 .sitenav .climenu .chev{font-size:9px;transition:transform .12s}
 .sitenav .climenu[open]>summary .chev{transform:rotate(180deg)}
 .sitenav .clipop{position:absolute;top:calc(100% + 6px);right:0;min-width:210px;max-height:60vh;overflow:auto;display:flex;flex-direction:column;gap:1px;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow,0 10px 30px rgba(37,9,2,.14));padding:6px;z-index:120}
 .sitenav .clipop .clihd{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--crimson-mid);font-weight:700;padding:4px 10px 6px}
 .sitenav a.cli{display:block;color:var(--muted);font-size:12.5px;letter-spacing:normal;text-transform:none;padding:7px 10px;border-radius:7px}
 .sitenav a.cli::after{display:none}
 .sitenav a.cli:hover{color:var(--ink);background:var(--surface-high)}
 .sitenav .navburger{display:none;cursor:pointer;color:var(--ink);font-size:17px;line-height:1;padding:4px 9px;border-radius:8px;border:1px solid var(--line);user-select:none}
 .sitenav .navburger:hover{border-color:var(--crimson-mid)}
 @media (max-width:760px){
  .sitenav .navburger{display:inline-flex;margin-left:auto}
  .sitenav .navmenu{display:none;position:absolute;top:100%;left:0;right:0;flex:none;flex-direction:column;align-items:stretch;gap:1px;background:var(--card);border-bottom:1px solid var(--line);padding:8px 14px 12px;box-shadow:var(--shadow,0 12px 28px rgba(37,9,2,.2));z-index:115}
  .sitenav .navcheck:checked~.navmenu{display:flex}
  .sitenav .navmenu>a{padding:10px 6px}
  .sitenav .navmenu>a::after{display:none}
  .sitenav .climenu{margin-left:0}
  .sitenav .climenu>summary{border:none;padding:9px 6px}
  .sitenav .clipop{position:static;max-height:none;background:transparent;border:none;box-shadow:none;padding:0 0 4px 10px}
 }
 @media (max-width:560px){
  .sitenav .lockup .lk-tag{display:none}
  .sitenav .lockup .lk-mark{width:28px!important;height:28px!important}
  .sitenav .lockup .lk-word{font-size:12px}
 }
 ${THEME_BTN_CSS}`;

const MAIN = [
  ["index.html", "Clearance reports", "index"],
  ["status.html", "Run status", "status"],
  ["profiles.html", "Profiles", "profiles"],
];

// Build the floating nav for the page `active` ('index'|'status'|'profiles'). A main link shows when its
// target exists (or it IS the active page, always shown + highlighted). Per-account client views keep the
// otherwise-unlinked customer pages reachable: pass them via `clientKeys` (the index knows them and writes
// them in the SAME regenIndex pass, so a filesystem scan would race); omit it and they're discovered from
// customer/<key>/index.html (correct for the status page, generated after the dirs exist).
// `linkPrefix` rebases the hrefs for a surface that is NOT at the pool root — a report lives at
// <pool>/<runId>/report.html, so it passes "../" to reach the staff pages. Existence-gating stays
// poolDir-absolute (only the href is prefixed). Default "" keeps the pool-root pages unchanged.
// opts.anon=false omits the privacy toggle — for surfaces (reports) that ship without the __ANON__
// config + overlay JS, where the button would render "Privacy ON" and do nothing.
// opts.labels (Map key→display name) renders the Clients dropdown with display names instead of raw keys —
// the staff index passes its profile-derived labels; the status page passes nothing and keeps keys.
export function siteNav(poolDir, active, clientKeys = null, linkPrefix = "", { anon = true, labels = null } = {}) {
  const links = MAIN
    .filter(([file, , key]) => key === active || (poolDir && existsSync(join(poolDir, file))))
    .map(([file, label, key]) => `<a href="${linkPrefix}${file}"${key === active ? ' class="active"' : ""}>${esc(label)}</a>`)
    .join("");
  let keys = clientKeys;
  if (!keys) {
    try {
      keys = readdirSync(join(poolDir, "customer"), { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(poolDir, "customer", d.name, "index.html")))
        .map((d) => d.name);
    } catch { keys = []; }
  }
  keys = [...keys].sort();
  // Per-customer views collapse into a native <details> dropdown (no JS). Demo anonymisation: each client
  // link text is aliased (anonClient) and the link itself is neutralised (data-anon-href) in privacy mode,
  // keyed by the customer key so the week's demo customer stays live. Omitted entirely when there are none.
  const clients = keys.length
    ? `<details class="climenu"><summary>Clients<span class="chev" aria-hidden="true">▾</span></summary>`
      + `<div class="clipop"><span class="clihd">Clients</span>`
      + keys.map((k) => `<a class="cli" data-anon-href data-anon-key="${esc(k)}" href="${linkPrefix}customer/${encodeURIComponent(k)}/">${anonClient(labels?.get(k) ?? k, k)}</a>`).join("")
      + `</div></details>`
    : "";
  // <navmenu> holds the page links + Clients dropdown (inline on desktop; behind the ☰ on mobile). The
  // checkbox+label is the CSS-only hamburger. The privacy + theme toggles no longer live IN the bar — they
  // ride the floating .fab-stack (siteFab, appended after </nav>), pinned bottom-right like the house
  // site, icon-only. Every caller embeds the whole siteNav() string as one unit, so the FABs travel with the
  // nav and no writer needs a separate emit; the fab-stack is position:fixed so its DOM location is inert.
  return `<nav class="sitenav"><div class="navinner">`
    + `<span class="brand">${logoLockup({ mark: 36 })}</span>`
    + `<input type="checkbox" id="tmnav" class="navcheck" hidden>`
    + `<label for="tmnav" class="navburger" aria-label="Menu" title="Menu">☰</label>`
    + `<div class="navmenu">${links}${clients}</div>`
    + `</div></nav>`
    + siteFab({ anon });
}

// The floating bottom-right settings stack: the privacy toggle (staff surfaces only) + the theme toggle,
// icon-only. Bundled into siteNav()'s output above; also emitted standalone by surfaces without a staff nav
// (the client-facing per-customer index and the client report export) so the theme control is always present.
// anon=false drops the privacy toggle (reports/client surfaces ship no overlay JS, so it would be inert).
export function siteFab({ anon = true } = {}) {
  return `<div class="fab-stack">${anon ? anonToggle() : ""}${themeButton()}</div>`;
}