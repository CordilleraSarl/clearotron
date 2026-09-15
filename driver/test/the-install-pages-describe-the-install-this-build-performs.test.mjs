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
import { ENGINE_BINARIES, MODELS, resolveEngineProgram } from "../driver.config.mjs";
import { CLOUD_SETTINGS, CLOUD_SWITCH, BILLING_MODES, resolveAuthMode } from "../engine/auth.mjs";
import { claudeModel } from "../engine/anthropic-agent.mjs";
import { platformEngineRefusal, installSizeLine, engineOptions, leaveDemoAdvice } from "../../bin/onboard.mjs";

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
  // "Offers": setup asks before it installs anything, and says first how much space the program takes.
  assert.match(one, /^\s*npx clearotron install {2}# offers to install the reasoning program if the machine has none, and shows you how to sign it in$/m,
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
  // AGENTS.md is read by whoever works on this repository, and it gave its own reason until it was held here.
  for (const f of ["README.md", "INSTALL.md", "QUICKSTART.md", "AGENTS.md"]) {
    const doc = flat(read(f));
    assert.ok(doc.includes("POSIX path and process semantics"), `${f} does not give the run door's reason`);
    assert.doesNotMatch(doc, /the POSIX way/, `${f} still says the engine finds the program "the POSIX way", which the code no longer says`);
  }
});

test("the example settings file names every way the reasoning is paid for", () => {
  // The words a reader knows each billing mode by, keyed by the modes the adapter accepts, so a mode added
  // there with no words here goes red rather than leaving the sentence below one short again.
  const words = { subscription: /subscription/, "api-key": /API key/, cloud: /cloud account/ };
  assert.deepEqual(Object.keys(words).sort(), [...BILLING_MODES].sort(), "the adapter accepts a billing mode this arm has no words for");
  const example = read(".env.example");
  const at = example.indexOf("Either way the reasoning");
  assert.notEqual(at, -1, ".env.example no longer says, beside the engine setting, what pays for the reasoning");
  const end = example.indexOf("\nCLEAROTRON_AI=", at);
  assert.ok(end > at, ".env.example's engine setting no longer follows that sentence");
  const said = flat(example.slice(at, end).replace(/^#\s?/gm, ""));
  for (const [mode, w] of Object.entries(words))
    assert.match(said, w, `.env.example's engine block leaves out ${mode} as a way to pay for the reasoning`);
});

test("the cloud-account section says a gateway alone is accepted, as the billing check does", () => {
  const claude = (env) => resolveAuthMode({ engineName: "anthropic-agent", env });
  assert.equal(claude({ CLEAROTRON_AI_BILLING: "cloud", ANTHROPIC_BASE_URL: "https://gateway.example" }).cloud, "gateway",
    "the billing check no longer accepts a gateway with no cloud switched on; §3b's first paragraph must change with it");
  assert.throws(() => claude({ CLEAROTRON_AI_BILLING: "cloud" }), /none of/);
  assert.throws(() => claude({ CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_VERTEX: "1", CLAUDE_CODE_USE_FOUNDRY: "1" }), /more than one cloud/);
  // The section's first paragraph, the one that says what Clearotron checks.
  const opening = flat(section(read("INSTALL.md"), "3b.").split("\n\n")[1]);
  assert.match(opening, /checks that exactly one cloud is switched on, or that a gateway is named \(below\)\. Otherwise every search is refused before anything is spent/,
    "§3b says Clearotron refuses unless exactly one cloud is switched on, and the gateway form it describes below has none");
  // A search is refused at order time; `clearotron start` comes up and names what to set (run-requirements.mjs,
  // the cloud rows are at: ORDER), so "refuses to start" described a start that does not happen.
  assert.doesNotMatch(flat(section(read("INSTALL.md"), "3b.")), /refuses to start/, "§3b says Clearotron refuses to start over a cloud setting, and it starts");
  // AND IT SAYS WHAT A BACKGROUND START DOES WITH THEM, which is the one way to change cloud later.
  assert.match(flat(section(read("INSTALL.md"), "3b.")), /`clearotron start --background` carries these settings into `~\/\.env`.*change the switch in both `~\/\.env` and Clearotron's settings file/,
    "§3b does not say that a background start carries the cloud settings, adds only what the file lacks, or that both files must change");
});

test("the quickstart's install line says what it installs, as the reference's does", () => {
  const comment = /^\s*npx clearotron install {2}(# .+)$/m.exec(section(read("INSTALL.md"), "1. Prerequisites"));
  assert.ok(comment, "INSTALL.md §1's install line carries no comment to hold the quickstart to");
  const block = /\n## Install\n\n```bash\n([\s\S]*?)```/.exec(read("QUICKSTART.md"));
  assert.ok(block, "QUICKSTART.md has no bash block under ## Install");
  assert.ok(block[1].split("\n").includes(`clearotron install  ${comment[1]}`),
    "QUICKSTART.md's install block does not say, as INSTALL.md §1 does, that the install command installs the reasoning program");
  // Still a block a reader can paste: every line is a command, with at most a comment after it.
  for (const line of block[1].trim().split("\n"))
    assert.match(line, /^(?:npm|clearotron) [^#]+?(?: {2}# .+)?$/, `QUICKSTART.md's install block has a line that is not a command: ${line}`);
});

test("the configuration reference says a tier follows the vendor, as the Claude adapter does", () => {
  for (const tier of ["opus", "sonnet", "haiku"])
    assert.equal(claudeModel(tier), tier, `the adapter no longer hands ${tier} to the program as an alias; the page below is now wrong the other way`);
  const ref = flat(read("docs/architecture/04-configuration-reference.md"));
  assert.doesNotMatch(ref, /opus and sonnet are pinned/, "the reference says two tiers are pinned; the adapter passes them as aliases");
  assert.ok(ref.includes("each tier follows the vendor's newest model"), "the reference no longer says what a tier resolves to");

  // WHICH CATALOG IDS GO OVER AS A CONCRETE MODEL, and which as a tier's alias, is the adapter's table, not
  // a rule about catalog ids: the level-1 target of `haiku` goes over as `haiku`. The page names each group;
  // every name in it is held to what the adapter does with it.
  const ids = (list) => [...list.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const said = /The catalog ids (.+?) are passed as those concrete models; (.+?) goe?s? over as the /.exec(ref);
  assert.ok(said, "the reference no longer says which catalog ids go over as a concrete model and which as an alias");
  const [concrete, aliased] = [ids(said[1]), ids(said[2])];
  for (const id of concrete)
    assert.equal(claudeModel(id), id.replace(/^anthropic\//, ""), `the reference says ${id} is passed as that concrete model; the adapter sends ${claudeModel(id)}`);
  for (const id of aliased)
    assert.ok(["opus", "sonnet", "haiku"].includes(claudeModel(id)), `the reference says ${id} goes over as an alias; the adapter sends ${claudeModel(id)}`);
  for (const tier of ["opus", "sonnet", "haiku"])
    assert.ok([...concrete, ...aliased].includes(MODELS[tier]), `the reference does not say what happens to ${MODELS[tier]}, the catalog id ${tier} resolves to`);
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
  // THE PROSE ASKS FOR SETTINGS TOO. The AWS keys are named in a sentence, not on a `NAME=` line, and the
  // lines above cannot see them. ANTHROPIC_API_KEY is the one name the section gives only to say a cloud
  // removes it, so it is held to that sentence instead.
  const prose = new Set([...b.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)].map((m) => m[1]));
  for (const n of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"])
    assert.ok(prose.has(n), `§3b's prose no longer names ${n}, so the check below would hold less than the page asks for`);
  assert.match(flat(b), /Clearotron removes `ANTHROPIC_API_KEY` from every step/);
  for (const n of prose)
    if (n !== "CLEAROTRON_AI_BILLING" && n !== "ANTHROPIC_API_KEY")
      assert.ok(CLOUD_SETTINGS.includes(n), `§3b's prose names ${n}, which setup's proof turn and doctor do not carry`);
  assert.match(b, /^\*\*Amazon Bedrock \(not yet tested\)\*\*$/m, "Amazon is not marked as not yet tested");
  assert.match(b, /^\*\*Google Cloud \(Vertex AI\)\*\*$/m, "Google's heading changed; it is not marked");
  assert.match(b, /^Tested on Microsoft Azure\./m);

  const three = section(install, "3. Configuration");
  assert.match(three, /^CLEAROTRON_AI_BILLING=subscription\s+#.*`api-key` \| `cloud`/m, "§3's billing line does not offer cloud");
  assert.match(three, /^# CLEAROTRON_CLAUDE_PATH= +# only to force one copy/m,
    "§3 still shows CLEAROTRON_CLAUDE_PATH as a line to set; it only forces one copy");

  // THE EXAMPLE SETTINGS FILE GIVES THE SAME ADVICE. Its row keeps the engine's own word, which the resolver
  // reads as unset; a path written there forces that copy and passes over setup's. So the comment above the
  // row may not tell a reader to write a path whenever the program is not on PATH, which is exactly where
  // setup's copy lives.
  const claude = ENGINE_BINARIES["anthropic-agent"];
  assert.equal(resolveEngineProgram("anthropic-agent", { env: { [claude.env]: claude.fallback, PATH: "" }, enginesDir: null }).explicit, false,
    `the resolver now reads ${claude.env}=${claude.fallback} as a forced copy; the example file's row and its comment must change`);
  assert.equal(resolveEngineProgram("anthropic-agent", { env: { [claude.env]: "/opt/engines/node_modules/.bin/claude", PATH: "" }, enginesDir: null }).explicit, true);
  const example = read(".env.example");
  const row = example.indexOf(`\n${claude.env}=${claude.fallback}\n`);
  assert.ok(row > 0, `.env.example has no ${claude.env}=${claude.fallback} row`);
  // The comment block right above the row, with its `#` markers taken off, so a sentence wrapped across
  // two comment lines still reads as one.
  const above = flat(example.slice(0, row).split(/\n(?!#)/).pop().replace(/^#\s?/gm, ""));
  assert.doesNotMatch(above, /ABSOLUTE path if the binary is not on PATH/,
    ".env.example still tells a reader to write a path when the program is not on PATH, which forces a copy and passes over setup's");
  assert.match(above, /only to force one copy/);
  assert.match(above, /then the copy setup installed/);
  assert.match(flat(section(install, "8. Access control")),
    /\*\*Serving other organisations\.\*\* An instance that runs searches for organisations other than your own bills Claude through an API key or a cloud account, never a Claude subscription/);
});

test("every model pin the checks carry is documented beside the others, the fable pin with when to set it", () => {
  // The containment above runs one way, pages within the code, so a pin added to the code and left off the
  // pages passes it. This runs the other way for the pins: each one on CLOUD_SETTINGS is named in §3b, in
  // the reference's pin row and in the example settings file's Foundry block.
  const pins = CLOUD_SETTINGS.filter((n) => /^ANTHROPIC_DEFAULT_[A-Z]+_MODEL$/.test(n));
  assert.ok(pins.includes("ANTHROPIC_DEFAULT_FABLE_MODEL"), `the fable pin is not carried, so the pages would be held to ${pins.length}`);
  const b = section(read("INSTALL.md"), "3b.");
  const pinRow = read("docs/architecture/04-configuration-reference.md").split("\n").find((l) => l.startsWith("| `ANTHROPIC_DEFAULT_OPUS_MODEL`"));
  assert.ok(pinRow, "the configuration reference has no row for the model pins");
  const example = read(".env.example");
  for (const n of pins) {
    assert.ok(b.includes(n), `§3b does not name ${n}`);
    assert.ok(pinRow.includes(`\`${n}\``), `the reference's pin row does not name ${n}`);
    assert.match(example, new RegExp(`^# ${n}=`, "m"), `.env.example does not show ${n}`);
  }
  // A stage reaches fable only through the synthesis override, so each page says the pin is for that.
  for (const [where, text] of [["§3b", flat(b)], ["the reference's pin row", pinRow], [".env.example", flat(example.replace(/^#\s?/gm, ""))]])
    assert.match(text, /fable deployment's name if you set `?CLEAROTRON_SYNTHESIS_MODEL=fable/i, `${where} does not say when to set the fable pin`);
});

test("the release notes promise what setup does", () => {
  const program = flat(read(".changeset/the-reasoning-program-comes-with-the-install.md"));
  assert.doesNotMatch(program, /needs nothing installed first/, "the note promises a machine needs nothing installed; setup offers, and the reader may say no");
  // THE APPROVED SENTENCES, WORD FOR WORD. A clause appended to either one is a sentence nobody approved.
  assert.ok(program.includes("Setup offers to install the reasoning program your engine uses."),
    "the note no longer carries the approved sentence about setup's install offer as it was approved");
  assert.match(program, /how much space the program takes and how to remove it/);
  // What the note promises is what setup's offer and its engine question say, for every program it installs.
  for (const [id, eng] of Object.entries(ENGINE_BINARIES).filter(([, e]) => e.package)) {
    assert.match(installSizeLine(eng), /^It takes about \d+ MB\. To remove it, delete that folder\.$/,
      `setup's install offer for ${eng.product} names no size, which the release note promises`);
    const row = (found) => engineOptions({ [id]: found }).find((o) => o.id === id).label;
    assert.match(row({ executable: true, version: "1.2.3" }), /found: 1\.2\.3 on this machine/, `the ${eng.product} row does not show the version found`);
    assert.match(row({ executable: false, rejected: [] }), /not installed: setup can install it/, `the ${eng.product} row does not say setup can install it`);
  }
  assert.match(program, /shows the version it found on this machine or says setup can install it/);
  assert.equal(engineOptions().at(-1).label, "none for now");
  assert.match(flat(read(".changeset/claude-through-your-own-cloud-account.md")),
    /Tested on Microsoft Azure; Google Cloud and Amazon Bedrock use the Claude program's own settings\./);
});

test("the release notes say which machines a sentence holds on, where the code decides it by machine", () => {
  // One entry of a note: each paragraph reaches the releases page on its own (.changeset/README.md).
  const entry = (note, re) => read(`.changeset/${note}.md`).split(/\n\s*\n/).map(flat).find((p) => re.test(p));
  // DEMO MODE NAMES SETUP ONLY OFF WINDOWS. On native Windows the run door refuses on the platform, so the
  // advice names WSL2 and the devcontainer, and a note saying demo mode points to setup is false there.
  const claude = ENGINE_BINARIES["anthropic-agent"];
  assert.match(leaveDemoAdvice(claude, { platform: "linux", command: "clearotron install" }).join(" "), /clearotron install/,
    "demo mode's advice off Windows no longer names setup; the note below must change with it");
  assert.doesNotMatch(leaveDemoAdvice(claude, { platform: "win32", command: "clearotron install" }).join(" "), /clearotron install|setup/i,
    "demo mode's advice on Windows now names setup; the note below can drop its qualifier");
  const demo = entry("the-sign-in-advice-fits-how-the-machine-pays", /demo mode/);
  assert.ok(demo, "the sign-in note no longer says what demo mode points to");
  assert.match(demo, /Outside Windows/, "the note says demo mode points to setup on every machine, and on Windows it names WSL2 instead");
  // A CLOUD'S OWN SWITCH STOPS ONLY A CLAUDE SEARCH. The Codex engine never reads the switches, so on a Codex
  // install one left on stops nothing, and the upgrade warning is true on a Claude install alone.
  const env = { CLAUDE_CODE_USE_FOUNDRY: "1" };
  assert.throws(() => resolveAuthMode({ engineName: "anthropic-agent", env }), /CLAUDE_CODE_USE_FOUNDRY is on/,
    "a cloud's switch beside the subscription no longer stops a Claude search; the upgrade warning must change with it");
  assert.doesNotThrow(() => resolveAuthMode({ engineName: "openai-agent", env }),
    "a cloud's switch now stops a Codex search too; the upgrade warning can drop its qualifier");
  const warning = entry("claude-through-your-own-cloud-account", /CLAUDE_CODE_USE_FOUNDRY/);
  assert.ok(warning, "the cloud note no longer warns about a cloud's own switch");
  assert.match(warning, /On a Claude install/, "the upgrade warning says a cloud's switch stops every search, and a Codex search reads no switch");
});
