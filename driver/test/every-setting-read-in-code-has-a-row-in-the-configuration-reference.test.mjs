// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The configuration reference is the page three documents send a reader to for every setting, and it named 95 of the 131
// `CLEAROTRON_*` settings product code reads: the env audit counted a name as documented when the governance page alone
// carried it, and nothing held even that count. The reference now has a row for every setting product code reads, the
// audit reads the reference alone, and this holds it: a setting read in product code with no row there fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditEnv } from "../../scripts/env-audit.mjs";
import { skipReason } from "../../shared/tracked-files.mjs";

const REF = "docs/architecture/04-configuration-reference.md";
const GOV = "docs/architecture/05-config-governance.md";

test("every setting product code reads has a row in the configuration reference", (t) => {
  const a = auditEnv();
  if (a === null) return t.skip(skipReason("env-audit (governance ratchet)"));
  assert.ok(a.product > 200, `only ${a.product} product settings were found, so this would pass on nothing`);
  assert.deepEqual(a.undocumentedProduct, [], `give each of these a row in ${REF}`);
});

/** A one-file checkout reading one invented setting, with the two pages as given. */
function tree({ ref = "", gov = "" }) {
  const root = mkdtempSync(join(tmpdir(), "config-reference-"));
  mkdirSync(join(root, "driver"), { recursive: true });
  mkdirSync(join(root, "docs", "architecture"), { recursive: true });
  writeFileSync(join(root, "driver", "invented.mjs"), "export const v = process.env.CLEAROTRON_AN_INVENTED_SETTING;\n");
  writeFileSync(join(root, REF), ref);
  writeFileSync(join(root, GOV), gov);
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  return root;
}

test("a setting only the governance page names is not documented; a row in the reference is", () => {
  const row = "| `CLEAROTRON_AN_INVENTED_SETTING` | unset | An invented setting. |\n";
  assert.deepEqual(auditEnv(tree({ gov: row })).undocumentedProduct, ["CLEAROTRON_AN_INVENTED_SETTING"], "the governance page alone documented it");
  assert.deepEqual(auditEnv(tree({ ref: row })).undocumentedProduct, []);
  assert.deepEqual(auditEnv(tree({ ref: "| `CLEAROTRON_AN_INVENTED_SETTING_WIDER` | unset | A longer name. |\n" })).undocumentedProduct,
    ["CLEAROTRON_AN_INVENTED_SETTING"], "a longer name documented the shorter one");
});

test("a setting named only in another row's meaning, or in prose, has no row; one sharing a first cell does", () => {
  const other = "| `CLEAROTRON_ANOTHER_SETTING` | unset | Read beside `CLEAROTRON_AN_INVENTED_SETTING`. |\n";
  assert.deepEqual(auditEnv(tree({ ref: other })).undocumentedProduct, ["CLEAROTRON_AN_INVENTED_SETTING"], "a mention in a meaning cell counted as a row");
  assert.deepEqual(auditEnv(tree({ ref: "Set `CLEAROTRON_AN_INVENTED_SETTING` to change it.\n" })).undocumentedProduct,
    ["CLEAROTRON_AN_INVENTED_SETTING"], "a mention in prose counted as a row");
  const escaped = "| `CLEAROTRON_ANOTHER_SETTING` \\| `CLEAROTRON_AN_INVENTED_SETTING` | unset | Either name. |\n";
  assert.deepEqual(auditEnv(tree({ ref: escaped })).undocumentedProduct, [], "an escaped pipe ended the first cell early");
  const shared = "| `CLEAROTRON_ANOTHER_SETTING`, `CLEAROTRON_AN_INVENTED_SETTING` | unset | Two settings, one row. |\n";
  assert.deepEqual(auditEnv(tree({ ref: shared })).undocumentedProduct, []);
});
