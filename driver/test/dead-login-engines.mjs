// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Two engine programs whose sign-in is dead, for the tests that must catch one. Each still looks signed in from
// the disk: the Codex one has its sign-in file and answers `login status` with "Logged in using ChatGPT", as the
// real one did on a production install whose renewal had been refused for three weeks. Every turn is refused, in
// the program's own words:
//   - Claude ends a `-p` turn with "Invalid API key · Please run /login" and exits 1;
//   - Codex 0.162.0 writes its refused renewal to stderr, fails the turn and exits 1 (the two lines are the ones
//     a-codex-renewal-that-fails-for-a-moment-is-not-a-sign-out.test.mjs replays, as codex wrote them).
// The shebang names this node, so a test that pins PATH to the system folders still starts them. Windows has no
// shebang: there the `.mjs` name is what starts them, because the product runs a JavaScript engine program through
// the Node running now (engineSpawn), as it runs Codex's npm launcher.
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CODEX_REFUSED = [
  "2026-11-03T13:39:36.110059Z ERROR codex_login::auth::manager: Failed to refresh token status=401 Unauthorized detail=TokenErrorDetail { error_code: Some(\"refresh_token_reused\"), error_message: Some(\"Your refresh token has already been used to generate a new access token. Please try signing in again.\"), .. }",
  "2026-11-03T13:39:36.110114Z ERROR codex_login::auth::manager: Failed to refresh token: Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.",
];

const CLAUDE = `process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Invalid API key · Please run /login" }) + "\\n");
  process.exit(1);
});
`;

const CODEX = `const a = process.argv.slice(2);
if (a.includes("login") && a.includes("status")) { console.log("Logged in using ChatGPT"); process.exit(0); }
process.stdin.resume();
process.stdin.on("end", () => {
  process.stderr.write(${JSON.stringify(CODEX_REFUSED.join("\n") + "\n")});
  const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
  send({ type: "thread.started", thread_id: "dead-login" });
  send({ type: "turn.started" });
  send({ type: "turn.failed", error: { message: "Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again." } });
  process.exit(1);
});
`;

function program(path, body) {
  writeFileSync(path, `#!${process.execPath}\n${body}`);
  chmodSync(path, 0o755);
  return path;
}

/**
 * Write both programs into `dir`. Returns the settings that choose each, ready to spread into an environment:
 * `claude` and `codex`, plus `authFile`, the Codex sign-in file that makes it look signed in.
 */
export function deadLoginEngines(dir) {
  const authFile = join(dir, "auth.json");
  writeFileSync(authFile, JSON.stringify({ auth_mode: "chatgpt", tokens: { refresh_token: "spent" } }) + "\n");
  const claude = program(join(dir, "claude-signed-out.mjs"), CLAUDE);
  const codex = program(join(dir, "codex-signed-out.mjs"), CODEX);
  return {
    authFile,
    claude: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: claude },
    codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_AI_BILLING: "subscription", CLEAROTRON_CODEX_PATH: codex, CLEAROTRON_OPENAI_AUTH_FILE: authFile },
  };
}
