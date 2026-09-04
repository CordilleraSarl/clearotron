// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — preflightCredentials(env) CHECKS THE ENVIRONMENT IT WAS HANDED.
//
// It takes a candidate environment and looks like it validates it. It validated the credential
// VARIABLES from that env, and resolved the PROVIDER those variables are checked against from
// `REGISTER_PROVIDER` — a module const evaluated ONCE, at first import, from the real `process.env`.
//
// Two consequences, both fail-silent, and the second is why repetition could not find it:
//
//   1. IT CHECKED THE WRONG PROVIDER. Validate `{CLEAROTRON_DATABASE: "euipo", …}` from a shell
//      holding `corsearch` and a live CORSEARCH_SESSION_KEY and it checks CORSEARCH_SESSION_KEY, finds
//      it, and returns `{provider: "corsearch"}`. A caller validating a candidate before persisting it
//      gets a pass it did not earn — and there is no error, because the wrong answer IS a pass.
//   2. IT WAS RIGHT AT MOST ONCE PER PROCESS. Even a caller that set process.env before importing got
//      one correct answer; the second call read the frozen const again.
//
// PROD-NEUTRALITY IS THE OTHER HALF and is asserted here too: no argument ⇒ the const path, byte for
// byte, including its refusal to default. Every production call site passes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { preflightCredentials, activeProvider, providerIdFrom, missingCredentials, PROVIDERS } from "../driver.config.mjs";

// A candidate environment naming a provider that is NOT this process's, with that provider's real
// credentials — the setup-wizard shape.
const euipoEnv = { CLEAROTRON_DATABASE: "euipo", EUIPO_CLIENT_ID: "id", EUIPO_CLIENT_SECRET: "secret" };

test("#634 a candidate env's PROVIDER decides which credentials are checked", () => {
  const r = preflightCredentials(euipoEnv);
  assert.equal(r.provider, "euipo",
    "THE DEFECT: this used to answer with the ambient provider, so a candidate env was never checked at all");
  assert.deepEqual(r.checked.sort(), ["EUIPO_CLIENT_ID", "EUIPO_CLIENT_SECRET"].sort(),
    "and it checks THAT provider's variables — euipo needs both halves of its OAuth pair");
});

test("#634 …so a candidate env holding the WRONG provider's key is refused, not passed", () => {
  // The exact shape the issue names: the ambient shell's corsearch key sitting in a euipo candidate.
  assert.throws(() => preflightCredentials({ CLEAROTRON_DATABASE: "euipo", CORSEARCH_SESSION_KEY: "live" }),
    /missing EUIPO_CLIENT_ID \+ EUIPO_CLIENT_SECRET for register provider "euipo"/,
    "a corsearch key cannot authorise a euipo run, and the pass it used to get was silent");
  // …and a half-filled OAuth pair is still missing, which is 's rule reaching a candidate env too
  assert.throws(() => preflightCredentials({ CLEAROTRON_DATABASE: "euipo", EUIPO_CLIENT_ID: "id" }),
    /missing EUIPO_CLIENT_SECRET/);
});

test("#634 it is right EVERY time, not once per process", () => {
  // The frozen const answered identically forever. Two different candidate environments in a row must
  // give two different answers — that is the property, and it cannot be shown by calling once.
  assert.equal(preflightCredentials(euipoEnv).provider, "euipo");
  assert.equal(preflightCredentials({ CLEAROTRON_DATABASE: "uspto-local", USPTO_LOCAL_DB: "/tmp/db" }).provider, "uspto-local");
  assert.equal(preflightCredentials(euipoEnv).provider, "euipo", "and back again — nothing is cached");
});

test("#634 PROD-NEUTRAL: no argument still takes the module const's path, refusal included", () => {
  // Every production call site passes nothing. That path is unchanged: it reads REGISTER_PROVIDER and
  // refuses when it is unset, rather than defaulting to a vendor the deployment did not choose.
  // ── TAIL — THIS ARM READ ONE SPELLING, TWICE, AND WAS WRONG BOTH TIMES ────────────────────
  //
  // changed the refusal to name the CURRENT spelling and fixed three door arms that had pinned
  // the legacy one. This is the fourth, and it was missed because it is not in the doors file. Both of
  // its reads are derived now, and its subject is untouched: no argument takes the module const's path.
  // It was never about which spelling names the provider.
  //
  //   · the BRANCH SELECTOR decides which half of the arm runs, so reading only `CLEAROTRON_*` sent a
  //     hand-run configured the documented way (`CLEAROTRON_DATABASE=euipo node --test <this file>`)
  //     into the refusal branch while `activeProvider()` correctly answered "euipo" — red on a correct
  //     engine, and red for the exact configuration this change exists to make work.
  //   · the REFUSAL PATTERN pinned `CLEAROTRON_DATABASE is not set`, which the message has not said
  //     since. Measured on origin/main: `node --test driver/test/preflight-credentials.test.mjs`
  //     with nothing set is already red here, and has been since that merge.
  const ambient = ["CLEAROTRON_DATABASE"]
    .map((n) => String(process.env[n] ?? "").trim().toLowerCase()).find(Boolean) ?? "";
  if (ambient && PROVIDERS[ambient]) {
    assert.equal(activeProvider().id, ambient, "no argument ⇒ the ambient provider, exactly as before");
  } else {
    assert.throws(() => activeProvider(), new RegExp(`CLEAROTRON_DATABASE is not set`),
      "no argument and nothing set ⇒ the same refusal as before, never a default");
  }
});

test("#634 an env that names NO provider says nothing about it — the ambient one still answers", () => {
  // THE LINE THAT KEEPS THIS PROD-NEUTRAL, and CI is what found it. My first cut REFUSED an env with no
  // provider in it, and two existing call sites pass exactly that: `{[credEnv]: "key"}`, asking about
  // the VARIABLES and saying nothing about the provider. Refusing them would have broken working
  // callers to fix a different defect. Naming no provider is not the same fact as naming a wrong one.
  assert.equal(providerIdFrom({}), null);
  assert.equal(providerIdFrom({ CLEAROTRON_DATABASE: "  " }), null, "whitespace is not a choice");
  assert.equal(providerIdFrom({ CLEAROTRON_DATABASE: "EUIPO" }), "euipo", "…and the id is normalised");
  assert.throws(() => activeProvider({ CLEAROTRON_DATABASE: "not-a-vendor" }), /unknown REGISTER_PROVIDER "not-a-vendor"/);
  // and the variables-only shape keeps working, which is what the two existing call sites do
  const { credEnv, id } = activeProvider();
  assert.equal(preflightCredentials({ [credEnv]: "a-real-looking-key" }).provider, id,
    "a variables-only candidate env is answered by the ambient provider, exactly as before");
});

test("#634 missingCredentials answers about the provider it was given", () => {
  // Its default is unchanged; what matters is that the pair travels together — a provider from one env
  // and variables from another is the defect one function over.
  assert.deepEqual(missingCredentials(PROVIDERS.euipo, { EUIPO_CLIENT_ID: "id" }), ["EUIPO_CLIENT_SECRET"]);
  assert.deepEqual(missingCredentials(PROVIDERS.euipo, euipoEnv), []);
});

// ──: SELECTING A PAID PROVIDER RUNS THAT PROVIDER, AND NEVER SILENTLY COMPOSES free-tier ───────
//
// The ruling recorded: the resolver never substitutes. A paid vendor configured IS the register
// alone — corsearch and clarivate already aggregate both offices, so a second free call buys nothing
// and would put an unchosen source in a client's evidence trail.
//
// This is pinned as an assertion because a silent substitution is invisible in the output: the run
// completes, the report reads normally, and the only trace is a provider attribution nobody checks.
test("#548 a paid provider id resolves to itself alone — no free-tier composition", () => {
  for (const paid of ["corsearch", "clarivate", "signa"]) {
    const p = PROVIDERS[paid];
    assert.equal(p.id, paid, `${paid} resolves to itself`);
    assert.equal(p.composedOf, undefined,
      `${paid} must declare NO members — a paid vendor that composed free sources would put a register `
      + `nobody chose into a client's evidence trail`);
    const env = { CLEAROTRON_DATABASE: paid };
    assert.equal(activeProvider(env).id, paid,
      `activeProvider must answer ${paid} for ${paid}, never a substitute`);
  }
  // And the one provider that IS composite says so, by name, so the distinction is declared not implied.
  assert.deepEqual(PROVIDERS["free-tier"].composedOf, ["euipo", "uspto-local"],
    "free-tier is the only composite, and it names its members");
});

// ── — a credential is not a capability ──────────────────────────────────────────────────────
//
// The door above proves the vendor will answer. It said nothing about whether the adapter can RUN a
// frozen plan, and those come apart: a provider with `recordFetch` alone resolves `planExec` to null
// and the run falls to the agent lane, which reports coverage it never searched. Asserted here as a
// REFUSAL, because the state it prevents is one where every downstream signal reads as success.

test("#1027/#1029 every registered provider can execute a plan — the door has nothing left to refuse", () => {
  // THIS TEST CHANGED SUBJECT WHEN LANDED, and the change is the point. It used to assert that
  // signa was REFUSED: it held a key and had no executor, so a run would fall to the model lane and
  // report coverage it never searched. Signa now has one, so the refusal has no subject left in the
  // registry — and the honest assertion is the invariant that leaves it with none.
  //
  // The door itself is unchanged and still enforces this. A provider added tomorrow without an
  // executePlan adapter is refused by name at the same door, before any spend; what this asserts is
  // that no such provider is currently shipped.
  const missing = Object.values(PROVIDERS).filter((p) => typeof p.executePlan !== "function").map((p) => p.id);
  assert.deepEqual(missing, [],
    `these providers would be refused at the preflight door — they hold a credential but cannot run a `
    + `frozen search plan: ${missing.join(", ")}`);
  assert.ok(Object.keys(PROVIDERS).length >= 6,
    "an empty or shrunk registry would make the line above vacuously true");
});

test("#1027 every provider that declares an executor still passes — including the free-tier composite", () => {
  // The composite is the one at risk from a naive `p.executePlan` check: it assembles its adapters
  // rather than declaring them literally, and it is the provider an open-source install actually uses.
  const capable = Object.values(PROVIDERS).filter((p) => typeof p.executePlan === "function");
  assert.ok(capable.length >= 5, `expected the five wired providers, got ${capable.length} — a shrunk list would make this vacuous`);

  for (const p of capable) {
    // Credentials are satisfied FROM THE REGISTRY, not from a literal map here — a hand-written map
    // goes stale the moment a provider gains a second required variable, and it goes stale as a
    // spurious credential failure in a test about executors.
    const env = { CLEAROTRON_DATABASE: p.id };
    for (const k of missingCredentials(p, env)) env[k] = "x";
    const r = preflightCredentials(env);
    assert.equal(r.provider, p.id);
    assert.equal(r.planExecutor, true, `${p.id}: preflight reports the executor it checked`);
  }
});

test("#1027 the refusal happens for the provider the ENV names, not the ambient one", () => {
  // 's lesson, re-asserted for the new check: a wizard validating a candidate must be told about
  // the candidate. If this resolved the ambient provider the refusal would fire on the wrong id, and
  // a caller would "fix" a provider that was never the problem.
  const r = preflightCredentials({ CLEAROTRON_DATABASE: "euipo", EUIPO_CLIENT_ID: "id", EUIPO_CLIENT_SECRET: "s" });
  assert.equal(r.provider, "euipo");
  assert.equal(r.planExecutor, true);
});
