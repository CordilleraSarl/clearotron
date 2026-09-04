// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE THREE STRUCTURAL IDENTIFIER CLASSES, STATED ONCE.
//
// `no-client-identifiers.test.mjs` refuses these over tracked BLOBS. `scripts/commit-message-guard.mjs`
// refuses the same three over COMMIT MESSAGES, which no sweep read until. Two
// corpora, one definition — because that file already records what happens otherwise: three copies of
// the customer-name rules drifted, and the retired publication gate was a fourth. The blob guard and
// the message guard must not be able to disagree about what a real matter number looks like.
//
// Each function takes TEXT and returns the matched strings. No file reading, no corpus walking, no
// assertions — the caller owns all three, because the two callers disagree about every one of them.
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── 1. matter numbers ────────────────────────────────────────────────────────────────────────────
// Real Cordillera matters are TMP<4 digits> and the range keeps advancing, so this allowlists the bands
// reserved for tests rather than blocking the band real matters happen to occupy today.
export function matterHits(text) {
  const out = [];
  for (const m of String(text).matchAll(/\btmp(\d{4})\b/gi)) if (!/^[01289]/.test(m[1])) out.push(m[0]);
  return out;
}

// ── 2. run codenames ─────────────────────────────────────────────────────────────────────────────
// A real run's codename is <adj>-<noun> from phase0.mjs's two 20-word lists. Any such pair is either a
// real run or indistinguishable from one. The vocabulary is READ from the generator, never transcribed:
// a transcribed copy goes stale the day someone adds a word, and goes stale silently.
export function codenameRegex(root) {
  const src = readFileSync(join(root, "driver/phase0.mjs"), "utf8");
  const words = (name) => {
    const block = new RegExp(`const ${name} = \\[(.*?)\\];`, "s").exec(src);
    if (!block) throw new Error(`${name} not found in driver/phase0.mjs — this guard needs updating with it`);
    return [...block[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  };
  const adj = words("ADJ"), noun = words("NOUN");
  if (adj.length < 10 || noun.length < 10) throw new Error("phase0.mjs vocabulary looks truncated");
  return { adj, noun, rx: new RegExp(`\\b(?:${adj.join("|")})-(?:${noun.join("|")})\\b`, "g") };
}
export const codenameHits = (text, rx) => [...String(text).matchAll(new RegExp(rx.source, "g"))].map((m) => m[0]);

// ── 3. noref run ids ─────────────────────────────────────────────────────────────────────────────
export function norefHits(text) {
  const out = [];
  for (const m of String(text).matchAll(/\bnoref([0-9a-f]{6})\b/gi)) if (!/^0{3}/.test(m[1])) out.push(m[0]);
  return out;
}
