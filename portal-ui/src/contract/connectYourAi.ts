// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Connect your AI — what the page says about this reader's connection, decided from the answer it was given.
//
// PURE, BECAUSE THE PROPERTY IS ABOUT DATA. What the page claims depends on a three-valued wire field, and
// a test reading the page's source cannot see which branch a value takes. So each decision lives here,
// where an arm can hand it null and read back that nothing was claimed.

import type { RememberedReport } from './askAi.ts'

/** The pill beside "Connect it": its words, and whether its dot is lit. */
export type ConnectionPill = { readonly label: string; readonly on: boolean }

/**
 * THREE VALUES, TWO PILLS. True reads "Connected" and false "Not connected yet". NULL IS NO PILL: the value
 * is null when the connector's access log could not be read, and a page drawing "Not connected yet" from
 * that tells the reader something the product does not know.
 */
export function connectionPill(aiConnected: boolean | null | undefined): ConnectionPill | null {
  if (aiConnected === true) return { label: 'Connected', on: true }
  if (aiConnected === false) return { label: 'Not connected yet', on: false }
  return null
}

/**
 * The line under the last step saying how the reader will know it worked — or null.
 *
 * ONLY WHILE THE ANSWER IS "NOT YET". Once connected the pill already says so. Where the log cannot be read
 * the page will never say Connected, so a line promising that it will would be untrue.
 */
export function watchForConnected(aiConnected: boolean | null | undefined): string | null {
  return aiConnected === false ? 'This page says **Connected** once your assistant calls Clearotron.' : null
}

/** Whether the steps fold away under "Setup steps": once connected, and only then. */
export const foldsSteps = (aiConnected: boolean | null | undefined): boolean => aiConnected === true

/**
 * The way back to the report the reader came from — "Continue with VENQORI" — or null.
 *
 * ALL THREE MUST HOLD: the reader arrived from a report's Ask AI, this browser remembers which report, and
 * the pill reads Connected. From the rail there is nothing to go back to. From a report but not connected
 * yet, the steps are the point, and the button would return the reader to a panel still telling them to
 * connect first.
 */
export function continueOffer(input: {
  readonly aiConnected: boolean | null | undefined
  readonly fromReport: boolean
  readonly remembered: RememberedReport | null
}): { readonly label: string; readonly report: RememberedReport } | null {
  if (input.aiConnected !== true || !input.fromReport || !input.remembered) return null
  return { label: `Continue with ${input.remembered.mark ?? 'the report'}`, report: input.remembered }
}
