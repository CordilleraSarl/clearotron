// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// About — and it is the AGPL §13 source offer, not a credits page (,).
//
// WHAT §13 ACTUALLY ASKS FOR, because it decides everything on this screen. An operator running a
// MODIFIED version of an AGPL work over a network must offer its users the source of THAT version.
// Not the project's source. Not the default branch. The source of the build they are talking to. So
// the load-bearing element here is the COMMIT, and a page that renders a repository link without one
// looks compliant while offering the wrong thing.
//
// WHICH IS WHY A MISSING COMMIT IS SAID OUT LOUD. `productIdentity` returns `commit: null` on a
// deployment that is not a git checkout, and falls its `sourceUrl` back to the bare repository. The
// honest rendering of that pair is a stated caveat, not a link that quietly means something weaker
// than it appears to. The failure this avoids is the one nobody ever notices: an offer that resolves,
// looks right, and points at code the user is not running.
//
// EVERYTHING HERE COMES FROM THE SERVER. The bundle cannot know its own commit — portal-ui/dist is
// committed to git and CI fails when dist and source disagree, so a hash injected at build time is not
// known until after the commit that would carry it, and dist could never match its source again.
//
// THE LICENCE IS READ, NEVER RESTATED. `license` comes from the root manifest via the server. A
// constant here would be a second answer that disagrees with package.json for as long as the relicence
// takes, and this page would be the one asserting it to users.

import { useEffect, useState } from 'react'
import { api } from '../contract/api.ts'
import type { About as AboutInfo } from '../contract/api.ts'
import { isOk } from '../contract/api.ts'

const LICENCE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html'

export function About() {
  const [info, setInfo] = useState<AboutInfo | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    void api.about().then((r) => {
      if (!live) return
      if (isOk(r)) setInfo(r.value)
      else setFailed(true)
    })
    return () => { live = false }
  }, [])

  if (failed) {
    return (
      <section className="screen">
        <h1>About</h1>
        <p>
          This deployment could not report which build it is running. That is a fault, not a
          configuration choice — the source offer below is incomplete without it.
        </p>
        <p>
          Source: <a href="https://github.com/CordilleraSarl/Clearotron">github.com/CordilleraSarl/Clearotron</a>
        </p>
      </section>
    )
  }
  if (!info) return <section className="screen"><h1>About</h1><p>Loading…</p></section>

  const shortSha = info.commit ? info.commit.slice(0, 12) : null

  return (
    <section className="screen">
      <h1>About {info.name}</h1>

      <dl>
        <dt>Product</dt>
        <dd>{info.name}{info.version ? ` ${info.version}` : ''}</dd>

        <dt>Build</dt>
        <dd>
          {shortSha
            ? <code title={info.commit ?? undefined}>{shortSha}</code>
            : <span>not reported by this deployment</span>}
        </dd>

        <dt>Source</dt>
        <dd>
          <a href={info.sourceUrl} rel="noreferrer">{info.sourceUrl}</a>
          {!info.commit && (
            <>
              {' '}
              <strong>
                This links to the repository, not to the exact build you are using — this deployment
                could not report its commit.
              </strong>
            </>
          )}
        </dd>

        <dt>Licence</dt>
        <dd>
          {info.license ?? 'not reported'}
          {' — '}
          <a href={LICENCE_URL} rel="noreferrer">full text</a>
        </dd>

        <dt>Copyright</dt>
        <dd>{info.copyright}</dd>
      </dl>

      {/* THE REPO'S OWN DOCUMENTS, LINKED. Each points at the file in the source
          repository the same way the trademark link below already does, rather than at prose describing
          it. SECURITY.md and CODE_OF_CONDUCT.md are included because both are present at the repo root
          and are standard for a public repository — say so if either should come out.
          `sourceRepo`, not `sourceUrl`: the second is commit-pinned where the deployment could report
          one, and a document link pinned to a build would rot the moment that build is superseded,
          while these files are meant to be read as they stand today. */}
      <p>
        <a href={`${info.sourceRepo}/blob/main/LICENSE`} rel="noreferrer">Licence</a>{' · '}
        <a href={`${info.sourceRepo}/blob/main/NOTICES.md`} rel="noreferrer">Notices</a>{' · '}
        <a href={`${info.sourceRepo}/blob/main/TRADEMARKS.md`} rel="noreferrer">Trademarks policy</a>{' · '}
        <a href={`${info.sourceRepo}/blob/main/CONTRIBUTING.md`} rel="noreferrer">Contributing</a>{' · '}
        <a href={`${info.sourceRepo}/blob/main/SECURITY.md`} rel="noreferrer">Security</a>{' · '}
        <a href={`${info.sourceRepo}/blob/main/CODE_OF_CONDUCT.md`} rel="noreferrer">Code of conduct</a>{' · '}
        <a href={info.sourceRepo} rel="noreferrer">View on GitHub</a>{' · '}
        <a href="https://clearotron.ai" rel="noreferrer">clearotron.ai</a>
      </p>

      {/* The mark is NOT licensed with the code, and this is the surface where someone reads the
          licence and reasonably assumes otherwise. §7(e) of the AGPL expressly permits declining to
          grant trademark rights, and TRADEMARKS.md is where that declination is written down. */}
      <p>
        <strong>{info.name}</strong> and the mountain mark are trade marks of Cordillera Sàrl. The
        licence above covers the software; it does not grant any right in the name or the mark. See{' '}
        <a href={`${info.sourceRepo}/blob/main/TRADEMARKS.md`} rel="noreferrer">TRADEMARKS.md</a>.
      </p>

      {/* BRING YOUR OWN ACCESS, said plainly and once. The paragraph this replaces
          said the same thing in licence terms — "grants nothing over any of them" — which answers a
          lawyer's question and leaves an operator's unanswered. The operational fact leads now and the
          licence clause follows it, rather than a second paragraph repeating the first in other words.
          Aligned with the README (the reasoning stages ride whatever access you already have; the paid
          registers are your own agreements) and promises nothing the README does not. */}
      <p>
        This runs on your own model access — a subscription or your own API key — and the paid registers
        on your own agreements with those providers. The reasoning stages are a proprietary third-party
        CLI that you install and license under that vendor&rsquo;s own terms; this licence grants nothing
        over any of them.
      </p>
    </section>
  )
}
