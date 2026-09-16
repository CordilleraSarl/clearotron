// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// One Save press, two requests: the dry run, then the write — and the write only on the dry run's own verdict.
//
// A profile the engine cannot read takes that company's searches down, so a write is always preceded by
// the server running the engine's own load-time validators over the same body. That used to be two
// buttons, Check and then Save, and the second was disabled until the first had passed: a reader met a
// Save that would not press and a line telling them to press something else first. The order is a rule
// about requests, not a job for the reader, so it lives here and one press runs both.
//
// PURE OVER ITS POSTER, so the rule can be driven: a test hands it a fake that answers each step and
// reads what reached the "server". The screen hands it the real call.

import type { Result } from './api.ts'
import { isOk } from './api.ts'

type Answer = Result<Record<string, unknown>>

export type SaveOutcome =
  /** The dry run answered and its verdict was no. Nothing was written. `errors` may be empty. */
  | { readonly kind: 'refused'; readonly errors: readonly string[] }
  /** A request itself failed — the dry run's or the write's. Nothing more was sent after it. */
  | { readonly kind: 'failed'; readonly result: Answer }
  /** Checked, then written. */
  | { readonly kind: 'saved'; readonly result: { readonly kind: 'ok'; readonly value: Record<string, unknown> } }

/**
 * THE TRANSPORT ANSWERING IS NOT THE PROFILE BEING ACCEPTABLE. The dry run returns 200 carrying its
 * verdict — `{ ok: false, errors: [...] }` — and a reader of the status alone once reported a refused
 * profile as checked, leaving the write to fail with the reasons the dry run already held. The verdict is
 * read here, and a refusal never reaches the write.
 */
export async function checkThenSave(post: (action: 'validate' | 'save') => Promise<Answer>): Promise<SaveOutcome> {
  const check = await post('validate')
  if (!isOk(check)) return { kind: 'failed', result: check }
  const errors = Array.isArray(check.value['errors']) ? (check.value['errors'] as unknown[]).map(String) : []
  if (check.value['ok'] === false || errors.length) return { kind: 'refused', errors }
  const written = await post('save')
  return isOk(written) ? { kind: 'saved', result: written } : { kind: 'failed', result: written }
}
