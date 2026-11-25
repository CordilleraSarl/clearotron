// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The register write-up's tool, its dispatch and its manual name the record the recorder takes. The tool's value
// lists come from the recorder's own constants, a drop's `ground` is required where the recorder refuses one
// without it, the dispatch names that ground and asks for no record ids the tool has no field for, and the manual
// sets `verify` by the value the tool takes. Pure, $0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIGEST_DROP_REASON_TOKENS, VERIFY_VALUES, ADJUDICATION_DECISIONS } from "../register-digest-record.mjs";
import { STAGES, paths } from "../stages.mjs";
import { DIGEST_SENTENCES } from "./ruled-sentences-digest.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The tools the recording server serves, asked as a session asks: tools/list. A timeout fails. */
function servedTools() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(DRIVER, "engine", "mcp", "recording-server.mjs")], {
      stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: join(DRIVER, "..", ".no-such-run") } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("the recording server did not answer tools/list")); }, 20000);
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return resolve(m.result?.tools ?? []);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "digest", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

test("the tool's value lists are the recorder's, and a drop requires its ground", async () => {
  const tool = (await servedTools()).find((t) => t.name === "record_register_digest");
  assert.ok(tool, "record_register_digest was not served");
  const items = (k) => tool.inputSchema.properties[k].items;
  assert.deepEqual(items("findings_rows").properties.verify.enum, [...VERIFY_VALUES]);
  assert.deepEqual(items("incumbent_rows").properties.verify.enum, [...VERIFY_VALUES]);
  assert.deepEqual(items("disagreement_resolutions").properties.decision.enum, [...ADJUDICATION_DECISIONS]);
  const drop = items("negative_rows");
  assert.deepEqual(drop.properties.ground.enum, [...DIGEST_DROP_REASON_TOKENS]);
  for (const k of ["uri", "drop_reason", "ground"]) assert.ok(drop.required.includes(k), `negative_rows does not require ${k}`);
  for (const token of DIGEST_DROP_REASON_TOKENS)
    assert.ok(drop.properties.ground.description.includes(`\`${token}\``), `the ground's description does not name ${token}`);
});

test("the dispatch names the ground and asks for no record ids the tool has no field for", () => {
  const msg = STAGES["register-digest"].message({ paths: paths("/r"), axes: ["primary-sweep"],
    intakeAsks: [{ owner: "register", ask: "Is the invented mark VELTRANE filed in class 9?" }] });
  assert.match(msg, /`negative_rows`: one entry per candidate screened out — its `uri`, your `drop_reason` and its `ground`\./);
  assert.match(msg, /answer each from the run's frozen register material via the band tools \(band_shape \/ band_lookup \/ band_record\) and send each answer in `instructed_checks`\./);
  assert.doesNotMatch(msg, /record ids you read in the findings file/);
  assert.match(msg, /MUST NOT RETYPE — [^.]*the record ids you read\./, "the rule that the ids are not the seat's to send is kept");
});

test("the manual sets verify by the value the tool takes", () => {
  const manual = readFileSync(join(DRIVER, "skills", "clearance-register", "digest.md"), "utf8").replace(/\s+/g, " ");
  assert.doesNotMatch(manual, /Verify\? ✅/);
  assert.ok(manual.includes(DIGEST_SENTENCES.whenInDoubtKeepSetVerify), "the in-doubt rule does not set verify");
  assert.ok(manual.includes(DIGEST_SENTENCES.ownerConflictsFlaggedVerify), "the checklist does not set verify");
});
