// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// experiment-honesty.mjs — an arm whose seat produced nothing does not print OK.
//
//. `--experiment <stage>` printed OK and recorded ok:true on an arm where the seat made
// ZERO tool calls, wrote nothing, and produced no output. Nothing in the arm's own surfaces contradicted
// that green: the exit code said pass, the stage record said ok:true, and the output file was present, the
// right size, and parsed — because the SANDBOX had copied the canonical run's document in as a declared
// input, under the name a reader checks.
//
// That is the sharpest form of the class: the sandbox itself supplies the evidence that makes the false
// green look true. A copy is correct behaviour for an input and indistinguishable from output once the
// stage has run.
//
// THREE TELLS, REQUIRED TOGETHER, because each alone is too wide:
//
//   1. `wrote === false`. THREE-VALUED, and this is the trap: true/false when the stage has expected
//      files, NULL when it has none. A falsy test would condemn every stage that emits nothing by design.
//      And `wrote` alone is insufficient in the other direction too — gateway.mjs says so at the site: a
//      failed attempt files as wrote:false with nothing written AND as wrote:true with the artifact
//      written and rejected.
//   2. No calls of either kind — no tool-call lines AND no typed-call directory. A stage can legitimately
//      make no TOOL calls while making typed ones, so both must be empty.
//   3. The output's hash equals the hash the receipt recorded for it AT DISPATCH. The receipt already
//      carries that per edge, so this comparison needed no new recording — only a reader.
//
// A missing input is COULD-NOT-TELL, never a refusal: refusing on what we could not read would be the
// same defect facing the other way.

/** @returns {{verdict: "produced-nothing"|"produced-something"|"could-not-tell", why: string}} */
export function armProduced({ wrote = null, toolCalls = null, typedCalls = null, outputSha = null, dispatchSha = null } = {}) {
  const unknown = [];
  if (wrote !== true && wrote !== false) unknown.push(`wrote (${wrote === null ? "absent" : String(wrote)})`);
  if (!Number.isInteger(toolCalls)) unknown.push("tool-call count");
  if (!Number.isInteger(typedCalls)) unknown.push("typed-call count");
  if (!outputSha || !dispatchSha) unknown.push("the output hash or the hash recorded at dispatch");

  // Anything POSITIVE settles it before the unknowns matter: a stage that wrote, called, or changed its
  // output produced something, whatever else could not be read.
  if (wrote === true) return { verdict: "produced-something", why: "the attempt wrote an expected artifact" };
  if (Number.isInteger(toolCalls) && toolCalls > 0) return { verdict: "produced-something", why: `${toolCalls} tool call(s)` };
  if (Number.isInteger(typedCalls) && typedCalls > 0) return { verdict: "produced-something", why: `${typedCalls} typed call(s)` };
  if (outputSha && dispatchSha && outputSha !== dispatchSha) {
    return { verdict: "produced-something", why: "the output differs from what the sandbox copied in" };
  }

  if (unknown.length) {
    return { verdict: "could-not-tell",
      why: `could not read ${unknown.join(", ")} — not concluding an arm produced nothing from what was not measured` };
  }
  return { verdict: "produced-nothing",
    why: "the attempt wrote nothing (wrote: false), made no tool calls and no typed calls, and the output "
      + "is byte-identical to the copy the sandbox placed there as an input" };
}

/** The one line a reader meets BEFORE the exit code —. */
export function producedNothingLine(stage, why) {
  return `--experiment ${stage} PRODUCED NOTHING — the seat made no calls and wrote no output, and the `
    + `file under the stage's output name is the copy the sandbox put there as an INPUT.\n`
    + `           ${why}\n`
    + "           This is NOT a pass. Nothing about this arm is comparable to one that ran.";
}

/**
 * Read the three tells from an arm's own surfaces —.
 *
 * Every read is best-effort and reports its own absence as null, so a surface that could not be read
 * reaches `armProduced` as could-not-tell rather than as a zero.
 */
export function readArmSurfaces({ shadowDir, stage, outputPath, io }) {
  const { readFile, listDir, sha256, driverPath } = io;
  const lastAttempt = () => {
    const text = readFile(driverPath(shadowDir, `${stage}.jsonl`));
    if (text == null) return null;
    const rows = text.split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return rows.length ? rows[rows.length - 1] : null;
  };
  const row = lastAttempt();
  const toolText = readFile(driverPath(shadowDir, "tool-calls.jsonl"));
  // A typed-call directory is per stage. Its ABSENCE is a zero here — the directory is created by the
  // first call, so "no directory" and "no calls" are the same fact, and the issue measured exactly that.
  const typedDir = listDir(driverPath(shadowDir, `${stage}-calls`));

  let outputSha = null, dispatchSha = null;
  if (outputPath) {
    outputSha = sha256(outputPath);
    const receipt = readFile(driverPath(shadowDir, "experiment-context.json"));
    if (receipt != null) {
      try {
        const rel = outputPath.startsWith(shadowDir) ? outputPath.slice(shadowDir.length + 1) : outputPath;
        const edge = (JSON.parse(receipt).edges ?? []).find((e) => e.rel === rel);
        dispatchSha = edge?.sha ?? null;
      } catch { dispatchSha = null; }
    }
  }
  return {
    wrote: row && Object.prototype.hasOwnProperty.call(row, "wrote") ? row.wrote : null,
    toolCalls: toolText == null ? null : toolText.split("\n").filter((l) => l.trim()).length,
    typedCalls: typedDir == null ? 0 : typedDir.filter((f) => f.endsWith(".json")).length,
    outputSha, dispatchSha,
  };
}
