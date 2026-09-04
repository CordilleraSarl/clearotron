// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — the probe has a standalone entry point, and it is driven here WITHOUT running one.
//
// `probeEngineTurn` spends money: one cheap-tier turn on the box's own credential. Every arm below
// injects the verdict instead, so this file is offline and $0 — the module's own behaviour is already
// covered by engine-probe.test.mjs, and what is new here is the wrapper's contract with a caller: what
// it prints, and what it exits.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { render, exitCodeFor } from "../../scripts/engine-probe.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OK = { ok: true, engine: "anthropic-agent", mode: "ok", basis: "completed-turn",
  headline: "anthropic-agent completed a turn", fix: null, detail: null };
const MISCONFIGURED = { ok: false, engine: "openai-agent", mode: "auth-misconfigured", basis: "config",
  headline: "openai-agent cannot start: the billing mode this box declares has no key",
  fix: "CLEAROTRON_AI_BILLING=api-key but CODEX_API_KEY is not set.", detail: null };

test("#1456 a failing verdict exits non-zero — a probe nobody can gate on is a probe nobody runs twice", () => {
  assert.equal(exitCodeFor(OK), 0);
  assert.equal(exitCodeFor(MISCONFIGURED), 1);
  // `ok` is asked for EXPLICITLY: a verdict object is always truthy, so a caller testing the object
  // rather than the field passes on every failure there is.
  assert.equal(exitCodeFor({ ok: false }), 1);
  assert.equal(exitCodeFor(undefined), 1, "no verdict at all is a failure, never a pass");
  assert.equal(exitCodeFor({}), 1, "a verdict missing its own ok field is not a green one");
});

test("#1456 the verdict names the MODE and the basis, and relays the owner's fix verbatim", () => {
  const bad = render(MISCONFIGURED);
  assert.match(bad, /^auth-misconfigured — openai-agent cannot start/, "the mode leads, so a scan reads the class first");
  assert.match(bad, /basis: config/, "the basis says what decided it — config, a throw, a watchdog");
  assert.ok(bad.includes(MISCONFIGURED.fix),
    "the thrower's own wording was paraphrased. auth.mjs owns the billing refusal and classifyProbe "
    + "relays it verbatim for that reason; a second wording here is a second thing to keep in step.");
  const good = render(OK);
  assert.match(good, /^ok — anthropic-agent completed a turn/);
  assert.ok(!/basis: config/.test(good) && /basis: completed-turn/.test(good));
});

test("#1456 --json emits the verdict itself, so a caller reads fields rather than parsing prose", () => {
  assert.deepEqual(JSON.parse(render(MISCONFIGURED, { json: true })), MISCONFIGURED);
});

test("#1456 the entry point SAYS it spends money, before it spends any", () => {
  // A probe that quietly bills a credential is the thing an operator most wants warned about, and the
  // warning has to precede the turn rather than explain it afterwards.
  const src = readFileSync(join(ROOT, "scripts", "engine-probe.mjs"), "utf8");
  const notice = src.indexOf("costs whatever one cheap turn costs");
  const call = src.indexOf("await probeEngineTurn(");
  assert.ok(notice > -1, "the cost notice is gone — the one line an operator needs before this runs");
  assert.ok(call > -1 && notice < call, "the notice must print BEFORE the turn is bought, not after it");
});
