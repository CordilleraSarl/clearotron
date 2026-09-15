// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE INSTALL PAGES DESCRIBE THE INSTALL THIS BUILD PERFORMS.
//
// Setup now installs the reasoning program itself, into a folder of its own, and a run finds that copy
// after the explicit setting and PATH. The pages written before that told a reader to install the program
// by hand first, listed npm commands the installer no longer runs, gave a native-Windows reason the code
// no longer gives, said two model tiers were pinned when the adapter hands every tier over as an alias,
// and called both reasoning programs proprietary when one of them is Apache-2.0. Each arm reads a page
// beside the code the page describes, so a page that drifts from the code goes red here rather than in
// front of a reader.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_BINARIES } from "../driver.config.mjs";
import { CLOUD_SETTINGS, CLOUD_SWITCH } from "../engine/auth.mjs";
import { claudeModel } from "../engine/anthropic-agent.mjs";
import { platformEngineRefusal } from "../../bin/onboard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
/** Prose with its line breaks folded, so a sentence wrapped at another column still matches. */
const flat = (s) => s.replace(/\s+/g, " ");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** One `## <heading>` section of a page, up to the next `## `. */
function section(doc, heading) {
  const start = doc.indexOf(`\n## ${heading}`);
  assert.notEqual(start, -1, `the page has no section "## ${heading}"`);
  const end = doc.indexOf("\n## ", start + 1);
  return doc.slice(start, end === -1 ? undefined : end);
}

test("the install pages leave installing the reasoning program to setup", () => {
  const pages = [["INSTALL.md", read("INSTALL.md")], ["QUICKSTART.md", read("QUICKSTART.md")]];
  // What setup installs comes from the registry setup reads. A page may not send the reader to do it by hand.
  for (const eng of Object.values(ENGINE_BINARIES)) {
    assert.ok(eng.package, `${eng.vendor} has no package for setup to install, so the pages would promise what setup cannot do`);
    for (const [name, doc] of pages)
      assert.doesNotMatch(doc, new RegExp(`npm install -g ${escape(eng.package)}`), `${name} still tells the reader to install ${eng.package} by hand`);
  }
  for (const [name, doc] of pages)
    assert.doesNotMatch(doc, /claude\.ai\/install\.sh/, `${name} still offers the vendor's shell installer`);

  const one = section(pages[0][1], "1. Prerequisites");
  assert.ok(flat(one).includes("**Setup installs the reasoning program.** Clearotron runs each step of a clearance as a "
    + "short, unattended session of Claude Code or the Codex CLI. Setup installs the one your engine uses, for this "
    + "machine, when you say yes. A copy already on the machine is used instead and keeps updating itself."),
  "INSTALL.md §1 no longer opens the reasoning program with the approved paragraph");
  assert.match(one, /^\s*npx clearotron install {2}# installs the reasoning program if the machine has none, and shows you how to sign it in$/m,
    "the Windows steps no longer end in the one install line");
  assert.match(flat(one), /the program setup installed \(doctor prints its path\), or `claude` if the machine has its own/,
    "the sign-in table still sends the reader to a `claude` command that setup's copy does not put on PATH");

  const readme = flat(read("README.md"));
  assert.doesNotMatch(readme, /which must be installed/, "the README still says the program must be installed first");
  assert.match(readme, /setup installs it if the machine has none/);
  assert.match(readme, /your signed-in subscription, an API key, or your own Google, Microsoft or Amazon cloud account/,
    "the README names two of the three ways a turn is paid for");
});

test("the root pages give the native-Windows reason the run door gives", () => {
  const said = platformEngineRefusal({ platform: "win32" });
  assert.match(said, /POSIX path and process semantics/, "the run door's reason changed; the pages below must follow it");
  for (const f of ["README.md", "INSTALL.md", "QUICKSTART.md"]) {
    const doc = flat(read(f));
    assert.ok(doc.includes("POSIX path and process semantics"), `${f} does not give the run door's reason`);
    assert.doesNotMatch(doc, /the POSIX way/, `${f} still says the engine finds the program "the POSIX way", which the code no longer says`);
  }
});

test("the configuration reference says a tier follows the vendor, as the Claude adapter does", () => {
  for (const tier of ["opus", "sonnet", "haiku"])
    assert.equal(claudeModel(tier), tier, `the adapter no longer hands ${tier} to the program as an alias; the page below is now wrong the other way`);
  const ref = flat(read("docs/architecture/04-configuration-reference.md"));
  assert.doesNotMatch(ref, /opus and sonnet are pinned/, "the reference says two tiers are pinned; the adapter passes them as aliases");
  assert.ok(ref.includes("each tier follows the vendor's newest model"), "the reference no longer says what a tier resolves to");
});

test("the licence words name each program's own licence", () => {
  // The registry records each package's declared licence; the page and the screen may not say otherwise.
  assert.match(ENGINE_BINARIES["anthropic-agent"].licence, /proprietary/);
  assert.match(ENGINE_BINARIES["openai-agent"].licence, /Apache-2\.0/);
  // INSTALL.md says "open source" rather than naming the licence, because no shipped markdown may carry
  // the word Apache at all (section-13-source-offer.test.mjs holds that, so no page can be read as saying
  // this product is under it). The About screen is not markdown and names it.
  const texts = [
    ["INSTALL.md §10", flat(section(read("INSTALL.md"), "10. Licence")), /Codex CLI[^.;]*open source/],
    ["the About screen", flat(read("portal-ui/src/screens/About.tsx")), /Codex CLI[^.;]*Apache-2\.0/],
  ];
  for (const [name, text, codex] of texts) {
    assert.match(text, /Claude Code[^.;]*proprietary/, `${name} does not say Claude Code is proprietary`);
    assert.match(text, codex, `${name} does not say the Codex CLI's licence differs from Claude Code's`);
    assert.doesNotMatch(text, /(?:is|are) (?:a )?proprietary third-party (?:software|CLI)/, `${name} still calls every reasoning program proprietary`);
  }
});

test("the cloud-account section asks only for settings setup and doctor carry, and marks what is untested", () => {
  const install = read("INSTALL.md");
  const b = section(install, "3b.");
  const named = new Set([...b.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
  assert.ok(named.size >= 10, `only ${named.size} setting(s) parsed from §3b, so the arm below would hold nothing`);
  // A setting setup's proof turn and doctor do not carry would make both report a fault on a machine
  // whose searches work, so the page may ask for nothing outside that list.
  for (const n of named)
    if (n !== "CLEAROTRON_AI_BILLING") assert.ok(CLOUD_SETTINGS.includes(n), `§3b asks for ${n}, which setup's proof turn and doctor do not carry`);
  for (const sw of Object.values(CLOUD_SWITCH)) assert.ok(named.has(sw), `§3b has no block for ${sw}`);
  assert.match(b, /^\*\*Amazon Bedrock \(not yet tested\)\*\*$/m, "Amazon is not marked as not yet tested");
  assert.match(b, /^\*\*Google Cloud \(Vertex AI\)\*\*$/m, "Google's heading changed; it is not marked");
  assert.match(b, /^Tested on Microsoft Azure\./m);

  const three = section(install, "3. Configuration");
  assert.match(three, /^CLEAROTRON_AI_BILLING=subscription\s+#.*`api-key` \| `cloud`/m, "§3's billing line does not offer cloud");
  assert.match(three, /^# CLEAROTRON_CLAUDE_PATH= +# only to force one copy/m,
    "§3 still shows CLEAROTRON_CLAUDE_PATH as a line to set; it only forces one copy");
  assert.match(flat(section(install, "8. Access control")),
    /\*\*Serving other organisations\.\*\* An instance that runs searches for organisations other than your own bills Claude through an API key or a cloud account, never a Claude subscription/);
});

test("the release notes promise what setup does", () => {
  const program = flat(read(".changeset/the-reasoning-program-comes-with-the-install.md"));
  assert.doesNotMatch(program, /needs nothing installed first/, "the note promises a machine needs nothing installed; setup offers, and the reader may say no");
  assert.match(program, /Setup offers to install the reasoning program your engine uses/);
  assert.match(program, /how much space the program takes and how to remove it/);
  assert.match(flat(read(".changeset/claude-through-your-own-cloud-account.md")),
    /Tested on Microsoft Azure; Google Cloud and Amazon Bedrock use the Claude program's own settings\./);
});
