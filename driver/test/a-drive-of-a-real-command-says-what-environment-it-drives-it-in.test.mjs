// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// a test that drives a real command silently gets built-in defaults.
//
// The failure is not that such a test fails. It is that it PASSES ON THE WRONG SUBJECT, and the number
// it lands on is a real address: an arm holding a free high port wrote it to its drive's `.env`, the
// file was never read, and the collision it measured was with whatever holds the BUILT-IN default on
// the machine running the suite — on a shared development box, another live install's portal.
//
// Two things are armed here and they are different questions. `drive-env.mjs` is the REMEDY, and its
// arms are about what it does. `drive-env-check.mjs` is the DETECTOR, and its arms are about what it
// can and cannot see — which matters more than usual, because a detector whose class quietly shrinks
// reads exactly like a clean tree. That happened once while this was being written: splitting a call's
// first argument on the comma turned `writeFileSync(join(home, ".config", "clearotron", ".env"), …)`
// into `join(home`, and three of the four files in the class vanished from it in silence.
import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handRunEnv, assertReadItsEnvFile } from "./drive-env.mjs";
import { firstArg, writesAnEnvLocalFile, spawnsAnEntryPoint, decides, scan, BOTH }
  from "../../scripts/drive-env-check.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");

test("the helper clears both mechanisms, and lets an arm set either back", () => {
  const base = { KEEP: "1", CLEAROTRON_NO_ENV_FILE: "1", INVOCATION_ID: "from-the-unit-above" };
  const e = handRunEnv({}, base);
  assert.equal(e.KEEP, "1", "it threw away the rest of the environment");
  for (const n of BOTH) assert.ok(!(n in e), `${n} survived, so this drive would read no .env`);
  // THE ARM MOST WORTH HAVING is the one about the service-managed path, and it needs the variable set
  // rather than cleared. A helper that forbade it would have to be worked around by every such arm.
  assert.equal(handRunEnv({ INVOCATION_ID: "deliberate" }, base).INVOCATION_ID, "deliberate");
  assert.equal(handRunEnv({ CLEAROTRON_NO_ENV_FILE: "1" }, base).CLEAROTRON_NO_ENV_FILE, "1");
  // and `undefined` removes, which is how a drive suppresses what its own shell happens to carry
  assert.ok(!("KEEP" in handRunEnv({ KEEP: undefined }, base)));
});

test("the ordering assertion says COULD NOT LOOK, in those words, before anything downstream", () => {
  // Ordering is most of the value. When CI ignored the file, the first thing to fail was a port
  // assertion reporting "the refusal named a port this arm did not hold" — true, and a symptom three
  // steps downstream of a drive that never got its configuration.
  assert.throws(() => assertReadItsEnvFile("start: FATAL: portal cannot start — 127.0.0.1:18802 is already in use.", "/h/.env"),
    /never reached the command/,
    "a drive that read nothing was allowed through to be measured on built-in defaults");
  // Both lines the loader can write are a yes. The second is the one a regex forgets.
  assert.equal(assertReadItsEnvFile("[env-local] applied 2 variables from /h/.config/clearotron/.env: A, B\n", "/h/.config/clearotron/.env"),
    "/h/.config/clearotron/.env");
  assert.equal(assertReadItsEnvFile("[env-local] /h/.env read; every variable in it was already in the environment — nothing applied\n"),
    "/h/.env");
  // and reading SOMEBODY ELSE'S file is not reading yours
  assert.throws(() => assertReadItsEnvFile("[env-local] applied 1 variable from /other/.env: A\n", "/mine/.env"),
    /not this drive's/);
});

test("the detector reads a nested call's first argument, not up to the first comma", () => {
  // THE BUG THAT SHRANK THE CLASS IN SILENCE. Every drive in this class writes the path as
  // `join(home, ".config", "clearotron", ".env")`, and a comma split reads that as `join(home`.
  const src = 'writeFileSync(join(home, ".config", "clearotron", ".env"), "A=1\\n");';
  assert.equal(firstArg(src, src.indexOf("(")), 'join(home, ".config", "clearotron", ".env")');
  const flat = 'writeFileSync(envPath, "A=1");';
  assert.equal(firstArg(flat, flat.indexOf("(")), "envPath");
  // a comma inside a string is not an argument boundary
  const str = 'writeFileSync("a,b.env", "x");';
  assert.equal(firstArg(str, str.indexOf("(")), '"a,b.env"');
});

test("the detector wants a WRITE to the file the command would read — not a mention of it", () => {
  assert.equal(writesAnEnvLocalFile('writeFileSync(join(home, ".config", "clearotron", ".env"), "A=1");'), true);
  assert.equal(writesAnEnvLocalFile('const envPath = join(REPO, ".env");\nwriteFileSync(envPath, "A=1");'), true);
  // THE PRECISION THAT KEEPS THIS FROM MANUFACTURING WORK. `start-command` names `join(REPO, ".env")`
  // three times to SNAPSHOT it, precisely so it can assert a refusal wrote nothing. A rule matching the
  // path anywhere pulled that file into the class and would have had its author neutralise variables
  // for a drive with no `.env` in the question at all.
  assert.equal(writesAnEnvLocalFile('const repoEnv = join(REPO, ".env");\nconst before = snapshot(repoEnv);'), false);
  // `~/.env` is the UNITS' EnvironmentFile. env-local never reads it, so neither mechanism reaches it.
  assert.equal(writesAnEnvLocalFile('writeFileSync(join(home, ".env"), "A=1");'), false);
});

test("a file is in the class only when it does BOTH, because either alone is not the hazard", () => {
  const writes = 'writeFileSync(join(home, ".config", "clearotron", ".env"), "A=1");';
  const spawns = 'spawnSync(process.execPath, [join(ROOT, "bin", "start.mjs")], {});';
  assert.equal(spawnsAnEntryPoint(spawns), true);
  assert.equal(spawnsAnEntryPoint('spawnSync("git", ["init"], {});'), false,
    "a `git` call counted as driving the product, which is how a blanket rule reaches 62 innocent files");
  assert.equal(spawnsAnEntryPoint(writes), false);
  assert.equal(writesAnEnvLocalFile(spawns), false);
});

test("a file decides by naming both, or by taking the helper that does", () => {
  assert.equal(decides("const env = handRunEnv({ HOME: home });"), true);
  assert.equal(decides("delete env.CLEAROTRON_NO_ENV_FILE;\ndelete env.INVOCATION_ID;"), true);
  assert.equal(decides("delete env.CLEAROTRON_NO_ENV_FILE;"), false,
    "half the question answered read as the whole of it — the CI half is the one that goes unnoticed");
  assert.equal(decides("// nothing about either"), false);
});

test("the real tree has a non-empty class, and every member of it has decided", () => {
  // AN EMPTY CLASS IS A FINDING ABOUT THE DETECTOR, not a clean bill: this suite contains drives of
  // this shape, so a run that matches none has stopped seeing its subject. The script exits 2 on that,
  // and this arm is the same statement one layer up.
  const r = scan();
  assert.ok(r.scanned > 100, `only ${r.scanned} test files were scanned — this arm is watching almost nothing`);
  assert.ok(r.inClass.length > 0,
    "no file in this suite writes a .env and drives a real command, which is false — the detector has "
    + "stopped seeing its subject");
  const undecided = r.inClass.filter((c) => !c.decided).map((c) => c.file);
  assert.deepEqual(undecided, [],
    `these drive a real command against a .env they wrote and never say what environment they drive it `
    + `in, so either mechanism would hand them built-in defaults with no error: ${undecided.join(", ")}`);
});

test("a scan that cannot see anything says so rather than passing", () => {
  const empty = scan(join(ROOT, "driver", "test"), () => "", () => []);
  assert.equal(empty.scanned, 0, "an empty directory read as files");
  assert.deepEqual(empty.inClass, [],
    "a scan of nothing produced class members, so the class is not coming from what was read");
});
