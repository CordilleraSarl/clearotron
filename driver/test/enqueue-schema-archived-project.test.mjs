// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The ADMISSION clarify for an archived project — the analogue of search-policy's "saved search is
// archived — un-archive it or name a built-in level".
//
// Its own file because it needs its own profiles STORE: profiles.mjs freezes PROFILE_DIR from
// CLEAROTRON_CUSTOMERS_DIR at module load, so the env must be set before enqueue-schema.mjs is imported and
// ESM hoisting rules out doing that in the main enqueue-schema test file (which reads the shipped store).
//
// Why the atClaim distinction exists: validateJob also runs AT CLAIM (runner.mjs), where an error reaches
// failAtIntake and parks the job as .failed with a notification. Applying the archived rule there would
// destroy work that was legitimately accepted before the project was archived — possibly days earlier.
// Archive means "stop offering this", not "cancel what is already agreed", so the rule is intake-only and
// the claim path records a warning instead. Nothing is mis-scoped by that: resolveEffectiveProfile still
// resolves an archived overlay (pinned in profiles.test.mjs), so the run gets the configuration it was
// admitted under.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const dir = mkdtempSync(join(tmpdir(), "enqueue-archived-"));
writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
writeFileSync(join(dir, "acme.json"), JSON.stringify({ name: "Acme Industrial", matchDomains: ["acme.example"], platforms: ["alibaba.com"] }));
mkdirSync(join(dir, "projects", "acme"), { recursive: true });
writeFileSync(join(dir, "projects", "acme", "live-one.json"), JSON.stringify({ projectName: "Live one", platforms: ["amazon.com"] }));
writeFileSync(join(dir, "projects", "acme", "retired-one.json"), JSON.stringify({ archived: true, projectName: "Retired one", platforms: ["walmart.com"] }));
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", dir);

const FULL = { id: "msg-1", msgId: "<msg-1@x>", forwarder: "staff-a", ref: "TMP9001", markName: "QUEUE PROBE", classes: [9] };
let validateJob;
before(async () => { ({ validateJob } = await import("../enqueue-schema.mjs")); });

test("admission: a job naming an ARCHIVED project clarifies — and says archived, not unknown", () => {
  const v = validateJob({ ...FULL, profileKey: "acme", projectKey: "retired-one" });
  assert.equal(v.classify, "clarify", "a new job cannot name an archived project");
  assert.match(v.errors.join(" "), /is archived/, "the message names the real reason");
  // ARCHIVED and UNKNOWN are deliberately different answers: "no known project" would send someone
  // hunting for a typo that is not there, when the project exists and just is not offered any more.
  assert.ok(!/no known project/.test(v.errors.join(" ")), "an archived project is not reported as a typo");
  assert.match(v.errors.join(" "), /un-archive the project/, "and it says how to proceed");
});

test("AT CLAIM: archiving does NOT kill a job that was already queued", () => {
  // The scenario: a job for retired-one is accepted and sits in the queue; staff then archive the
  // project; the runner picks the job up. Before this distinction existed, the re-validation at claim
  // returned the admission error, which routes to failAtIntake — the job parked as .failed and the
  // requester was notified, for work they had legitimately requested while the project was live.
  const v = validateJob({ ...FULL, profileKey: "acme", projectKey: "retired-one" }, { atClaim: true });
  assert.equal(v.ok, true, "an accepted job survives its project being archived under it");
  assert.equal(v.classify, "run");
  assert.ok(!v.errors.some((e) => /archived/.test(e)), "archived is not an error on the claim path");
  // Visible rather than silent: the run log carries why this was allowed through.
  assert.match(v.warnings.join(" "), /archived after this job was queued/);
  assert.match(v.warnings.join(" "), /does not cancel accepted work/);
});

test("AT CLAIM: a genuinely unknown project still parks, because that manifest cannot run", () => {
  // atClaim relaxes the ARCHIVED rule only. An unknown key means the overlay is gone entirely, so there
  // is no configuration to run under — that must still fail loudly rather than silently re-scoping.
  const v = validateJob({ ...FULL, profileKey: "acme", projectKey: "ghost" }, { atClaim: true });
  assert.equal(v.ok, false, "a vanished project is still a hard stop at claim");
  assert.match(v.errors.join(" "), /no known project/);
});

test("admission: the live sibling still runs, and an unknown key still reads as unknown", () => {
  assert.equal(validateJob({ ...FULL, profileKey: "acme", projectKey: "live-one" }).classify, "run");
  const ghost = validateJob({ ...FULL, profileKey: "acme", projectKey: "no-such-project" });
  assert.equal(ghost.classify, "clarify");
  assert.match(ghost.errors.join(" "), /no known project under this customer/, "the unknown-key clarify is unchanged");
});
