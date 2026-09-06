// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// drive-env.mjs — the environment a drive standing in for a HAND-RUN command must present.
//
// A test that writes a `.env` and then drives a real command is asking that command to read the file.
// Two things stop it, and a drive has to defeat both (tracker issue 204):
//
//   · `scripts/test-run.mjs` sets `CLEAROTRON_NO_ENV_FILE=1` for every child of the suite, so that no
//     test is configured by a file on the developer's box. Right on its own terms, and fatal to a test
//     whose whole subject IS a file it wrote.
//   · `INVOCATION_ID` is INHERITED by every descendant of a systemd unit, and `shared/env-local.mjs`
//     reads it as proof the process was started as a service and is configured by its EnvironmentFile.
//     A hosted CI runner's job is a descendant of the runner agent's unit — so this is set there and
//     unset on a laptop, and a drive can be green locally and red on CI for the same reason.
//
// Neither failure announces itself. The command reads no file, falls back to BUILT-IN DEFAULTS
// including default PORTS, and the arm measures something real that is not its subject: a port
// collision arm wrote a free high port into a drive's `.env` and ended up measuring whatever holds the
// built-in default on the machine running the suite, which on a shared box is another live install.
import assert from "node:assert/strict";

/**
 * A hand-run environment: this process's, minus the two things that would make the driven command
 * ignore the file the test just wrote.
 *
 * `extra` is applied AFTER the deletions, so an arm that is ABOUT one of these paths sets it back —
 * `handRunEnv({ INVOCATION_ID: "abc" })` drives the service-managed branch deliberately, which is the
 * arm most worth having and the reason this clears rather than forbids. An `undefined` value in `extra`
 * removes the name, which is how a drive suppresses a variable its own shell happens to carry.
 */
export function handRunEnv(extra = {}, base = process.env) {
  const env = { ...base };
  delete env.CLEAROTRON_NO_ENV_FILE;
  delete env.INVOCATION_ID;
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

/**
 * Did this drive's own configuration reach the command? Asked BEFORE anything downstream of it.
 *
 * ORDERING IS MOST OF THE VALUE. When CI ignored the file, the first thing to fail was a port
 * assertion, and it reported "the refusal named a port this arm did not hold" — true, and useless: a
 * symptom three steps downstream of a drive that never got its configuration. An arm that cannot see
 * its subject has to say so in those words, or the next reader debugs the wrong thing.
 *
 * Reads the loader's own line rather than inferring from behaviour, and returns the path it names so a
 * caller can assert against what the process READ instead of a path the test composed.
 */
export function assertReadItsEnvFile(said, envFile) {
  // BOTH LINES THE LOADER CAN WRITE. It says "applied N variables from <path>:" when it changed
  // something and "<path> read; every variable in it was already in the environment" when it did not —
  // and the second is a yes. A regex that knew only the first would call a correctly-read file a
  // could-not-look on any drive whose values were already in its environment.
  const loader = /\[env-local\] applied \d+ variables? from (\S+):/.exec(said)
    ?? /\[env-local\] (\S+) read; every variable in it/.exec(said);
  assert.ok(loader,
    `this drive's .env never reached the command, so nothing downstream of it could be measured — every `
    + `value the command used is a BUILT-IN DEFAULT, ports included:\n${String(said).slice(0, 900)}`);
  if (envFile) assert.equal(loader[1], envFile, "the command read an env file, but not this drive's");
  return loader[1];
}
