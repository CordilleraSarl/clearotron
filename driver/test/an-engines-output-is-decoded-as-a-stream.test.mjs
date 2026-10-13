// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN ENGINE'S OUTPUT IS DECODED AS A STREAM, NOT CHUNK BY CHUNK.
//
// Both engine adapters read the engine's output a chunk at a time and decoded each chunk on its own. A pipe hands
// the output over in chunks, and a character of two or more bytes can straddle two of them: an em dash, an accented
// owner, a mark in a non-Latin script. Decoded apart, its halves read as replacement characters, in every line the
// adapter parsed and in the turn's final result. Each stream now has a decoder that holds a split character's first
// bytes until the rest arrive. The arms plant a character across two chunks, a pause apart, on both adapters. The
// text is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { runStreamingChild } from "../engine/common.mjs";
import { anthropicAgentEngine } from "../engine/anthropic-agent.mjs";
import { payloadText } from "../gateway.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const TEXT = "kept whole — a café in 東京";

test("the shared runner reads a character split across two chunks whole, on stdout and on stderr", async () => {
  // Each write stops inside the em dash; the rest follows 300 ms later, so it reaches the reader in a second chunk.
  const code = `const out = Buffer.from(${JSON.stringify(JSON.stringify({ text: TEXT }) + "\n")}, "utf8");
const err = Buffer.from(${JSON.stringify(TEXT + "\n")}, "utf8");
const cut = (b) => b.indexOf(0xe2) + 1;
process.stdout.write(out.subarray(0, cut(out))); process.stderr.write(err.subarray(0, cut(err)));
setTimeout(() => { process.stdout.write(out.subarray(cut(out))); process.stderr.write(err.subarray(cut(err))); }, 300);`;
  const lines = [];
  const r = await runStreamingChild({ bin: execPath, args: ["-e", code], input: "", onStdoutLine: (l) => lines.push(l) });
  assert.deepEqual(lines.map((l) => JSON.parse(l).text), [TEXT], "the line the runner handed on lost its split character");
  assert.equal(r.stderr, `${TEXT}\n`, "stderr lost its split character");
});

test("the Claude adapter's final result reads a character split across two chunks whole", async () => {
  const env = { CLEAROTRON_CLAUDE_PATH: fileURLToPath(new URL("./mock-claude.mjs", import.meta.url)), MOCK_CLAUDE_RESULT: TEXT, MOCK_CLAUDE_SPLIT_UTF8: "300" };
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  try {
    const r = await anthropicAgentEngine.runTurn({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 });
    assert.equal(payloadText(r.json), TEXT, "the turn's result lost its split character");
  } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } }
});
