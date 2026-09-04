// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// default-port-is-a-guess.test.mjs —: a port nobody chose says so, and can be made a refusal.
//
// Measured on the deployment box, 2026-08-18, while landing: 18811 and 18812 were held by
// PRODUCTION's two client MCP faces, and `mcp-server/http-server-client.mjs` defaults to 18811.
//
// A collision is the BENIGN outcome. It fails loudly and somebody fixes it. The outcome to design
// against is the other one: on a day production is down there is no collision, the second instance
// binds successfully, and a CLIENT surface serves the wrong instance's runs to a client's AI with
// nothing anywhere saying so. The failure mode that matters is the one that does not fail.
//
// So the fix is not "remove the defaults" — a product that made a stranger invent port numbers would be
// the cure outgrowing the disease. It is:
//
//   ANNOUNCE   a default-port bind says so, every time, naming the variable that would have moved it.
//              This is the half that fires in the dangerous case, because the dangerous case has no
//              holder to inspect: the port is free precisely because its owner is not running.
//   REFUSE     `CLEAROTRON_REQUIRE_EXPLICIT_PORTS=1` makes a default-port bind fatal. A shared box sets it
//              once; a single-machine install sets nothing and keeps its defaults.
//
// AND NOTHING IS CLAIMED ABOUT WHO HOLDS THE PORT. Node cannot see another user's process without
// privilege, and a probe that usually cannot look would print "no other instance" when it means "could
// not check" — the same class of lie this issue is about.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePort, listenOrDie, listenErrorMessage, REQUIRE_EXPLICIT_PORTS } from "../../shared/listen.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const code = (f) => readFileSync(join(ROOT, f), "utf8")
  .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

// Every service that takes a port from the environment with a built-in fallback.
const SERVICES = [
  ["driver/portal-service.mjs", "PORTAL_SERVICE_PORT"],
  ["driver/profile-service.mjs", "PROFILE_PORT"],
  ["driver/recipe-service.mjs", "RECIPE_PORT"],
  ["mcp-server/http-server.mjs", "TRADEMARK_MCP_HTTP_PORT"],
  ["mcp-server/http-server-client.mjs", "CLIENT_MCP_HTTP_PORT"],
];

test("#1194 the SOURCE travels with the number", () => {
  assert.deepEqual(resolvePort({ value: "18823", name: "CLIENT_MCP_HTTP_PORT", fallback: 18811, env: {} }),
    { port: 18823, source: "env", portVar: "CLIENT_MCP_HTTP_PORT", requireExplicit: false });
  const d = resolvePort({ value: undefined, name: "CLIENT_MCP_HTTP_PORT", fallback: 18811, env: {} });
  assert.equal(d.port, 18811);
  assert.equal(d.source, "default",
    "18811 and '18811 because nobody said otherwise' are different addresses to an operator, and only "
    + "the second one is a guess at which instance this is");
  for (const v of ["", "   ", null]) assert.equal(resolvePort({ value: v, fallback: 1, env: {} }).source, "default");
});

test("#1194 a value that is not a port REFUSES rather than falling back to the default", () => {
  // Silently substituting the default for a typo is the same silent substitution one level down: the
  // operator typed an address, got a different one, and nothing said so.
  for (const bad of ["eighteen", "0", "-1", "65536", "18823x"]) {
    const r = resolvePort({ value: bad, name: "X_PORT", fallback: 18811, env: {} });
    assert.equal(r.source, "invalid", `${JSON.stringify(bad)} resolved to ${r.source}`);
    assert.equal(r.port, null, "an unusable value must not become a port at all");
  }
});

test("#1194 a default-port bind announces itself, and prints the EFFECTIVE port", async () => {
  const said = [];
  const server = createServer(() => {});
  await new Promise((resolve) => {
    listenOrDie(server, {
      // Port 0 asks the OS for a free one, so the requested and effective numbers CANNOT agree — which
      // is the point. A unit file declaring one port while the process listens on another is not
      // hypothetical: on systemd an EnvironmentFile beats an Environment= line in the same unit, and
      // that is exactly how a service came up on 18823 while its unit said 18822.
      port: 0, host: "127.0.0.1", what: "a test surface", portVar: "TEST_PORT",
      portSource: "default", env: {}, log: (m) => said.push(m), onReady: resolve,
    });
  });
  const bound = server.address().port;
  server.close();

  const out = said.join("\n");
  assert.match(out, /BUILT-IN DEFAULT port/, "a default-port bind said nothing");
  assert.match(out, new RegExp(`\\b${bound}\\b`), `the notice did not name the port actually bound (${bound})`);
  assert.ok(!/port 0\b/.test(out), "the notice echoed the REQUESTED port instead of the effective one");
  assert.match(out, /TEST_PORT/, "and it must name the variable that would have moved it");
  assert.match(out, new RegExp(REQUIRE_EXPLICIT_PORTS), "and the way to turn the warning into a refusal");
});

test("#1194 a CONFIGURED port says nothing — the announcement is about the guess, not the bind", async () => {
  const said = [];
  const server = createServer(() => {});
  await new Promise((resolve) => {
    listenOrDie(server, {
      port: 0, host: "127.0.0.1", what: "a test surface", portVar: "TEST_PORT",
      portSource: "env", env: {}, log: (m) => said.push(m), onReady: resolve,
    });
  });
  server.close();
  assert.equal(said.length, 0, `a deliberately-addressed service was warned at: ${said.join(" | ")}`);
});

test("#1194 REQUIRE_EXPLICIT_PORTS makes a default-port bind fatal, BEFORE the socket", () => {
  const said = [];
  let exited = null;
  let listened = false;
  const fake = { once() { return this; }, listen() { listened = true; return this; }, address: () => null };
  listenOrDie(fake, {
    port: 18811, host: "127.0.0.1", what: "the client MCP surface", portVar: "CLIENT_MCP_HTTP_PORT",
    portSource: "default", env: { [REQUIRE_EXPLICIT_PORTS]: "1" },
    log: (m) => said.push(m), exit: (c) => { exited = c; },
  });
  assert.equal(exited, 1);
  assert.equal(listened, false,
    "it bound the socket and then complained — a box that banned silent defaults must get nothing, not "
    + "a working listener and a warning");
  assert.match(said.join("\n"), /Refusing to start/);
  assert.match(said.join("\n"), /CLIENT_MCP_HTTP_PORT/);
});

test("#1194 the flag does NOT touch a configured port", () => {
  let exited = null;
  let listened = false;
  const fake = { once() { return this; }, listen(p, h, cb) { listened = true; if (cb) cb(); return this; }, address: () => ({ port: 18823 }) };
  listenOrDie(fake, {
    port: 18823, host: "127.0.0.1", what: "x", portVar: "CLIENT_MCP_HTTP_PORT",
    portSource: "env", env: { [REQUIRE_EXPLICIT_PORTS]: "1" }, log: () => {}, exit: (c) => { exited = c; },
  });
  assert.equal(exited, null, "a service given an explicit address was refused anyway");
  assert.equal(listened, true);
});

test("#1194 a caller that has not been taught the question behaves exactly as before", () => {
  // `portSource` absent = the pre- contract. providers/oauth-mcp-bridge/warm-server.mjs takes its
  // port as `--port` and reads no environment variable, so it can never take a silent default and is
  // deliberately not changed.
  let exited = null;
  let listened = false;
  const said = [];
  const fake = { once() { return this; }, listen(p, h, cb) { listened = true; if (cb) cb(); return this; }, address: () => ({ port: 9 }) };
  listenOrDie(fake, {
    port: 9, host: "127.0.0.1", what: "x", portVar: null,
    env: { [REQUIRE_EXPLICIT_PORTS]: "1" }, log: (m) => said.push(m), exit: (c) => { exited = c; },
  });
  assert.equal(exited, null);
  assert.equal(listened, true);
  assert.equal(said.length, 0);
});

test("#1194 EADDRINUSE on a DEFAULT port says the port was never chosen", () => {
  const msg = listenErrorMessage({ code: "EADDRINUSE" }, {
    what: "the client MCP surface", host: "127.0.0.1", port: 18811,
    portVar: "CLIENT_MCP_HTTP_PORT", portSource: "default",
  });
  assert.match(msg, /THIS PORT WAS NOT CHOSEN/);
  assert.match(msg, /had it been down just now, this process would have taken it silently/,
    "the message must name the outcome that does NOT fail — that is the whole issue");
  assert.ok(!/owned by|user \w+/i.test(msg),
    "the message asserted something about who holds the port; Node cannot see another user's process "
    + "without privilege, and a guess there is the same class of lie as the one being fixed");
  assert.match(msg, /ss -ltnp/, "the instruction that actually works stays");
});

test("#1194 EADDRINUSE on a CONFIGURED port keeps #773's original sentence and adds nothing", () => {
  const msg = listenErrorMessage({ code: "EADDRINUSE" }, {
    what: "the portal service", host: "127.0.0.1", port: 18802,
    portVar: "PORTAL_SERVICE_PORT", portSource: "env",
  });
  assert.ok(!/THIS PORT WAS NOT CHOSEN/.test(msg),
    "an address conflict on a port somebody chose is a different problem with a different remedy");
  assert.match(msg, /already in use/);
});

test("#1194 EVERY service that can take a default port reports its source", () => {
  const missing = [];
  for (const [file, portVar] of SERVICES) {
    const src = code(file);
    if (!new RegExp(`resolvePort\\(\\{[^}]*name: "${portVar}"`).test(src)) missing.push(`${file}: not resolved through resolvePort`);
    if (!/portSource: PORT_CHOICE\.source/.test(src)) missing.push(`${file}: binds without reporting the source`);
  }
  assert.deepEqual(missing, [],
    `these can still take a default port in silence:\n  ${missing.join("\n  ")}\n\n`
    + `Resolve it with resolvePort({ value, name, fallback }) and pass portSource to listenOrDie. The `
    + `service that skipped it is the one an operator hits — the same argument shared/listen.mjs makes `
    + `about four bind handlers drifting.`);
});

test("#1194 the raw default-port idiom is gone from those services", () => {
  const offenders = [];
  for (const [file, portVar] of SERVICES) {
    if (new RegExp(`process\\.env\\.${portVar}\\s*\\|\\|`).test(code(file))) offenders.push(file);
  }
  assert.deepEqual(offenders, [],
    "a port default is being taken inline again, which discards the source before anyone can report it:"
    + `\n  ${offenders.join("\n  ")}`);
});

// ── — the announcement names the port the socket is ON ────────────────────
//
// `onReady()` was handed nothing, so every service composed "listening on" from the port it ASKED for.
// Request an ephemeral port and the socket binds somewhere real while the line reads `:0` or `:null`.
// That line is the only thing that says where the service is: a harness reads it to talk to the
// service, an operator reads it out of a journal, a health check scrapes it. It reported success and
// handed over an address nothing could reach — worse than a failed bind, which gets investigated.

test("1961 onReady is handed the BOUND port, not the requested one", async () => {
  const server = createServer((_q, r) => r.end());
  const seen = await new Promise((resolve) => {
    listenOrDie(server, {
      port: 0, host: "127.0.0.1", what: "an ephemeral probe", portVar: "PROBE_PORT",
      log: () => {}, onReady: resolve,
    });
  });
  const actual = server.address().port;
  // Closed BEFORE the assertions, not after: a failing assert skips everything below it, and a leaked
  // listening socket in a suite that runs files concurrently is a flake for somebody else's arm.
  server.close();

  assert.equal(seen?.port, actual,
    `onReady was told ${JSON.stringify(seen)} while the socket is on ${actual} — a caller composing its `
    + "announcement from this is telling every reader the wrong address");
  assert.notEqual(seen.port, 0, "0 is the REQUEST, never a bind — this is the exact value that printed as null");
  assert.ok(Number.isInteger(seen.port) && seen.port > 0);
});

test("1961 a REQUEST to the announced port is answered", async () => {
  // ✕ THE HALF THE FIRST ARM DID NOT COVER, and the issue named it: "announcing a plausible number
  // nothing serves would be the same defect with a better disguise." Asserting the number is real and
  // non-zero proves it came from somewhere; it does not prove it came from THIS listener. A stale
  // capture, an off-by-one, or a number read from the wrong server would all satisfy the arm above.
  //
  // So this one spends the number the way every reader of that line spends it: it makes a request.
  const BODY = "port-1961-answered";
  const server = createServer((_q, r) => r.end(BODY));
  const seen = await new Promise((resolve) => {
    listenOrDie(server, {
      port: 0, host: "127.0.0.1", what: "an answering probe", portVar: "PROBE_PORT",
      log: () => {}, onReady: resolve,
    });
  });
  try {
    // The failure is CAUGHT and restated. Left alone, a refused connection surfaces as a bare
    // `TypeError: fetch failed` with an undici stack and no port in it — measured under the plant below,
    // and it tells the next reader nothing about what this arm was asking.
    //
    // The catch RECORDS and the assertions below RUN EVERY TIME. An `assert.fail` inside the catch would
    // be an assert site that never executes on a green run, which is the shape 's coverage census
    // exists to refuse — and it is right to: an assertion that never runs has never been checked.
    let text = null, refused = null;
    try {
      text = await (await fetch(`http://127.0.0.1:${seen.port}/`)).text();
    } catch (e) {
      refused = String(e?.cause?.code ?? e?.message ?? e);
    }
    assert.equal(refused, null,
      `nothing answered on the announced port ${seen.port} (${refused}). The line named a plausible `
      + "number that serves nothing — the same defect wearing a better disguise, which is why the number "
      + "alone is not the claim worth checking");
    assert.equal(text, BODY,
      `the announced port ${seen.port} answered, but not with this listener's body — it is serving `
      + "something else, so the line is pointing a reader at the wrong process");
  } finally {
    server.close();
  }
});

test("1961 an explicit port is still reported as itself", async () => {
  // The control. A fix that always reported something OTHER than the request would pass the arm above
  // while breaking every ordinary boot.
  const server = createServer((_q, r) => r.end());
  const probe = createServer((_q, r) => r.end());
  const free = await new Promise((r) => probe.listen(0, "127.0.0.1", () => r(probe.address().port)));
  probe.close();
  const seen = await new Promise((resolve) => {
    listenOrDie(server, {
      port: free, host: "127.0.0.1", what: "an explicit probe", portVar: "PROBE_PORT",
      log: () => {}, onReady: resolve,
    });
  });
  server.close();   // same reason as above: closed before the assertion, never after it
  assert.equal(seen.port, free, "an explicitly requested port must be announced as itself");
});

test("1961 no service composes its address line from the port it REQUESTED", () => {
  // The corpus half. The seam above is fixed once; this is what stops the sixth site being written
  // wrong again, and it covers the bridge, which is not an env-port service and so is not in SERVICES.
  const ANNOUNCERS = [...SERVICES.map(([f]) => f), "providers/oauth-mcp-bridge/warm-server.mjs"];
  const wrong = [];
  let checked = 0;
  for (const f of ANNOUNCERS) {
    // Comments stripped: the source above explains the defect by NAMING the old form, and a guard that
    // read comments would fire on its own explanation.
    for (const line of code(f).split("\n")) {
      const m = line.match(/http:\/\/\$\{[A-Za-z_$]+\}:\$\{([A-Za-z_$]+)\}/);
      if (!m) continue;
      checked++;
      if (m[1] !== "bound") wrong.push(`${f}: interpolates \${${m[1]}} where the BOUND port belongs`);
    }
  }
  // ANTI-VACUITY: a walk that matches nothing reports clean, and this regex is exactly the kind that
  // stops matching when somebody reformats a template literal.
  assert.ok(checked >= ANNOUNCERS.length,
    `only ${checked} address line(s) found across ${ANNOUNCERS.length} announcers — the walk is broken, not the tree`);
  assert.deepEqual(wrong, [],
    `these announce an address built from the REQUESTED port, so an ephemeral bind prints a URL that `
    + `resolves to nothing:\n  ${wrong.join("\n  ")}`);
});

