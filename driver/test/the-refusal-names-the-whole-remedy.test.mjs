// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — spawns the real `doctor` command three times; the portal is driven in-process
//
// THE REFUSAL NAMES THE WHOLE REMEDY FOR HOW THIS MACHINE RUNS THE PRODUCT.
//
// An install that cannot search refuses an order, and the person who runs it was told to run setup. On a
// machine with background services that was not enough: the services read their own file, which setup does not
// write, and a background start adds a line that file lacks but never replaces one, an empty one included. On a
// machine without them, the foreground `clearotron start` that runs the portal reads its settings once, when it
// starts. The owner's words now give each machine its whole remedy, and everyone else keeps the requester's
// sentence.
//
// Each machine is planted in a throwaway home: unit files where systemd's user units live, and the services'
// settings file beside them. The portal is driven through its own refusal path, the review of an order, as the
// person who runs the install and as a client. Doctor is spawned with and without a running start on record.
// Nothing here reads the real `~/.config/systemd`, starts a service or runs an engine. Invented names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { makePortalService } from "../portal-service.mjs";
import { runTables } from "../order-tables.mjs";
import { REGISTER_ENV, orderTimeRefusal } from "../run-requirements.mjs";
import { SERVER_INSTALL_SET } from "../../shared/server-units.mjs";
import { SERVER_UNITS } from "../../bin/start.mjs";
import { handRunEnv } from "./drive-env.mjs";
import { doctorRepoRoot } from "./helpers/portal-bundle.mjs";

// A namespace, not a named import, so a portal without its own refusal path falls back to what it asked before:
// the runner's question alone. Each test then fails on the words that portal shows, not on a missing name.
const portal = await import("../portal-service.mjs");
const refusalOf = portal.portalOrderRefusal ?? (({ env, tables }) => orderTimeRefusal(env, tables));

const GRANTS = { tenants: { celta: { accounts: ["generic", "zephyr"], users: { "cli@celta.example": ["zephyr"] } } },
  people: { "staff@example-firm.com": { run: true, manage: true, everything: true }, "cli@celta.example": { run: true } } };
const OPERATOR = { email: "staff@example-firm.com" };   // sees everything: the person who runs the install
const CLIENT = { email: "cli@celta.example" };            // runs searches for one company, and sees nothing else
const ORDER = { account: "generic", markName: "QUILLBRAE", classes: [9], product: "global-preliminary-search", geography: { mode: "worldwide" } };
const REQUESTER = "This installation is not configured to run searches yet. Nothing has been searched and nothing has been "
  + "charged. Please contact whoever administers it.";
// An install that has chosen neither an AI nor a register, in the owner's phrases.
const MISSING = "no AI is chosen and no register is chosen";
const NOTHING_SPENT = "Nothing has been searched and nothing has been charged.";
// A server unit the product does not manage: the detector names it, and a background start refuses over it.
const FOREIGN = SERVER_UNITS.filter((u) => !SERVER_INSTALL_SET.includes(u));

/** A throwaway machine: `units` installed as user units, and `servicesFile` the text of the file they read. */
function machine({ units = [], servicesFile = null } = {}) {
  const home = mkdtempSync(join(tmpdir(), "refusal-remedy-"));
  if (units.length) {
    const dir = join(home, ".config", "systemd", "user");
    mkdirSync(dir, { recursive: true });
    for (const u of units) writeFileSync(join(dir, u), "[Service]\nType=simple\nEnvironmentFile=%h/.env\nExecStart=/bin/true\n");
  }
  if (servicesFile !== null) writeFileSync(join(home, ".env"), servicesFile);
  return home;
}

// The install's own folder, apart from the home, so the settings resolver finds no older file inside it.
const REPO_ROOT = mkdtempSync(join(tmpdir(), "refusal-remedy-install-"));

/** What the portal's review answers the order with, for `principal`, on the machine planted at `home`. */
async function reviewed(home, principal) {
  const svc = makePortalService({ secret: "s".repeat(32), grants: GRANTS, audit: () => {},
    trigger: async (job) => ({ ok: true, id: job.id }),
    orderRefusal: async () => refusalOf({ env: {}, tables: await runTables(), home, repoRoot: REPO_ROOT }) });
  // A client orders for the one company it is granted; the person who runs the install, for any.
  const plan = await svc.route("POST", "/portal/api/run/plan", principal, principal === CLIENT ? { ...ORDER, account: "zephyr" } : ORDER);
  assert.equal(plan.status, 409, JSON.stringify(plan.json));
  assert.equal(plan.json.code, "not_configured");
  return plan.json;
}

const servicesRead = (home) => `Its background services read their settings from ${join(home, ".env")}.`;
const FORMS = {
  setupAndBackgroundStart: (home) => `This install cannot run a search yet: ${MISSING}. ${servicesRead(home)} Run \`clearotron install\` `
    + "in a terminal to set it up, then `clearotron start --background`: it adds the missing lines to that file and restarts the "
    + `services. ${NOTHING_SPENT}`,
  bothFiles: (home, units) => `This install cannot run a search yet: ${MISSING}. ${servicesRead(home)} \`clearotron start --background\` `
    + "only adds a setting that file has no line for; it never replaces one. Set each missing setting in that file and in "
    + `${join(home, ".config", "clearotron", ".env")}, then restart the services: \`systemctl --user restart ${units.join(" ")}\`. `
    + `\`clearotron doctor\` names each setting. ${NOTHING_SPENT}`,
  startAgain: () => `This install cannot run a search yet: ${MISSING}. Run \`clearotron install\` in a terminal to set it up, then `
    + `stop \`clearotron start\` with Ctrl-C and run it again: it reads the settings setup writes when it starts. ${NOTHING_SPENT}`,
};

test("a machine without background services is told to run setup, then stop the start and run it again", async () => {
  const home = machine();
  try {
    assert.deepEqual((await reviewed(home, OPERATOR)).errors, [FORMS.startAgain()]);
    assert.deepEqual((await reviewed(home, CLIENT)).errors, [REQUESTER], "the requester's sentence changed");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("services whose file has no line yet for what is missing are sent to setup and a background start", async () => {
  // No file at all is the plainest "no line": a background start writes it.
  for (const servicesFile of [null, "# kept by the operator\nPORTAL_LOCAL_USER=staff\n"]) {
    const home = machine({ units: SERVER_INSTALL_SET, servicesFile });
    try {
      assert.deepEqual((await reviewed(home, OPERATOR)).errors, [FORMS.setupAndBackgroundStart(home)], `file: ${servicesFile}`);
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});

test("an empty line for a missing setting, which a background start keeps, sends the reader to both files", async () => {
  const home = machine({ units: SERVER_INSTALL_SET, servicesFile: `${REGISTER_ENV}=\n` });
  try {
    assert.deepEqual((await reviewed(home, OPERATOR)).errors, [FORMS.bothFiles(home, SERVER_INSTALL_SET)]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a server unit the product does not manage, which a background start refuses over, also gets both files", async () => {
  assert.ok(FOREIGN.length, "the detector names no unit the product does not manage, so this machine cannot be planted");
  const units = [...SERVER_INSTALL_SET, ...FOREIGN];
  const home = machine({ units });
  try {
    assert.deepEqual((await reviewed(home, OPERATOR)).errors, [FORMS.bothFiles(home, units)]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("no form shows the browser a setting's name, and the requester keeps their sentence on every machine", async () => {
  const machines = [
    { home: machine(), form: "then stop `clearotron start` with Ctrl-C" },
    { home: machine({ units: SERVER_INSTALL_SET }), form: "then `clearotron start --background`: it adds the missing lines" },
    { home: machine({ units: SERVER_INSTALL_SET, servicesFile: `${REGISTER_ENV}=\n` }), form: "Set each missing setting in that file" },
  ];
  try {
    for (const { home, form } of machines) {
      // The planted paths are taken out first: a folder name is not a setting, whatever its letters.
      const body = JSON.stringify(await reviewed(home, OPERATOR)).split(home).join("<home>").split(REPO_ROOT).join("<install>");
      assert.ok(body.includes(form), `this machine's form was not shown: ${body}`);
      assert.doesNotMatch(body, /CLEAROTRON_|PORTAL_/, `a setting's name reached the browser: ${body}`);
      assert.doesNotMatch(body, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, `a variable-shaped name reached the browser: ${body}`);
      assert.deepEqual((await reviewed(home, CLIENT)).errors, [REQUESTER]);
    }
  } finally { for (const { home } of machines) rmSync(home, { recursive: true, force: true }); }
});

// ── DOCTOR'S OPENING SHARES THE SENTENCE, AND SAYS TO RUN `start` AGAIN ONLY WHILE ONE RUNS ─────────────────

const ROOT = doctorRepoRoot();
const NODE_DIR = (() => {
  const d = mkdtempSync(join(tmpdir(), "refusal-remedy-node-"));
  symlinkSync(process.execPath, join(d, process.platform === "win32" ? "node.exe" : "node"));
  return d;
})();

function doctor(home) {
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), "doctor"], {
    cwd: ROOT, encoding: "utf8", timeout: 120_000,
    env: handRunEnv({ PATH: [NODE_DIR, "/usr/bin", "/bin"].join(delimiter), HOME: home, USERPROFILE: home,
      CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" }, {}),
  });
  if (r.error || r.signal) throw new Error(`doctor did not come back (signal=${r.signal} error=${r.error?.message})`);
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const lines = out.split("\n");
  const title = lines.indexOf("  Trademark clearance engine — configuration check");
  const install = out.match(/re-run `([^`]+)` to set it/)?.[1];
  assert.ok(title >= 0 && install, `doctor printed no title or no setup command:\n${out}`);
  return { lead: lines.slice(title + 1).find((l) => l.trim()), install, out };
}

/** A running start on record in `home`, as `clearotron start` leaves one: this test's own live process. */
function startOnRecord(home, { demo }) {
  const dir = join(home, ".config", "clearotron", "running");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, demo, base: home,
    url: "http://127.0.0.1:9", host: "127.0.0.1", ports: { portal: 9, mcp: 10, client: 11 } }));
}

test("doctor's opening says to run the start again only while a foreground start, not a demo, is running", () => {
  const home = machine();
  try {
    const none = doctor(home);
    assert.equal(none.lead, `  This install cannot run a search yet: ${MISSING}. Run \`${none.install}\` in a terminal to set it up.`, none.out);
    startOnRecord(home, { demo: false });
    const running = doctor(home);
    assert.equal(running.lead, `  This install cannot run a search yet: ${MISSING}. Run \`${running.install}\` in a terminal to set it up, `
      + "then stop `clearotron start` with Ctrl-C and run it again: it reads the settings setup writes when it starts.", running.out);
    rmSync(join(home, ".config", "clearotron", "running"), { recursive: true, force: true });
    startOnRecord(home, { demo: true });
    const demo = doctor(home);
    assert.equal(demo.lead, none.lead, "a demo's start reads no install's settings, so it is not one to run again");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
