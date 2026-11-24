// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// jx-providers.mjs — the native-language lanes' dispatch, beside the configuration they used to sit in. The configuration
// is read by the engine's own modules, so the lanes, which run a turn on the engine, live here and import it instead.
//
// ── jx providers (Phase 2b, Stage-1.5 lanes) — the same lazy-import + cred-guard idiom. ONE
// non-agentic schema-enforced completions call per mark×lane turns the mark into native-script
// register candidates; tests inject an executor, the dev instance uses CLEAROTRON_JX_FIXTURES. Knob:
//   CLEAROTRON_JX_FIXTURES                       — dir of <mark-kebab>.<lane>.json canned candidate lists
//                                              ({candidates:[{term,kind,rationale}]}) — the $0 seam
//
// ── / — THE NATIVE-LANGUAGE LANES RUN ON THE PROGRAM THE CUSTOMER CHOSE ────────────────
//
// Ruling 2026-08-20, verbatim: "one LLM provider only ever, API or auth, no mix." These three
// lanes were the mix. They POSTed to the Anthropic Messages API on `ANTHROPIC_API_KEY` at a hardcoded
// haiku tier no matter which engine the run was configured for — so round 21f9b0ad's receipt carried
// engine `openai-agent` / SUBSCRIPTION on its agentic stages and `anthropic-direct` / API-KEY on all
// eleven jx calls, and every round this project has run has mixed subscription with metered spend.
//
// They now take `engine.runTurn()`, the same door every stage uses, through `engine/jx-turn.mjs` —
// which resolves the run's billing mode first (the trap probe.mjs documents) and reports the vendor,
// the billing mode and the SERVED model on every result, success or degrade.
//
// `JX_ANTHROPIC_API_KEY` was deleted by and `ANTHROPIC_API_KEY` follows it out of this path: the
// lanes no longer authenticate anything themselves. There is no `credEnv` here any more because there
// is no separate credential — the engine's is the only one, and its absence is refused at the engine
// door rather than re-checked here.
//
// WHAT THIS COSTS, STATED. `tool_choice` forced the answer's shape and a CLI turn cannot be forced, so
// the shape is asked for and validated instead — this engine's house pattern everywhere else. The
// safety that replaces the forcing lives in providers/jx/src/turn-envelope.mjs: an answer the parser
// cannot read is a DEGRADE with a cause, never an empty result. Without that, an unreadable judge reply
// would have meant every SERP hit came back unclassified, which a report reads as no adverse hits.
// `runDir` is the run the lane serves: a run that recorded its engine at its start keeps it here as its stages
// do, so a run's lanes and stages never split across engines (engine/run-choices.mjs).
async function jxRunner(runDir) {
  const { makeJxTurnRunner } = await import("./engine/jx-turn.mjs");
  return makeJxTurnRunner({ runDir });
}

/** One lane's dispatch: resolve the engine, lazy-import the pure core, run it on the turn. */
async function jxLane(kind, mod, call, runDir = null) {
  const runner = await jxRunner(runDir);
  if (runner.error) return { ok: false, cause: `jx ${kind}: ${runner.error}` };
  let core;
  try { core = await import(mod); }
  catch (e) { return { ok: false, cause: `jx ${kind} core unavailable: ${e.message}` }; }
  try { return await call(core, runner.turn); }
  catch (e) { return { ok: false, cause: `jx ${kind} call threw: ${String(e?.message ?? e).slice(0, 200)}` }; }
}

export const JX_PROVIDERS = {
  completions: {
    generate: ({ mark, productContext, lane, runDir }) =>
      jxLane("completions", "../providers/jx/src/core.js",
        (core, turn) => core.generateCandidates({ mark, productContext, lane, turn }), runDir),
  },
  // Phase 4 slice 2 — the SERP-grid hit judge (classification only; retrieval is code-side).
  judge: {
    judge: ({ mark, hits, runDir }) =>
      jxLane("judge", "../providers/jx/src/judge.js",
        (mod, turn) => mod.judgeHits({ mark, hits, turn }), runDir),
  },
  // Phase 4 slice 3 — the nativeread lane (reads the code-inlined zh evidence slice, returns structured
  // flags; severity_hint never sets a band).
  nativeread: {
    read: ({ mark, lane, payload, runDir }) =>
      jxLane("nativeread", "../providers/jx/src/nativeread.js",
        (mod, turn) => mod.generateReadItems({ mark, lane, payload, turn }), runDir),
  },
};
