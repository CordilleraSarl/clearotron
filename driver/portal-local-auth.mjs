// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-local-auth.mjs —: THE THIRD IDENTITY SOURCE. One person, one passphrase, no edge.
//
// The portal had exactly two ways to know who you are: a Cloudflare Access JWT at the edge, or
// `PORTAL_AUTH_DISABLED=1` + `PORTAL_DEV=1`, which is not an identity source at all — it skipped the
// question and handed every caller the same synthetic address. Anyone who wanted to run the portal on
// their own machine had to switch authentication OFF to get in, which is why that switch existed and
// why it kept being reached for. replaces it: a real credential, a real session, and the bypass
// deleted so there is nothing left to reach for.
//
// PURE FUNCTIONS OVER INJECTED INPUTS, in the style of portal-access.mjs. Nothing here reads
// process.env, nothing here logs, and nothing here knows what an HTTP request is. The bootstrap in
// portal-service.mjs supplies the paths and the secret; this module only decides. That boundary is what
// lets the whole credential and session lifecycle be tested in-process with no server and no clock.
//
// WHAT THIS DOES NOT DO, on purpose: it does not authorize. `verifySession` hands back an email STRING
// and stops. makePrincipal(portal-access.mjs) is still the only thing that turns an address into a
// principal, and assertPrincipal is still the only chokepoint. A local sign-in produces exactly the
// `{ email }` shape the Cloudflare path produces, reaches exactly the same roster, and is refused by
// exactly the same rules — an identity that is not in CLEAROTRON_ACCESS_FILE (or on a staff domain) gets no
// portal here either. THE AUTHORIZATION BOUNDARY IS UNTOUCHED BY THIS FILE, and that is the point.
//
// ── SESSION SIGNING: ONE SECRET, TWO TOKEN FAMILIES, ONE DOMAIN SEPARATOR ─────────────────────────
//
// STATED DESIGN DECISION. Sessions are signed with PORTAL_SECRET — the same secret the
// confirmation tokens use (portal-service.mjs mintConfirmation/verifyConfirmation) — rather than with a
// second secret of their own. A second secret is a second thing to generate, a second thing to rotate,
// and a second thing to forget; the deployment surface this issue exists to shrink does not need
// another required value.
//
// Sharing a secret between two token families is only safe if a token of one family can never be
// replayed as a token of the other, so the two SIGN DIFFERENT MESSAGES over the same key:
//
//   confirmation:  HMAC-SHA256(secret,                        body)      ← unchanged, keeps signing bare
//   session:       HMAC-SHA256(secret, "portal-session.v1|" + body)      ← this file, always prefixed
//
// A confirmation token's signature therefore never validates a session body, and a session's signature
// never validates a confirmation body, even though both were produced with the same key. The version
// inside the separator is deliberate: changing the session payload's meaning means changing the
// separator, which invalidates every old session instead of silently reinterpreting it.
//
// The confirmation side is NOT changed to match. It is a live, short-TTL, one-shot token minted by a
// running portal; prefixing it would invalidate every in-flight confirmation on deploy, and it does not
// need the prefix — one side of a pair is enough to separate the pair.
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ── the credential record ────────────────────────────────────────────────────────────────────────
//
// scrypt rather than a bare hash: the whole threat here is somebody who has the credential FILE (a
// stolen laptop, a synced backup directory, a careless tarball) and wants the passphrase back. A fast
// digest of a 24-character generated secret is not recoverable, but a fast digest of the human-chosen
// passphrase this also accepts absolutely is.
//
// N=16384,r=8,p=1 needs 128*N*r = 16 MiB, which sits inside node's 32 MiB default scrypt maxmem — the
// next power of two (N=32768) needs exactly 32 MiB and throws on some builds. Costed to be invisible to
// one person signing in (~60 ms) and expensive per guess offline.
const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1 });
const KEYLEN = 64;
// The parameters travel WITH the record, not just in this constant. A record written by a future
// version with different work factors must be recognisable as one this code cannot check, rather than
// silently re-derived with today's numbers and reported as a wrong passphrase.
const ALGO = `scrypt$N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p},keylen=${KEYLEN}`;

const derive = (passphrase, saltB64u) =>
  scryptSync(Buffer.from(String(passphrase), "utf8"), Buffer.from(saltB64u, "base64url"), KEYLEN, SCRYPT);

/**
 * readLocalCredential(path) → { email, salt, hash, algo, createdAt } | null
 *
 * null means NO USER HAS BEEN SET UP HERE — the first-run case, and the only case that is allowed to
 * read as an absence. Everything else THROWS.
 *
 * A file that exists but cannot be read, or parses to something that is not a credential, must never
 * degrade to null: "no user configured" is the state the bootstrap answers by MINTING A NEW PASSPHRASE,
 * so a corrupt file read as an absence would silently replace a working credential with one nobody has
 * — and the person who owned the old one would be locked out with no error anywhere. An absence is a
 * finding; a broken file is not an absence.
 *
 * ENOENT is caught from the read itself rather than pre-checked with existsSync: the pre-check has a
 * race (the file can vanish or appear between the two calls) and would report the race as a crash.
 */
export function readLocalCredential(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return null;   // the ONLY absence
    throw new Error(`local credential ${path} exists but could not be read (${e?.code ?? e?.message}) — refusing to treat an unreadable credential as "no user configured"`);
  }
  let rec;
  try { rec = JSON.parse(text); } catch { throw new Error(`local credential ${path} is not valid JSON — it has been truncated or edited by hand`); }
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) throw new Error(`local credential ${path} is not a credential object`);
  const need = ["email", "salt", "hash", "algo"];
  const missing = need.filter((k) => typeof rec[k] !== "string" || !rec[k]);
  if (missing.length) throw new Error(`local credential ${path} is missing ${missing.join(", ")} — it is not a credential this build wrote`);
  if (rec.algo !== ALGO) throw new Error(`local credential ${path} was written with ${rec.algo}, and this build derives ${ALGO} — refusing to check a passphrase against parameters it was not hashed with`);
  return {
    email: rec.email,
    salt: rec.salt,
    hash: rec.hash,
    algo: rec.algo,
    createdAt: typeof rec.createdAt === "string" ? rec.createdAt : null,
  };
}

/**
 * establishCredential({ path, email, passphrase = null }) → { passphrase, generated }
 *
 * Writes the ONE credential and hands the plaintext back so the caller can print it ONCE. This function
 * never logs and never returns the record — the only thing a caller can do with the value is show it to
 * the person standing there.
 *
 * `flag: "wx"` rather than a check-then-write: an existing credential is REFUSED, atomically. Overwriting
 * would mint a passphrase nobody asked for over one somebody has already written down, and a
 * check-then-write would still lose a race with a second process starting at the same moment.
 *
 * The explicit chmod after the write is not redundant with the `mode` option. `mode` is masked by the
 * process umask (0o600 under a umask of 0o077 is fine; under an inherited 0o000 it is still 0o600, but
 * under a permissive umask the DIRECTORY mode is what slips) and it applies only when the file is
 * created. Setting the bits afterwards states the requirement rather than hoping the environment
 * agreed with it. The directory is only tightened when THIS call created it — silently re-permissioning
 * a directory the operator already had is not ours to do.
 */
/**
 * WHERE THE LOCAL CREDENTIAL LIVES — one definition, because two readers now need it.
 *
 * The service resolved this inline. The `passphrase` verb has to resolve the SAME file or its reset
 * mints a second credential somewhere the portal will never read, and the operator is locked out by a
 * command whose whole job was to let them in. A path computed twice is a path that can disagree once.
 *
 * NOT in the repository (a credential in a checkout is a credential in a diff) and NOT under the pool
 * or archive root (that tree is client matter, synced and backed up as such).
 */
export function credentialPathFor(env = process.env, home = null) {
  // `homedir()` is resolved ON THE RETURN LINE, not as a signature default, and that is deliberate:
  // 's arm finds the single line naming the credential's env override and asserts the fallback
  // derives from homedir() rather than a literal path. A one-line decision gets a one-line check, and
  // a signature default would put the fact where that check cannot see it. `home` stays injectable.
  //
  // The env variable's NAME is deliberately not written in this comment: the arm takes the FIRST
  // matching line, and a comment that names it becomes that line.
  return env.PORTAL_LOCAL_CREDENTIAL || join(home ?? homedir(), ".cordillera", "portal-local-credential.json");
}

/**
 * A new passphrase — the ONE place the entropy decision is made.
 *
 * 18 bytes to 24 base64url characters, no padding and no ambiguous punctuation: readable off a terminal,
 * typeable into a browser, 144 bits so a generated one is never the weak half of this design.
 *
 * Exported ( — F10) because the SUPERVISOR now mints on a first foreground start,
 * so that the summary can print the value instead of pointing at a log line above it. Two generators
 * would be two entropy decisions, and the second one is always the weaker.
 */
export function newPassphrase() {
  return randomBytes(18).toString("base64url");
}

export function establishCredential({ path, email, passphrase = null }) {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) throw new Error("establishCredential: an email address is required — it is the identity the session will carry");
  const generated = passphrase == null;
  // 18 bytes → 24 base64url characters, no padding and no ambiguous punctuation: readable off a
  // terminal, typeable into a browser, and 144 bits of entropy so a generated one is never the weak
  // half of this design.
  const secret = generated ? newPassphrase() : String(passphrase);
  if (!secret) throw new Error("establishCredential: an empty passphrase is not a credential");
  const salt = randomBytes(16).toString("base64url");
  const rec = {
    email: e,
    salt,
    hash: derive(secret, salt).toString("base64url"),
    algo: ALGO,
    createdAt: new Date().toISOString(),
  };
  const dir = dirname(path);
  const created = mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (created) { try { chmodSync(created, 0o700); } catch { /* best-effort: the mode option already asked */ } }
  writeFileSync(path, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  return { passphrase: secret, generated };
}

/**
 * checkPassphrase(record, passphrase) → boolean
 *
 * Never throws, on any input. A login form is reachable by anything that can open a socket, so every
 * malformed shape — a missing record, a number where a string belongs, a 10 MB body — has to come back
 * as a plain false rather than as a 500 that says something about the internals.
 *
 * The timing-safe compare is over the DERIVED DIGESTS, which are equal-length by construction, never
 * over the raw input: timingSafeEqual throws on a length mismatch, so comparing raw input would turn a
 * wrong-length passphrase into an exception — and an exception that only fires for one class of wrong
 * answer is itself an oracle.
 */
export function checkPassphrase(record, passphrase) {
  if (!record || typeof record.salt !== "string" || typeof record.hash !== "string") return false;
  if (typeof passphrase !== "string" || !passphrase) return false;
  if (record.algo !== ALGO) return false;
  let got;
  try { got = derive(passphrase, record.salt); } catch { return false; }
  let want;
  try { want = Buffer.from(record.hash, "base64url"); } catch { return false; }
  if (want.length !== got.length) return false;
  return timingSafeEqual(got, want);
}

// ── the session token ────────────────────────────────────────────────────────────────────────────
//
// `ps1.<base64url JSON {sub, exp, jti}>.<base64url HMAC-SHA256>` — the same three-part shape
// shared/scope.mjs mints (`v1.<body>.<sig>`), with its own version tag so the two can never be confused
// by eye either. `exp` is UNIX SECONDS, matching scope.mjs; `jti` is a per-session id so a future
// revocation list has a handle to name (nothing consumes it yet, and it costs 12 characters).
/**
 * ── — WHO IS ON THE OTHER END OF STDERR ──────────────────────────────────
 *
 * The one-time passphrase handoff was written for an operator watching a terminal: print it once, say
 * it cannot be read back, never print it again. That is right for a terminal and wrong everywhere else.
 * Under a systemd unit stderr is the journal — durable and readable by anyone with journal access.
 * Under CI it is a build log kept indefinitely. Under a test harness it is a captured string an
 * assertion can embed. Same line, same intent, and in three of those four places the credential
 * outlives the moment it was meant for.
 *
 * MEASURED, not hypothetical: a live generated passphrase reached a runner's output through a failing
 * assertion that embedded the portal's stderr. That one was ephemeral and the directory was deleted.
 * On CI it would have been durable and readable by everyone who could see the run.
 *
 * ✕ NEITHER HALF OF THAT PAIR IS WRONG ON ITS OWN TERMS, which is why it survived: the service is doing
 * a deliberate credential handoff, and the harness is doing ordinary diagnostics. They compose.
 *
 * THE DECISION IS TAKEN BEFORE ANYTHING IS MINTED, which is why it is separate from the lines below. A
 * credential minted and only then found undeliverable is the silent invention this issue's second half
 * is about: the digest is on disk, the plaintext is gone, and the operator has an install nobody can
 * sign into and no sentence saying why. So a non-terminal boot with no recovery route to name refuses,
 * and mints nothing.
 *
 * NOT REACHABLE FROM TODAY'S CALL SITE, and said plainly rather than left to look like protection: the
 * service composes its reset command from a literal, so `resetCommand` is never empty there. This
 * guards the invariant against a future caller, and the arm drives it directly.
 */
export function localCredentialHandoff({ isTTY, resetCommand = "" }) {
  const reset = String(resetCommand ?? "").trim();
  if (isTTY) return { mint: true, printPassphrase: true, refusal: null };
  if (!reset) {
    return {
      mint: false, printPassphrase: false,
      refusal: "stderr is not a terminal and no passphrase-reset command could be named, so a credential "
        + "created now could not be handed to anybody. Refusing to start rather than minting one nobody "
        + "can obtain \u2014 start once with stderr on a terminal, or write the credential file directly.",
    };
  }
  return { mint: true, printPassphrase: false, refusal: null };
}

/**
 * The first-run notice, composed rather than logged, so an arm can assert on the TEXT.
 *
 * Which branch was taken proves less than what the branch would have WRITTEN: the thing that must be
 * true is that the secret does not appear in the non-terminal form, and only reading the lines shows
 * that. The arm passes a passphrase in on the non-terminal branch anyway and requires it absent, so a
 * caller that wires the secret through the wrong branch reds rather than leaking.
 */
export function firstRunCredentialLines({ handoff, credentialPath, email, passphrase = null, resetCommand = "" }) {
  const head = `local sign-in: no credential at ${credentialPath}, so one has been created for ${email}.`;
  if (handoff?.printPassphrase) {
    return [head, `  PASSPHRASE: ${passphrase}`,
      "  Write it down now. It is not stored anywhere in a form that can be read back, and this line will not be printed again."];
  }
  return [head,
    "  The passphrase is NOT printed here: stderr is not a terminal, so this line would outlive the moment \u2014 a journal, a CI log, or a test's captured output.",
    "  Nothing holds it now, this process included: what is on disk is a digest. To get one you can sign in with, run:",
    `    ${resetCommand}`];
}

export const SESSION_DOMAIN = "portal-session.v1|";
const SESSION_PREFIX = "ps1";
const sign = (secret, body) => createHmac("sha256", secret).update(SESSION_DOMAIN + body).digest("base64url");

/** mintSession({ email, secret, ttlSec, now }) → token. 12 hours: a working day, then sign in again. */
export function mintSession({ email, secret, ttlSec = 60 * 60 * 12, now = Date.now() }) {
  if (!secret) throw new Error("mintSession: a signing secret is required (fail-closed; an unsigned session is not a session)");
  const e = String(email ?? "").trim().toLowerCase();
  if (!e) throw new Error("mintSession: a session must name the identity it carries");
  const payload = { sub: e, exp: Math.floor(now / 1000) + Math.floor(ttlSec), jti: randomBytes(9).toString("base64url") };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${SESSION_PREFIX}.${body}.${sign(secret, body)}`;
}

/**
 * verifySession({ token, secret, now }) → { email } | null
 *
 * NULL FOR EVERYTHING WRONG — malformed, wrong family, bad signature, unparseable, expired. A caller
 * that gets null shows the login page; there is no branch it could usefully take on WHY, and a reason
 * handed back to an unauthenticated caller is a description of the check they are trying to beat.
 */
export function verifySession({ token, secret, now = Date.now() }) {
  if (!secret || typeof token !== "string" || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_PREFIX) return null;
  const [, body, sig] = parts;
  if (!body || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(secret, body));
  // Length first: timingSafeEqual throws on unequal lengths, and a forged token is free to be any
  // length at all.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!p || typeof p !== "object") return null;
  if (typeof p.sub !== "string" || !p.sub) return null;
  if (typeof p.exp !== "number" || !Number.isFinite(p.exp) || p.exp <= Math.floor(now / 1000)) return null;
  return { email: p.sub };
}

/**
 * makeAttemptLimiter({ max, windowMs }) → { take(key, now) → boolean }
 *
 * A fixed window, deliberately separate from the portal's RateLimiter. That one is a 120/minute token
 * bucket sized for status polling and page assets; 120 passphrase guesses a minute is not a rate limit
 * on a passphrase. This is 10 attempts per 5 minutes and it counts EVERY attempt, not only the failures
 * — counting failures alone lets a caller reset the window with one correct-looking request.
 *
 * ON A LOOPBACK-ONLY INSTALL THE KEY IS ALWAYS 127.0.0.1, so the window is effectively global rather
 * than per-attacker. That is correct for the install this exists for — one user, one machine, no third
 * party who could be denied by someone else's attempts — and it is stated rather than implied, because
 * the same counter would need a different key if this ever faced a network.
 */
export function makeAttemptLimiter({ max = 10, windowMs = 5 * 60 * 1000 } = {}) {
  const windows = new Map();   // key -> { start, n }
  return {
    take(key, now = Date.now()) {
      const k = String(key ?? "anon");
      // Bounded memory: the map only ever holds keys seen inside one window, and expired ones are
      // dropped as they are touched. A loopback install holds exactly one entry.
      for (const [other, w] of windows) if (now - w.start >= windowMs) windows.delete(other);
      let w = windows.get(k);
      if (!w || now - w.start >= windowMs) { w = { start: now, n: 0 }; windows.set(k, w); }
      if (w.n >= max) return false;
      w.n += 1;
      return true;
    },
  };
}
