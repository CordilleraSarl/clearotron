// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ordinary-words.mjs — the impure edge of the one-letter neighbourhood rule: it reads the word list off disk.
//
// form-neighbourhood.mjs is PURE and takes the list as a Set; this is the one place that turns the file into
// that Set, so there is one reading of it and not one per caller. The file's own header states its source,
// its date and its licence; lines starting with `#` are that header and are skipped.
//
// A LIST THAT WILL NOT LOAD REMOVES NOTHING. The rule only ever takes queries away, so the safe failure is an
// empty Set — every neighbour searched, exactly as before the rule existed — and the caller is told, so the
// run record can say the rule did not apply rather than read as a mark with no ordinary-word neighbours.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where each language's list lives. English only; other markets add a file and a key. */
export const WORD_LIST_PATHS = Object.freeze({ en: join(HERE, "wordlists", "en.txt") });

/** Parse a list file's text into a Set of lowercase words. PURE. */
export function parseWordList(text) {
  const out = new Set();
  for (const line of String(text ?? "").split("\n")) {
    const w = line.trim();
    if (!w || w.startsWith("#")) continue;
    out.add(w.toLowerCase());
  }
  return out;
}

const cache = new Map();

/**
 * The ordinary-word Set for a language, read once per process.
 * @returns {{ words: Set<string>, error: string|null }}
 */
export function loadOrdinaryWords(lang = "en") {
  if (cache.has(lang)) return cache.get(lang);
  const p = WORD_LIST_PATHS[lang];
  let r;
  if (!p) r = { words: new Set(), error: `no word list for language "${lang}"` };
  else {
    try { r = { words: parseWordList(readFileSync(p, "utf8")), error: null }; }
    catch (e) { r = { words: new Set(), error: `word list ${lang} unreadable: ${String(e?.message ?? e).slice(0, 120)}` }; }
    if (!r.error && !r.words.size) r = { words: r.words, error: `word list ${lang} holds no words` };
  }
  cache.set(lang, r);
  return r;
}
