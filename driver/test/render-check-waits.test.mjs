// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A WAIT THAT TIMES OUT MUST NAME ITSELF.
//
// The browser drivers died with "Cannot read properties of undefined (reading 'click')" — a message
// naming no selector, no screen and no step. Two separate defects composed it: `settle` returns false
// on timeout and never throws, and `findByText` is `Array.prototype.find`, so it returns undefined.
// A wait that quietly failed walked straight into a `.click()` on nothing.
//
// The scan below is the part that fails closed. A behavioural arm proves the helpers throw today; only
// a scan proves no NEW call site reintroduces the shape, and this defect was reintroduced by a call
// site, not by the helper.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILES = ["scripts/composer-render-check.mjs", "scripts/portal-lifecycle-check.mjs"];
const src = (f) => readFileSync(join(ROOT, f), "utf8");

// Comments are stripped first: this file's own prose names every shape it forbids, and a scan that
// reads comments is satisfied — or tripped — by writing about the bug rather than by the bug.
const code = (f) => src(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

test("#1809 no call site asserts absence through the THROWING findByText", () => {
  // Converting one of these by mistake is the failure this change is most at risk against: a throwing
  // findByText on a negated site crashes on the CORRECT path, so the arm would pass only when the bug
  // is present. `!findByText(...).prop` is deliberately NOT forbidden — there the `!` negates the
  // property and the element must exist.
  const forbidden = [
    [/!\s*findByText\([^;\n]*?\)\s*(?:;|\)|&&|\|\|)/, "bare negation — use maybeByText"],
    [/Boolean\(\s*findByText\(/, "Boolean() presence check — use maybeByText"],
    [/findByText\([^;\n]*?\)\s*\?\./, "optional chaining — use maybeByText"],
    [/const\s+\w+\s*=\s*findByText\(/, "assigned then tested — use maybeByText"],
  ];
  for (const f of FILES) {
    for (const [rx, why] of forbidden) {
      const hit = code(f).split("\n").find((l) => rx.test(l));
      assert.equal(hit, undefined, `${f}: ${why} — ${String(hit).trim()}`);
    }
  }
});

test("#1809 no wait discards its result — every settle is read or is a mustSettle", () => {
  for (const f of FILES) {
    const bare = code(f).split("\n")
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /^\s*await\s+settle\(/.test(l));
    assert.deepEqual(bare, [], `${f}: ${bare.length} wait(s) discard their return`);
  }
});

test("#1809 both drivers define the pair, and each names the wait it failed", () => {
  for (const f of FILES) {
    const s = code(f);
    assert.match(s, /const maybeByText = \(sel, re\)/, `${f}: maybeByText is missing`);
    assert.match(s, /const findByText = \(sel, re\) => \{/, `${f}: findByText is not the throwing form`);
    assert.match(s, /const mustSettle = async \(pred, ms, what\)/, `${f}: mustSettle is missing`);
    // Every mustSettle passes a phrase, not a bare timeout. 17 sites x "wait timed out" is barely
    // better than the crash it replaced.
    for (const call of s.match(/mustSettle\([^\n]*\n?[^\n]*/g) ?? []) {
      if (/const mustSettle/.test(call)) continue;
      assert.match(call, /,\s*'[^']{12,}'/, `${f}: a mustSettle names no wait — ${call.slice(0, 70)}`);
    }
  }
});

test("#1809 the helpers behave: a miss throws naming what it missed, maybeByText stays quiet", () => {
  // Built from the real source rather than restated here, so a change to the helper reaches this arm.
  const s = src(FILES[0]);
  const from = s.indexOf("const maybeByText");
  const to = s.indexOf("};", s.indexOf("const findByText")) + 2;
  assert.ok(from > 0 && to > from, "could not locate the helper pair in the driver source");
  const doc = { querySelectorAll: (sel) => (sel === "button" ? [{ innerText: "Start clearance" }] : []) };
  const { findByText, maybeByText } = new Function("document", `${s.slice(from, to)}\nreturn { findByText, maybeByText };`)(doc);

  assert.equal(maybeByText("button", /Back to edit/), undefined, "maybeByText must still return undefined");
  assert.deepEqual(findByText("button", /Start clearance/), { innerText: "Start clearance" });

  let err;
  try { findByText("button", /Back to edit/); } catch (e) { err = e; }
  assert.ok(err, "findByText must throw when nothing matches — returning undefined is the defect");
  assert.match(err.message, /button/, "the message must name the selector it searched");
  assert.match(err.message, /Back to edit/, "the message must name the pattern it missed");
  assert.doesNotMatch(err.message, /undefined/, "this is the message the fix exists to replace");
});