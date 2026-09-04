// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// listen.mjs — the one place a bind failure becomes a sentence.
//
//. Four services in this repo create a listener at boot, and until now exactly one place in the
// tree knew what to do when the port was taken: `bin/example.mjs`, which scans twenty ports because
// `startPortal` rejects rather than crashing. Everywhere else an unhandled `error` event on an
// `http.Server` IS an uncaught exception, so starting the product twice — or starting it on a box where
// something already holds 18794, 18801 or 18802 — printed
//
//     Error: listen EADDRINUSE: address already in use 127.0.0.1:18802
//         at Server.setupListenHandle [as _listen2] (node:net:1908:16)
//         …
//
// a stack trace that names the failure and no remedy. The ports are fixed defaults in code, so a
// collision is the ordinary first-run experience, not an exotic one.
//
// ── WHY A HELPER AND NOT FOUR HANDLERS ───────────────────────────────────────────────────────────
//
// The issue's own constraint: the handling belongs wherever the listener is created, ONCE. Four copies
// of a bind handler drift — the fourth gets the message wrong, or gets written a year late, and the
// service that skipped it is the one an operator hits. `shared/` is the right home because it is the
// only directory both `driver/` and `bin/` already import from (`shared/scope.mjs`,
// `shared/env-local.mjs`), and it has no dependency on either.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
//
// IT DOES NOT RETRY. `bin/example.mjs` scans for a free port because a demo has no fixed address anyone
// depends on; a SERVICE does. If `portal-service` quietly moved to 18803 because 18802 was taken, the
// tunnel in front of it would keep pointing at 18802, the health check would keep passing against
// whatever answers there, and the operator would be debugging a proxy. A service that cannot have the
// address it was configured with has failed, and says so.
//
// IT DOES NOT CHANGE `startPortal`'s CONTRACT. `driver/dev-portal.mjs` keeps rejecting its promise with
// the raw error, because `bin/example.mjs:140-143` reads `e.code === "EADDRINUSE"` to decide whether to
// try the next port. The dev-portal CLI gate catches that rejection and formats it through
// `listenErrorMessage` here, so there is still ONE definition of the sentence and the demo's scan is
// untouched.

// ── — A DEFAULT PORT IS A GUESS ABOUT WHICH INSTANCE YOU ARE ─────────────────────────────────
//
// Measured on the deployment box, 2026-08-18: 18811 and 18812 were held by PRODUCTION's two client MCP
// faces, and `mcp-server/http-server-client.mjs` defaults to 18811. Starting a second instance without
// an explicit port collides — which is the BENIGN outcome, because a collision fails loudly and
// somebody fixes it.
//
// The outcome to design against is the other one. On a day production is down — a restart, a deploy, a
// crash loop — there is no collision. The second instance binds successfully, production's face then
// fails to come back or comes back somewhere else, and a CLIENT surface is serving the wrong instance's
// runs to a client's AI with nothing anywhere saying so. **The failure mode that matters is the one
// that does not fail.**
//
// So two things, and neither is "remove the defaults":
//
//   ANNOUNCE.  A bind that took the built-in default says so, every time, naming the variable that
//              would have moved it. This is the half that fires in the dangerous case, because the
//              dangerous case has no holder to inspect — the port is free precisely because the
//              instance that owns it is not running.
//
//   REFUSE, ON REQUEST.  `CLEAROTRON_REQUIRE_EXPLICIT_PORTS=1` makes a default-port bind fatal. A shared
//              box sets it once and every service on it must then be addressed deliberately. A
//              single-machine install sets nothing and keeps its defaults — a product that made a
//              stranger invent port numbers would be the cure outgrowing the disease.
//
// WHAT THIS DELIBERATELY DOES NOT DO: look up who holds the port. Node cannot see another user's
// process without privilege, and a probe that usually cannot look would print "no other instance" when
// it means "could not check" — which is the same class of lie this whole issue is about. The EADDRINUSE
// message already tells the operator `ss -ltnp`, which is the instruction that works.

/** The environment variable a shared box sets once to ban silent defaults for every service on it. */
export const REQUIRE_EXPLICIT_PORTS = "CLEAROTRON_REQUIRE_EXPLICIT_PORTS";

/**
 * Where a port came from, decided once instead of at six `|| <literal>` sites.
 *
 * `source` is the fact every caller had and none of them carried: "18811" and "18811 because nobody
 * said otherwise" are different addresses to an operator, and only the second one is a guess.
 *
 * A value that is present but not a usable port is NOT silently replaced by the fallback — that would
 * turn a typo into the default, which is the same silent substitution one level down. It refuses.
 */
export function resolvePort({ value, name, fallback, env = process.env } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return { port: fallback, source: "default", portVar: name ?? null, requireExplicit: env?.[REQUIRE_EXPLICIT_PORTS] === "1" };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return { port: null, source: "invalid", portVar: name ?? null, raw,
      requireExplicit: env?.[REQUIRE_EXPLICIT_PORTS] === "1" };
  }
  return { port: n, source: "env", portVar: name ?? null, requireExplicit: env?.[REQUIRE_EXPLICIT_PORTS] === "1" };
}

/** The sentence a default-port bind says on the way up. One definition, so six services cannot say it
 *  six ways — and it prints the EFFECTIVE port, never the requested one (see listenOrDie). */
export function defaultPortNotice({ what, host, port, portVar }) {
  return `${what}: using the BUILT-IN DEFAULT port ${port} — nothing set ${portVar ?? "a port variable"}, `
    + `so this address is a guess rather than a decision.
`
    + `  On a box that runs more than one instance, that guess is another instance's port on the day that `
    + `instance is down, and nothing about it fails. Set ${portVar ?? "the port variable"} explicitly, or `
    + `set ${REQUIRE_EXPLICIT_PORTS}=1 to make this refusal rather than this warning. Listening on ${host}:${port}.`;
}

/** The refusal, when a shared box has banned silent defaults. */
export function explicitPortRequiredMessage({ what, port, portVar }) {
  return `FATAL: ${what} cannot start — ${REQUIRE_EXPLICIT_PORTS}=1 and nothing set `
    + `${portVar ?? "a port variable"}, so the only address available is the built-in default ${port}.
`
    + `  This box has declared that a default port is not an address: on a machine running more than one `
    + `instance, a default is another instance's port the moment that instance is down, and binding it `
    + `succeeds silently.
`
    + `  Set ${portVar ?? "the port variable"}=<this instance's port> and start again.
`
    + `  Refusing to start.`;
}

/** The remedy line for a bind failure — one definition, used by the helper below and by any caller
 *  that already owns its own error path (the dev-portal CLI gate).
 *
 *  `what`     what an operator calls this thing ("the portal", "profile-service")
 *  `portVar`  the environment variable that moves it. NAMED, never described: "set the port variable"
 *             sends the reader to grep. This text goes to stderr at boot, which is outside every
 *             response-body and bundle assertion in the suite, so naming it is free and correct.
 *  `portFlag` an optional CLI equivalent, for the entry points that take one.
 */
export function listenErrorMessage(err, { what, host, port, portVar, portFlag = null, portSource = null }) {
  const at = `${host}:${port}`;
  const move = [portVar ? `set ${portVar}=<free port>` : null, portFlag ? `pass ${portFlag} <free port>` : null]
    .filter(Boolean).join(", or ");
  switch (err?.code) {
    case "EADDRINUSE":
      return `FATAL: ${what} cannot start — ${at} is already in use.\n`
        + `  The usual cause is a second copy of ${what} that is still running; the product's ports are `
        + `fixed defaults, so two checkouts on one box collide.\n`
        // — and when the port was never chosen, say so. A collision on a CONFIGURED port is an
        // address conflict somebody can reason about; a collision on a default is this process
        // discovering it guessed another instance's address. Different remedy, so it is a different
        // sentence. Nothing is claimed about WHO holds it — that cannot be seen without privilege.
        + (portSource === "default"
          ? `  THIS PORT WAS NOT CHOSEN: ${portVar ?? "the port variable"} is unset, so ${port} is the `
            + `built-in default. Whatever is already there may be another instance that owns this `
            + `address — and had it been down just now, this process would have taken it silently. `
            + `Set ${portVar ?? "the port variable"} for this instance.\n`
          : "")
        + `  See what holds it:  ss -ltnp 'sport = :${port}'   (or: lsof -i :${port})\n`
        + `  Then stop that process${move ? `, or ${move}` : ""}.\n`
        + `  Refusing to start — it will NOT quietly move to another port, because whatever is in front `
        + `of it is still addressed to ${at}.`;
    case "EACCES":
      return `FATAL: ${what} cannot start — this process is not allowed to bind ${at}.\n`
        + (port < 1024
          ? `  ${port} is a privileged port; an unprivileged process cannot bind it. ${move || "Choose a port above 1024"}.`
          : `  The address is refused by the OS (a socket policy, a container restriction, or a bound-but-hidden listener). ${move || ""}`.trimEnd());
    case "EADDRNOTAVAIL":
      return `FATAL: ${what} cannot start — ${host} is not an address on this machine, so ${at} cannot be bound.\n`
        + `  Bind an interface this host actually has (127.0.0.1 for loopback, 0.0.0.0 for every interface).`;
    default:
      // Named, not swallowed. An unrecognised bind failure still gets a sentence and still exits
      // non-zero; what it must not do is arrive as a stack trace with no statement of consequence.
      return `FATAL: ${what} could not listen on ${at} — ${err?.code ? `${err.code}: ` : ""}${err?.message ?? String(err)}.\n`
        + `  Refusing to start.`;
  }
}

/**
 * Bind `server`, or explain and exit non-zero. Never a stack trace.
 *
 * Owns BOTH halves — the error event and the success callback — so no call site can attach one and
 * forget the other. That is the point of routing four services through it rather than four handlers:
 * the failure path is not something each boot block remembers to write.
 *
 * `log` is the service's own stderr writer, so the message carries the same `[profile-service]` prefix
 * as everything else it says. `exit` is injectable for the test that asserts this without ending the
 * test process.
 */
export function listenOrDie(server, {
  port, host, what, portVar, portFlag = null, log, onReady, exit = (c) => process.exit(c),
  // — "env" | "default" | null. Null is a caller that has not been taught the question yet and
  // behaves exactly as before; every service in this repo passes it.
  portSource = null,
  env = process.env,
} = {}) {
  const write = log ?? ((m) => process.stderr.write(`${m}\n`));

  // — THE REFUSAL COMES FIRST, before the socket. A box that has banned silent defaults must not
  // get a working listener and a warning; it must get nothing and a sentence. Checked HERE rather than
  // at six call sites, for the reason this file already gives about four bind handlers drifting: the
  // service that skipped it is the one an operator hits.
  if (portSource === "default" && env?.[REQUIRE_EXPLICIT_PORTS] === "1") {
    write(explicitPortRequiredMessage({ what, port, portVar }));
    exit(1);
    return server;
  }

  server.once("error", (err) => {
    write(listenErrorMessage(err, { what, host, port, portVar, portFlag, portSource }));
    exit(1);
  });
  server.listen(port, host, () => {
    // — the EFFECTIVE port, read off the bound socket, never the number we asked for. A unit file
    // that declares one port while the process listens on another is not hypothetical: on systemd an
    // EnvironmentFile beats an Environment= line in the same unit, and that is exactly how a service
    // came up on 18823 while its unit said 18822. An announcement that echoed the request would have
    // agreed with the wrong one.
    // ── — THE BOUND PORT, NOT THE REQUESTED ONE, AND EVERY CALLER GETS IT ──
    //
    // This value was already computed here, for the default-port notice alone, while `onReady()` was
    // handed nothing. So every service composed its own "listening on" line out of the port it ASKED
    // for. Request an ephemeral port and the socket binds somewhere real while the announcement reads
    // `:0` or `:null` — and that line is the only thing that says where the service is. It reported
    // success and handed over an address nothing could reach, which is worse than either failing to
    // bind or saying nothing: both of those get investigated.
    //
    // HOISTED rather than duplicated. Two derivations of "which port am I on" can disagree once, and
    // this one already existed and was already right.
    const bound = (() => { try { return server.address()?.port ?? port; } catch { return port; } })();
    if (portSource === "default") write(defaultPortNotice({ what, host, port: bound, portVar }));
    // An OBJECT, not a positional: a later fact (the bound host, say) then costs no renumbering at six
    // call sites, and a caller whose onReady takes no argument is unaffected.
    if (onReady) onReady({ port: bound });
  });
  return server;
}
