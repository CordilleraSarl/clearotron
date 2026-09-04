// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — WHAT AN INSTALLER WHO CONFIGURES NOTHING PUBLISHES.
//
// The seam was never the problem. `CLEAROTRON_BRAND_NAME`/`_TAGLINE`/`_PRODUCT` worked, TRADEMARKS.md
// documented them, and driver/publish/index.mjs read them. What shipped was the DEFAULTS behind that
// seam — one Swiss practice's name and strapline — so every deployment that set nothing published
// reports, a pool index, portal chrome, Excel metadata and connector instructions branded with somebody
// else's firm. On the page that warns a deployer the licence grants no rights to the name, and that
// deploying under a name that is not yours "is the exact problem it exists to detect".
//
// WHY THIS IS A TEST AND NOT A ONE-LINE EDIT. The defect had two halves and only one of them lives in
// the seam:
//
//   1. the DEFAULTS, which are a value and stay fixed once changed; and
//   2. STRING LITERALS in modules the seam never reaches — a failure note in portal-service.mjs, an
//      allowance note in mcp-server/lib/plan.mjs, an installer banner in bin/start.mjs. Sixty-one files
//      carried the name, and the seam substituted in eight of them.
//
// The second half is what regrows. Every one of those literals was written by somebody adding a sentence
// to a screen, in a repository where the operator's name was simply true — which is exactly how it will
// be written again. Arm D is therefore a scan over the modules that EMIT client-visible copy, not a
// review note. It reads the tracked tree via `git ls-files`, so a file staged but unwritten is caught and
// an untracked scratch copy is not mistaken for shipped code.
//
// WHAT IT DELIBERATELY DOES NOT POLICE. Comments, the licence header, the trademark notice in
// TRADEMARKS.md, the AGPL §13 source-repository URL and About.tsx's attribution all name the firm
// truthfully and MUST keep doing so — a fork that strips its own copyright headers has broken the
// licence, not fixed the branding. Prose comments that name the deployment's operator are 's sweep
// and are out of scope here on purpose: this file is about EMITTED bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { BRAND, logoLockup, CHROME_CSS, WARM_ROOT, REPORT_ROOT, FAVICON_LINK } from "../../shared/brand.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(REPO, p), "utf8");

// The name and strapline the defaults used to carry. Spelled out once, here, because every arm below is
// really asking the same question: can an installer who sets nothing still publish these?
const FIRM = /Cordillera|IP Law/;

test("#1376 arm A — the shipped defaults name the PRODUCT, and the tagline defaults to nothing", () => {
  // Read the source rather than the imported value: BRAND is env-read at import, so a test that only
  // looked at BRAND.name would go green on any box that happens to export CLEAROTRON_BRAND_NAME — which is
  // every deployment, and is precisely the reader who cannot see this defect.
  const src = read("shared/brand.mjs");
  const literal = src.match(/export const BRAND = \{([\s\S]*?)\n\};/)?.[1];
  assert.ok(literal, "the BRAND object literal is still declared the way this arm reads it");
  // Capital C: the superseding casing ruling (, 2026-08-20) is Clearotron in prose and UI,
  // `clearotron` in config values, commands and identifiers. This default is the NAME stamped into
  // titles, chrome and Excel metadata — prose — so it carries the capital. Pinned, because the first
  // ruling said lowercase-always and a sweep run under it would land back here.
  // — the READER changed, the claim did not. THE PAIR IS DELIBERATE and is pinned as a pair: this
  // module reads env at IMPORT time, so it cannot rely on the entry point having run `warnRetiredEnv()`
  // first, and it names both spellings itself. Anyone who "simplifies" this to one name silently re-files
  // — dropping CLEAROTRON_ un-renames the variable, dropping CLEAROTRON_ closes the compat window early.
  // Re-pinned exactly rather than loosened to `.*`: what this line holds is the DEFAULT and its capital C.
  assert.match(literal, /name: process\.env\.CLEAROTRON_BRAND_NAME \|\| "Clearotron"/);
  assert.match(literal, /tagline: process\.env\.CLEAROTRON_BRAND_TAGLINE \|\| ""/);
  assert.doesNotMatch(literal, FIRM,
    "a default behind the brand seam names a firm again — an installer who sets nothing would publish it");
});

test("#1376 arm B — an unset tagline renders as ABSENT, not as an empty element or a stray separator", () => {
  // The distinction is the whole requirement. An empty <span class="lk-tag"></span> still occupies the
  // lockup's flex column and still draws its 5px top margin, so a "blank" strapline is a visible gap
  // under the wordmark rather than no strapline — and it reads as a rendering fault, which is worse than
  // the firm name it replaced.
  const bare = logoLockup({ mark: 16, tag: "" });
  assert.doesNotMatch(bare, /lk-tag/, "an empty tagline must emit no lk-tag element at all");
  assert.doesNotMatch(bare, /<span class="lk-text">[\s\S]*?<\/span>\s*·/, "no separator survives the empty tagline");
  assert.match(bare, /lk-word/, "the wordmark itself still renders");

  const withTag = logoLockup({ mark: 16, tag: "Some Deployment · Somewhere" });
  assert.match(withTag, /<span class="lk-tag">Some Deployment · Somewhere<\/span>/,
    "a configured tagline still renders — arm B must not pass by breaking the element outright");

  // And the default is the SEAM, not a literal: the argument default is what the frozen renderer relies
  // on, so a literal put back here would be invisible to arm C.
  assert.match(read("shared/brand.mjs"), /logoLockup = \(\{ mark = 30, tag = BRAND\.tagline/);
});

test("#1376 arm B2 — the lockup carries no national flag, on THIS renderer as well as the portal's", () => {
  // NOT A NEW RULING. removed the flag from the portal's lockup when the product was renamed, and
  // portal-ui/test/lockup.test.ts pins its absence with the reason: "the flag is gone — this is not a
  // Swiss firm's internal tool". There are TWO lockups — Logo.tsx for the portal shell, logoLockup here
  // for the report footer and topbar, the pool index and the staff pages — and only one of them got it.
  // The delivered report went on flying the flag next to whatever name the deployment configured; the
  // demo published it twice per report and once on the pool index with nothing configured at all.
  //
  // Pinned as an ABSENCE on both sides, so restoring either one fails. The hex is asserted separately
  // from the class because a restore that renamed the element would otherwise slip through.
  const logo = logoLockup({ mark: 36 });
  assert.doesNotMatch(logo, /lk-flag/, "the flag element is back in the report lockup");
  assert.doesNotMatch(logo, /#DA291C/i, "the flag's colours are back in the report lockup, under some other name");
  assert.doesNotMatch(CHROME_CSS, /lk-flag/, "the flag's sizing rule is back — it is dead CSS unless something emits it");
  // The mark itself is NOT the claim and stays: kept it exported for the favicon and this
  // renderer, generated from the shared asset with emit-tokens.mjs --check policing the pair.
  assert.match(logo, /class="lk-mark"/, "the ridge mark still renders — the flag made the claim, not the shape");
});

test("#1376 arm C — neither report renderer passes a hardcoded strapline", () => {
  // driver/publish/render.mjs is hash-frozen, so this arm is not redundant with the freeze: the freeze
  // says "these bytes changed", this says WHICH way they may not change back. render-knockout.mjs is not
  // frozen at all and had the identical literal, which is how the pair drifts.
  for (const f of ["driver/publish/render.mjs", "driver/publish/render-knockout.mjs"]) {
    const src = read(f);
    for (const m of src.matchAll(/logoLockup\(\{[^}]*?tag:\s*(['"])(.*?)\1/g))
      assert.equal(m[2], "", `${f} passes a hardcoded lockup tag ("${m[2]}") — the strapline comes from the seam`);
  }
});

// ── arm D ────────────────────────────────────────────────────────────────────────────────────────────
// Comments are stripped by a real scanner rather than a line regex, because the cheap version is wrong in
// the direction that hides defects: `const u = "https://x/y" // note` has a `//` inside a string, and a
// regex that cuts at the first one would silently delete the rest of a line that may carry a literal.
const stripJs = (src) => {
  let out = "", i = 0, q = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) {
      if (c === "\\") { out += "  "; i += 2; continue; }
      if (c === q) q = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
    if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
};
const stripHtml = (src) => src.replace(/<!--[\s\S]*?-->/g, " ");

// The modules that EMIT client-visible copy. Named rather than globbed: a glob that silently matched
// nothing would pass, and a list that silently lost an entry would too — both are checked below.
const EMITTERS = [
  "driver/portal-service.mjs", "driver/pipeline.mjs", "driver/runner.mjs", "driver/scope-rules.mjs",
  "driver/dev-portal.mjs", "driver/publish/index.mjs", "driver/publish/render.mjs",
  "driver/publish/render-knockout.mjs", "driver/publish/profiles-page.mjs", "driver/publish/xlsx.mjs",
  "driver/profile-page.html", "driver/portal-report.mjs", "shared/brand.mjs", "shared/site-nav.mjs",
  "mcp-server/server.mjs", "mcp-server/lib/options.mjs", "mcp-server/lib/plan.mjs",
  "bin/example.mjs", "bin/start.mjs",
];

const GUARD = "#1376 shipped-brand emitters";

test("#1376 arm D — no module that emits client-visible copy carries the firm name in a literal", (t) => {
  // The corpus comes from shared/tracked-files.mjs, not a raw `git ls-files`: a tree with no checkout
  // must SKIP loudly rather than produce a wall of failures that say nothing about branding.
  const files = trackedFiles(GUARD, { root: REPO });
  if (!files) return t.skip(skipReason(GUARD));
  const tracked = new Set(files);
  assert.ok(tracked.size > 100, "the tracked corpus came back almost empty — the scan below would be vacuous");

  // An absence is a finding: a renamed or deleted emitter must fail here rather than quietly shrink the
  // scan to the files that happen to still exist.
  const missing = EMITTERS.filter((f) => !tracked.has(f));
  assert.deepEqual(missing, [], "EMITTERS names files that are not in the tracked tree — update the list deliberately");

  const offenders = [];
  for (const f of EMITTERS) {
    const raw = read(f);
    const code = f.endsWith(".html") ? stripHtml(raw) : stripJs(raw);
    for (const line of code.split("\n"))
      if (FIRM.test(line)) offenders.push(`${f}: ${line.trim().slice(0, 120)}`);
  }
  assert.deepEqual(offenders, [],
    "a client-visible literal names the firm again. It belongs behind BRAND.name — see #1376:\n"
    + offenders.join("\n"));
});

test("#1376 arm E — the CHROME the pages actually carry names no firm, encoded or plain", () => {
  // Arm D reads source; this reads what the modules EMIT, and the two are not the same question. The
  // defect that proved it: `WATERMARK_URI` URL-encoded the ridge asset whole, aria-label included, so
  // every page's <style> carried `aria-label%3D%22Cordillera%22` — invisible to a source grep for the
  // plain name, present in the delivered bytes of every report and pool index. It was found by running
  // the demo and grepping the published index, not by reading the module.
  //
  // Decoded as well as raw, because encoding is exactly how it hid the first time.
  for (const [name, css] of [["CHROME_CSS", CHROME_CSS], ["WARM_ROOT", WARM_ROOT],
                             ["REPORT_ROOT", REPORT_ROOT], ["FAVICON_LINK", FAVICON_LINK]]) {
    assert.doesNotMatch(css, FIRM, `${name} carries the firm name into every page that includes it`);
    assert.doesNotMatch(decodeURIComponent(css.replace(/%(?![0-9A-Fa-f]{2})/g, "%25")), FIRM,
      `${name} carries the firm name URL-ENCODED — a source grep would not have seen it`);
  }

  // THIS FLOOR REPLACES THE WATERMARK ONE, and the reasoning is unchanged: an arm that passed by
  // emitting nothing would be worse than the string it removed. REMOVED the watermark (the mask
  // this used to assert was the ridge, URL-encoded with its aria-label — the very defect the arm above
  // exists for), so the mask is gone and the non-vacuity has to be bought elsewhere. Each constant must
  // actually carry chrome.
  for (const [name, css, must] of [["CHROME_CSS", CHROME_CSS, /\.lockup\s*\{/],
                                   ["WARM_ROOT", WARM_ROOT, /--/],
                                   ["REPORT_ROOT", REPORT_ROOT, /--/],
                                   ["FAVICON_LINK", FAVICON_LINK, /rel="icon"/]]) {
    assert.ok(css.length > 40, `${name} is empty or near-empty — this arm would pass on a page with no chrome at all`);
    assert.match(css, must, `${name} no longer carries the chrome it is asserted about`);
  }
});

// ── arm F ────────────────────────────────────────────────────────────────────────────────────────────
// The portal bundle is COMMITTED and served as bytes, so what it contains is shipped output, not source.
// Two things must survive in it and a fork that stripped either would be in breach rather than tidy:
// the AGPL §13 source-repository URL, and the trademark attribution on the About page. Everything else
// must be gone — including comments, which minification preserves more often than anyone expects. Two
// of them were in the bundle when this arm was written: a build-time note about the font source, and a
// comment quoting retired copy. Neither was visible to a review of the screens' rendered text.
const DECLARED_IN_BUNDLE = [
  { what: "the AGPL §13 source offer — the public repository the running commit is pinned against",
    re: /github\.com\/CordilleraSarl\/Clearotron/ },
  { what: "the trademark attribution on About — the notice TRADEMARKS.md exists to state",
    re: /trade marks of Cordillera S/ },
];

test("#1376 arm F — the built portal bundle carries only the DECLARED firm references", (ctx) => {
  const dir = join(REPO, "portal-ui", "dist", "assets");
  // BUILD OUTPUT, NOT SOURCE. `portal-ui/dist` is withheld from the public cut, so this arm has nothing
  // to read there. A STATED skip, never a silent pass — and note the arm below already refuses an EMPTY
  // bundle directory as vacuous, which is the same instinct one step further in.
  if (!existsSync(dir)) return ctx.skip("portal-ui/dist is build output and absent here — `npm run build:ui` to run this arm");
  const bundles = readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(bundles.length > 0, "no built bundle under portal-ui/dist/assets — this arm would be vacuous");

  const undeclared = [];
  for (const f of [...bundles.map((b) => join("portal-ui", "dist", "assets", b)),
                   join("portal-ui", "dist", "index.html")]) {
    const src = read(f);
    for (const m of src.matchAll(/Cordillera|IP Law/g)) {
      const around = src.slice(Math.max(0, m.index - 120), m.index + 120);
      if (!DECLARED_IN_BUNDLE.some((d) => d.re.test(around))) undeclared.push(`${f}: …${around.trim()}…`);
    }
  }
  assert.deepEqual(undeclared, [],
    "the shipped bundle names the firm outside the two declared places. If it belongs there, declare it in\n"
    + "DECLARED_IN_BUNDLE with the reason; if it does not, it is branding a fork should never carry:\n"
    + undeclared.join("\n"));

  // And the two that MUST be there still are — an arm that passed by losing the source offer would be a
  // licence defect wearing a green tick.
  const all = bundles.map((b) => read(join("portal-ui", "dist", "assets", b))).join("");
  for (const d of DECLARED_IN_BUNDLE)
    assert.match(all, d.re, `the bundle LOST ${d.what}`);
});
