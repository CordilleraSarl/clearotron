// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// profiles-page.test.mjs — the Profiles page is GENERATED from profile-page.html (template) by injecting the
// demo-anon overlay (shared/anon-config.json via anon-overlay.mjs) AND the cross-page nav (site-nav.mjs) from
// their SINGLE sources, so it can't drift from the other four pages. These tests pin that single-source contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { writeProfilesPage } from "../publish/profiles-page.mjs";
import { anonAssets, anonToggle, loadAnonConfig } from "../../shared/anon-overlay.mjs";
import { NAV_CSS } from "../../shared/site-nav.mjs";

const TEMPLATE = fileURLToPath(new URL("../profile-page.html", import.meta.url));

test("template is SINGLE-SOURCE: has the placeholders, carries NO inline config/overlay/nav copy", () => {
  const src = readFileSync(TEMPLATE, "utf8");
  for (const marker of ["<!--ANON-HEAD-->", "/*NAV-CSS*/", "<!--SITE-NAV-->", "<!--ANON-JS-->", "<!--THEME-INIT-->", "/*BRAND-DARK*/"])
    assert.ok(src.includes(marker), `template must contain ${marker}`);
  assert.doesNotMatch(src, /window\.__ANON__\s*=/, "template must NOT inline the config (single source)");
  assert.doesNotMatch(src, /new MutationObserver/, "template must NOT inline the overlay JS (single source)");
  assert.doesNotMatch(src, /<nav class="sitenav">/, "template must NOT hardcode the nav bar (single source)");
  assert.doesNotMatch(src, /\.sitenav \.navinner/, "template must NOT inline the nav CSS (single source)");
  assert.doesNotMatch(src, /localStorage\.getItem\('cordillera-theme'\)/, "template must NOT inline the theme init (single source)");
  assert.doesNotMatch(src, /:root\[data-theme="dark"\]/, "template must NOT inline the dark token block (single source)");
});

test("writeProfilesPage fills the placeholders from the single sources + writes profiles.html", () => {
  const pool = mkdtempSync(`${tmpdir()}/profiles-`);
  const out = writeProfilesPage({ poolDir: pool });
  assert.ok(out.endsWith("/profiles.html"));
  const html = readFileSync(out, "utf8");

  // placeholders are consumed (injection happened) ...
  for (const marker of ["<!--ANON-HEAD-->", "/*NAV-CSS*/", "<!--SITE-NAV-->", "<!--ANON-JS-->", "<!--THEME-INIT-->", "/*BRAND-DARK*/"])
    assert.ok(!html.includes(marker), `${marker} should be replaced in the output`);
  // staff page theme: full gating — pre-paint init + explicit dark block + @media auto-dark + nav toggle
  assert.match(html, /localStorage\.getItem\('cordillera-theme'\)/, "THEME_INIT injected");
  assert.ok(html.indexOf("cordillera-theme") < html.indexOf("</head>"), "init in <head> (pre-paint)");
  assert.match(html, /:root\[data-theme="dark"\]/, "WARM_ROOT_DARK injected");
  assert.match(html, /prefers-color-scheme/, "staff page auto-darks");
  assert.match(html, /class="theme-toggle"/, "toggle arrives via the injected nav");
  // ... with EXACTLY what the single sources produce (ties the page to anon-config.json + site-nav.mjs)
  const a = anonAssets();
  assert.ok(html.includes(a.head), "head injected verbatim from anonAssets()");
  assert.ok(html.includes(a.js), "overlay injected verbatim from anonAssets()");
  assert.ok(html.includes(NAV_CSS), "nav CSS injected verbatim from site-nav.mjs");
  assert.match(html, /<nav class="sitenav">/, "nav bar injected from siteNav()");
  assert.match(html, /href="profiles.html" class="active"/, "siteNav('profiles') marks Profiles active");
  assert.ok(html.includes(anonToggle()), "privacy toggle injected via the nav (single source)");
  // the page's own app markup (roster/editor tagging) is untouched
  assert.match(html, /data-anon="client"/);

  // with the feature enabled (shipped state), the real config values flow through — proves NO second copy
  if (loadAnonConfig().enabled) {
    assert.match(html, /class="anon-toggle/, "toggle button present");
    assert.match(html, /new MutationObserver/, "overlay JS present");
  }
});

// ── PR-2 affordances (roster presentation, framework box enrichment, editor robustness) ──────────────────
// The page is a static template whose JS runs only in the browser, so these pin the template SOURCE: the
// render expressions and user-facing strings the profile-service tests can't see.
test("PR-2: framework box renders axes + prominent source deck + the band-meanings box (blurred prose)", () => {
  const src = readFileSync(TEMPLATE, "utf8");
  assert.match(src, /Rated on: /, "matrix frameworks show what the band is rated on");
  assert.ok(src.includes('m.structure.axes.map(esc).join(" × ")'), "the axes joined with × (escaped per axis)");
  assert.ok(src.includes('class="srcdeck"'), "source deck has its own prominent line, not an 11px afterthought");
  assert.match(src, /What the bands mean/, "the band-meanings box is rendered when the service serves bandMeanings");
  assert.ok(src.includes('class="bmtxt" data-anon="mark"'),
    "band-meaning prose is wrapped data-anon=mark — the decks are Privileged & Confidential, the demo blur must cover them");
});

test("PR-2: roster sub-line truncates, key is a mono slug, and the anon spans still cover name and key+industry", () => {
  const src = readFileSync(TEMPLATE, "utf8");
  assert.match(src, /-webkit-line-clamp:2/, "the sub-line clamps (aurora's ~110-char industry must not overflow)");
  assert.ok(src.includes('<code class="slug">${esc(p.key)}</code>'), "the key renders as a muted mono slug");
  assert.ok(src.includes('data-anon="client" data-anon-key="${esc(p.key)}">${esc(p.name||p.key)}'),
    "the client span still exactly covers the name (the overlay swaps its textContent)");
  assert.ok(src.includes('class="ind" data-anon="mark" data-anon-key="${esc(p.key)}"'),
    "the mark span still exactly covers key+industry (the overlay blurs it)");
});

test("PR-2: editor robustness — explicit error states, delivery merge, null-safe msg, responsive collapse", () => {
  const src = readFileSync(TEMPLATE, "utf8");
  // a failed roster fetch is an explicit error state, never "No customers."
  assert.match(src, /Couldn’t load customers — service error or sign-in expired/);
  assert.match(src, /if \(r\.status !== 200\) \{\s*\/\/ a failed fetch is NOT an empty roster/);
  // collect() merges over the LOADED delivery instead of hardcoding it (style/template survive)
  assert.ok(src.includes('const delivery = { ...((current.profile && current.profile.delivery) || {}), email: $("f_email").value };'),
    "collect() spreads the loaded delivery, overwriting only the form's fields");
  assert.doesNotMatch(src, /\$\("f_priv"\)\.checked, template: "standard"/, "no hardcoded delivery rewrite");
  // The marking is composed SEPARATELY and stays three-state: its default option writes absence, never
  // `false` ( — a checkbox here recorded "strip the line" for customers who had asked
  // for nothing). The executable arms live in
  // the-staff-editor-cannot-invent-a-confidentiality-instruction.test.mjs; this one guards the shape.
  assert.ok(src.includes('if ($("f_priv").value === "no") delivery.privileged = false; else delete delivery.privileged;'),
    "the marking's default option writes ABSENCE rather than a boolean");
  assert.doesNotMatch(src, /privileged: \$\("[fp]_priv"\)\.checked/,
    "neither collector reads a two-state control for a three-state field");
  // async bodies surface readable failures; showMsg can't crash; the initial panel can show a message
  assert.match(src, /async function submit\(write\) \{\s*try \{/);
  assert.match(src, /async function openCustomer\(key\) \{\s*try \{/);
  assert.match(src, /const el = \$\("msg"\); if \(!el\) return;/, "showMsg is null-safe");
  assert.match(src, /<div class="panel" id="editor">.*<div class="msg" id="msg">/, "the initial editor panel carries a #msg node");
  // the two fixed grids collapse at the shared nav's breakpoint
  assert.match(src, /@media \(max-width:760px\)\{ \.cols\{grid-template-columns:1fr\} \.row2\{grid-template-columns:1fr\} \}/);
});

// ── spec 62 — the nested project (engagement) editor ─────────────────────────────────────────────────────
test("spec 62: the customer editor hosts a Projects section (existing customers only) and loads the list", () => {
  const src = readFileSync(TEMPLATE, "utf8");
  assert.match(src, /Projects \(engagements\)/, "the customer editor has a Projects section header");
  assert.ok(src.includes('${isNew ? "" : `<div class="sectionh">Projects (engagements)</div>'),
    "the Projects section is gated to EXISTING customers (a new customer has no file to hang projects under yet)");
  assert.ok(src.includes('if (!isNew) loadProjectList(key);'), "the customer editor populates its project list on render");
  assert.match(src, /async function loadProjectList\(customer\)/, "the project list is fetched from GET /profiles/:customer/projects");
  assert.ok(src.includes('`${API}${encodeURIComponent(customer)}/projects`'), "list route is the nested projects path");
  // masking contract: BOTH the project name AND its slug sit inside the data-anon span (a bare slug outside
  // it would leak the engagement name the moment privacy mode is on — the customer roster masks key+name together).
  assert.ok(src.includes('<span data-anon="mark">${esc(p.name||p.key)} <code class="slug">${esc(p.key)}</code></span>'),
    "the project row masks name AND slug together (no bare slug outside the anon span)");
});

test("spec 62: the project editor is a SPARSE overlay form — blank inherits, projectName required, customer-only fields absent", () => {
  const src = readFileSync(TEMPLATE, "utf8");
  // the delta model: collectProject includes a field ONLY when the user set it
  assert.match(src, /function collectProject\(\)/);
  assert.ok(src.includes("const plats = lines($(\"p_platforms\").value); if (plats.length) o.platforms = plats;"),
    "platforms only included when the user set them (blank ⇒ inherit)");
  // The density line stood here until the owner ruled the control off every surface (2026-08-29). What
  // replaces it is the opposite assertion: the form must not carry the input at all. The stored field
  // survives, preserved server-side —
  // driver/test/a-removed-control-does-not-delete-the-setting-behind-it.test.mjs holds that half.
  assert.equal(src.includes("p_density"), false, "the removed listing-size control has not come back");
  // projectName is the one always-present overlay field; identity/framework fields have NO input at all
  assert.ok(src.includes('o = { projectName: ($("p_name").value||"").trim() }'), "projectName always carried");
  assert.doesNotMatch(src, /id="p_name_matchdomains"|id="p_framework"|id="p_excl"/, "no customer-only field inputs in the project form");
  assert.match(src, /A project overlays this customer — fill in only what differs/, "the inherit-by-blank contract is stated to the user");
  // the overlay posts to the nested save/validate route
  assert.ok(src.includes('`${API}${encodeURIComponent(currentProject.customer)}/projects/${encodeURIComponent(c.slug)}/${write?"save":"validate"}`'),
    "the project save/validate posts to the nested route");
  // masking contract: the project display name + posture render through data-anon (privacy blur must cover them)
  assert.ok(src.includes('data-anon="client">${esc(cname)}'), "the customer name in the project header stays anon-masked");
});

// ── privacy-mode affordance (staff-hygiene batch): a neutralised link explains itself ─────────────────────
test("anon overlay: a privacy-dead link carries a plain-English title, dropped again on restore, and stays hoverable", () => {
  const cfg = { enabled: true, privacyDefaultOn: true, markStyle: "blur", fallbackClientAlias: "Confidential client", clients: {}, demoAllow: { clientKeys: [], runs: [] } };
  const { head, js } = anonAssets(cfg);
  // the affordance text, set exactly where the href is neutralised…
  assert.match(js, /hidden in privacy mode — toggle Privacy OFF to open/);
  assert.ok(js.includes('el.classList.add("anon-dead"); el.setAttribute("title", DEAD_TITLE)'),
    "title set alongside the href neutralisation");
  // …and removed on restore ONLY if it is ours (never clobbers a link's own title)
  assert.ok(js.includes('if(el.getAttribute("title") === DEAD_TITLE) el.removeAttribute("title")'),
    "restore drops only the overlay's own title");
  // pointer-events:none would suppress the hover tooltip — dead links must stay hoverable, inert via preventDefault
  assert.doesNotMatch(head, /anon-dead\{pointer-events:none\}/);
  assert.match(head, /\.anon-dead\{cursor:not-allowed\}/);
  assert.ok(js.includes('closest(".anon-dead")'), "click on a dead link is swallowed by the overlay handler");
  // the deliberate default-ON bootstrap is untouched (first visit honours privacyDefaultOn)
  assert.ok(head.includes('on=(s===null)?!!c.privacyDefaultOn:(s==="1")'), "privacyDefaultOn bootstrap unchanged");
});

// ── — the owner's term, on the staff door ─────────────────────────────────────────
// The staff page names the default rating authority in four places a person reads. Asserting the ABSENCE
// of the old term as well as the presence of the new one is the point: a partial sweep that renamed the
// heading and left the read-only explanation underneath is exactly the state this catches, and it reads
// as done from a screenshot.
test("1990: the staff page calls the default rating authority by the owner's term, everywhere", () => {
  const src = readFileSync(TEMPLATE, "utf8");
  assert.doesNotMatch(src, /house[\s-]default/i, "no surface still says the retired term");
  assert.doesNotMatch(src, /house framework/i, "including the explanation under the heading");
  assert.match(src, /<b>Generic default<\/b>/, "the read-only heading names it");
  assert.match(src, /Generic default framework/, "and so does the framework name when none is on file");
  assert.equal((src.match(/Generic default/g) || []).length, 5,
    "five sites: the page meta, the framework name, the two read-only explanations, and the comment that "
    + "explains the branch between them — counted, not predicted");
});
