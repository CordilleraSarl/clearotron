// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// START NAMES THE GRANTS FILE BEFORE IT SAYS AN ORGANISATION WAS "FILED THERE".
//
// When `start` adds the first organisation to a grants file that already names the installer, it printed
// `organisation "…", filed there — rename it there too` with no line before it saying where: the line that
// names the file printed only when the file was created or a person was added (measured in testing,
// 2026-11-17). The file's own label now prints first in that case too.
//
// The grants come from start's own seeding, `installerGrants`, so `changed` is what a real second start
// computes; the lines are start's own, `grantsFileLines`, which its grants block prints one by one.
import test from "node:test";
import assert from "node:assert/strict";
import { grantsFileLines, installerGrants } from "../../bin/start.mjs";

const USER = "alex@a-firm.example-tld";
const PATH = "trademark/config/grants.json";
const said = (existed, seeded, organisation) => grantsFileLines({ existed, changed: seeded.changed, path: PATH, user: USER,
  organisation, organisations: Object.keys(seeded.grants.tenants ?? {}).length });

test("an organisation added to a file that already names the installer is filed under the file's name", () => {
  const first = installerGrants(null, { user: USER, organisation: "" });
  const second = installerGrants(first.grants, { user: USER, organisation: "A Firm Sàrl" });
  assert.deepEqual(second.changed, ["organisation"], "the case under test: only the organisation is new");
  const lines = said(true, second, "A Firm Sàrl");
  const filed = lines.findIndex((l) => /organisation "A Firm Sàrl", filed there/.test(l));
  assert.ok(filed > 0, `nothing before "filed there":\n${lines.join("\n")}`);
  assert.equal(lines[filed - 1].trim(), `grants         ${PATH}`, "the line before it names the grants file");
});

test("the other cases say what they said before", () => {
  const fresh = installerGrants(null, { user: USER, organisation: "A Firm Sàrl" });
  assert.deepEqual(said(false, fresh, "A Firm Sàrl"), [
    `  created        ${PATH} — ${USER}: Run, Manage, access to everything`,
    '                 organisation "A Firm Sàrl", filed there — rename it there too',
  ]);
  const unnamed = installerGrants(null, { user: USER, organisation: "" });
  const unnamedLines = said(false, unnamed, "");
  assert.equal(unnamedLines.length, 2);
  assert.equal(unnamedLines[0], `  created        ${PATH} — ${USER}: Run, Manage, access to everything`);
  assert.match(unnamedLines[1], /^ {17}no organisation named yet — `[^`]*start --organisation "<name>"` files the first one$/);
  const again = installerGrants(fresh.grants, { user: USER, organisation: "A Firm Sàrl" });
  assert.deepEqual(again.changed, [], "a start that changes nothing");
  assert.deepEqual(said(true, again, "A Firm Sàrl"), [], "says nothing about a file it did not change");
});
