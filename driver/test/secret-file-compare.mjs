// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// secret-file-compare.mjs — did this credential-bearing file change, said without printing it.
//
// THE ASSERTION THAT LEAKS IS THE CAREFUL ONE. `assert.equal(after, before)` over two file contents
// reads as the right check, and it is: comparing a snapshot to itself is what lets an arm hold on a
// developer box that legitimately carries a `.env` and on a bare runner alike. What it also does is
// render BOTH operands in the failure, and Node prints them in full.
//
// SO THE ARM IS SILENT UNTIL THE MOMENT IT IS WORST. On a runner `before` is null, because CI carries
// no `.env`. The only way such an assertion fails there is the defect it was written for — the command
// under test wrote the file before it should have — and what our commands write into that file is a
// freshly minted token. A green run says nothing; a red run publishes a credential into the log of a
// public repository.
//
// WHAT THIS ANSWERS INSTEAD. Changed or unchanged, on a digest and a byte count, plus the KEY NAMES
// that appeared, vanished or moved. A key name is what the reader needs to act — it says which
// credential the command touched — and it is not the credential. Values never leave this module.
//
// ONE OWNER, BECAUSE THE NEXT ARM WILL WANT THE SAME SNAPSHOT. The shape recurs wherever a test proves
// that something did not write to a file it must not write to yet, and each new site would otherwise
// reach for `assert.equal` again and be right about the check and wrong about the failure.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/** A file's contents, or null where it is absent. Absent and empty are different states. */
export const snapshot = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null);

const digest = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

/**
 * The keys an env-shaped file declares, IN ORDER, values discarded on the way past.
 *
 * Deliberately permissive about the format: this is for naming what moved in a failure message, not
 * for deciding what a loader would apply — `shared/env-local.mjs` owns that question and this must
 * never become a second answer to it.
 */
export const keysIn = (text) => (text ?? "")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("=")[0].trim())
  .filter(Boolean);

const describe = (text) => text === null
  ? "absent"
  : `${Buffer.byteLength(text)} bytes, sha256:${digest(text)}`;

/**
 * Did this file change, and — if it did — what changed about it that can safely be said.
 *
 * @returns {{same: boolean, why: string}} `why` is written to be pasted into an assertion message.
 *   It NEVER contains a value read out of either side.
 */
export function unchanged(before, after) {
  if (before === after) return { same: true, why: `unchanged (${describe(before)})` };

  const was = keysIn(before);
  const now = keysIn(after);
  const appeared = now.filter((k) => !was.includes(k));
  const vanished = was.filter((k) => !now.includes(k));

  const parts = [`was ${describe(before)}, now ${describe(after)}`];
  if (appeared.length) parts.push(`keys that appeared: ${appeared.join(", ")}`);
  if (vanished.length) parts.push(`keys that vanished: ${vanished.join(", ")}`);
  // Same key set, different bytes: a value moved. Saying WHICH key would be useful and is exactly the
  // thing that starts leaking, because the next person to want a bit more detail adds the value.
  if (!appeared.length && !vanished.length) {
    parts.push(`the same ${now.length} key(s) are declared, so a value changed — this file is not `
      + "printed here and must not be printed to find out which");
  }
  return { same: false, why: parts.join("; ") };
}
