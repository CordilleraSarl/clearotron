// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a box with the services installed has ONE configuration, and it is not this one.
//
// `clearotron start` read the HAND-RUN environment (`<repo>/.env`) and answered for the SERVICE, whose
// configuration is the units' `EnvironmentFile` (`%h/.env`). Those two files are disjoint BY DESIGN —
// INSTALL.md §3 documents the first, `render-units.mjs` defaults the second, and the units set
// `CLEAROTRON_NO_ENV_FILE=1` so a checkout file cannot reach a server.
//
// So on a correctly installed box — the only kind where those files differ — `start` found no hosted
// door in the file it could see and started the passphrase door beside a service already serving
// another. Measured on the test box: the same command answered differently depending on which shell it
// was run from.
//
// Owner ruling: refuse outright. Reading the units' file instead would have made it correct and still
// wrong-shaped — two portals on one box is not a configuration anybody wants, whichever file chose it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installedUnits, SERVER_UNITS, UNIT_DIR } from "../../bin/start.mjs";
import { doorDivergence } from "../../bin/onboard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("#1925 a box carrying any shipped unit is a server, and each one is enough", () => {
  // THE POSITIVE CONTROL FIRST: a box with none of them is not a server. Without this, a predicate that
  // answered "installed" to everything would satisfy every case below and look correct.
  assert.deepEqual(installedUnits("/nowhere", () => false), [],
    "a box with no units is not a server — if this reads non-empty the predicate answers yes to "
    + "everything and nothing below means anything");

  for (const unit of SERVER_UNITS) {
    assert.deepEqual(installedUnits("/units", (p) => p.endsWith(unit)), [unit],
      `${unit} alone must make this box a server — a door unit is enough, and so is the drain`);
  }
  assert.equal(installedUnits("/units", () => true).length, SERVER_UNITS.length, "all of them, named");
});

test("#1925 the check reads FILES, not systemd — a stopped service is still a server", () => {
  // Asking `systemctl` would make this command's answer depend on whether a service happened to be
  // RUNNING. A unit that is installed but stopped still means this box's configuration lives in an
  // EnvironmentFile, and an answer that moves with a service's state is the shape that caused the
  // original defect: the same command, two answers, depending on something the operator cannot see.
  const src = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  const fn = src.slice(src.indexOf("export function installedUnits"), src.indexOf("export function installedUnits") + 400);
  assert.doesNotMatch(fn, /systemctl|spawnSync|execFile/,
    "installedUnits must not ask systemd — file presence is the question, and it is one fewer subprocess "
    + "in a command that is about to spawn two");
});

test("#1925 start CONSULTS it before it decides anything, and names what it found", () => {
  // The arms above drive the predicate; this holds the WIRING, because a helper nothing calls is the
  // failure this repository keeps finding. The refusal must also come BEFORE the PORTAL_AUTH_MODE check
  // — that one reads the hand-run environment, which is exactly the reading this issue is about.
  const src = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  const call = src.indexOf("const installed = installedUnits();");
  const mode = src.indexOf('const declaredMode = (process.env.PORTAL_AUTH_MODE');
  assert.ok(call > 0, "start must consult it at all");
  assert.ok(mode > 0 && call < mode,
    "the server check must run BEFORE the PORTAL_AUTH_MODE check, which reads the hand-run environment "
    + "— the very reading that answered for the service and got it wrong");
  // Matched on the WORDS, not on how the string literal happens to be wrapped: an assertion that
  // depends on where a concatenation breaks reds on a reflow and teaches people to delete it.
  assert.match(src, /would start a second/, "the refusal must say WHY, not just no");
  assert.match(src, /portal beside the first/,
    "an operator told only 'refused' goes looking for a flag to override it; one told what would happen "
    + "goes and looks at the services");
  assert.match(src, /systemctl --user status/, "and must point at the services it found, since that is "
    + "what the operator actually wants");
});

// ──, criterion 3 — doctor reports a DIVERGENCE, not a second file ────────────────
//
// The issue first asked doctor to report that a second env file exists. That is the ordinary case on a
// server box: the checkout's `.env` is the hand-run configuration and the units' `%h/.env` is the
// server's, they are disjoint BY DESIGN, and reporting their existence would flag every correctly set
// up machine. Reworded after reading INSTALL.md and `render-units.mjs`: the finding is that the two
// files name a DIFFERENT DOOR.
test("#1925 a door value that differs between the two files is reported, by name and by both values", () => {
  const repo = 'PORTAL_AUTH_MODE=local\nCLEAROTRON_REPORTS_DIR=/home/dev/pool\n';
  const home = 'PORTAL_AUTH_MODE=auth-proxy\nCLEAROTRON_REPORTS_DIR=/srv/archive\n';
  const d = doorDivergence({ repoText: repo, homeText: home });
  assert.deepEqual(d, [{ key: "PORTAL_AUTH_MODE", checkout: "local", units: "auth-proxy" }],
    "the door differs and must be named; CLEAROTRON_REPORTS_DIR also differs and must NOT be, because "
    + "those two files are supposed to disagree about paths");
});

test("#1925 absence is not divergence, and one file alone says nothing", () => {
  // A key set in one file and absent from the other is not a disagreement: absence means "this file
  // does not decide that", and systemd's EnvironmentFile only overrides keys it actually sets.
  // Reporting those would flag every correctly-split pair on every box — noise that gets the whole
  // check switched off.
  assert.deepEqual(doorDivergence({ repoText: "PORTAL_AUTH_MODE=local\n", homeText: "CF_ACCESS_TEAM=t\n" }), []);
  assert.deepEqual(doorDivergence({ repoText: "PORTAL_AUTH_MODE=local\n", homeText: null }), [],
    "one file is the ordinary case and is not a finding");
  assert.deepEqual(doorDivergence({ repoText: null, homeText: "PORTAL_AUTH_MODE=local\n" }), []);
  // And identical values are agreement, not a difference.
  assert.deepEqual(doorDivergence({ repoText: "CF_ACCESS_TEAM=x\n", homeText: "CF_ACCESS_TEAM=x\n" }), []);
});

test("#1925 doctor CONSULTS it, and the reader is told which file the services actually use", () => {
  const src = readFileSync(join(ROOT, "bin", "onboard.mjs"), "utf8");
  assert.match(src, /doorDivergence\(\{/, "doctor must call it — a predicate nothing calls is this "
    + "repository's most-found defect");
  assert.match(src, /the second is what the/,
    "and must say which file the SERVICES run with; 'they differ' leaves the operator to guess which "
    + "one is the one that matters");
  // ONE READER, NOT A SECOND COPY: the parser is imported from render-units, which is what actually
  // renders the units systemd reads. Two KEY=value parsers drift, and they drift silently.
  assert.match(src, /import \{ parseEnvFile \} from "\.\.\/driver\/systemd\/render-units\.mjs"/,
    "the env parser must be the one the unit renderer uses");
});
