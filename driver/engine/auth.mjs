// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/auth.mjs — billing-mode ("auth") resolution shared by the gateway and the engine adapters. This
// is what makes the "subscription vs API-key billing" toggle PROVABLE (W3):
//   • FAIL LOUD — a mode that claims API billing but has NO key throws here, instead of silently falling
//     through to the subscription (the pre-existing anthropic footgun: you think you are API-metered and
//     you are not). The gateway calls this once at the top of runStage, so the throw is controlled and
//     happens BEFORE any turn runs — and it fixes the anthropic path WITHOUT editing anthropic-agent.mjs.
//   • STAMP — the resolved { provider, mode, apiBilled } is recorded on the per-attempt telemetry row and
//     the run manifest, so any run can be SHOWN to have billed the way it claims.
// Provider-blind by design; a future/unknown engine gets a no-policy "unknown" result and never throws.
//
// STILL DEPENDENCY-FREE. `shared/env-aliases.mjs` is a frozen table and three pure functions — no node
// imports, no I/O — so importing it keeps every property this file's header claims.

// ONE NAME, READ THE SAME WAY BY BOTH ENGINES — and that is the design, not an accident of the rename.
//
// had each read take the current spelling first and then that engine's own legacy one, because
// BILLING was a COLLAPSE row: two old names folded into one new one, and resolving through the whole
// spelling list let the OpenAI half decide how an Anthropic run bills. deleted the old names, so
// there is one variable, only the selected engine is ever consulted, and the hazard has no route left.
//
// And deliberately written OUT as a literal rather than passed to a helper as an argument: the env
// audit finds a product read by the literal `env.NAME`, so a helper taking the name as an argument makes
// the read invisible to it — measured, it turned the reads harness-only and put the name on the "no
// longer read by product code" list. `billingMode` below spells the name out, which keeps it visible.

// THREE MODES FOR CLAUDE, AND NOTHING ELSE IS A MODE. `cloud` bills Claude through the reader's own
// Google, Microsoft or Amazon account, or through a gateway in front of one (ANTHROPIC_BASE_URL). The
// vendor's program already routes on its own switches, which reach it because the stage environment
// carries the vendor's own names (engine-env.mjs); what was missing was a billing word that says so. Without it a cloud machine had two
// choices and both were wrong: `api-key` refused for want of an Anthropic key the machine does not have,
// and `subscription` ran and stamped every row as billed to a subscription nobody was paying.
//
// AN UNKNOWN WORD IS REFUSED. It used to run as `subscription` on both engines, so a typo in the one
// setting that decides who pays was a quiet bill to the wrong account. It refuses here, at the top of
// runStage, in the probe and in the jx runner, before any turn runs.
export const BILLING_MODES = Object.freeze(["subscription", "api-key", "cloud"]);

/**
 * The billing word as the environment writes it, normalised and NOT validated: unset or blank reads as
 * the default. The one parse of the word. `resolveAuthMode` validates it; the anthropic adapter's
 * `spawnEnv`, which must never throw, reads it through here rather than parsing it a second way.
 */
export function billingMode(env = process.env) {
  return String(env.CLEAROTRON_AI_BILLING ?? "").trim().toLowerCase() || "subscription";
}

// The vendor's own switches, read the way its program reads them: "1", "true", "yes" or "on" switches
// one on. Spelled out one per line for the reason given above. The order is only the order a refusal
// names them in.
const switchedOn = (v) => ["1", "true", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());
export const CLOUD_SWITCH = Object.freeze({ vertex: "CLAUDE_CODE_USE_VERTEX", foundry: "CLAUDE_CODE_USE_FOUNDRY", bedrock: "CLAUDE_CODE_USE_BEDROCK" });

// EVERY NAME THE PROGRAM READS TO REACH AND PAY A CLOUD, as setup writes them and the install page lists
// them: each cloud's switch and its least settings, the gateway pair, and the four model pins a cloud
// deployment is named by. A run takes every line of its settings file, so it has these already. Setup's
// proof turn and doctor read the file name by name, and carry these so a check proves the account a run
// bills rather than whatever the shell happened to hold.
//
// THE FABLE PIN IS ON IT, THOUGH SETUP NEVER ASKS FOR IT. The program reads a pin for every tier it takes as
// an alias, fable included, and no stage asks for fable unless an override names it. On Foundry that
// alias resolves to nothing unless the pin names a deployment, so a reader who sets the override sets the
// pin by hand, and doctor, setup's proof turn and a background start must carry it like the other three.
//
// THE STANDARD AWS KEY VARIABLES ARE ON IT. A machine with no AWS profile and no instance role keeps its
// Amazon keys in the settings file, and a search reads them from there. Without these three names doctor's
// proof turn ran without the keys and reported a fault on a machine whose searches worked.
export const CLOUD_SETTINGS = Object.freeze([
  ...Object.values(CLOUD_SWITCH),
  "ANTHROPIC_VERTEX_PROJECT_ID", "CLOUD_ML_REGION", "GOOGLE_APPLICATION_CREDENTIALS",
  "ANTHROPIC_FOUNDRY_RESOURCE", "ANTHROPIC_FOUNDRY_API_KEY",
  "AWS_REGION", "AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
  "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL",
]);

// THE ONES THAT HOLD A SECRET, by name. Wherever a cloud setting is shown, one of these is shown as set and
// never with its value. Named rather than matched by suffix: AWS_ACCESS_KEY_ID ends like the Google project
// id beside it, and only one of the two is a credential.
export const CLOUD_SECRETS = Object.freeze([
  "ANTHROPIC_FOUNDRY_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "ANTHROPIC_AUTH_TOKEN",
]);

// WHAT A READER CHECKS WHEN A CLOUD REFUSES THE CREDENTIALS, per cloud: who refused, by the name a reader
// knows it by, and the settings and sign-in that decide it. Names only, never a value. The remedy for a
// subscription, run the program once and sign in, means nothing on a machine that pays through a cloud, and
// it was the only remedy the checks gave. Every setting named here is on CLOUD_SETTINGS, so doctor and
// setup's proof turn carry what this tells a reader to check.
export const CLOUD_CREDENTIAL_CHECK = Object.freeze({
  vertex: Object.freeze({ who: "Google Cloud",
    check: "ANTHROPIC_VERTEX_PROJECT_ID, CLOUD_ML_REGION, and the Google sign-in on this machine (gcloud's, or the key GOOGLE_APPLICATION_CREDENTIALS names)" }),
  foundry: Object.freeze({ who: "Microsoft Azure",
    check: "ANTHROPIC_FOUNDRY_API_KEY, or the Azure sign-in on this machine, and ANTHROPIC_FOUNDRY_RESOURCE" }),
  bedrock: Object.freeze({ who: "Amazon Bedrock",
    check: "AWS_REGION and the AWS credentials on this machine (a profile, an instance role, or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)" }),
  gateway: Object.freeze({ who: "the gateway", check: "ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN" }),
});

export function cloudsSwitchedOn(env = process.env) {
  const on = [];
  if (switchedOn(env.CLAUDE_CODE_USE_VERTEX)) on.push("vertex");
  if (switchedOn(env.CLAUDE_CODE_USE_FOUNDRY)) on.push("foundry");
  if (switchedOn(env.CLAUDE_CODE_USE_BEDROCK)) on.push("bedrock");
  return on;
}

// Every refusal below carries `billingRefusal: true`, so a reader classifies it by what it is rather than
// by its wording: the probe does, and a sign-in error that also names this setting is not one of these.
const refuse = (message) => Object.assign(new Error(message), { billingRefusal: true });
const notAMode = (mode, modes) => refuse(
  `CLEAROTRON_AI_BILLING=${mode} is not a billing mode — refusing to guess, because the guess would bill ` +
  `the subscription. One of: ${modes.join(", ")}.`);

export function resolveAuthMode({ engineName, env = process.env } = {}) {
  const name = String(engineName || "").toLowerCase();

  if (name === "anthropic-agent") {
    const mode = billingMode(env);
    if (mode === "api-key" && !env.ANTHROPIC_API_KEY)
      throw refuse(
        `CLEAROTRON_AI_BILLING=api-key but ANTHROPIC_API_KEY is not set — refusing to silently bill the ` +
        `subscription instead. Set the key, or use CLEAROTRON_AI_BILLING=subscription.`);
    const on = cloudsSwitchedOn(env);
    // A cloud's switch sends the program to that cloud whatever the billing word says. Measured on Foundry,
    // 2026-09-14: with the switch on and the word unset, the program reported Foundry as its provider and
    // the row was stamped as the subscription's. So a switch beside `subscription` or `api-key` is refused,
    // after a missing key, which is the fault the config page names first.
    if ((mode === "subscription" || mode === "api-key") && on.length)
      throw refuse(
        `${on.map((c) => CLOUD_SWITCH[c]).join(" and ")} ${on.length > 1 ? "are" : "is"} on, which sends Claude to ` +
        `that cloud account, while CLEAROTRON_AI_BILLING says ${mode} — refusing rather than record the wrong ` +
        `account. Use CLEAROTRON_AI_BILLING=cloud, or ${on.length > 1 ? "turn them off" : "turn the switch off"}.`);
    if (mode === "subscription") return { provider: "anthropic", mode, apiBilled: false };
    if (mode === "api-key") return { provider: "anthropic", mode, apiBilled: true };
    if (mode === "cloud") {
      if (on.length > 1)
        throw refuse(
          `CLEAROTRON_AI_BILLING=cloud but more than one cloud is switched on ` +
          `(${on.map((c) => CLOUD_SWITCH[c]).join(", ")}) — set exactly one, so the run can say which account it bills.`);
      // A switch names the cloud. ANTHROPIC_BASE_URL alone is the gateway form: a cloud reached through the
      // reader's own proxy. With a switch also set, the switch is what the program routes on.
      const cloud = on[0] ?? (env.ANTHROPIC_BASE_URL ? "gateway" : null);
      if (!cloud)
        throw refuse(
          `CLEAROTRON_AI_BILLING=cloud but none of CLAUDE_CODE_USE_VERTEX, CLAUDE_CODE_USE_FOUNDRY, ` +
          `CLAUDE_CODE_USE_BEDROCK or ANTHROPIC_BASE_URL is set — refusing to silently bill the subscription ` +
          `instead. Set the one for your cloud (INSTALL.md), or use CLEAROTRON_AI_BILLING=subscription.`);
      return { provider: "anthropic", mode, apiBilled: true, cloud };
    }
    throw notAMode(mode, BILLING_MODES);
  }

  if (name === "openai-agent") {
    const mode = billingMode(env);
    if (mode === "cloud")
      throw refuse(
        `CLEAROTRON_AI_BILLING=cloud bills Claude through a cloud account, and this machine runs the Codex ` +
        `engine — refusing rather than billing the ChatGPT subscription instead. Use subscription or api-key ` +
        `with Codex, or CLEAROTRON_AI=anthropic-agent for a cloud account.`);
    if (mode !== "subscription" && mode !== "api-key") throw notAMode(mode, ["subscription", "api-key"]);
    if (mode === "api-key" && !env.CODEX_API_KEY)
      throw refuse(
        `CLEAROTRON_AI_BILLING=api-key but CODEX_API_KEY is not set — refusing to silently bill the ChatGPT ` +
        `subscription instead. Set the key, or use CLEAROTRON_AI_BILLING=subscription.`);
    return { provider: "openai", mode, apiBilled: mode === "api-key" };
  }

  return { provider: name || "unknown", mode: "unknown", apiBilled: false };
}

/**
 * What a reader calls the account a cloud mode bills: "Google Cloud", "Microsoft Azure", "Amazon Bedrock"
 * or "Gateway". Null for no cloud.
 *
 * ONE TABLE OF CLOUD NAMES, NOT TWO. `CLOUD_CREDENTIAL_CHECK` in engine/auth.mjs already names each cloud
 * the way a reader knows it, for the advice a refused sign-in prints, and this reads it rather than keeping
 * a second list that could name a cloud differently on the page. It writes the gateway "the gateway", for
 * use inside a sentence; a label on a page drops the article and starts with a capital, and that one
 * adjustment is the whole of what this adds.
 */
export function cloudName(cloud) {
  const who = CLOUD_CREDENTIAL_CHECK[cloud]?.who;
  if (!who) return null;
  const bare = who.replace(/^the /, "");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/**
 * WHY A BILLING SETTING REFUSES EVERY SEARCH, as data: which refusal it is and the names involved, so the
 * config page words it once, in plain English, without reading the resolver's sentence apart.
 *
 * `kind` is one of:
 *   switch-beside-mode  subscription or api-key, and a cloud's switch on beside it (`clouds`)
 *   two-clouds          cloud, and more than one cloud switched on (`clouds`)
 *   no-cloud            cloud, and no cloud switched on and no gateway address (`clouds` lists every
 *                       switch, and `gateway` the gateway's setting, as the choices to make)
 *   not-a-mode          a word that is not a billing mode (`modes` are the ones this engine takes)
 *   cloud-on-codex      cloud, on the Codex engine, which a cloud account cannot pay for (`engineSetting`
 *                       and `engineChoice` name the Claude engine only where it would pay: one cloud
 *                       switched on, or none and a gateway address; otherwise that move is one more refusal)
 *   unclassified        a refusal this list does not name; the page says only that searches are refused.
 *                       Not "other": that is an assistant's id in connect-clients.mjs, and a surface may
 *                       not name one in code
 *
 * `defaulted` says the billing setting is blank, so `subscription` is the default and not a word anybody
 * wrote: a page that said "payment is set to subscription" would send a reader looking for a line their
 * settings file does not have. It is the state measured on Foundry, a switch on and the word unset.
 *
 * THE SAME PREDICATES AS THE RESOLVER, IN ITS ORDER. `resolveAuthMode` refuses by throwing a sentence and
 * nothing else, so the kind is read back from the same environment through the same functions it uses
 * (`billingMode`, `cloudsSwitchedOn`), in the order it checks them. Called only once it has thrown.
 *
 * NAMES, NEVER A VALUE. `mode` is sent only when it is one of the three modes; the word in a `not-a-mode`
 * refusal is whatever was typed, and it is not sent at all.
 */
export function billingRefusalReason(id, env = process.env) {
  const mode = billingMode(env);
  const setting = "CLEAROTRON_AI_BILLING";
  const clouds = (ids) => ids.map((c) => ({ name: cloudName(c), setting: CLOUD_SWITCH[c] }));
  const defaulted = String(env[setting] ?? "").trim() === "";
  const base = { setting, mode: null, defaulted, clouds: [], modes: [], gateway: null, engineSetting: null, engineChoice: null };
  if (id === "openai-agent") {
    if (mode === "cloud") {
      // The resolver's own test for a cloud the Claude engine would pay through, in its words: one switch,
      // or no switch and a gateway address.
      const on = cloudsSwitchedOn(env);
      const claudeWouldPay = on.length === 1 || (!on.length && Boolean(env.ANTHROPIC_BASE_URL));
      return { ...base, kind: "cloud-on-codex", mode, modes: ["subscription", "api-key"],
        ...(claudeWouldPay ? { engineSetting: "CLEAROTRON_AI", engineChoice: "anthropic-agent" } : {}) };
    }
    if (mode !== "subscription" && mode !== "api-key") return { ...base, kind: "not-a-mode", modes: ["subscription", "api-key"] };
  }
  if (id === "anthropic-agent") {
    const on = cloudsSwitchedOn(env);
    if ((mode === "subscription" || mode === "api-key") && on.length) return { ...base, kind: "switch-beside-mode", mode, clouds: clouds(on) };
    if (mode === "cloud" && on.length > 1) return { ...base, kind: "two-clouds", mode, clouds: clouds(on) };
    if (mode === "cloud" && !on.length) {
      return { ...base, kind: "no-cloud", mode, clouds: clouds(Object.keys(CLOUD_SWITCH)), gateway: "ANTHROPIC_BASE_URL" };
    }
    if (!BILLING_MODES.includes(mode)) return { ...base, kind: "not-a-mode", modes: [...BILLING_MODES] };
  }
  return { ...base, kind: "unclassified", mode: BILLING_MODES.includes(mode) ? mode : null };
}
