// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-register-probe-reads-the-install-env-file.test.mjs — `doctor --probe-providers` probes what this
// install is configured for: the environment first, the install's env file behind it.
//
// Driven through the real command with a scratch HOME, so the env file is the one doctor reads and no
// developer's own settings reach the child. The provider is the local US index, so nothing here goes
// over the network or spends anything: an empty file stands in for an index nobody synced, and the
// provider's refusal names the path it was handed, which is what shows which value reached the call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { handRunEnv } from "./drive-env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Run `doctor --probe-providers` and return its register-probe section. `dotenv` is written where
 *  doctor reads the install's env file; `env` is the whole of the child's environment beyond PATH/HOME. */
function probe({ env = {}, dotenv = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), "probe-home-"));
  try {
    const index = (name) => { const p = join(home, name); writeFileSync(p, ""); return p; };
    const resolveIn = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "function" ? v(index) : v]));
    const file = resolveIn(dotenv), vars = resolveIn(env);
    mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
    writeFileSync(join(home, ".config", "clearotron", ".env"), Object.entries(file).map(([k, v]) => `${k}=${v}\n`).join(""));
    const r = spawnSync(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), "doctor", "--probe-providers"],
      { cwd: ROOT, encoding: "utf8", timeout: 120000,
        // Built on PATH alone, so none of the suite's own variables reaches the child — its register
        // choice above all — and handRunEnv keeps out the two that would make it ignore this drive's file.
        env: handRunEnv({ HOME: home, CLEAROTRON_DOCTOR_ASSUME_PINNED: "1", ...vars }, { PATH: "/usr/bin:/bin" }) });
    // The spawn's own fate before its text means anything: a child that never came back prints nothing.
    if (r.error || r.signal) throw new Error(`the child did not come back (signal=${r.signal} error=${r.error?.message}) — a could-not-look, not a verdict`);
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const from = out.indexOf("Register lane — proven");
    assert.ok(from >= 0, `doctor printed no register probe at all:\n${out.slice(-2000)}`);
    const to = out.indexOf("Where files are stored", from);
    return { section: out.slice(from, to < 0 ? undefined : to), file, vars };
  } finally { rmSync(home, { recursive: true, force: true }); }
}

test("a provider named only in the install's env file is the one the probe asks", () => {
  const { section } = probe({ dotenv: { CLEAROTRON_DATABASE: "uspto-local", USPTO_LOCAL_DB: (i) => i("file.db") } });
  assert.doesNotMatch(section, /could not be probed/,
    "the probe could not run although the env file names a provider — it asked the shell, which names none");
  assert.match(section, /Probing uspto-local/, `the probe asked some other provider:\n${section}`);
});

test("a credential kept only in the install's env file reaches the probe", () => {
  const { section, file } = probe({ env: { CLEAROTRON_DATABASE: "uspto-local" }, dotenv: { USPTO_LOCAL_DB: (i) => i("file.db") } });
  assert.doesNotMatch(section, /USPTO_LOCAL_DB absent/,
    "the probe reported the variable absent while the env file doctor itself read holds it");
  assert.ok(section.includes(file.USPTO_LOCAL_DB), `the probe was not handed the env file's index path:\n${section}`);
});

test("the environment still wins over the env file, as it does for a run", () => {
  const { section, file, vars } = probe({ env: { CLEAROTRON_DATABASE: "uspto-local", USPTO_LOCAL_DB: (i) => i("env.db") },
    dotenv: { USPTO_LOCAL_DB: (i) => i("file.db") } });
  assert.ok(section.includes(vars.USPTO_LOCAL_DB), `the probe did not use the environment's index path:\n${section}`);
  assert.ok(!section.includes(file.USPTO_LOCAL_DB), "the env file's value overrode the environment's");
});
