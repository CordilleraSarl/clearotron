// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE MINIMUM NODE VERSION, READ FROM THE ONE PLACE THAT DECLARES IT.
//
// `package.json` says `engines: { node: ">=22.19.0" }`. npm reads that field, and so does everything
// here. Nothing restates the number.
//
// WHY THIS FILE EXISTS RATHER THAN A CONSTANT. There was a constant: `NODE_FLOOR = 22` in bin/onboard.mjs,
// compared as `Number(process.versions.node.split(".")[0]) >= NODE_FLOOR`. A major-only comparison
// STRUCTURALLY CANNOT SEE A MINOR FLOOR, so 22.16.0 passed a check written for 22.19.0 — the check said
// `node 22.16.0` and a tick while npm, reading the same requirement from the same repository, printed
// EBADENGINE for it. One requirement, two spellings, already disagreeing.
//
// The cost was a first-run failure nobody could diagnose: an engine door exited 1 on a machine below the
// floor, and every check the product offers said the runtime was fine.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The declared range, verbatim, e.g. `">=22.19.0"`. Throws if the field is gone — an absent floor is a
 *  packaging fault, not a licence to run on anything. */
export function declaredRange(root = join(HERE, "..")) {
  const range = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))?.engines?.node;
  if (!range) throw new Error("package.json declares no engines.node — the runtime floor has no source");
  return String(range);
}

/**
 * `">=22.19.0"` → [22, 19, 0]. `">=22"` and `">=22.19"` are accepted too, with the absent parts read as
 * zero, because that is what they mean and not a guess — and because the field is edited by whoever
 * changes the floor, who should not have to know which spelling this reader was written against. A
 * coordination failure between two people editing one number is the defect this whole file exists for.
 *
 * ONLY the `>=` family. A caret or tilde range, or an `||` union, THROWS rather than being interpreted:
 * a floor read wrongly is worse than one not read at all, because it would silently pass every version
 * and take every check built on it with it.
 */
export function floorOf(range) {
  const m = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(String(range).trim());
  if (!m) throw new Error(`engines.node is ${range}, which this reader does not understand — expected ">=x", ">=x.y" or ">=x.y.z"`);
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** `"22.16.0"` → [22, 16, 0], ignoring any pre-release or build suffix. */
export const partsOf = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
};

/** Is `current` at or above `floor`? ALL THREE PARTS, in order — the defect this replaces compared one. */
export function meetsFloor(current, floor) {
  const c = partsOf(current);
  for (let i = 0; i < 3; i += 1) {
    if (c[i] > floor[i]) return true;
    if (c[i] < floor[i]) return false;
  }
  return true;
}

/**
 * The whole answer, for a caller that wants to refuse.
 *
 * `current` and `root` are injected so a check can drive every side of this without a second Node
 * installation — a floor guard that can only be exercised by running on an old runtime is one nobody
 * ever sees fail.
 */
export function nodeFloorVerdict({ current = process.versions.node, root } = {}) {
  const range = declaredRange(root);
  const floor = floorOf(range);
  return { ok: meetsFloor(current, floor), current, required: floor.join("."), range };
}

/** What a person is told, in one sentence, naming both versions. No stack, no advice they cannot act on. */
export function nodeFloorRefusal(v) {
  return `This needs Node ${v.required} or newer, and this is Node ${v.current}. `
    + "Upgrade Node and run the command again — nothing else here will work until you do.";
}
