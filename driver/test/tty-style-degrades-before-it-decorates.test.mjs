// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the styling that setup wears, tested from the failure end rather than the
// pretty end.
//
// THE DECORATION IS NOT THE RISK. An escape code is invisible when it works and invisible when it is
// wrong: a log file full of ESC[1m still contains every word, so nothing throws, no arm reds, and the
// damage is seen only by whoever opens the file later. CI reads this output. So almost every arm below
// is about the OFF path, and the one that is about colour exists to prove the off path is a decision
// rather than a module that never coloured anything.

import { test } from "node:test";
import assert from "node:assert/strict";
import { colorEnabled, styleFor, banner } from "../../shared/tty-style.mjs";

const TTY = { isTTY: true };
const PIPE = { isTTY: false };
const ESC = /\x1b\[/;

test("2065 a pipe gets no escape codes, and that is the DEFAULT rather than a special case", () => {
  // Positive evidence only. The hazard is a module that colours unless it can prove nobody is watching,
  // because "I could not tell" then renders as decoration into a file — the absence-read-as-a-pass this
  // repository refuses everywhere else, wearing escape codes.
  assert.equal(colorEnabled({ stream: PIPE, env: {} }), false);
  assert.equal(colorEnabled({ stream: undefined, env: {} }), false, "no stream at all is not a terminal");
  assert.equal(colorEnabled({ stream: {}, env: {} }), false, "a stream that does not say isTTY is not one");
});

test("2065 NO_COLOR is honoured AS SET, including the empty string", () => {
  // Its specification says SET, to any value. Testing truthiness would leave `NO_COLOR=` colouring —
  // and that is the exact spelling a reader who wants it off is most likely to reach for, so the
  // truthiness bug would be invisible to everyone except the person it was aimed at.
  for (const v of ["", "1", "0", "false", "no"]) {
    assert.equal(colorEnabled({ stream: TTY, env: { NO_COLOR: v } }), false, `NO_COLOR=${JSON.stringify(v)}`);
  }
  assert.equal(colorEnabled({ stream: TTY, env: {} }), true, "and unset leaves a real terminal coloured");
});

test("2065 TERM=dumb is not a terminal for this purpose", () => {
  assert.equal(colorEnabled({ stream: TTY, env: { TERM: "dumb" } }), false);
  assert.equal(colorEnabled({ stream: TTY, env: { TERM: "xterm-256color" } }), true);
});

test("2065 FORCE_COLOR speaks in both directions, and outranks the stream", () => {
  // A caller who sets it is telling us something we cannot otherwise see — a pager, a CI that renders
  // escapes, a recorded demo. Honouring it in one direction only would make the override a trap.
  assert.equal(colorEnabled({ stream: PIPE, env: { FORCE_COLOR: "1" } }), true, "on, off a pipe");
  assert.equal(colorEnabled({ stream: TTY, env: { FORCE_COLOR: "0" } }), false, "off, on a terminal");
  // AND NO_COLOR OUTRANKS IT. The convention's whole value is that a reader sets it once and every tool
  // obeys, so a tool whose own variable wins defeats the standard it claims to implement — in the
  // direction that adds decoration over a stated preference. This assertion is here because the module
  // had the precedence the other way round first, and only running the real command with both set
  // showed it.
  assert.equal(colorEnabled({ stream: TTY, env: { FORCE_COLOR: "1", NO_COLOR: "1" } }), false,
    "NO_COLOR must win over FORCE_COLOR=1");
  assert.equal(colorEnabled({ stream: TTY, env: { FORCE_COLOR: "1", NO_COLOR: "" } }), false,
    "including the empty spelling, which is the one a reader is likeliest to type");
});

test("2065 with colour off every style is IDENTITY, so a caller needs no second code path", () => {
  // The alternative is `if (color) bold(x) else x` at every call site, and the branch nobody exercises
  // is the one that ships escapes into a log. Identity functions make the off path the same path.
  const s = styleFor({ stream: PIPE, env: {} });
  assert.equal(s.enabled, false);
  // Every key the module actually exposes, not a list written down beside it. A literal list is how a
  // key added later — the mark's accent was one — inherits the claim without ever being checked
  // against it, and the off path is the path nobody looks at until a log is full of escapes.
  const keys = Object.keys(s).filter((k) => k !== "enabled");
  assert.ok(keys.length >= 6, `styleFor exposed ${keys.length} styles; the table has shrunk`);
  for (const k of keys) {
    assert.equal(s[k]("the passphrase"), "the passphrase", `${k} must not decorate off a terminal`);
    assert.doesNotMatch(s[k]("x"), ESC, `${k} emitted an escape code with colour off`);
  }
});

test("2065 with colour ON the styles really do differ — or the arms above prove nothing", () => {
  // A module that never coloured anything would pass every arm above. This is the control.
  const s = styleFor({ stream: TTY, env: {} });
  assert.equal(s.enabled, true);
  const seen = new Map();
  const keys = Object.keys(s).filter((k) => k !== "enabled");
  for (const k of keys) {
    const out = s[k]("x");
    assert.match(out, ESC, `${k} did not colour on a terminal`);
    assert.match(out, /x/, `${k} lost the text it was wrapping`);
    assert.ok(!seen.has(out), `${k} and ${seen.get(out)} are the same code — the weight carries no meaning`);
    seen.set(out, k);
  }
  assert.equal(seen.size, keys.length, "every kind must be its own code");
});

test("2065 the banner is a rectangle whatever the styling does to it", () => {
  // The frame is composed from the visible text, so a styled title must not push the border out —
  // padding computed from a string that already contains escape codes is the classic way this breaks,
  // and it only shows on the coloured path, which is the one a piped test never sees.
  for (const stream of [TTY, PIPE]) {
    const lines = banner({ title: "Clearotron setup", subtitle: "about five minutes",
                           style: styleFor({ stream, env: {} }) }).split("\n");
    const widths = lines.map((l) => [...l.replace(/\x1b\[[0-9;]*m/g, "")].length);
    assert.equal(new Set(widths).size, 1,
      `the banner is not a rectangle with isTTY=${stream.isTTY}: widths ${widths.join(", ")}`);
  }
});
