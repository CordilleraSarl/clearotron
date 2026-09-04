// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// 's CLASS AT A THIRD SITE — a Latin normaliser standing where a comparison should be.
//
// `consolidationKey` folds owner and mark with `[^a-z0-9]`, which reduces any CJK, Cyrillic or Arabic
// value to the EMPTY STRING. Measured on origin/main before this fix:
//
//   Shanghai Xiangjin + 色度  →  "shanghai xiangjin|"   ┐ SAME KEY — two different marks, one owner
//   Shanghai Xiangjin + 色彩  →  "shanghai xiangjin|"   ┘
//   上海翔金          + 色度  →  "|"                     ← both halves empty
//
// The second is the severe one: a Chinese owner with a Chinese mark keys to the empty string, so every
// such finding in a run — across unrelated owners — shares one key. consolidateFindings keeps the
// highest-severity member and drops the rest, so a run's whole non-Latin field can collapse into one
// card whose prose describes one of them.

import { test } from "node:test";
import assert from "node:assert/strict";

import { consolidateFindings } from "../findings-model.mjs";

const f = (owner, mark, ordinal) => ({
  owner: { name: owner, registrations: [{ uri: `/mark/x/${ordinal}` }] },
  mark, ordinal, composite: 1,
});

test("#383 TWO DIFFERENT CJK MARKS UNDER ONE OWNER STAY TWO FINDINGS", () => {
  const out = consolidateFindings([f("Shanghai Xiangjin", "色度", 1), f("Shanghai Xiangjin", "色彩", 2)]);
  assert.equal(out.findings.length, 2, "different marks are different conflicts");
  assert.deepEqual(out.merges, [], "and nothing was merged away");
});

test("#383 A CJK OWNER WITH A CJK MARK DOES NOT KEY TO THE EMPTY STRING", () => {
  // The severe case: before the fix every such finding, across unrelated owners, shared one key.
  const out = consolidateFindings([
    f("上海翔金", "色度", 1), f("北京华方", "商标", 2), f("株式会社デルフィ", "デルフィ", 3),
  ]);
  assert.equal(out.findings.length, 3, "three unrelated owners, three findings");
  assert.deepEqual(out.merges, []);
});

test("#383 A GENUINE DUPLICATE STILL CONSOLIDATES — the fix must not stop the function working", () => {
  const out = consolidateFindings([f("BePharBel", "VELTRI", 1), f("BePharBel", "VELTRI", 2)]);
  assert.equal(out.findings.length, 1);
  assert.deepEqual(out.merges.map((m) => m.dropped), [[2]]);
  assert.equal(out.findings[0].owner.registrations.length, 2, "and the union carries both registrations");
});

test("#383 A CJK DUPLICATE CONSOLIDATES TOO — the fix is a key, not an exemption", () => {
  const out = consolidateFindings([f("上海翔金", "色度", 1), f("上海翔金", "色度", 2)]);
  assert.equal(out.findings.length, 1, "the same mark and the same owner is still one conflict");
});

test("#383 full-width and half-width forms of one name key ALIKE (NFKC)", () => {
  const out = consolidateFindings([f("ＤＥＬＦＩ", "デルフィ", 1), f("ＤＥＬＦＩ", "ﾃﾞﾙﾌｨ", 2)]);
  assert.equal(out.findings.length, 1, "compatibility forms of the same characters are the same mark");
});

test("#383 LATIN KEYS ARE UNCHANGED — an archived finding must not re-merge differently", () => {
  // The risk this fix carries: a consolidation key that moved would regroup every archived run's
  // findings on republish. Latin values take the same path they always did.
  const out = consolidateFindings([
    f("Delphi Technologies, Inc.", "DELPHI", 1), f("delphi technologies inc", "delphi", 2),
    f("Delphi Scientific LLC", "DELPHI SCIENTIFIC", 3),
  ]);
  assert.equal(out.findings.length, 2, "punctuation and case still fold exactly as before");
  assert.deepEqual(out.merges.map((m) => m.dropped), [[2]]);
});
