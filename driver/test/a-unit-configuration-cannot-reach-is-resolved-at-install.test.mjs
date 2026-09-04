// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// / 1876 — THREE UNITS CARRY A LITERAL CONFIGURATION CANNOT REACH.
//
// Owner ruling 2026-08-25, option B: the installer writes resolved copies into ~/.config/systemd/user/
// and the tracked units stay generic. `render-units.mjs` is that installer step; these arms are what
// stop it from becoming the thing it replaced — a mechanism somebody has to remember.
//
// The three, and why none takes the mechanism the other units use:
//   · prelim-driver.path            a .path unit cannot read an environment variable AT ALL
//   · profile-service.service       loads no EnvironmentFile on purpose — one would shadow the CF AUD
//   · courtlistener-mcp.service     loads none for the same class of reason — its PATH
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { UNIT_INVENTORY } from "../unit-inventory.mjs";
// — the fixture builds its placeholder name from the alias table rather than
// typing it. A literal here is a spelling, and a spelling goes stale the day the table re-keys it —
// silently, because a fixture that names the wrong variable still renders, it just proves nothing.
import { trackedUnits, unitsNeedingRender, placeholdersIn, renderUnit, resolveValues, parseEnvFile, directiveText }
  from "../systemd/render-units.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── THE AGREEMENT, IN BOTH DIRECTIONS ────────────────────────────────────────────────────────────
test("1876: every unit that needs rendering is declared, and everything declared needs rendering", () => {
  const needing = new Set(unitsNeedingRender(ROOT).map((u) => u.name));
  const declared = new Set(UNIT_INVENTORY.flatMap((e) => e.resolved ?? []));

  const undeclared = [...needing].filter((n) => !declared.has(n));
  assert.deepEqual(undeclared, [],
    "a tracked unit carries a placeholder and the inventory does not know it. The installer would "
    + "render it and no inventory reader would expect the copy — the undeclared-unit shape this "
    + "inventory exists to make impossible, one level down.");

  const stale = [...declared].filter((n) => !needing.has(n));
  assert.deepEqual(stale, [],
    "the inventory declares a unit as resolved and the file carries no placeholder. A declaration that "
    + "outlives its reason is how the next reader learns to distrust the whole field.");

  // TWO, NOT THREE SINCE. `profile-service.service` was the third: it carried
  // `@CLEAROTRON_CHECKOUT_DIR@` because it loaded no EnvironmentFile and so had no `${VAR}` for systemd
  // to expand. The owner's one-config-per-server-box ruling gave it `EnvironmentFile=%h/.env` like every
  // other service, which turns that path into an ordinary systemd expansion and leaves no placeholder.
  //
  // THE NUMBER IS FROZEN ON PURPOSE and lowering it is the loosening this comment exists to justify: a
  // unit that stops needing rendering must do so because its configuration got SIMPLER, never because
  // someone deleted a placeholder that was carrying a real value. What changed here is where the value
  // comes from, and that is checked by the two set comparisons above, which still hold in both
  // directions.
  const RENDERED = ["courtlistener-mcp.service", "prelim-driver.path"];   // sorted, to compare against a sorted set
  assert.deepEqual([...needing].sort(), RENDERED,
    `expected exactly ${RENDERED.join(" and ")}, saw ${[...needing].sort().join(", ")}. A NEW name here `
    + "is a unit that cannot be synced verbatim; a MISSING one is a placeholder that stopped being "
    + "required, and only the second is ever good news.");
});

// ── THE DEFECT THE TOOL FOUND ON ITS OWN FIRST RUN ───────────────────────────────────────────────
test("1876: a placeholder in a COMMENT does not demand a value", () => {
  // profile-service.service explains the convention in prose. The first cut of the scanner read the
  // `@NAME@` in that sentence as a required value, so a unit that DOCUMENTED the mechanism could not be
  // rendered. Found by running the tool, not by an arm — which is why there is now an arm.
  const unit = [
    "# an unsubstituted @NAME@ reaches systemd verbatim, which is the point",
    "[Service]",
    "ExecStart=/usr/bin/node @CLEAROTRON_CHECKOUT_DIR@/x.mjs",
  ].join("\n");
  assert.deepEqual(placeholdersIn(unit), ["CLEAROTRON_CHECKOUT_DIR"],
    "only the directive placeholder is required");
  assert.deepEqual(placeholdersIn(unit, { includeComments: true }).sort(), ["CLEAROTRON_CHECKOUT_DIR", "NAME"],
    "…and the comment one is still VISIBLE, so the substitution pass can rewrite it");

  // It renders with only the directive value supplied — the comment must not block it.
  const out = renderUnit(unit, { CLEAROTRON_CHECKOUT_DIR: "/srv/app" });
  assert.match(out, /ExecStart=\/usr\/bin\/node \/srv\/app\/x\.mjs/);
  assert.match(out, /@NAME@/, "an unresolvable comment placeholder is left as written rather than blanked");
});

// ── REFUSE, NEVER PARTIAL ────────────────────────────────────────────────────────────────────────
test("1876: a missing value refuses the whole unit — a half-resolved unit starts and misbehaves", () => {
  const CHECKOUT = "CLEAROTRON_CHECKOUT_DIR";
  const WORK = "CLEAROTRON_WORK_DIR";
  const unit = `[Service]\nExecStart=/usr/bin/node @${CHECKOUT}@/x.mjs\nWorkingDirectory=@${WORK}@\n`;
  assert.throws(() => renderUnit(unit, { [CHECKOUT]: "/srv/app" }),
    new RegExp(`unresolved placeholder\\(s\\): ${WORK}`),
    "one missing value must refuse the file, not write the other one and leave a literal behind");
  // The control: with both, it renders and NOTHING of the placeholder syntax survives.
  const ok = renderUnit(unit, { [CHECKOUT]: "/srv/app", [WORK]: "/srv/work" });
  assert.doesNotMatch(ok, /@[A-Z]/, "a rendered unit carries no placeholder at all");
});

// ── AN ABSENCE IS A FINDING ──────────────────────────────────────────────────────────────────────
test("1876: values are read from the environment file the units themselves load", () => {
  const dir = mkdtempSync(join(tmpdir(), "render-units-"));
  const envFile = join(dir, ".env");
  writeFileSync(envFile, 'CLEAROTRON_CHECKOUT_DIR="/srv/app"\n# a comment\nexport CLEAROTRON_WORK_DIR=/srv/work\n');
  const parsed = parseEnvFile(readFileSync(envFile, "utf8"));
  assert.equal(parsed.CLEAROTRON_CHECKOUT_DIR, "/srv/app", "quotes are stripped — operators write them");
  assert.equal(parsed.CLEAROTRON_WORK_DIR, "/srv/work", "`export` is accepted — operators write that too");

  const { values, missing } = resolveValues(["CLEAROTRON_CHECKOUT_DIR", "ABSENT_ON_PURPOSE"], { env: {}, envFile });
  assert.equal(values.CLEAROTRON_CHECKOUT_DIR, "/srv/app");
  assert.deepEqual(missing, ["ABSENT_ON_PURPOSE"],
    "an unset value is REPORTED, not defaulted — a default here would be a unit that looks configured");
  rmSync(dir, { recursive: true, force: true });
});

// ── THE CENSUS, AS A STANDING CHECK ──────────────────────────────────────────────────────────────
test("1863: no tracked unit names the directory the working home was cut from", () => {
  // The config STORE is a different repository whose name did not change; four correct lines in
  // profile-service.service name it, and a check that matched the bare string would have condemned
  // them. Reading a count instead of the lines is exactly the mistake this arm is written against.
  // DIRECTIVES ONLY, for the same reason the placeholder scan reads directives only: a comment that
  // explains why the name changed legitimately contains the old name, and a check that condemned prose
  // would make the history unwritable. This arm fired on its own first run against exactly such a
  // comment — the one in profile-service.service explaining the 2026-08-24 cut.
  const offenders = trackedUnits(ROOT)
    .map((u) => ({ rel: u.rel, hits: directiveText(u.text).split("\n").filter((l) => /cordillera\.ch-trademark(?!-config)/.test(l)) }))
    .filter((u) => u.hits.length);
  assert.deepEqual(offenders, [],
    "a shipped unit still names the old checkout directory. After a documented install that directory "
    + "does not exist, so the unit fails exactly as #1849 did.");
});
