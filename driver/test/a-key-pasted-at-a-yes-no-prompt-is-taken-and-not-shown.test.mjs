// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KEY PASTED AT A YES/NO PROMPT IS TAKEN AS THE ANSWER, AND IS NEVER SHOWN.
//
// Setup asked "Enter a Perplexity API key now? [Y/n]", a person pasted the key there, and the terminal
// showed it before the wizard said "Please answer y or n". Reported from a real install, 2026-09-10.
//
// The echo is driven through Node's own readline in terminal mode, the way setup builds it, because the
// defect is in when readline writes: each keypress is echoed as it arrives, so a decision made after the
// line is submitted comes too late.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { PassThrough, Writable } from "node:stream";
import { couldBeYesNo, looksLikeAKey, yesNoEchoOf } from "../../shared/yes-no-echo.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KEY = "pplx-" + "Q7w2Z9k4R1t8Y5u3I6o0P2a4S6d8F1g3H5j7";   // shaped like the real thing, and not one

test("what can still become a yes/no answer, and what is plainly a key", () => {
  for (const line of ["", "y", "Y", "ye", "yes", "YES", "n", "no", "No"]) assert.equal(couldBeYesNo(line), true, JSON.stringify(line));
  for (const line of ["p", "pplx-", "yess", "nope", "sk-", "maybe", "yes please"]) assert.equal(couldBeYesNo(line), false, JSON.stringify(line));
  assert.equal(looksLikeAKey(KEY), true);
  assert.equal(looksLikeAKey(`  ${KEY}  `), true, "surrounding blanks from a paste do not hide a key");
  for (const a of ["", "y", "yes", "no", "maybe", "yes please", "not a key at all"]) assert.equal(looksLikeAKey(a), false, JSON.stringify(a));
});

/** A readline in terminal mode writing through the same filter setup's output applies while a yes/no question is open. */
function yesNoPrompt() {
  const input = new PassThrough();
  let shown = "";
  let rl;
  const output = new Writable({
    write(chunk, enc, cb) { const out = yesNoEchoOf(String(chunk), { line: rl?.line ?? "", prompt: rl?.getPrompt?.() ?? "" }); shown += out; cb(); },
  });
  output.isTTY = true;
  output.columns = 120;
  rl = createInterface({ input, output, terminal: true });
  const ask = async (q, typed) => {
    const answer = rl.question(q);
    setTimeout(() => { for (const piece of typed) input.write(piece); }, 10);
    return answer;
  };
  // Cursor control stripped for reading: readline moves to the answer column between the prompt and the answer.
  return { ask, shown: () => shown.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ""), close: () => rl.close() };
}

test("a pasted key is never shown, and still reaches the answer whole", async () => {
  const p = yesNoPrompt();
  try {
    const answer = await p.ask("  Enter a Perplexity API key now? [Y/n] ", [KEY, "\r"]);
    assert.equal(answer, KEY, "the answer must carry the whole key, so setup can take it");
    const shown = p.shown();
    assert.match(shown, /Enter a Perplexity API key now\? \[Y\/n\] /, "the question itself is still shown");
    for (const fragment of ["pplx", "Q7w2", "H5j7", KEY.slice(-4)])
      assert.ok(!shown.includes(fragment), `a fragment of the key reached the terminal: ${JSON.stringify(fragment)}`);
    assert.match(shown, /\r\n$/, "and the newline still passes, so the next line starts where it should");
  } finally { p.close(); }
});

test("a typed yes, and a typed no, are shown as they are typed", async () => {
  const p = yesNoPrompt();
  try {
    assert.equal(await p.ask("  Go on? [Y/n] ", ["y", "e", "s", "\r"]), "yes");
    assert.match(p.shown(), /Go on\? \[Y\/n\] yes\r\n/, "a yes/no answer must echo, or the prompt feels dead");
    assert.equal(await p.ask("  Again? [Y/n] ", ["n", "o", "\r"]), "no");
    assert.match(p.shown(), /Again\? \[Y\/n\] no\r\n/);
  } finally { p.close(); }
});

test("an edit after a key-shaped line keeps the question on screen and still shows nothing of the line", async () => {
  const p = yesNoPrompt();
  try {
    // A backspace makes readline redraw the prompt and the whole line in one write.
    const answer = await p.ask("  Enter a key now? [Y/n] ", ["pplx-abcdefgh", "\x7f", "\r"]);
    assert.equal(answer, "pplx-abcdefg");
    const shown = p.shown();
    assert.ok(!shown.includes("pplx"), "the redraw showed the line it was meant to hide");
    assert.ok(shown.split("Enter a key now? [Y/n] ").length - 1 >= 2, "the redraw lost the question");
  } finally { p.close(); }
});

test("setup wires it: the yes/no questions echo through the filter, and the key question takes a key", () => {
  const src = readFileSync(join(REPO, "bin", "onboard.mjs"), "utf8");
  assert.match(src, /import \{ looksLikeAKey, yesNoEchoOf \} from "\.\.\/shared\/yes-no-echo\.mjs";/);
  assert.match(src, /yesNo \? yesNoEchoOf\(String\(chunk\), \{ line: rl\.line, prompt: rl\.getPrompt\(\) \}\)/,
    "setup's output must pass a yes/no question's echo through the filter");
  assert.equal(src.split("await askYesNo(").length - 1, 1, "one yes/no read, and its one caller is confirmOrKey");
  assert.match(src, /const confirm = async \(q, def = true\) => \(await confirmOrKey\(q, def, \{ key: false \}\)\)\.yes;/,
    "every other yes/no question goes through the same read, so none of them can echo a key either");
  assert.match(src, /const answer = await confirmOrKey\(`Enter a \$\{adapter\.label\} API key now\?`, true\);/,
    "the research-key question is the one that takes a key as its answer");
  assert.match(src, /if \(answer\.value\) candidate\[name\] = answer\.value;/, "and a key given there is kept");
});
