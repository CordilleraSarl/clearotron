// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// no-credential-rides-the-supplemental-mint.test.mjs —.
//
// `proposeSupplemental` used to take a credential as its first argument and thread it, untouched,
// into the injected `executePlan`. Every provider passed a secret in: AUTH objects (euipo,
// free-tier, uspto-local), a raw API key (clarivate, signa), a session cookie (corsearch).
//
// ── THE PART THE FILING GOT WRONG, WHICH IS WHY THIS FILE SCANS RATHER THAN TRUSTS ───────────────
//
// The issue was filed saying every `executePlan` dep discarded the value, so it "reached nothing".
// FIVE discarded it in a `(_auth, params, t)` wrapper. Corsearch passed `doExecutePlan` itself, and
// that function's first parameter is real — it forwards to `makeExecutePlan`'s `search(sessionKey,
// params, tctx)` and onto the wire. So one live cookie genuinely travelled through the shared kernel,
// and a naive drop of the parameter would have handed corsearch `params` as its auth and `tctx` as
// its params: silent for five providers, broken for the sixth. Five call sites agreeing is what a
// sixth disagreeing looks like right up until you read it.
//
// So the arms below are DISCOVERED from the directory rather than written from a list. A guard's
// subject list is exactly as complete as whoever typed it, and the provider this one would have
// missed is the provider that mattered.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MCP = join(HERE, "driver", "engine", "mcp");
const servers = () => readdirSync(MCP).filter((f) => f.endsWith("-server.mjs")).sort();
const read = (f) => readFileSync(join(MCP, f), "utf8");

/** Every `proposeSupplemental(` call in a server, with the argument text that follows it. */
function mintCalls() {
  const out = [];
  for (const f of servers()) {
    const src = read(f);
    for (const m of src.matchAll(/proposeSupplemental\(([\s\S]{0,120}?),/g))
      out.push({ file: f, first: m[1].trim(), line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

test("#1644 the population is discovered and non-empty — an empty scan would pass every arm below", () => {
  // The control. Every assertion in this file is of the form "no call does X", and a scan that found
  // no calls satisfies all of them while proving nothing.
  const all = servers();
  assert.ok(all.length >= 5, `found ${all.length} MCP server files — the directory scan is broken`);
  const calls = mintCalls();
  assert.ok(calls.length >= 4,
    `found ${calls.length} proposeSupplemental call site(s) across ${all.length} servers — the call-site `
    + "regex has stopped matching, so the offender list below would be empty for the wrong reason");
});

test("#1644 no server passes anything but the TOOL ARGS as the mint's first argument", () => {
  // THE ARM. Keyed on the mechanism — what the first argument IS — rather than on a denylist of
  // secret-looking names. A denylist passes the day someone assigns the key to a variable called
  // `ctx`, and the whole defect here was a credential wearing the name `sessionKey`.
  const offenders = mintCalls().filter((c) => c.first !== "a");
  assert.deepEqual(offenders.map((c) => `${c.file}:${c.line} passes \`${c.first}\``), [],
    "a server passes something other than the handler's own tool arguments into proposeSupplemental. "
    + "That slot used to carry a credential into the shared kernel; it takes the mint's params now.");
});

test("#1644 NO caller anywhere still passes a first argument — servers were too narrow a population", () => {
  // The server scan above answers the security question: does a credential ride the mint. It does not
  // answer the wider one, and I found that out by hand rather than from this file — a clarivate PROVIDER
  // test was still calling `proposeSupplemental("s-key", …)` and went on failing while every driver test
  // and every arm above was green. The population that matters for arity is every caller, not every
  // server, so it is discovered from the tree.
  const roots = [join(HERE, "driver"), join(HERE, "providers")];
  const files = [];
  const walk = (d) => {
    const entries = readdirSync(d, { withFileTypes: true });
    //: a loop over a DISCOVERED set asserts the set is not empty. Empty is not the passing state
    // here — git tracks no empty directory, so a directory that reads empty means this walk is reading
    // somewhere the checkout does not have, and the arms below would then scan nothing and pass.
    assert.ok(entries.length, `${d} read as empty — the tree walk is not reading the checkout`);
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(mjs|js)$/.test(e.name)) files.push(full);
    }
  };
  for (const r of roots) walk(r);
  assert.ok(files.length > 200, `walked ${files.length} source files — the tree walk is broken`);

  const callers = [], offenders = [];
  for (const f of files) {
    // THIS FILE IS EXCLUDED FROM ITS OWN CORPUS. It quotes the removed shapes verbatim in its prose —
    // `proposeSupplemental("s-key", …)`, `("COOKIE", …)` — so scanning itself reports its own
    // explanation as four offences. Same exclusion 's guard makes for the same reason.
    if (f.endsWith("no-credential-rides-the-supplemental-mint.test.mjs")) continue;
    const src = readFileSync(f, "utf8");
    if (!src.includes("proposeSupplemental(")) continue;
    for (const m of src.matchAll(/(?<!function )proposeSupplemental\(\s*([\s\S]{0,40}?)[,\n]/g)) {
      const first = m[1].trim();
      if (!first) continue;
      // A COMMENT NAMING THE OLD SHAPE IS NOT A CALL. supplemental.test.mjs records what its fixtures
      // used to pass, which is the note a future reader needs — reading it as code would force the
      // explanation out of the tree to keep the arm green.
      const line = src.slice(src.lastIndexOf("\n", m.index) + 1, src.indexOf("\n", m.index));
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      callers.push(f);
      // A call opens with the params object (`{`), the handler's args (`a`), or a named params var.
      if (!/^[{(]/.test(first) && !/^(a|params|args)$/.test(first))
        offenders.push(`${f.replace(HERE + "/", "")}: opens with \`${first}\``);
    }
  }
  assert.ok(callers.length >= 5, `found ${callers.length} caller(s) — the arity scan matched nothing`);
  assert.deepEqual(offenders, [],
    "a caller still passes something ahead of the mint's params. In production that is a credential; in "
    + "a test it is a fixture pinning the removed parameter back.");
});

test("#1644 the kernel does not ACCEPT a credential — the parameter is gone, not renamed", () => {
  // Renaming it to `auth` would document the hazard and keep it: the seventh provider still gets a
  // slot to put a secret in. The signature is the thing that makes that impossible.
  const src = readFileSync(join(MCP, "supplemental.mjs"), "utf8");
  const sig = /export async function proposeSupplemental\(([^)]*)\)/.exec(src);
  assert.ok(sig, "proposeSupplemental's signature no longer parses — this arm is reading nothing");
  const params = sig[1].split(",").map((p) => p.trim().split(/[=\s]/)[0]);
  assert.deepEqual(params, ["params", "tctx", "deps"],
    "the mint's signature changed. If a credential parameter is back, the six servers will thread a "
    + "secret into it again — that is how this got here the first time.");
  assert.doesNotMatch(src, /executePlan\(\s*[A-Za-z_$][\w$]*\s*,\s*\{ plan_path/,
    "the kernel passes a bare identifier ahead of the plan params again — the threading is back");
});

test("#1644 every executePlan dep binds (params, t) — a leading auth slot would silently misalign", () => {
  // The other half of the same contract, and the half corsearch would have failed. A dep declared
  // `(_auth, params, t)` now receives `params` in the `_auth` slot and `tctx` in the `params` slot.
  // Nothing throws: it reads a plan path off the wrong object and fails later, somewhere else.
  const bad = [];
  for (const f of servers()) {
    const src = read(f);
    for (const m of src.matchAll(/executePlan:\s*\(([^)]*)\)\s*=>/g)) {
      const first = m[1].split(",")[0]?.trim() ?? "";
      if (first !== "params") bad.push(`${f}: executePlan dep opens with \`${first}\``);
    }
    // A dep bound as a BARE function is the corsearch shape: whatever the kernel passes first lands
    // in that function's first parameter, whatever it happens to be named there.
    for (const m of src.matchAll(/executePlan:\s*([A-Za-z_$][\w$]*)\s*[,}]/g))
      bad.push(`${f}: executePlan is bound to the bare function \`${m[1]}\` — bind a closure instead, `
        + "or the kernel's argument order decides what that provider treats as auth");
  }
  assert.deepEqual(bad, [],
    "an executePlan dep does not take the mint's params first, so its arguments are shifted by one");
});

test("#1644 the ONE provider the filing missed is covered by the discovered population", () => {
  // Named explicitly, because this is the case that refuted the issue's own premise and a future
  // reader deserves to find it by name rather than by re-deriving it. Not a hardcoded subject list —
  // the arms above scan the directory; this asserts the directory really does contain it.
  assert.ok(servers().includes("corsearch-server.mjs"),
    "corsearch-server.mjs is not in the scanned population — the provider whose credential actually "
    + "reached the wire is the one this guard is no longer watching");
  const src = read("corsearch-server.mjs");
  assert.match(src, /executePlan: \(params, t\) => doExecutePlan\(COOKIE, params, t\)/,
    "corsearch no longer binds its executor in a closure, so the cookie is threaded through the kernel "
    + "again — the exact state #1644 was filed about, and the one the other five hid");
});
