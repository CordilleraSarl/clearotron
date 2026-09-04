// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — F48. Three services ran replaced configuration for forty minutes and every
// status read said healthy.
//
//     ~/.env repaired   10:51:16
//     worker            10:51:21   ← new config
//     portal            10:10:16   ← old config
//     mcp-face          10:10:16   ← old config
//     client-mcp        10:23:40   ← old config
//
// The portal had no customer store in its environment, fell back to the bundled demo roster, and
// `clearotron status` reported all four active/running throughout — because they WERE active. A process
// reads its environment once, at start, so "is it up" and "is it running the configuration on disk" are
// different questions and only the first was being asked. The only signal was a roster looking wrong in
// a screenshot, spotted by eye.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { configStaleness, stalenessWarning, minutesBehind, parseSystemdTimestamp } from "../config-staleness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATUS = readFileSync(join(HERE, "..", "..", "bin", "status.mjs"), "utf8");

// The owner's own numbers, as epochs. Wall-clock strings are what this module refuses to compare.
const CONFIG = Date.UTC(2026, 8, 4, 8, 51, 16);
const at = (h, m, s) => Date.UTC(2026, 8, 4, h, m, s);

test("2179-F48 the incident reproduces: three stale, one fresh", () => {
  const rows = configStaleness({
    configEpochMs: CONFIG,
    units: [
      { name: "worker", startedEpochMs: at(8, 51, 21) },
      { name: "portal", startedEpochMs: at(8, 10, 16) },
      { name: "mcp-face", startedEpochMs: at(8, 10, 16) },
      { name: "client-mcp", startedEpochMs: at(8, 23, 40) },
    ],
  });
  assert.deepEqual(rows.map((r) => `${r.name}:${r.state}`),
    ["worker:fresh", "portal:stale", "mcp-face:stale", "client-mcp:stale"]);
  assert.equal(minutesBehind(rows[1].behindMs), 41, "the portal was 41 minutes behind its configuration");
});

test("2179-F48 a unit started in the same millisecond as the write is NOT behind it", () => {
  // Strictly before, deliberately. An off-by-one in the other direction reports every freshly
  // restarted service as stale, and a warning that cries wolf gets ignored — which costs more than
  // the silence it replaced.
  const [same] = configStaleness({ configEpochMs: CONFIG, units: [{ name: "u", startedEpochMs: CONFIG }] });
  assert.equal(same.state, "fresh");
  const [after] = configStaleness({ configEpochMs: CONFIG, units: [{ name: "u", startedEpochMs: CONFIG + 1 }] });
  assert.equal(after.state, "fresh");
  const [before] = configStaleness({ configEpochMs: CONFIG, units: [{ name: "u", startedEpochMs: CONFIG - 1 }] });
  assert.equal(before.state, "stale");
});

test("2179-F48 an unreadable start time or config mtime is UNKNOWN, never fresh", () => {
  // The collapse this exists to undo. "We could not tell" and "it is current" are the two answers the
  // product had already merged into one, and merging them again here would rebuild the defect.
  for (const units of [[{ name: "u", startedEpochMs: null }], [{ name: "u" }]])
    assert.equal(configStaleness({ configEpochMs: CONFIG, units })[0].state, "unknown");
  assert.equal(configStaleness({ configEpochMs: null, units: [{ name: "u", startedEpochMs: at(8, 0, 0) }] })[0].state,
    "unknown", "with no config mtime there is nothing to be behind, and that is not a clean bill of health");
});

test("2179-F48 the warning names the services, how far behind, and the only thing that fixes it", () => {
  const stale = configStaleness({
    configEpochMs: CONFIG,
    units: [{ name: "portal", startedEpochMs: at(8, 10, 16) }, { name: "mcp-face", startedEpochMs: at(8, 10, 16) }],
  });
  const w = stalenessWarning(stale);
  assert.match(w, /RUNNING CONFIGURATION THAT HAS SINCE BEEN REPLACED/);
  assert.match(w, /portal, mcp-face/, "a warning that does not name them cannot be acted on");
  assert.match(w, /41 minute\(s\)/, "how long it has been wrong is the part that makes a reader look");
  // There is no reload: a process reads its environment at start, so implying a lighter option exists
  // would be a remedy that does not work.
  assert.match(w, /nothing short of a restart applies the change/);
  assert.match(w, /systemctl --user restart portal mcp-face/, "the command must be runnable as printed");
});

test("2179-F48 `status` asks the question, and reports a could-not-look as one", () => {
  assert.match(STATUS, /configStaleness\(\{/, "status must actually ask, not merely import the answer");
  assert.match(STATUS, /statSync\(ENV_FILE\)\.mtimeMs/,
    "the config's mtime is the other half of the comparison");
  assert.match(STATUS, /could not be determined/,
    "an unreadable start time must be reported, not silently treated as current");
  assert.match(STATUS, /This is not a report that they are current/,
    "and it must say so in the words that stop a reader concluding the opposite");
});

test("2179-F48 the timestamp parse is DRIVEN over systemd's three real outputs", () => {
  // Measured on systemd 255 by role-dev/Grogu, on a box with a user bus — which this session has not
  // got, and is why the parse was moved out of the shell-out and into the pure module rather than left
  // asserted by grepping status.mjs for a flag string.
  assert.equal(parseSystemdTimestamp("@1788409761"), 1788409761000,
    "the --timestamp=unix form is the one the reader actually gets");
  // THE FALLBACK THIS REPLACED WAS DEAD. Date.parse of the human form is NaN — CEST is not an
  // abbreviation Node is required to know — while the same string with UTC parses. So the old fallback
  // caught the box that needed no help and missed the only case it existed for.
  assert.equal(parseSystemdTimestamp("Thu 2026-09-03 06:29:21 CEST"), null,
    "an unparseable form is could-not-look, not a third state pretending to be a second");
  // An INACTIVE unit prints empty, not @0 — measured across six of them. @0 would have parsed to epoch
  // zero and reported every never-started unit as stale by fifty-six years, which is the cry-wolf
  // failure the strictly-before rule exists to avoid, arriving by the other door.
  for (const empty of ["", "   ", null, undefined])
    assert.equal(parseSystemdTimestamp(empty), null, `${JSON.stringify(empty)} must read as could-not-look`);
  assert.equal(parseSystemdTimestamp("@0"), 0,
    "and if systemd ever DID print @0 it is a real epoch, handled by the comparison rather than here");
});

test("2179-F48 status delegates the parse and never orders formatted times", () => {
  assert.match(STATUS, /--timestamp=unix/,
    "the @<seconds> form is the one that cannot be misread across a timezone");
  assert.match(STATUS, /parseSystemdTimestamp\(/,
    "the interpretation belongs to the pure module, where it is driven rather than grepped for");
  assert.doesNotMatch(STATUS, /Date\.parse/,
    "the dead fallback must not come back: it could not parse the only form it existed for");
  assert.doesNotMatch(STATUS, /localeCompare|toLocaleString\(\)\s*[<>]/,
    "nothing here may order formatted times: this box prints CEST and the seam inverts twice a year");
});
