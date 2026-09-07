// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE TWO SERVER-RENDERED DOORS DECLARE NO COLOUR OF THEIR OWN.
//
// `loginPage` and `denialPage` are rendered by driver/portal-service.mjs with no bundle, no stylesheet
// and no script — a door has to render when the rest of the portal will not. That self-containment is
// why they carried their own palette, and why each had independently guessed a DARK one: five values,
// written twice, against a ground (#17150f) that is not the brand pack's (#0f0e0c). left it in
// place deliberately and said so in the code; this is the follow-up it named.
//
// WHY THE ARM READS THE EMITTED HTML AND NOT THE SOURCE FILE. Scanning portal-service.mjs for
// `#[0-9a-f]{6}` false-positives on its own comments — the docblock above `loginPage` quotes the three
// hexes the page used to hardcode, and must keep quoting them to explain what changed. The bytes a
// browser receives are the actual claim, so those are what this reads.
//
// AND WHY IT ASSERTS MEMBERSHIP, NOT ABSENCE. "No colour literal in the output" can never be true: the
// tokens resolve to hexes, so the emitted CSS is nothing but colour literals. The real requirement is
// that every one of them came from brand.mjs — which is a set-membership question.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTE, PALETTE_DARK, DOOR_ROOT, DOOR_ROOT_DARK, DOOR_THEME_INIT } from "../../shared/brand.mjs";
import { loginPage, denialPage } from "../portal-service.mjs";

// Every colour VALUE brand.mjs blesses, lowercased. rgba() spellings are included verbatim because two
// of the door tokens are alpha over a ground and a flat hex would be wrong on one of the surfaces.
const BRAND_COLOURS = new Set(
  [...Object.values(PALETTE), ...Object.values(PALETTE_DARK)]
    .filter((v) => /^(#|rgba?\()/.test(v))
    .map((v) => v.toLowerCase().replace(/\s+/g, "")),
);

// Pull every colour out of a stylesheet: hexes and rgb/rgba functions. The `{3,8}` floor is what keeps
// the HTML entity `&#39;` (an escaped apostrophe, which this page emits) from reading as a colour.
const coloursIn = (html) => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  const hex = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  const fn = [...css.matchAll(/rgba?\([^)]*\)/g)].map((m) => m[0]);
  return [...hex, ...fn].map((v) => v.toLowerCase().replace(/\s+/g, ""));
};

// The two doors, named so a failure says which one and so a renamed export cannot read as a pass.
const DOORS = [
  ["loginPage", () => loginPage({ email: "someone@example.test", error: "That passphrase is not right." })],
  ["denialPage", () => denialPage(403, "no policy matched this address")],
];

test("#1892 — every colour both doors emit is a brand value", () => {
  assert.equal(DOORS.length, 2, "both doors are scanned — an arm that scans nothing passes");
  let scanned = 0;
  for (const [name, render] of DOORS) {
    const colours = coloursIn(render());
    assert.ok(colours.length > 0, `${name} emitted a stylesheet with no colours — the renderer moved`);
    const strays = [...new Set(colours)].filter((c) => !BRAND_COLOURS.has(c));
    assert.deepEqual(strays, [],
      `${name} emits ${strays.join(", ")} — a colour with no entry in PALETTE or PALETTE_DARK. `
      + "Add it to brand.mjs and take it from there by name; do not hand-pick it in the renderer.");
    scanned++;
  }
  assert.equal(scanned, 2);
});

test("#1892 — both doors take the SAME two blocks, so neither can drift from the other", () => {
  for (const [name, render] of DOORS) {
    const html = render();
    assert.ok(html.includes(DOOR_ROOT), `${name} no longer carries DOOR_ROOT — it has a palette of its own again`);
    assert.ok(html.includes(DOOR_ROOT_DARK), `${name} no longer carries DOOR_ROOT_DARK`);
    // The failure this catches: a page that keeps DOOR_ROOT and adds a palette of its own beside it.
    // One bare `:root{` (light) and one `:root[data-theme="dark"]{` — a third of either is a page
    // that has started declaring colours again.
    assert.equal(html.match(/:root\s*\{/g).length, 1, `${name} declares a second light :root block`);
    assert.equal(html.match(/:root\[data-theme="dark"\]\s*\{/g).length, 1, `${name} declares a second dark block`);
  }
});

test("#1892 — the dark scheme is tokens only: it cannot restyle a selector the light block never named", () => {
  // DOOR_ROOT_DARK is ONE selector block and nothing else. If a scoped rule ever gets added to it, the
  // doors are back to overriding selectors in dark, which is the shape that let the two copies diverge.
  assert.match(DOOR_ROOT_DARK, /^:root\[data-theme="dark"\]\{[^{}]*\}$/,
    "DOOR_ROOT_DARK carries something other than a single :root token block");
});

test("#1892 — the dark ground and text are the brand pack's, not the doors' guesses", () => {
  // brand pack §01: Dark BG #0f0e0c near-black, Parchment #f0e8d8 dark text/mark. The doors had
  // guessed #17150f/#ece5d8 independently, twice. Pinned so a future edit has to argue with the pack.
  assert.equal(PALETTE_DARK.ground, "#0f0e0c");
  assert.equal(PALETTE_DARK.ink, "#f0e8d8");
  for (const guess of ["#17150f", "#ece5d8", "#1f1c15", "#a89b87", "#332e24"])
    assert.ok(!BRAND_COLOURS.has(guess), `${guess} is one of the retired hand-picked door values`);
});

test("#1892 — the error state has named colours in both schemes", () => {
  // The other half of the issue: `.err` had three light values and three dark ones, none of which had
  // any home. The light ink is crimsonDeep and is deliberately not a fourth entry.
  for (const k of ["errBg", "errLine"]) {
    assert.ok(PALETTE[k], `PALETTE.${k} is missing — the light error state has nowhere to come from`);
    assert.ok(PALETTE_DARK[k], `PALETTE_DARK.${k} is missing — the dark error state has nowhere to come from`);
  }
  assert.ok(PALETTE_DARK.errInk, "PALETTE_DARK.errInk is missing");
  assert.match(DOOR_ROOT, /--err-bg:.*--err-line:.*--err-ink:/);
  assert.match(DOOR_ROOT_DARK, /--err-bg:.*--err-line:.*--err-ink:/);
});

// ── — THE DOORS OBEY THE CLIENT-SURFACE DARK DOCTRINE ────────────────────────────────────────
//
// `shared/portal-tokens.mjs` states the rule: a client surface never follows the OS colour preference.
// Dark ships as `[data-theme]` only, so a first view is always light and dark arrives from a choice the
// visitor made. The check that enforced it greps the BUILT SPA BUNDLE, so these two server-rendered
// pages were never in its domain and shipped an OS-preference media query for as long as they existed.
//
// The two arms below are a PAIR and neither is sufficient. Removing the media query alone makes the
// doors permanently light for everyone — nothing else on the page reads the shared theme key — which is
// a worse outcome than the defect. That is why the second arm exists.

test("#1903 — neither door follows the OS colour preference", () => {
  for (const [name, render] of DOORS) {
    const html = render();
    // The literal feature name, not a parsed media query: the SPA's own guard is a dumb string search
    // for exactly this reason, and a check that can be talked past is not a check.
    assert.ok(!html.includes("prefers-color-scheme"),
      `${name} carries the OS colour-preference feature — a client surface must not auto-dark`);
    assert.ok(html.includes('[data-theme="dark"]'), `${name} ships no explicit dark block at all`);
  }
});

test("#1903 — and each door can still REACH dark, or the doctrine leaves it permanently light", () => {
  for (const [name, render] of DOORS) {
    const html = render();
    assert.ok(html.includes(DOOR_THEME_INIT),
      `${name} has no pre-paint script: with no media query and nothing reading the saved choice, `
      + "this page is light for everyone forever, including a visitor who chose dark on their report");
    // Before the stylesheet, or the attribute lands after first paint and a returning visitor sees a
    // light flash — which is the whole reason this script is inline rather than bundled.
    assert.ok(html.indexOf(DOOR_THEME_INIT) < html.indexOf("<style>"),
      `${name} loads its pre-paint script after the stylesheet`);
  }
});

test("#1903 — the door init applies a saved choice and does nothing else", () => {
  // It is deliberately NOT brand's THEME_INIT: that one also installs a delegated click handler for
  // `.theme-toggle`, and these pages have no buttons. Both share one copy of the apply half, so the
  // storage key and the attribute name cannot drift between them.
  assert.ok(DOOR_THEME_INIT.includes("cordillera-theme"), "the door init reads the shared theme key");
  assert.ok(!DOOR_THEME_INIT.includes("addEventListener"),
    "the door init installs a listener — these pages ship no toggle for it to serve");
});
