// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE READING TURN NARROWS THE SAME WAY ON EVERY REGISTER.
//
// The reading turn narrows a crowded identical question through `register_propose_supplemental`: by goods
// words, by market, and it names the crowd it replaces. The shared mint handled all three on every
// register, but only the Clarivate server offered them to the model; on Signa the turn could narrow by
// class alone, and three of its four narrowings crowded again. The product is register-agnostic, so the
// schema is one definition served everywhere, and the handling is the compiler's own: one question per
// goods word where the register cannot offer alternatives in one clause, and a recorded gap where it
// cannot search goods text at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mintSupplementalEntries } from "../engine/mcp/supplemental.mjs";
import { goodsTextUnsupportedReason } from "../register-plan.mjs";
import { CAPABILITIES as SIGNA } from "../../providers/signa/src/capabilities.js";
import { CAPABILITIES as CLARIVATE } from "../../providers/clarivate/src/capabilities.js";
import { CAPABILITIES as EUIPO } from "../../providers/euipo/src/capabilities.js";

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp");
const REGISTERS = ["clarivate", "corsearch", "signa", "euipo", "free-tier", "uspto-local"];

/** The proposal item schema a register's server actually serves. A timeout FAILS, never returns empty. */
function servedProposal(server) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(MCP, `${server}-server.mjs`)], { stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: join(MCP, ".no-such-run") } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error(`${server}-server.mjs did not answer tools/list`)); }, 20000);
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        const tool = (m.result?.tools ?? []).find((t) => t.name === "register_propose_supplemental");
        return tool ? resolve(tool.inputSchema.properties.proposals.items.properties)
          : reject(new Error(`${server}-server.mjs serves no register_propose_supplemental`));
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

test("every register serves the reading turn the same three narrowing fields", async () => {
  const served = Object.fromEntries(await Promise.all(REGISTERS.map(async (r) => [r, await servedProposal(r)])));
  for (const r of REGISTERS)
    for (const f of ["goods_words", "regions", "narrows"])
      assert.ok(served[r][f], `${r} does not offer ${f}, so the reading turn cannot narrow that way there`);
  // One definition: the same narrows text everywhere, and the same goods text, give or take a register's own fact.
  assert.equal(new Set(REGISTERS.map((r) => served[r].narrows.description)).size, 1, "narrows reads differently by register");
  const core = served.signa.goods_words.description;
  for (const r of REGISTERS) assert.ok(served[r].goods_words.description.startsWith(core), `${r}'s goods text is not the shared one`);
});

const CROWD = "primary-sweep:exact:veltrin";
const narrowing = { predicate: "exact", term: "VELTRIN", nice_classes: ["9"], goods_words: ["games", "toys"],
  narrows: CROWD, regions: ["US"], rationale: "the identical question crowded" };

test("where the register has no OR on its goods filter, each goods word is its own question", () => {
  const { minted, rejected } = mintSupplementalEntries("primary-sweep", [narrowing], { capabilities: SIGNA });
  assert.deepEqual(rejected, []);
  assert.deepEqual(minted.map((e) => e.goods_text), [["games"], ["toys"]], "the words were joined into one intersected question");
  assert.equal(new Set(minted.map((e) => e.qid)).size, 2, "the two questions share a qid, so one would be read as a re-proposal");
  for (const e of minted) {
    assert.equal(e.narrows, CROWD, "a narrowing lost the crowd it replaces");
    assert.deepEqual(e.regions, ["US"]);
    assert.equal(e.unsupported, undefined);
  }
});

test("THE CONTROL: where the register offers alternatives in one clause, it stays one question", () => {
  const { minted } = mintSupplementalEntries("primary-sweep", [narrowing], { capabilities: CLARIVATE });
  assert.deepEqual(minted.map((e) => e.goods_text), [["games", "toys"]]);
});

test("where the register cannot search goods text, the narrowing is recorded as a gap, never run on the class alone", () => {
  // No region: this register is one office, and a region outside it is refused for that reason instead.
  const onEuipo = { ...narrowing, regions: undefined };
  const { minted, rejected } = mintSupplementalEntries("primary-sweep", [onEuipo], { capabilities: EUIPO });
  assert.deepEqual(rejected, []);
  assert.equal(minted.length, 1);
  assert.equal(minted[0].unsupported, true, "a goods narrowing would have run as the crowded question it replaces");
  assert.equal(minted[0].unsupported_reason, goodsTextUnsupportedReason(EUIPO.id ?? "unknown"));
  // A proposal with no goods words is untouched on the same register.
  const plain = mintSupplementalEntries("primary-sweep", [{ ...onEuipo, goods_words: undefined }], { capabilities: EUIPO }).minted;
  assert.equal(plain[0].unsupported, undefined);
});

test("each goods word is one question against the mint's own caps, so a long list cannot run past them", () => {
  // Where the register has no OR on the goods field, N words are N questions. They draw on whatever cap a
  // caller sets, as every proposal does, and the words past it are refused by name, never run. The tool
  // itself sets none (ruled 2026-09-25).
  const words = Array.from({ length: 25 }, (_, i) => `goods${i}`);
  const { minted, rejected } = mintSupplementalEntries("primary-sweep", [{ ...narrowing, goods_words: words }], { capabilities: SIGNA, perCall: 12, axisMax: 24 });
  assert.equal(minted.length, 12);
  assert.equal(rejected.length, 13);
  assert.ok(rejected.every((r) => /per-call cap 12/.test(r.issue)));
  const late = mintSupplementalEntries("primary-sweep", [{ ...narrowing, goods_words: words.slice(0, 3) }], { capabilities: SIGNA, perCall: 12, axisMax: 24, existingCount: 23 });
  assert.equal(late.minted.length, 1, "the per-axis budget did not bound the split");
  // THE CONTROL: where the register takes the list in one clause, the same proposal is one question.
  assert.equal(mintSupplementalEntries("primary-sweep", [{ ...narrowing, goods_words: words }], { capabilities: CLARIVATE }).minted.length, 1);
});
