// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Driving one run from your own assistant, from inside the shell.
//
// THE DEFECT. The full clearance report carries an "Ask your AI about this run"
// band — a copy-question button, the connector address, and the setup recipes. The portal shell STRIPS
// that band from every client-facing framed report, because it names the STAFF host, and unlike the
// report's Export menu — which the shell strips and then reproduces in its own header — nothing
// reproduced this one. The knockout renderer never had a band at all.
//
// So no client, on any run kind, could reach an Ask-AI control anywhere in the portal. The owner
// reported it missing; it was missing by construction.
//
// THE ADDRESS HERE IS THE CLIENT DOOR AND NEVER THE STAFF HOST. That is the whole reason the band is
// stripped in the first place, and re-introducing the host through a control the shell draws itself
// would defeat the strip rather than complete it. The address comes from /portal/api/mcp-access, which
// reports the deployment's CLIENT connector or null — never a placeholder.

/**
 * The sentence a reader says to their assistant.
 *
 * ONE RULE, TWO SURFACES. The report composes this too (`askAiPrompt` in driver/publish/render.mjs) and
 * the two must not drift — a reader who copies it off the page and a reader who copies it out of a
 * delivered document are asking the same question about the same run. The parity test joins this to the
 * driver's own function rather than to a second copy of the template.
 */
export function askAiPrompt(runId: string | null, mark?: string | null): string {
  const name = String(mark ?? 'this mark').trim() || 'this mark'
  return runId ? `Brief me on trademark clearance run ${runId}.` : `Brief me on the ${name} trademark clearance.`
}

/** What the Ask-AI control can offer, given what the deployment has wired. */
export type AskAiOffer = {
  /** Always present: the question to paste, whatever the connector state. */
  readonly question: string
  /** The CLIENT connector address, or null when this deployment has not wired one. Never the staff host. */
  readonly address: string | null
  /** Where the per-assistant setup instructions live. */
  readonly instructionsPath: string
  /**
   * The local stdio route, when this reader can use one.
   *
   * Null for a hosted client — they have no checkout to spawn a server from, so the command would be a
   * false offer. Non-null for staff, whose machine has this install on its disk. The string is COMPOSED
   * SERVER-SIDE and handed over: the browser cannot know the install's own path, which is what makes
   * three surfaces stating this route unable to drift apart.
   */
  readonly stdio: { readonly command: string; readonly note: string; readonly verify: string } | null
}

/**
 * Compose the control's contents.
 *
 * A NULL ADDRESS IS AN ANSWER, NOT A GAP. A deployment with no client connector says so — the same
 * discipline the Use-your-AI screen already keeps, and the reason the API returns null rather than a
 * plausible host. The question is still worth having: it is the sentence to say once a connector exists,
 * and it costs nothing to show.
 */
export function askAiOffer(
  runId: string,
  mark: string | null,
  access: {
    readonly url: string | null
    readonly enabled: boolean
    readonly stdio?: { readonly command: string; readonly note: string; readonly verify: string } | null
  } | null,
): AskAiOffer {
  return {
    question: askAiPrompt(runId, mark),
    address: access?.enabled ? access.url : null,
    instructionsPath: '/portal/ai',
    // Passed through, never composed here. A null address WITH a stdio route is a local install, and
    // that is the case where this control used to show a question and nowhere to ask it.
    stdio: access?.stdio ?? null,
  }
}
