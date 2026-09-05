// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// F18 — the terminal mark is the SVG's geometry, and these arms are built to
// red if it ever stops being.
//
// THE DEFECT THIS IS AGAINST IS A DRAWING THAT AGREES WITH NOTHING. The finding's one constraint is
// that the ASCII be GENERATED from `BRACKET_RECTS`/`BRACKET_BLOCK`, never hand-drawn beside them,
// because a second transcription drifts and nothing in a build compares a picture to a picture.
//
// So a golden string of the real mark is necessary and NOT sufficient: a function that ignored every
// argument and returned that literal would pass it, and would be exactly the hand-drawn copy the
// finding forbids. The load-bearing arms below drive geometry that is NOT the real mark and watch the
// output follow it, and prove every part of the real mark is actually on the screen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bracketAsciiCells, BRACKET_RECTS, BRACKET_BLOCK, BRACKET_VIEWBOX } from "../../shared/brand.mjs";
import { banner, styleFor, MARK_GLYPHS } from "../../shared/tty-style.mjs";

const TTY = { isTTY: true };
const PIPE = { isTTY: false };
const ESC = /\x1b\[[0-9;]*m/g;

const draw = (cells) =>
  cells.map((r) => r.map((k) => (k === "bracket" ? "#" : k === "block" ? "o" : " ")).join("")).join("\n");
const columnsOf = (cells, kind) => {
  const cols = new Set();
  cells.forEach((r) => r.forEach((k, i) => { if (k === kind) cols.add(i); }));
  return [...cols].sort((a, b) => a - b);
};

test("2175 the output follows a geometry that is NOT the mark — the control against a literal", () => {
  // If this function returned a hard-coded picture, every arm that only looks at the real constants
  // would still pass. Nothing here is the real mark: one square, moved.
  const box = { x: 0, y: 0, width: 24, height: 24 };
  const left = bracketAsciiCells({ cols: 8, rows: 4, trim: false, block: null, viewBox: "0 0 24 24",
                                   rects: [{ ...box, x: 0, width: 6 }] });
  const right = bracketAsciiCells({ cols: 8, rows: 4, trim: false, block: null, viewBox: "0 0 24 24",
                                    rects: [{ ...box, x: 18, width: 6 }] });
  assert.deepEqual(columnsOf(left, "bracket"), [0, 1], `a rect on the left drew at ${draw(left)}`);
  assert.deepEqual(columnsOf(right, "bracket"), [6, 7], `a rect on the right drew at ${draw(right)}`);
  // And a taller rect fills more rows, so the vertical axis is read too and not just assumed.
  const short = bracketAsciiCells({ cols: 4, rows: 4, trim: false, block: null, rects: [{ x: 0, y: 0, width: 24, height: 6 }] });
  const tall  = bracketAsciiCells({ cols: 4, rows: 4, trim: false, block: null, rects: [{ x: 0, y: 0, width: 24, height: 18 }] });
  assert.equal(short.filter((r) => r.some(Boolean)).length, 1);
  assert.equal(tall.filter((r) => r.some(Boolean)).length, 3);
});

test("2175 move the block and the block moves — the accent part is read, not assumed", () => {
  // `block` is the ONE part that takes the accent. A renderer that drew the brackets from data and the
  // block from a remembered position would pass every bracket arm here.
  const at = (x) => columnsOf(bracketAsciiCells({ cols: 12, rows: 6, trim: false, rects: [], block: { x, y: 0, width: 4, height: 24 } }), "block");
  assert.deepEqual(at(0), [0, 1]);
  assert.deepEqual(at(10), [5, 6]);
  assert.deepEqual(at(20), [10, 11]);
});

test("2175 EVERY part of the real mark reaches the screen at the size that ships", () => {
  // The arms are 2 units of 24 and the stems are 2 of 24. A grid coarse enough to be a sensible banner
  // is exactly coarse enough to lose them, and the loss reads as a design choice: `| |` instead of
  // `[ ]`. So each of the seven parts must be load-bearing — remove it and the picture must change.
  const full = draw(bracketAsciiCells());
  const parts = [...BRACKET_RECTS.map((r, i) => ["rect " + i, { rects: BRACKET_RECTS.filter((_, j) => j !== i) }]),
                 ["the enclosed block", { block: null }]];
  assert.equal(parts.length, 7, "seven parts: six bracket rects and the block");
  for (const [name, without] of parts) {
    assert.notEqual(draw(bracketAsciiCells(without)), full,
      `${name} contributes no cell — it is in the geometry and not on the screen:\n${full}`);
  }
});

test("2175 a change to the geometry changes the mark, which is the whole point of generating it", () => {
  // The anti-drift claim, stated as a test: the picture cannot stay still while the constant moves.
  const widened = BRACKET_RECTS.map((r) => (r.width === 2 ? { ...r, width: 4 } : r));
  assert.notEqual(draw(bracketAsciiCells({ rects: widened })), draw(bracketAsciiCells()));
  const shifted = { ...BRACKET_BLOCK, x: BRACKET_BLOCK.x - 4 };
  assert.notEqual(draw(bracketAsciiCells({ block: shifted })), draw(bracketAsciiCells()));
});

test("2175 what comes out is KINDS — no glyph and no escape code leaves the geometry module", () => {
  // `brand.mjs` has no business holding an opinion about what a tty can draw or may colour. If a glyph
  // ever leaks into here, the terminal's fallback story is decided in the wrong file.
  for (const row of bracketAsciiCells({ cols: 30, rows: 15 })) {
    for (const cell of row) assert.ok(["", "bracket", "block"].includes(cell), `unexpected cell ${JSON.stringify(cell)}`);
  }
});

test("2175 the real mark reads as a bracket pair enclosing a block", () => {
  // The golden. It documents what ships and is deliberately the LAST claim here, not the first: on its
  // own it is satisfied by the hand-drawn copy the finding forbids.
  assert.equal(draw(bracketAsciiCells()), [
    "#####      #####",
    "##            ##",
    "##    oooo    ##",
    "##    oooo    ##",
    "##    oooo    ##",
    "##            ##",
    "#####      #####",
  ].join("\n"));
  assert.equal(BRACKET_VIEWBOX, "0 0 24 24", "the golden above is sampled over this box");
});

test("2175 trimming removes empty MARGIN — a gap inside the shape survives it", () => {
  // The discriminating case, because the real mark has no interior gap and so cannot show this.
  // Filtering out every empty row instead of walking in from the edges closes a hole in the MIDDLE of
  // a shape: the picture stops following the constant, in the one function whose whole job is that it
  // does. Two bars with two empty rows between them must come back four rows tall.
  const gapped = bracketAsciiCells({ cols: 4, rows: 4, block: null,
    rects: [{ x: 0, y: 0, width: 24, height: 6 }, { x: 0, y: 18, width: 24, height: 6 }] });
  assert.equal(gapped.length, 4, `an interior gap was squashed:\n${draw(gapped)}`);
  assert.deepEqual(gapped.map((r) => r.some(Boolean)), [true, false, false, true]);
  // And the same on the other axis, which is the half that was already right.
  const columns = bracketAsciiCells({ cols: 4, rows: 1, block: null,
    rects: [{ x: 0, y: 0, width: 6, height: 24 }, { x: 18, y: 0, width: 6, height: 24 }] });
  assert.deepEqual(columns[0].map(Boolean), [true, false, false, true], "an interior gap was squashed sideways");

  // Margin, meanwhile, does go — and what is left still has content on all four edges.
  const untrimmed = bracketAsciiCells({ trim: false });
  const trimmed = bracketAsciiCells();
  assert.ok(untrimmed.length > trimmed.length, "the mark's own geometry has empty rows top and bottom");
  assert.ok(trimmed.every((r) => r.length === trimmed[0].length), "trim must leave a rectangle");
  assert.ok(trimmed[0].some(Boolean) && trimmed.at(-1).some(Boolean), "an edge row is still empty after trimming");
  assert.ok(trimmed.some((r) => r[0]) && trimmed.some((r) => r.at(-1)), "an edge column is still empty after trimming");
  assert.deepEqual(untrimmed.filter((r) => r.some(Boolean)).length, trimmed.length,
    "the real mark has no interior gap, so trimming it must lose only the blank rows");
});

test("2175 a grid that cannot be drawn is refused by name, not silently rounded", () => {
  for (const [opts, wanted] of [
    [{ cols: 0 }, /cols must be a positive integer/],
    [{ rows: -3 }, /rows must be a positive integer/],
    [{ cols: 12.5 }, /cols must be a positive integer/],
    [{ coverage: 0 }, /coverage must be greater than 0/],
    [{ coverage: 2 }, /coverage must be greater than 0/],
    [{ viewBox: "0 0 24" }, /viewBox must be four numbers/],
    [{ viewBox: "0 0 0 24" }, /positive width and height/],
  ]) assert.throws(() => bracketAsciiCells(opts), wanted, `${JSON.stringify(opts)} was accepted`);
});

test("2175 the mark reads with colour OFF, because that is the path CI and every log takes", () => {
  // The block takes the accent in the SVG. In a pipe there is no accent, so the block has to be told
  // apart by its GLYPH — otherwise the enclosed square disappears into the brackets exactly where a
  // log or a CI transcript is the only record anyone has.
  assert.notEqual(MARK_GLYPHS.bracket, MARK_GLYPHS.block);
  const out = banner({ title: "Clearotron setup", subtitle: "one pass, and everything here is skippable",
                       style: styleFor({ stream: PIPE, env: {} }), mark: bracketAsciiCells() });
  assert.doesNotMatch(out, /\x1b\[/, "escape codes reached a stream that is not a terminal");
  assert.ok(out.includes(MARK_GLYPHS.bracket) && out.includes(MARK_GLYPHS.block), "the mark did not print");
});

test("2175 the box is a rectangle around the MARK too, coloured or not", () => {
  // The frame used to be sized from the title alone. A mark wider than the title then hangs out of the
  // box it is in — and with colour on, padding measured off a string full of escape codes breaks the
  // other way, on the one path a piped test never sees.
  for (const stream of [TTY, PIPE]) {
    for (const title of ["Clearotron setup", "x"]) {
      const lines = banner({ title, subtitle: "one pass, and everything here is skippable",
                             style: styleFor({ stream, env: {} }), mark: bracketAsciiCells() }).split("\n");
      const widths = lines.map((l) => [...l.replace(ESC, "")].length);
      assert.equal(new Set(widths).size, 1,
        `not a rectangle with isTTY=${stream.isTTY}, title "${title}": widths ${widths.join(", ")}`);
      assert.equal(lines.length, 9, "seven mark rows plus the two frame rows");
    }
  }
});

test("2175 the mark is the first thing dropped when the box would not fit the pane", () => {
  // A box that wraps is worse than a box with no logo in it: at 60 columns a 65-column frame folds and
  // he sees neither the mark nor the sentence. The fallback must be TODAY'S banner exactly — this
  // finding adds a surface on a wide terminal, it does not change what a narrow one gets.
  const style = styleFor({ stream: PIPE, env: {} });
  const words = { title: "Clearotron setup", subtitle: "one pass, and everything here is skippable", style };
  const framed = (columns) => banner({ ...words, mark: bracketAsciiCells(), columns }).split("\n");
  const width = framed(Infinity)[0].length;
  assert.equal(width, 65, "the composed width moved; the two boundary cases below are stated in columns");

  assert.ok(framed(width).some((l) => l.includes(MARK_GLYPHS.bracket)), "the mark went at exactly its own width");
  assert.ok(!framed(width - 1).some((l) => l.includes(MARK_GLYPHS.bracket)), "the mark stayed one column too wide");
  assert.equal(framed(width - 1).join("\n"), banner(words), "the fallback is not the plain banner");

  // And a caller with no terminal to ask is never degraded on the strength of a missing number.
  assert.equal(framed(undefined).join("\n"), framed(Infinity).join("\n"), "an absent width dropped the mark");
});

test("2175 the mark's block is coloured differently from a refusal", () => {
  // `err` means a refusal. The mark's accent is decoration, and the two sharing a code is how a logo
  // ends up reading as an error the first time anyone looks at a screenshot.
  const s = styleFor({ stream: TTY, env: {} });
  assert.match(s.accent("x"), /\x1b\[/, "the accent did not colour on a terminal");
  assert.notEqual(s.accent("x"), s.err("x"));
  assert.equal(styleFor({ stream: PIPE, env: {} }).accent("x"), "x", "accent must be identity off a terminal");
});

test("2175 a banner with NO mark is unchanged — this finding adds a surface, it does not move one", () => {
  const style = styleFor({ stream: PIPE, env: {} });
  assert.equal(banner({ title: "Clearotron setup", subtitle: "about five minutes", style }),
    ["┌────────────────────┐",
     "│ Clearotron setup   │",
     "│ about five minutes │",
     "└────────────────────┘"].join("\n"));
  assert.equal(banner({ title: "Only a title", style }),
    ["┌──────────────┐", "│ Only a title │", "└──────────────┘"].join("\n"));
});
