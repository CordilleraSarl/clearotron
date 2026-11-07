// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE INSTALL GUIDE'S SAMPLE SETTINGS PICK THE REGISTER THE GUIDE RECOMMENDS, AND NAME EACH CREDENTIAL ONCE.
//
// The guide recommends Signa, and its sample settings block selected Clarivate, with Clarivate's key
// uncommented beside it, the EU register's environment uncommented under a register nobody had chosen,
// and the Corsearch and Clarivate keys each listed twice (measured on a beta, 2026-11-04). A reader who
// copies the block, as it invites, configured a sales-gated register they had just been told to skip.
//
// The recommendation is read from the register table setup offers, whose order is the ladder: the
// recommended register first. Every register's credentials come from the same table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDERS } from "../../shared/register-selection.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The register lines of INSTALL.md's sample settings: from the register heading to the research heading. */
function registerLines() {
  const text = readFileSync(join(ROOT, "INSTALL.md"), "utf8");
  const from = text.indexOf("# ── Register provider (choose ONE)");
  assert.notEqual(from, -1, "INSTALL.md's sample settings have no register section");
  const to = text.indexOf("# ── Web research", from);
  assert.ok(to > from, "INSTALL.md's sample settings no longer end the register section at the research key");
  return text.slice(from, to).split("\n");
}
const live = (lines) => lines.map((l) => /^([A-Z][A-Z0-9_]*)=(\S*)/.exec(l)).filter(Boolean).map((m) => ({ name: m[1], value: m[2] }));

test("the uncommented register is the one setup recommends, with its credentials and nothing else", () => {
  const recommended = PROVIDERS[0];
  assert.match(recommended.label, /recommended/, "the first register in setup's table is not the recommended one; this arm reads the order");
  const set = live(registerLines());
  assert.deepEqual(set.filter((s) => s.name === "CLEAROTRON_DATABASE").map((s) => s.value), [recommended.id],
    `the sample settings select a register other than ${recommended.id}`);
  assert.deepEqual(set.filter((s) => s.name !== "CLEAROTRON_DATABASE").map((s) => s.name), recommended.credentials,
    "the sample settings leave a credential uncommented that the selected register does not read");
});

test("the register list names every register setup offers, and each credential appears once", () => {
  const lines = registerLines();
  const listed = /REQUIRED — ([a-z-]+(?: \| [a-z-]+)*)/.exec(lines.join("\n"));
  assert.ok(listed, "the sample settings no longer list the registers");
  assert.deepEqual(listed[1].split(" | ").sort(), PROVIDERS.map((p) => p.id).sort(), "the listed registers are not the ones setup offers");
  const text = lines.join("\n");
  for (const name of new Set(PROVIDERS.flatMap((p) => [...p.credentials, ...(p.optionalCredentials ?? [])]))) {
    const n = (text.match(new RegExp(`\\b${name}=`, "g")) ?? []).length;
    assert.equal(n, 1, `${name} appears ${n} time(s) in the sample settings`);
  }
});
