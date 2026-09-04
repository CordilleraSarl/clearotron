// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// phonetic-key.test.mjs — known-answer + invariant tests for the Double Metaphone form-neighbourhood key.
//
// The KNOWN_ANSWERS table below is taken verbatim from the canonical `double-metaphone` JS package's
// published output (v2.0.1 — itself a faithful port of Lawrence Philips' reference algorithm, the same one
// behind CPAN Text::DoubleMetaphone). Each [primary, secondary] pair was captured directly from that
// reference, NOT guessed. If a future change to phonetic-key.mjs diverges from the reference, these vectors
// fail and say exactly where.
import { test } from "node:test";
import assert from "node:assert/strict";
import { doubleMetaphone, phoneticKey } from "../phonetic-key.mjs";

// word -> [primary, secondary], straight from the reference implementation.
const KNOWN_ANSWERS = [
  ["Thompson", ["TMPSN", "TMPSN"]],
  ["Smith", ["SM0", "XMT"]],
  ["Schmidt", ["XMT", "SMT"]],     // Smith/Schmidt: classic anglicization pair (different codes, by design)
  ["Catherine", ["K0RN", "KTRN"]],
  ["Katherine", ["K0RN", "KTRN"]], // Catherine/Katherine share the SECONDARY KTRN
  ["Tymczak", ["TMSK", "TMXK"]],
  ["Pfister", ["PFSTR", "PFSTR"]],
  ["Wright", ["RT", "RT"]],         // silent initial WR
  ["Xavier", ["SF", "SFR"]],        // initial X -> S
  ["Caesar", ["SSR", "SSR"]],
  ["knight", ["NT", "NT"]],         // silent KN + silent GH
  ["psalm", ["SLM", "SLM"]],        // silent PS
  ["Arnow", ["ARN", "ARNF"]],
  ["Arnoff", ["ARNF", "ARNF"]],     // Arnow/Arnoff: the W/-OFF secondary collapse
  ["Hochmeier", ["HKMR", "HKMR"]],
  ["gnarl", ["NRL", "NRL"]],        // silent GN
  ["knack", ["NK", "NK"]],
  ["pneumatic", ["NMTK", "NMTK"]],  // silent PN
  ["wrack", ["RK", "RK"]],
  ["psycho", ["SX", "SK"]],
  ["chemical", ["KMKL", "KMKL"]],   // Greek CH -> K
  ["choral", ["KRL", "KRL"]],
  ["michael", ["MKL", "MXL"]],      // CH ambiguous: K primary / X secondary
  ["accident", ["AKSTNT", "AKSTNT"]], // CC -> KS
  ["succeed", ["SKST", "SKST"]],
  ["focaccia", ["FKX", "FKX"]],     // CC -> X (Italian)
  ["edge", ["AJ", "AJ"]],           // DGE -> J
  ["Edgar", ["ATKR", "ATKR"]],      // DG -> TK
  ["thumb", ["0M", "TM"]],          // TH -> 0/T, silent final B after M
  ["dumber", ["TMR", "TMR"]],       // silent B in -MB- before ER
  ["Van Agema", ["FNKM", "FNKM"]],  // Germanic prefix forces hard G
  ["McHugh", ["MK", "MK"]],
  ["ghislane", ["JLN", "JLN"]],     // initial GHI -> J
  ["ghoul", ["KL", "KL"]],          // initial GH -> K
  ["laugh", ["LF", "LF"]],          // -AUGH -> F
  ["weight", ["AT", "FT"]],         // silent GH
  ["tagliaro", ["TKLR", "TLR"]],    // GLI: primary KL / secondary L
  ["cagney", ["KKN", "KKN"]],
  ["Jose", ["HS", "HS"]],           // Spanish J -> H
  ["Joseph", ["JSF", "HSF"]],
  ["Jankelowicz", ["JNKLTS", "ANKLFX"]],
  ["bajador", ["PJTR", "PHTR"]],
  ["svaraj", ["SFRJ", "SFR"]],
  ["island", ["ALNT", "ALNT"]],     // silent S
  ["sugar", ["XKR", "SKR"]],
  ["schenker", ["XNKR", "SKNKR"]],
  ["schooner", ["SKNR", "SKNR"]],   // Dutch SCH -> SK
  ["schlepp", ["XLP", "SLP"]],
  ["tion", ["XN", "XN"]],           // -TION- -> X
  ["czerny", ["SRN", "XRN"]],
  ["zhao", ["J", "J"]],             // pinyin ZH -> J
  ["matrix", ["MTRKS", "MTRKS"]],   // X -> KS
  ["breaux", ["PR", "PR"]],         // French terminal -EAUX drops X
  ["Filipowicz", ["FLPTS", "FLPFX"]],
  ["Mazurkiewicz", ["MSRKTS", "MTSRKFX"]],
  ["ancient", ["ANSNT", "ANXNT"]],
  ["delicious", ["TLSS", "TLXS"]],
];

test("known-answer vectors match the canonical Double Metaphone reference", () => {
  assert.ok(KNOWN_ANSWERS.length >= 25, `need >=25 vectors, have ${KNOWN_ANSWERS.length}`);
  for (const [word, expected] of KNOWN_ANSWERS) {
    assert.deepEqual(
      doubleMetaphone(word),
      expected,
      `doubleMetaphone(${JSON.stringify(word)}) -> ${JSON.stringify(doubleMetaphone(word))}, expected ${JSON.stringify(expected)}`,
    );
    // phoneticKey is the primary of the same pair.
    assert.equal(phoneticKey(word), expected[0], `phoneticKey(${JSON.stringify(word)})`);
  }
});

test("doubleMetaphone returns [primary, secondary] uppercase A–Z (0 allowed for theta) strings", () => {
  for (const [word] of KNOWN_ANSWERS) {
    const out = doubleMetaphone(word);
    assert.ok(Array.isArray(out) && out.length === 2, `${word}: shape`);
    const [p, s] = out;
    assert.equal(typeof p, "string");
    assert.equal(typeof s, "string");
    // The code alphabet is uppercase consonant metaphs plus '0' (theta) and 'A' (kept leading vowel).
    assert.match(p, /^[A-Z0]*$/, `${word}: primary alphabet`);
    assert.match(s, /^[A-Z0]*$/, `${word}: secondary alphabet`);
  }
});

test("empty / non-letter input -> ['', '']", () => {
  assert.deepEqual(doubleMetaphone(""), ["", ""]);
  assert.deepEqual(doubleMetaphone("   "), ["", ""]);
  assert.deepEqual(doubleMetaphone("12345"), ["", ""]);
  assert.deepEqual(doubleMetaphone("!@#$%"), ["", ""]);
  assert.deepEqual(doubleMetaphone(null), ["", ""]);
  assert.deepEqual(doubleMetaphone(undefined), ["", ""]);
  assert.equal(phoneticKey(""), "");
});

test("usage invariants for the form-neighbourhood key", () => {
  // case-insensitive
  assert.equal(phoneticKey("ZURENA"), phoneticKey("zurena"));
  // vowel-substitution family shares a key (the whole point: ZURENA/ZIRENA collapse)
  assert.equal(phoneticKey("ZURENA"), phoneticKey("ZIRENA"));
  // onset (s vs k) differs -> different key
  assert.notEqual(phoneticKey("ZURENA"), phoneticKey("KURENA"));
});

test("tolerant of mixed case, digits, punctuation and Latin diacritics", () => {
  // punctuation / digits are ignored
  assert.equal(phoneticKey("O'Brien"), phoneticKey("OBrien"));
  assert.equal(phoneticKey("Smith-3000"), phoneticKey("Smith"));
  // diacritics fold to their base letter
  assert.equal(phoneticKey("José"), phoneticKey("Jose"));
  assert.equal(phoneticKey("Müller"), phoneticKey("Muller"));
  // fully case-insensitive across a few of the known answers
  for (const [word, expected] of KNOWN_ANSWERS) {
    assert.deepEqual(doubleMetaphone(word.toLowerCase()), expected, `${word} lowercased`);
    assert.deepEqual(doubleMetaphone(word.toUpperCase()), expected, `${word} uppercased`);
  }
});

test("doubleMetaphone(word).filter(Boolean) — the form-neighbourhood consumer shape — yields keys", () => {
  // form-neighbourhood.mjs does: doubleMetaphone(el).filter(Boolean)
  const keys = doubleMetaphone("ZURENA").filter(Boolean);
  assert.ok(keys.length >= 1, "at least one non-empty key");
  for (const k of keys) assert.match(k, /^[A-Z0]+$/);
});
