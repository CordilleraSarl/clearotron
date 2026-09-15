// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE OLD AZURE SETTINGS ARE GONE, AND NOTHING THAT RUNS CHANGED WITH THEM.
//
// Two groups left on 2026-09-15. CLEAROTRON_AZURE_MODEL overrode the target of the `azure` model alias,
// which no stage names and no engine runs: the Claude adapter refuses the alias. The four AZURE_OPENAI_*
// rows in `.env.example` named another platform's settings and nothing here read them. On a page that
// now explains paying for Claude through an Azure account, both looked like that setup's settings.
//
// The first arm drives the module in a child process with the old setting present, because the alias
// table is built when the module loads and an in-process arm would only ever see the first load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NAMES_IN_FORCE } from "../../shared/names-in-force.mjs";
import { claudeModel } from "../engine/anthropic-agent.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const RETIRED = "CLEAROTRON_AZURE_MODEL";

test("the azure alias keeps its target whatever the retired setting holds", () => {
  const config = pathToFileURL(join(ROOT, "driver", "driver.config.mjs")).href;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e",
    `const m = await import(${JSON.stringify(config)}); process.stdout.write(String(m.MODELS.azure));`],
  { encoding: "utf8", env: { ...process.env, [RETIRED]: "azure-openai/a-deployment-somebody-set" } });
  assert.equal(out, "azure-openai/gpt-5.4", `the alias followed ${RETIRED}, so the setting is still read`);
  // Nothing that runs changed: the alias was never runnable, and still is not.
  assert.throws(() => claudeModel("azure"), /no claude model mapped/);
});

test("the build lists the retired setting nowhere as a name it reads, and the reference lists it as retired", () => {
  assert.ok(NAMES_IN_FORCE.length > 100, "the names list is nearly empty, so the next assertion would hold nothing");
  assert.ok(!NAMES_IN_FORCE.includes(RETIRED),
    `${RETIRED} is still in the names this build reads, so an old spelling of it would be sent to a setting that does nothing`);

  const ref = read("docs/architecture/04-configuration-reference.md");
  const start = ref.indexOf("### Retired — set these and nothing happens");
  assert.ok(start > 0, "the reference has no retired-settings table");
  const retired = ref.slice(start).split(/\n## /)[0];
  assert.match(retired, new RegExp(`^\\| \`${RETIRED}\` \\|`, "m"), "the reference does not list the setting as retired");
  const live = ref.slice(0, start);
  assert.ok(!live.includes(RETIRED), "the reference still describes the retired setting outside the retired table");
  assert.ok(!read("docs/architecture/05-config-governance.md").includes(RETIRED),
    "the governance register still lists the retired setting among the engine settings");
});

test("the example settings file carries no Azure OpenAI rows, and marks Amazon as not yet tested", () => {
  const example = read(".env.example");
  assert.doesNotMatch(example, /^#?\s*AZURE_OPENAI_[A-Z_]+\s*=/m, ".env.example still carries a setting nothing in Clearotron reads");
  assert.doesNotMatch(example, new RegExp(`^#?\\s*${RETIRED}\\s*=`, "m"));
  assert.doesNotMatch(read("docs/architecture/05-config-governance.md"), /still there and stay/,
    "the governance register still says the Azure OpenAI rows stay");

  assert.match(example, /^# {3}Amazon Bedrock \(not yet tested\)\./m, "the Amazon block is not marked as not yet tested");
  assert.match(example, /^# {3}Google Cloud \(Vertex AI\)\./m, "the Google block's heading changed; it is not marked");
  assert.match(example, /^# CLAUDE_CODE_USE_BEDROCK=1$/m, "Amazon left the example file; it stays, marked");
});
