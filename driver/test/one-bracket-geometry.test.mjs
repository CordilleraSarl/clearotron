// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// one-bracket-geometry.test.mjs —: the bracket is one shape, and two files draw it.
//
// THIS GUARD EXISTS BECAUSE THE ONE THAT WAS CITED DOES NOT. `portal-ui/src/components/Logo.tsx` said
// of its rectangles: "The geometry is transcribed from the site asset and is asserted against it — see
// Logo.test.tsx." No such file has existed at any commit — `git log --all --diff-filter=AD --
// '*Logo.test*'` returns nothing — and `lockup.test.ts` pins the lockup's TYPE (family, weight,
// tracking), not the shape. So the bracket was guarded by a sentence.
//
// gave it a second reader: `shared/brand.mjs` needs the same bracket for the favicon and for the
// report/knockout/nav lockup, so the shape is data there (`BRACKET_RECTS` + `BRACKET_BLOCK`). Adding a
// second unguarded copy of an unguarded shape would have doubled the defect rather than fixing it.
//
// WHY THE COPY IS ALLOWED AT ALL. portal-ui cannot import a driver `.mjs` into its type-stripped test
// runner, and it may not use React's raw-HTML escape hatch (`no-danger.test.ts` keeps that closed), so
// the JSX has to spell its own rects. Two spellings of one shape is acceptable ONLY with something
// holding them together. This is that something.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BRACKET_RECTS, BRACKET_BLOCK, BRACKET_VIEWBOX, FAVICON_LINK, bracketMark } from "../../shared/brand.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(REPO, p), "utf8");

/** Every `<rect …/>` in a JSX/SVG source, as {x, y, width, height, fill}. Order is preserved. */
function rectsOf(src) {
  return [...src.matchAll(/<rect\s+([^/>]+)\/>/g)].map((m) => {
    const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)=(?:"([^"]*)"|\{([^}]*)\})/g)]
      .map((a) => [a[1], a[2] ?? a[3]]));
    return { x: Number(attrs.x), y: Number(attrs.y), width: Number(attrs.width), height: Number(attrs.height), fill: attrs.fill };
  });
}

test("#1431 the bracket's SIX rects are the same six in Logo.tsx and in brand.mjs", () => {
  // ── THE END OF THE SLICE IS STRUCTURAL, NOT A NEIGHBOUR'S NAME ──────────────────────────
  //
  // It used to end at `indexOf("export function RidgeMark")`, which coupled this test to the NAME of the
  // next symbol in the file. Deleting `RidgeMark` — which did — makes that `indexOf` return -1, so
  // `slice(start, -1)` becomes "the rest of the file minus one character" and this measures a region it
  // does not mean to. It would not fail at the deletion; it would fail on a rect COUNT, pointing at
  // geometry, with the cause three files away. No reference search for the component would have found
  // the coupling, because the coupling is to its name in source text.
  //
  // The next top-level `export` after BracketMark is the boundary whatever that export happens to be.
  const logoSrc = read("portal-ui/src/components/Logo.tsx");
  const from = logoSrc.indexOf("export function BracketMark");
  assert.notEqual(from, -1, "BracketMark is gone from Logo.tsx — this test measures nothing");
  const to = logoSrc.indexOf("\nexport ", from + 1);
  assert.notEqual(to, -1, "BracketMark is the last export in Logo.tsx, so the slice runs to EOF and this "
    + "arm would measure every rect in the file rather than the bracket's");
  const jsx = rectsOf(logoSrc.slice(from, to));
  assert.equal(jsx.length, 7, `BracketMark should draw six bracket rects plus the enclosed block, saw ${jsx.length}`);

  const brackets = jsx.filter((r) => r.fill === "currentColor").map(({ x, y, width, height }) => ({ x, y, width, height }));
  assert.deepEqual(brackets, [...BRACKET_RECTS].map(({ x, y, width, height }) => ({ x, y, width, height })),
    "the bracket geometry differs between portal-ui's JSX and shared/brand.mjs. One shape, two spellings "
    + "— change both, or the favicon and the report lockup stop being the same mark as the portal header.");

  const block = jsx.find((r) => r.fill !== "currentColor");
  assert.deepEqual({ x: block.x, y: block.y, width: block.width, height: block.height },
    { x: BRACKET_BLOCK.x, y: BRACKET_BLOCK.y, width: BRACKET_BLOCK.width, height: BRACKET_BLOCK.height },
    "the enclosed block — the one part that takes the accent — differs between the two");
  // — the intent in that message is right and unchanged; the NAME was wrong. In the portal's
  // vocabulary the accent token is `--accent` (shared/portal-tokens.mjs builds it from brand
  // `--crimson`), and the portal bundles only tokens.css and base.css, neither of which defines
  // `--crimson`. So this asserted the presence of a string that resolved to nothing, and the block
  // rendered with no fill while the arm stayed green. Asserting the string is not asserting that it
  // resolves — portal-ui/test/customPropertiesResolve.test.ts is the arm that checks the second thing.
  assert.match(block.fill, /--accent/, "the block takes the accent token, not a literal colour");
  assert.ok(!/#[0-9a-f]{6}/i.test(block.fill), "still a token, not the hex literal it stands for");
});

test("#1431 the two viewBoxes agree — the same rects in a different box is a different mark", () => {
  const src = read("portal-ui/src/components/Logo.tsx");
  const at = src.indexOf("export function BracketMark");
  assert.match(src.slice(at, at + 400), new RegExp(`viewBox="${BRACKET_VIEWBOX}"`),
    "BracketMark's viewBox no longer matches BRACKET_VIEWBOX — the rects would render at a different scale");
});

test("#1431 the portal's favicon IS brand.mjs's favicon, byte for byte", () => {
  // index.html cannot import brand.mjs (it is served as a static file before any bundle runs), so the
  // data-URI is pasted. Pasted and unchecked is how the tab kept the old mark after every other surface
  // moved — which is the shape was filed about.
  const href = FAVICON_LINK.match(/href="([^"]+)"/)[1];
  const html = read("portal-ui/index.html");
  assert.ok(html.includes(href),
    "portal-ui/index.html's favicon is not the one shared/brand.mjs emits. Regenerate it from "
    + "FAVICON_LINK — a hand-edited data-URI is how the browser tab keeps a retired mark.");
});

test("#1431 NO SURFACE this product renders still draws the ridge", () => {
  // The acceptance criterion, mechanised. The ridge ASSETS stay on disk — they are the parent company's
  // mark — so this asserts the RENDERERS, which is what the criterion says. Since nothing in this
  // product reads those assets at all: the generated brand-art.ts chain that used to went with the
  // component it fed.
  const ridgeViewBox = "0 0 1446 1446";
  for (const f of ["shared/brand.mjs", "driver/publish/render.mjs", "driver/publish/render-knockout.mjs",
    "driver/publish/index.mjs", "portal-ui/index.html"]) {
    assert.ok(!read(f).includes(ridgeViewBox),
      `${f} still carries the ridge viewBox — a surface this product renders is drawing the retired mark`);
  }
  // The watermark is REMOVED, not restyled: no rule, no token DEFINITION, no token USE, no class on any
  // body. Asserted on the MECHANISM (`--wm-alpha:` defines, `var(--wm-alpha)` reads) rather than on the
  // bare word — the comment recording why the rule went quotes the token's name, and a guard that
  // forbids a string in a file it reads fires on the explanation of what it forbids. (It did.)
  const brand = read("shared/brand.mjs");
  assert.ok(!/--wm-alpha\s*:/.test(brand), "the watermark opacity token is DEFINED again");
  assert.ok(!/var\(--wm-alpha\)/.test(brand), "something READS the watermark opacity token again");
  assert.ok(!/\.watermark\s*(::?after)?\s*\{/.test(brand), "the .watermark rule is back");
  for (const f of ["driver/publish/render.mjs", "driver/publish/render-knockout.mjs", "driver/publish/index.mjs"]) {
    assert.ok(!/class="[^"]*\bwatermark\b/.test(read(f)), `${f} still puts the watermark class on its body`);
  }
});

test("#1431 the mark FIRES — bracketMark draws seven rects and takes its colours from its caller", () => {
  // A guard that only asserts absence passes on a renderer that draws nothing at all.
  const svg = bracketMark(20, "currentColor");
  assert.equal((svg.match(/<rect/g) ?? []).length, 7, "six bracket rects plus the enclosed block");
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /fill="currentColor"/, "the brackets take the caller's colour");
  const tinted = bracketMark(20, "#ffffff", "#000000");
  assert.match(tinted, /fill="#ffffff"/);
  assert.match(tinted, /fill="#000000"/, "the accent is a parameter, so the favicon can use concrete colours");
});
