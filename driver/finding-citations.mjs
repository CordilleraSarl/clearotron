// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// finding-citations.mjs — the finding numbers a text cites, read one way wherever the driver reads them.
//
// Two readers. The delivery check reads the overview's prose for a citation of a finding the report does not carry,
// in every written form. The writer's exclusions record the findings their grounds cite ("carried as finding 9"), so
// that a later review is told when one of them changed. A ground is read in the forms that carry the word "finding"
// only: a number after a bare hash sign can be a class there, and a false link would pull a settled exclusion back
// into review.
//
// A pure leaf with no imports: the declination tool server and the delivery check both load it.

// "finding 12", "finding no. 12", "findings 3 and 4", "findings 5–7", each also with a hash sign before the number,
// and a number after a bare hash sign that is not part of a word, a link or a colour.
const WITH_BARE = /(?:\bfindings?\s+(?:no\.?\s*|number\s+)?#?|(?<![\w#/&=-])#)(\d{1,4})((?:\s*(?:,|and|&|or|[–-])\s*#?\d{1,4}(?!\w))*)(?!\w)/gi;
const WORD_ONLY = /\bfindings?\s+(?:no\.?\s*|number\s+)?#?(\d{1,4})((?:\s*(?:,|and|&|or|[–-])\s*#?\d{1,4}(?!\w))*)(?!\w)/gi;

/**
 * The finding numbers a text cites, in order of first mention. With `bare: false` a number after a bare hash sign is
 * not read: the word "finding" must come before it. PURE.
 */
export function citedFindingNumbers(text, { bare = true } = {}) {
  const out = [];
  const add = (n) => { if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n); };
  for (const m of String(text ?? "").matchAll(bare ? WITH_BARE : WORD_ONLY)) {
    add(Number(m[1]));
    let prev = Number(m[1]);
    for (const part of String(m[2] ?? "").matchAll(/([,&–-]|and|or)\s*#?(\d{1,4})/gi)) {
      const n = Number(part[2]);
      // A range names every finding in it, up to a run's worth.
      if (/[–-]/.test(part[1]) && n > prev && n - prev <= 50) for (let k = prev + 1; k < n; k++) add(k);
      add(n);
      prev = n;
    }
  }
  return out;
}
