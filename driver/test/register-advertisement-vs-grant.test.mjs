// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT A REGISTER SERVER ADVERTISES vs WHAT ITS STAGE GRANT ALLOWS — per provider, all six.
//
// ── WHY THE EXISTING PIN CANNOT ANSWER THIS ──────────────────────────────────────────────────────────
//
// `engine.gather.test.mjs`'s per-provider count pin reads its comparand out of the same table it is
// checking: `allowedToolsFor(["register"])` is built FROM `REGISTER_SERVERS[p].tools`, so the assertion
// is the table equalling itself. It is vacuous with respect to what the server process actually serves —
// and worse than vacuous, because a correct grant then FAILS it. On the base of this branch the signa row
// granted 2 while `signa-server.mjs` advertised 4, and that pin was defending the gap.
//
// The check that would have caught it existed for five providers and not the sixth: `corsearch server:
// handshake + 8 tools`, `clarivate … 7`, `uspto-local … 6`, `euipo … the 7 NEUTRAL tools`. Signa was the
// one provider whose advertisement was never compared to anything. Adding a sixth hand-written sibling
// would leave the seventh provider unchecked on the day it lands, so the population here is DISCOVERED
// from `REGISTER_SERVERS` — 's census form, the same move `server-tools-granted-or-stated.test.mjs`
// made after scanned two scripts by name and was blind to growth.
//
// ── WHY THE GRANT IS READ IN A SUBPROCESS ────────────────────────────────────────────────────────────
//
// `requireRegisterProvider()` reads a config object that snapshots the environment at MODULE LOAD, so
// setting `process.env.CLEAROTRON_DATABASE` in here cannot reach it — the registry documents this
// exact trap, and its first version set the variable, re-asked, got an empty answer and reported a clean
// pass. One child process per provider is the only way to ask the question honestly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { REGISTER_SERVERS } from "../engine/mcp/gather-config.mjs";


// TAIL — PINNING A PROVIDER FOR A CHILD MEANS PINNING EVERY SPELLING. `driver.config.mjs`
// resolves the register provider from the current name first, so a child that inherits
// `CLEAROTRON_DATABASE` from the operator's shell and is handed only the legacy name runs as the
// INHERITED provider — silently, for every case in the loop. Measured: `CLEAROTRON_DATABASE=clarivate
// npm test` reported clarivate's numbers under all six provider names. Derived from the table so the
// next rename carries it.
const pinProvider = (value) => Object.fromEntries(
  ["CLEAROTRON_DATABASE"].map((n) => [n, value]));

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = join(HERE, "..", "engine", "mcp");
const REPO = join(HERE, "..", "..");
const run = promisify(execFile);

/**
 * Tools a provider WITHHOLDS from a stage although its own server advertises them.
 *
 * EMPTY, and that is a STATE rather than a placeholder — every one of the six now grants exactly what it
 * serves. The shape is kept because the legitimate case exists: a tool a server can answer that we choose
 * not to hand a seat. Adding a row is how that choice gets written down; a gap with no row fails.
 *
 * A row is `"<provider>": { "<tool>": "the reason, with the probe or the ruling behind it" }`, and the
 * staleness arms below hold it to the same standard the sibling census holds `UNGRANTED_ON_PURPOSE` to:
 * a row for a tool the server stopped serving is stale, and a row for a tool that IS granted is FALSE.
 */
const WITHHELD_ON_PURPOSE = Object.freeze({});

/** The tool names a provider's server process actually advertises, over real MCP stdio. */
async function advertised(script) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(MCP, script)], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "", out = null;
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(out); };
    const timer = setTimeout(done, 8000);
    child.stdout.on("data", (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const m = JSON.parse(line);
          if (m.id === 2) { out = (m.result?.tools ?? []).map((t) => t.name).sort(); clearTimeout(timer); done(); }
        } catch { /* non-json line */ }
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
  });
}

/** The bare register tool names a `register` seat holds under one provider, resolved in a child. */
async function granted(provider) {
  const script = 'import("./driver/engine/mcp/gather-config.mjs").then(m=>console.log(JSON.stringify('
    + 'm.allowedToolsFor(["register"]).split(" ").filter(x=>x.startsWith("mcp__register__")).map(x=>x.split("__")[2]).sort())))';
  const { stdout } = await run(process.execPath, ["-e", script], { cwd: REPO, env: { ...process.env, ...pinProvider(provider) } });
  return JSON.parse(stdout.trim().split("\n").pop());
}

test("#1144 — every register provider GRANTS what its server ADVERTISES, or the gap is a written choice", async (t) => {
  const providers = Object.keys(REGISTER_SERVERS);
  assert.ok(providers.length >= 6,
    `only ${providers.length} providers in REGISTER_SERVERS — the census is sweeping a table that shrank, not passing`);

  const gaps = [];
  for (const p of providers) {
    const serves = await advertised(REGISTER_SERVERS[p].script);
    assert.ok(Array.isArray(serves) && serves.length > 0,
      `${p}: its server advertised no tools — the handshake broke, it did not find an empty server. `
      + "An absence here reads exactly like a provider that grants everything it serves.");
    const holds = new Set(await granted(p));
    const stated = WITHHELD_ON_PURPOSE[p] ?? {};
    for (const tool of serves) {
      if (holds.has(tool)) continue;
      if (stated[tool]) continue;                       // withheld, and the reason is written above
      gaps.push(`${p}: ${tool} is SERVED by ${REGISTER_SERVERS[p].script} and not granted, and no reason is stated`);
    }
    // The other direction: a grant for a tool the server does not serve is a phantom. It reads as a
    // capability in every place the grant is consulted, and fails only when a seat calls it.
    for (const tool of holds) {
      if (serves.includes(tool)) continue;
      gaps.push(`${p}: ${tool} is GRANTED and ${REGISTER_SERVERS[p].script} does not serve it — a phantom grant`);
    }
    t.diagnostic(`${p}: serves ${serves.length}, grants ${holds.size}`);
  }
  assert.deepEqual(gaps, [],
    "a register provider's advertisement and its grant disagree. Either grant the tool, stop serving it, or "
    + "add it to WITHHELD_ON_PURPOSE with the reason and the probe behind it:\n  " + gaps.join("\n  "));
});

test("…and the withheld rows cannot rot in either direction", async () => {
  // Same two arms the sibling census learned the hard way: a row for a tool nobody serves any more is
  // stale, and a row for a tool that IS granted is FALSE — and the false direction is the one that
  // short-circuits, because the loop above `continue`s on the grant before it ever reads the row.
  for (const [p, stated] of Object.entries(WITHHELD_ON_PURPOSE)) {
    assert.ok(REGISTER_SERVERS[p], `WITHHELD_ON_PURPOSE names "${p}", which is not a register provider — delete the row`);
    const serves = new Set(await advertised(REGISTER_SERVERS[p].script));
    const holds = new Set(await granted(p));
    for (const tool of Object.keys(stated)) {
      assert.ok(serves.has(tool), `${p}: ${tool} has a "withheld on purpose" row but the server no longer serves it — delete the row`);
      assert.ok(!holds.has(tool), `${p}: ${tool} carries a "withheld on purpose" row and the grant now CARRIES it — the row is false; delete it in the commit that adds the grant`);
    }
  }
});

// ── THE HEADER'S CLAIM, MADE CHECKABLE ───────────────────────────────────────────────────────────────
//
// `gather-config.mjs`'s neutral-namespace note says the point of the neutral names is that "an
// excludeTools entry or a corrective-ladder nudge cannot silently name a tool that isn't loaded".
// asks for that claim to be either derived-and-true or dropped. It is neither today: it is TRUE for three
// of the four tools the driver's composed prose actually names, and FALSE for the fourth on one provider.
//
// So it is enforced here with its one live member named, the shape `TOOL_ORDER_BACKLOG` uses: the list can
// only shrink, and a SECOND member fails CI rather than joining a whitelist.
//
// The universe is `REGISTER_TOOLS` and not a regex over the prose, because a bare `/register_[a-z_]+/`
// also matches `register_plan` — a manifest KEY in pipeline.mjs, not a tool anybody grants. A guard whose
// population includes non-tools is a guard that earns itself an ignore-list within a week.
// EMPTY, and it got here by the loop below rather than by anyone deciding it should be. Its one member
// was `signa:register_propose_supplemental` until wired the mint into signa-server.mjs, at which
// point the `!tools.includes(t)` assert declared the row false and named the commit that had to delete
// it. That is the intended end state for every row here: an excuse that outlives its defect fails.
//
// An empty allowlist proves nothing on its own — it reads identically whether the census is watching or
// broken — so the PLANT arm below re-adds a member and confirms this list can still fire.
const NAMED_BUT_UNSERVED = Object.freeze({});

/**
 * Every (provider, tool) pair the driver's prose ORDERS and that provider's server does not serve.
 *
 * Lifted out of the arm below so the PLANT can drive THIS predicate rather than a copy of it. A plant
 * that re-expresses the loop tests the copy, and the copy is not what ships.
 */
function unservedOrders(named, servers, allowlist) {
  const out = [];
  for (const [p, entry] of Object.entries(servers)) {
    for (const t of [...named].sort()) {
      if (entry.tools.includes(t)) continue;
      if (allowlist[`${p}:${t}`]) continue;
      out.push(`${p}: the driver's prose orders ${t} and ${entry.script} does not serve it`);
    }
  }
  return out;
}

test("#1144 — every register tool the driver's own prose ORDERS is served by every provider", async () => {
  const { stringLiterals } = await import("../contract-dictation.mjs");
  const { readFileSync } = await import("node:fs");
  // DERIVED as the union over the table, not exported from the module and not recited here: the union IS
  // the set of neutral names any deploy can serve, and half a derivation reads exactly like a whole one.
  const universe = [...new Set(Object.values(REGISTER_SERVERS).flatMap((e) => e.tools))].sort();
  assert.equal(universe.length, 8, `the neutral tool universe is ${universe.length}, not 8 — this arm's population moved`);

  // The composers, read as SERVED TEXT rather than as code: string literals only, so a comment naming a
  // tool is not an order and a variable holding one is not either. Same rule, same helper, as E12.
  const named = new Set();
  for (const f of ["gateway.mjs", "stages.mjs", "pipeline.mjs"]) {
    for (const lit of stringLiterals(readFileSync(join(HERE, "..", f), "utf8"))) {
      for (const t of universe) if (new RegExp(`(?<![A-Za-z0-9_])${t}(?![A-Za-z0-9_])`).test(lit.text)) named.add(t);
    }
  }
  assert.ok(named.size >= 3,
    `the driver's prose names only ${named.size} register tool(s) — the literal scan broke, it did not find `
    + "a driver that stopped ordering register work");

  const unserved = unservedOrders(named, REGISTER_SERVERS, NAMED_BUT_UNSERVED);
  assert.deepEqual(unserved, [],
    "gather-config's neutral-namespace note claims a corrective-ladder nudge cannot name a tool that is not "
    + "loaded. A new member of this list makes that claim false again:\n  " + unserved.join("\n  "));

  // …and the named member must STILL reproduce, or its excuse has outlived its defect.
  for (const key of Object.keys(NAMED_BUT_UNSERVED)) {
    const [p, t] = key.split(":");
    assert.ok(REGISTER_SERVERS[p], `NAMED_BUT_UNSERVED names provider "${p}", which no longer exists — delete the row`);
    assert.ok(named.has(t), `${key}: the driver's prose no longer names ${t} — delete the row`);
    assert.ok(!REGISTER_SERVERS[p].tools.includes(t), `${key}: ${p} now serves ${t} — the row is false; delete it in the commit that wires it`);
  }
});

test("PLANT: an EMPTY NAMED_BUT_UNSERVED still FIRES — the list shrank, the detector did not", async () => {
  // emptied the allowlist. An empty allowlist and a broken census produce the same green, and the
  // green above is now the only thing standing between a re-introduced gap and silence — so this arm
  // re-introduces one and confirms it is still seen.
  assert.deepEqual(Object.keys(NAMED_BUT_UNSERVED), [],
    "this arm is written for an empty allowlist; a member reappeared, so re-read what it excuses");

  // THE REAL TABLE, with the tool wired taken back out of signa's grant. This is the exact
  // regression the empty list has to catch: someone unwires the mint and nothing else changes.
  const named = new Set(["register_propose_supplemental"]);
  const unwired = { ...REGISTER_SERVERS, signa: { ...REGISTER_SERVERS.signa,
    tools: REGISTER_SERVERS.signa.tools.filter((t) => t !== "register_propose_supplemental") } };
  const caught = unservedOrders(named, unwired, NAMED_BUT_UNSERVED);
  assert.deepEqual(caught, ["signa: the driver's prose orders register_propose_supplemental and signa-server.mjs does not serve it"],
    "signa's grant lost the tool the driver's prose orders and the census said nothing");

  // …and it is the WIRING that silences it, not the arm being blind: same call, real table.
  assert.deepEqual(unservedOrders(named, REGISTER_SERVERS, NAMED_BUT_UNSERVED), [],
    "signa does not serve register_propose_supplemental — #1161 did not land, or gather-config lost the row");

  // The excuse path still works, so a FUTURE row is honoured rather than ignored by a stale detector.
  assert.deepEqual(unservedOrders(named, unwired, { "signa:register_propose_supplemental": "a stated reason" }), [],
    "a stated reason no longer suppresses the row — the next real gap cannot be written down");
});

test("PLANT: the census predicate detects both directions — it is a detection, not a walk", () => {
  // The green above is over a population that happens to agree. These are what make it mean something.
  const check = (serves, holds, stated = {}) => {
    const gaps = [];
    for (const t of serves) if (!holds.includes(t) && !stated[t]) gaps.push(`served-not-granted:${t}`);
    for (const t of holds) if (!serves.includes(t)) gaps.push(`granted-not-served:${t}`);
    return gaps;
  };
  assert.deepEqual(check(["a", "b", "c", "d"], ["a", "b"]), ["served-not-granted:c", "served-not-granted:d"],
    "the predicate does not detect the signa shape — served and not granted");
  assert.deepEqual(check(["a", "b"], ["a", "b", "z"]), ["granted-not-served:z"],
    "the predicate does not detect a phantom grant");
  assert.deepEqual(check(["a", "b", "c"], ["a", "b"], { c: "probed 403, withheld" }), [],
    "a stated withholding does not silence its own row");
  assert.deepEqual(check(["a", "b"], ["a", "b"]), [], "the predicate fires on a provider that agrees");
});
