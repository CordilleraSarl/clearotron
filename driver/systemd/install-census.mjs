// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// install-census.mjs — what the shipped units refuse to start without, DERIVED rather than listed.
//
// ── why this exists ─────────────────────────────────────────────────────────────
//
// Tracker issue 122 named a family rather than a bug: four values this product needs are each written
// by exactly one command, and for three of them that command is not the documented install. A box built
// strictly from the document therefore came up with correct units, correct code, and a value nothing
// ever set — and each one failed as something else. A 502 on submit. An empty screen. A door that would
// not enable. Three lanes hit three instances in one day without recognising them as one shape.
//
// The instances are fixed. This module exists for the FIFTH one, which nobody has met yet. Its job is to
// answer, from the tree rather than from anyone's memory: what does a unit this install places refuse to
// start without?
//
// ── DERIVED, BECAUSE A HAND-KEPT CENSUS AGREES WITH ITSELF ───────────────────────────────────────────
//
// 122 asked for this in as many words: *"The census should be derivable, not a hand-kept list."* A list
// typed into a test passes on the day someone adds a sixth required value, because the list and the
// assertion are the same author. So the left-hand side is read out of the units and their entrypoints,
// and the only thing written by hand is a REASON for each value the install does not write — a claim a
// reader can check, attached to a name this file found rather than to one somebody remembered.
//
// ── HOW A VALUE IS FOUND, AND WHY THE FILTER IS A SUBTRACTION ────────────────────────────────────────
//
// A start-up refusal in this product has one recognisable voice — `FATAL:` and "refusing to start" —
// and it NAMES the value it refuses over, because it is written for an operator who has to fix it. So
// the names are the environment-shaped tokens on those lines.
//
// The filter is what took the work. Intersecting with `process.env.X` in the same file LOOKED right and
// silently dropped two real values: `CLEAROTRON_ACCESS_FILE` and `CLEAROTRON_OIDC_AUDIENCE` are read
// through `envFrom(process.env, "NAME")`, so the census went quiet about the two most load-bearing
// names in the tree while reporting a confident list. A census that stops seeing things passes.
//
// So the filter SUBTRACTS instead: every environment-shaped token on a refusal line, minus the ones the
// same file declares as its own bindings. `ALLOWED_HOSTS`, `AUTH_DISABLED`, `LOCAL_USER` and their kind
// are module constants that happen to be shouted; `PORTAL_SECRET` is not declared anywhere in the file
// that refuses over it, which is precisely what makes it environment. Subtraction cannot silently
// shrink the answer the way an allow-list can — a name it has never heard of survives.
//
// ── COULD-NOT-LOOK IS ITS OWN ANSWER ─────────────────────────────────────────────────────────────────
//
// A unit whose entrypoint cannot be resolved or read returns `names: null` and a reason, never `[]`. An
// empty list is a claim that the process requires nothing, and this repo has paid for collapsing those
// two into one answer more than once. The worker genuinely returns `[]` — `driver/runner.mjs` contains
// no `process.exit(1)` and no start-up throw at all — and that zero is worth being able to tell apart
// from a parse that failed.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_INSTALL_SET } from "../../shared/server-units.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository root, from this file's own location — never the working directory. */
export const REPO_ROOT = join(HERE, "..", "..");

// The voice of a start-up refusal in this product. "refusing to listen" is in here because two of them
// are phrased that way — a door that will not bind a reachable address has refused to start, and a
// pattern that missed it would report a door with no requirements.
const REFUSAL = /refusing to start|refuses to start|refusing to listen|FATAL:/i;

// SHOUTED AND JOINED: at least one underscore, so `FATAL`, `HTTP` and `TLS` are not names. Every
// environment variable this product reads has one.
const ENV_SHAPED = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

// What the file declares for itself. `export` is included so an exported constant is still recognised
// as this module's own rather than as something it reads from the environment.
const OWN_BINDING = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var|function|class)\s+([A-Z][A-Z0-9_]*)\b/g;

/**
 * The module a unit executes, relative to the checkout root.
 *
 * Units name their entrypoint as `${CLEAROTRON_CHECKOUT_DIR}/<path>` because systemd expands variables
 * in `ExecStart` arguments and nowhere else — the units' own comments say so. That is the shape this
 * reads, and anything else is reported rather than guessed at: a unit that starts a shell script, or
 * one whose ExecStart moved, is a thing to look at and not a thing to skip.
 */
export function entrypointOf(unitText) {
  const line = String(unitText).split("\n").find((l) => l.startsWith("ExecStart="));
  if (!line) return { rel: null, unreadable: "the unit has no ExecStart= line, so nothing says what it runs" };
  const m = /\$\{CLEAROTRON_CHECKOUT_DIR\}\/(\S+\.mjs)\b/.exec(line);
  if (!m) {
    return { rel: null,
      unreadable: `ExecStart does not name a module under \${CLEAROTRON_CHECKOUT_DIR}: ${line.slice(0, 120)}` };
  }
  return { rel: m[1], unreadable: null };
}

/**
 * Every environment value a module refuses to start without — a superset, on purpose.
 *
 * A name reaches this list by appearing in a refusal, which does not prove that its ABSENCE is what
 * refuses: some of these refuse when SET (the dev bypasses), some when set to a value that is not
 * loopback, and some are one of two alternatives where neither alone is required. Telling those apart
 * statically is not possible and guessing at it would be worse than not trying — so the caller declares
 * what supplies each one, and a superset only makes that stricter. Nothing required can hide in it.
 */
export function valuesRefusedOver(source) {
  const own = new Set([...String(source).matchAll(OWN_BINDING)].map((m) => m[1]));
  const names = new Set();
  for (const line of String(source).split("\n")) {
    // A COMMENT IS NOT A REFUSAL. This file's own prose names `PORTAL_SECRET` and "refusing to start"
    // in one paragraph; so does every module that explains its gate above the code. Reading those would
    // make the census depend on how well a file is commented.
    if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
    if (!REFUSAL.test(line)) continue;
    for (const t of line.match(ENV_SHAPED) ?? []) if (!own.has(t)) names.add(t);
  }
  return [...names].sort();
}

/**
 * The census, one row per unit the documented install places.
 *
 * `names` is `null` — never `[]` — for a unit this could not look inside, and `unreadable` says why.
 */
export function startupCensus({ root = REPO_ROOT, units = SERVER_INSTALL_SET } = {}) {
  return [...units].sort().map((unit) => {
    const unitPath = join(root, "driver", "systemd", unit);
    if (!existsSync(unitPath)) {
      return { unit, entrypoint: null, names: null, unreadable: `${unit} is named for install and is not in this tree` };
    }
    const { rel, unreadable } = entrypointOf(readFileSync(unitPath, "utf8"));
    if (unreadable) return { unit, entrypoint: null, names: null, unreadable };
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      return { unit, entrypoint: rel, names: null, unreadable: `${unit} executes ${rel}, which is not in this tree` };
    }
    return { unit, entrypoint: rel, names: valuesRefusedOver(readFileSync(abs, "utf8")), unreadable: null };
  });
}

/** Every value any placed unit refuses over, across the whole install set. */
export function everyStartupValue(census) {
  const all = new Set();
  for (const row of census) for (const n of row.names ?? []) all.add(n);
  return [...all].sort();
}
