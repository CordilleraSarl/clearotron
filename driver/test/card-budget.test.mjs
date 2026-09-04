// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// PR-9 (Levels) — card-budget: the level-1 budgets enforced at assembly, MOTION never deletion. Every
// fold's invariant is checked the hard way: no word of the overflow may be lost from the document.
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSentences, foldCardRead, foldCaption } from "../card-budget.mjs";

const S = (n, i) => `Sentence number ${i} of the read carries roughly ten words here.`;
const sentences = (n) => Array.from({ length: n }, (_, i) => S(n, i + 1)).join(" ");

test("splitSentences: plain prose splits; legal abbreviations and initials never split", () => {
  assert.equal(splitSentences("One here. Two here. Three here.").length, 3);
  assert.equal(splitSentences("The Cl. 5 filing under Reg. No. 1234 is live. A second sentence.").length, 2,
    "Cl. / Reg. / No. are not boundaries");
  assert.equal(splitSentences("Filed in the U.S. before J. Smith joined. Next one.").length, 2);
  assert.equal(splitSentences("The crowd is dilutive, e.g. seventeen live marks coexist.").length, 1,
    "a false boundary after e.g. would burn the 2-sentence budget on a fragment");
  assert.equal(splitSentences("Both share the head element, i.e. the coined term. A second sentence.").length, 2);
  assert.equal(splitSentences("Compare the cited decision, cf. the EUIPO line. Next one.").length, 2);
  assert.equal(splitSentences("Registered to Smith et al. across three classes. Next one.").length, 2);
  assert.deepEqual(splitSentences(""), []);
  assert.equal(splitSentences("No terminal punctuation at all").length, 1);
});

test("foldCardRead: a read within budget is byte-identical, no fold", () => {
  const card = "## Owner — MARK, US\n- ord: 1\n### The read\nShort verdict. Two sentences only.\n\n### Full detail\n- Source: [x](/mark/us/1)\n";
  const { md, fold } = foldCardRead(card);
  assert.equal(md, card);
  assert.equal(fold, null);
});

test("foldCardRead: overflow MOVES to the head of Full detail under a Continued-read bullet — zero words lost", () => {
  const read = sentences(5);
  const card = `## Owner — MARK, US\n- ord: 1\n### The read\n${read}\n\n### Full detail\n- Filing history bullet.\n- Source: [x](/mark/us/1)\n`;
  const { md, fold } = foldCardRead(card);
  assert.ok(fold, "a 5-sentence read folds");
  assert.equal(fold.movedSentences, 3, "2 sentences kept, 3 moved");
  // the read now carries exactly the first two sentences
  const readBody = md.match(/### The read\n([\s\S]*?)\n\n### Full detail/)[1].trim();
  assert.equal(splitSentences(readBody).length, 2);
  // the overflow leads Full detail as its own bullet, BEFORE the existing bullets
  const detail = md.slice(md.indexOf("### Full detail"));
  assert.match(detail, /^### Full detail\n\n- \*\*Continued read:\*\* /);
  assert.ok(detail.indexOf("Continued read") < detail.indexOf("Filing history bullet"), "overflow at the HEAD of Full detail");
  // MOTION NOT DELETION: every word of the original read survives somewhere in the document
  for (const w of read.split(/\s+/)) assert.ok(md.includes(w), `word lost in fold: ${w}`);
});

test("foldCardRead: the word cap folds a 2-sentence read that busts ~120 words; a single over-long sentence stays whole", () => {
  const long = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ") + ".";
  const twoLong = `${long(90)} ${long(90)}`;
  const card = `## O — M, US\n- ord: 1\n### The read\n${twoLong}\n\n### Full detail\n- b.\n`;
  const { md, fold } = foldCardRead(card);
  assert.ok(fold, "second 90-word sentence exceeds the 120-word budget");
  assert.equal(fold.movedSentences, 1);
  // one giant sentence has no boundary to cut at — kept whole, never chopped mid-thought
  const one = `## O — M, US\n- ord: 1\n### The read\n${long(200)}\n\n### Full detail\n- b.\n`;
  assert.equal(foldCardRead(one).fold, null);
});

test("foldCardRead: a card with no Full detail section grows one to receive the overflow", () => {
  const card = `## O — M, US\n- ord: 1\n### The read\n${sentences(4)}\n`;
  const { md, fold } = foldCardRead(card);
  assert.ok(fold);
  assert.match(md, /### Full detail\n\n- \*\*Continued read:\*\* /);
});

test("foldCaption: ≤3 sentences untouched; overflow moves into the Checks-we-ran bucket — zero words lost", () => {
  const three = "One driver. One consequence. One step.";
  const ok = `---\noverall_caption: ${three}\n---\n\n# Actions\n\n### Checks we ran — what we found\n- register clean.\n`;
  assert.equal(foldCaption(ok).fold, null);
  const five = "First sentence here. Second sentence here. Third sentence here. Fourth sentence overflowing now. Fifth sentence overflowing too.";
  const over = `---\noverall_caption: ${five}\n---\n\n# Actions\n\n### Checks we ran — what we found\n- register clean.\n`;
  const { md, fold } = foldCaption(over);
  assert.ok(fold);
  assert.equal(fold.movedSentences, 2);
  const cap = md.match(/^overall_caption: (.+)$/m)[1];
  assert.equal(splitSentences(cap).length, 3, "caption clipped at the sentence boundary");
  assert.match(md, /### Checks we ran — what we found\n\n- \*\*Continued summary:\*\* Fourth sentence overflowing now\. Fifth sentence overflowing too\./);
  for (const w of five.split(/\s+/)) assert.ok(md.includes(w), `word lost in fold: ${w}`);
});

test("foldCaption: creates the Checks-we-ran bucket under # Actions (or # Actions itself) when absent", () => {
  const five = "S one is fine. S two is fine. S three is fine. S four moves out. S five moves out.";
  const withActions = `---\noverall_caption: ${five}\n---\n\n# Actions\n\n### Only you can close these\n- x\n`;
  const a = foldCaption(withActions);
  assert.match(a.md, /# Actions\n\n### Checks we ran — what we found\n\n- \*\*Continued summary:\*\*/);
  assert.ok(a.md.indexOf("Checks we ran") < a.md.indexOf("Only you can close these"), "inserted at the head of # Actions");
  const noActions = `---\noverall_caption: ${five}\n---\n\n# Methodology\nnote\n`;
  const b = foldCaption(noActions);
  assert.match(b.md, /# Actions\n\n### Checks we ran — what we found\n\n- \*\*Continued summary:\*\*/);
  // no caption line at all ⇒ untouched
  assert.equal(foldCaption("---\n---\n\n# Actions\n").fold, null);
});
