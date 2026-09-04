#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// profiles-page.mjs — generate the pool's profiles.html from the static template profile-page.html,
// injecting BOTH shared surfaces from their single sources: the demo-anon overlay (shared/anon-config.json
// via anon-overlay.mjs) AND the cross-page nav bar (site-nav.mjs).
//
// Why a generator instead of `cp`: profile-page.html is the only staff page that used to be copied
// verbatim, so it carried its OWN inline copy of the anon config/overlay AND a hand-copied nav bar —
// two drift traps (reword an alias, or restyle/rename the nav, and the Profiles page silently disagreed; its
// nav had already drifted to stale labels for deleted pages with no Clients list). This writer fills the
// template's placeholders so both live in exactly ONE place; re-running it (the CLI below) is what keeps
// profiles.html matching the other staff pages.

import "../../shared/env-local.mjs";   // — FIRST: the CLEAROTRON_* translation must land before any
                                     // module-top capture below it evaluates. A call in this file's BODY
                                     // would run too late — that was the repair that left this open.
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { anonAssets } from "../../shared/anon-overlay.mjs";
import { NAV_CSS, siteNav } from "../../shared/site-nav.mjs";
import { WARM_ROOT, WARM_ROOT_DARK, THEME_INIT, FAVICON_LINK, BRAND } from "../../shared/brand.mjs";
import { config } from "../driver.config.mjs";
import { isEntrypoint } from "../../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

// The template lives one dir up: driver/profile-page.html
const TEMPLATE = fileURLToPath(new URL("../profile-page.html", import.meta.url));

// Replace each placeholder with the injected string. A FUNCTION replacer is used so a `$` in the injected
// markup (e.g. inside the overlay JS) is never interpreted as a String.replace special pattern ($&, $1, …).
function fill(html, marker, value) {
  return html.replace(marker, () => value);
}

// Render <poolDir>/profiles.html from the template + the single sources. siteNav(poolDir,'profiles') gets the
// same nav as the generated pages (page links existence-gated, Clients discovered from customer/<key>/, the
// privacy toggle baked in). Returns the written path.
export function writeProfilesPage({ poolDir, template = TEMPLATE } = {}) {
  const a = anonAssets();
  let html = readFileSync(template, "utf8");
  // Tenant brand: the template carries the DEFAULT brand name/product; stamp the configured
  // ones at write time (same shape as dev-portal.mjs's serve-time stamp) so a rebranded tenant's page is
  // consistent. Done BEFORE the fills so only template-owned strings are touched — the injected assets
  // already route through BRAND at their own single sources. (The 'cordillera-theme' localStorage key is a
  // stable storage key, not branding, and does not contain the default brand name — the replace, which is
  // case-sensitive and keyed on the DEFAULT name rather than on any firm's, leaves it alone.)
  html = html.replace("Clearotron · Trademark clearance", () => `${BRAND.name} · ${BRAND.product}`);
  html = html.replaceAll("Clearotron", () => BRAND.name);
  html = fill(html, "<!--FAVICON-->", FAVICON_LINK);
  html = fill(html, "<!--THEME-INIT-->", THEME_INIT);          // staff page: OS-aware pre-paint init
  html = fill(html, "/*BRAND-ROOT*/", WARM_ROOT);
  html = fill(html, "/*BRAND-DARK*/", WARM_ROOT_DARK);         // staff dark block (explicit + @media auto)
  html = fill(html, "<!--ANON-HEAD-->", a.head);
  html = fill(html, "/*NAV-CSS*/", NAV_CSS);
  html = fill(html, "<!--SITE-NAV-->", siteNav(poolDir, "profiles"));
  html = fill(html, "<!--ANON-JS-->", a.js);
  const out = join(poolDir, "profiles.html");
  writeFileSync(out, html);
  try { chmodSync(out, 0o640); } catch { /* best-effort; the deploy step also chmods */ }
  return out;
}

// ── CLI ── regenerate <pool>/profiles.html (CLEAROTRON_STAFF_POOL_ROOT or the live pool root)
const isMain = isEntrypoint(import.meta.url);
if (isMain) {
  // — this WRITES a page into the pool, so an unset pool root refuses by name rather than falling
  // back to `/srv/trademark-archive`. config.poolRoot is the one derivation; the literal is gone from
  // here. (Importing driver.config is free: every value on it is a getter, so nothing resolves until
  // this line runs — writeProfilesPage's own callers pass their poolDir and never touch it.)
  const poolDir = process.env.CLEAROTRON_STAFF_POOL_ROOT || config.poolRoot;
  console.log(`wrote ${writeProfilesPage({ poolDir })}`);
}
