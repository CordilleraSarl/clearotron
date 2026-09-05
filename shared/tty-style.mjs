// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// tty-style.mjs — weight where the meaning is, and NOTHING when the reader is not a terminal.
//
// ── why this exists (, owner ruling 2026-08-31) ────────────────────────────────────
//
// "new terminals can do things like bold and colours etc — good formatting impresses people because it's
// made clear to them someone put the time in." That is a product argument, not a decorative one: setup
// is the first thing anyone sees, and how it looks is the only evidence a reader has about the care that
// went into everything they cannot see yet. A lawyer evaluating this cannot read the engine.
//
// Two defects already on that issue are formatting defects wearing other clothes — the passphrase is
// buried because every line around it has the same weight, and the coverage reason is invisible because
// it is drawn in the faintest thing available. Neither is fixed by rewriting a sentence.
//
// ── THE FAILURE THIS MODULE IS BUILT AROUND IS THE ONE THAT IS SILENT ────────────────────────────────
//
// Escape codes are invisible when they work and invisible when they are wrong: a log file full of
// `ESC[1m` still contains every word, so nothing fails, no test reds, and the damage is only ever seen
// by whoever opens the file later. CI reads this output. So the DEFAULT is off and colour is switched
// on only by positive evidence that a terminal is reading — never by the absence of evidence that one
// is not, which is the same absence-as-a-pass this repository refuses everywhere else.
//
// NO DEPENDENCY, by the same ruling. This is a handful of escape codes, and a package for it is a
// supply-chain row for something the platform already does.

/** SGR pairs. Nothing here is chosen for prettiness — each one marks a different KIND of line. */
const SGR = Object.freeze({
  bold:  ["\x1b[1m", "\x1b[22m"],   // the question being asked, and the one address to open
  dim:   ["\x1b[2m", "\x1b[22m"],   // the default that will be taken if the reader just presses enter
  ok:    ["\x1b[32m", "\x1b[39m"],  // a step that completed
  warn:  ["\x1b[33m", "\x1b[39m"],  // it worked, and there is something to know
  err:   ["\x1b[31m", "\x1b[39m"],  // a refusal
  head:  ["\x1b[1m\x1b[36m", "\x1b[39m\x1b[22m"], // a section header: where the reader is
  // The mark's enclosed block — the one thing here that is not a line of meaning. It is the
  // TERMINAL'S red, not the brand hex: crimson on parchment is what the SVG draws against, and a
  // hard-coded dark red lands invisible on the dark background most terminals actually have. Bold
  // separates it from `err`, which is a refusal and must not share a code with decoration.
  accent: ["\x1b[1m\x1b[31m", "\x1b[39m\x1b[22m"],
});

/**
 * IS ANYONE WATCHING THIS IN A TERMINAL? Positive evidence only, in the order the answers disagree.
 *
 * `NO_COLOR` is honoured as its specification defines it — SET, to any value including the empty
 * string, means no colour. Testing truthiness instead would leave `NO_COLOR=` colouring, which is the
 * one spelling a reader who wants it off is most likely to reach for.
 *
 * AND IT IS READ FIRST, ahead of `FORCE_COLOR`. The whole value of the convention is that a reader sets
 * it once for their environment and every tool obeys; a tool whose own variable outranks it defeats the
 * standard it claims to implement, and does so in the direction that ADDS decoration nobody asked for.
 * A caller who wants colour for one command unsets NO_COLOR for that command, which is explicit and
 * local. This ordering was the other way round first, and driving `--check` with both set is what
 * showed it: colour rendered over a reader's stated preference.
 *
 * `FORCE_COLOR` then speaks in both directions — `0` off, anything else on even down a pipe — because
 * a caller who sets it is telling us something the stream cannot: a pager, a CI that renders escapes,
 * a recorded demo.
 */
export function colorEnabled({ stream = process.stdout, env = process.env } = {}) {
  if (env.NO_COLOR !== undefined) return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== "0";
  if (env.TERM === "dumb") return false;
  return stream?.isTTY === true;
}

/**
 * The styling functions, already resolved for this stream. IDENTITY when colour is off — so a caller
 * writes `s.bold(x)` unconditionally and there is no second code path to get wrong, which is how a
 * `if (color)` branch ends up printing escapes into a log on the one path nobody exercised.
 */
export function styleFor(opts = {}) {
  const on = colorEnabled(opts);
  const wrap = (k) => (on ? (t) => `${SGR[k][0]}${t}${SGR[k][1]}` : (t) => String(t));
  const s = { enabled: on };
  for (const k of Object.keys(SGR)) s[k] = wrap(k);
  return Object.freeze(s);
}

/** The glyphs the mark is drawn with. Block elements, like the frame — one family, one fallback story. */
export const MARK_GLYPHS = Object.freeze({ bracket: "█", block: "▓" });

/**
 * One row of the box: content, then padding computed from the content's VISIBLE width.
 *
 * The width is passed in rather than measured, because by the time a row reaches here it may already
 * contain escape codes and `.length` would count them — which pushes the right border out on the
 * coloured path ONLY, the path a piped test never sees. Every caller below knows its plain width.
 */
const row = (text, width, inner) => `│ ${text}${" ".repeat(inner - width + 1)}│`;

/**
 * A row of the mark, with RUNS of one kind wrapped once rather than each character wrapped alone.
 *
 * Same pixels either way; ten times the bytes the other way. This module's whole argument is about
 * what escape codes do to a file somebody opens later, and a sixteen-column mark that costs ninety-six
 * escape pairs makes a log or a pasted screenshot unreadable for no gain at all.
 */
function paintRow(cells, style) {
  const paint = { bracket: (t) => style.bold(t), block: (t) => style.accent(t), "": (t) => t };
  const glyph = { bracket: MARK_GLYPHS.bracket, block: MARK_GLYPHS.block, "": " " };
  let out = "";
  for (let i = 0; i < cells.length;) {
    const kind = cells[i];
    let j = i;
    while (j < cells.length && cells[j] === kind) j++;
    out += paint[kind](glyph[kind].repeat(j - i));
    i = j;
  }
  return out;
}

/**
 * The entry banner. ONCE, on entry, named — not on every command (the ruling says so, and a banner on
 * every verb is how a product becomes tiresome to use twice).
 *
 * The frame is box-drawing rather than ASCII art: it costs one line of code and does not depend on a
 * font. `mark` puts the product's mark beside the words — pass the grid from `bracketAsciiCells()`,
 * which is the SVG's own geometry sampled onto characters. It arrives here as KINDS, not glyphs and
 * not escapes, so the shape stays in `brand.mjs` with the constant it is generated from and the
 * decision about what a terminal can draw stays here.
 *
 * The words sit vertically centred against the mark, and the box is sized from mark + gutter + text.
 * Sizing it from the title alone is how a mark wider than the title overflows the frame it is in.
 */
export function banner({ title, subtitle = "", style = styleFor(), mark = null, gutter = 3, columns = Infinity } = {}) {
  const text = [
    { text: style.bold(title), width: title.length },
    ...(subtitle ? [{ text: style.dim(subtitle), width: subtitle.length }] : []),
  ];
  const words = Math.max(...text.map((t) => t.width));
  // The mark is the first thing to go when it does not fit. A box that wraps is worse than a box with
  // no logo in it — the owner asked to SEE the mark, and a 65-column frame folded into a 60-column pane
  // shows him neither the mark nor the sentence. `columns` defaults to Infinity so a caller that has no
  // terminal to ask (a test, a rendered doc) is never silently degraded on the strength of a missing
  // number; the ONE caller that reads a real width passes it.
  let cells = mark ?? [];
  let markWidth = cells.length ? Math.max(...cells.map((r) => r.length)) : 0;
  if (markWidth && markWidth + gutter + words + 4 > columns) { cells = []; markWidth = 0; }
  const pad = markWidth ? markWidth + gutter : 0;
  const inner = pad + words;
  const line = "─".repeat(inner + 2);

  const height = Math.max(cells.length, text.length);
  const top = Math.floor((height - text.length) / 2);
  const out = [`┌${line}┐`];
  for (let i = 0; i < height; i++) {
    const drawn = cells[i] ?? [];
    const left = markWidth ? paintRow(drawn, style) + " ".repeat(pad - drawn.length) : "";
    const t = text[i - top];
    out.push(row(left + (t ? t.text : ""), pad + (t ? t.width : 0), inner));
  }
  out.push(`└${line}┘`);
  return out.join("\n");
}
