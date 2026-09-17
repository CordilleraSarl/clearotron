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
// THE LINK READS AS THE REPOSITORY, AND THE BUILD STAYS ONE ROW ABOVE IT. The Source row used to print
// the whole commit-pinned address, ninety characters wrapped over two lines. It now reads as the
// repository's name, and still goes to the address pinned to this build; the identifier it is pinned to
// is the Build row directly above, in mono, because the offer is to the source of THIS build.
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
import { PageHeader } from '../components/PageHeader.tsx'
import { repositoryName } from '../contract/repositoryName.ts'

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
        <PageHeader title="About" />
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
  if (!info) return <section className="screen"><PageHeader title="About" /><p>Loading…</p></section>

  const shortSha = info.commit ? info.commit.slice(0, 12) : null

  return (
    <section className="screen">
      <div className="measure">
        <PageHeader title="About" />

        <div className="about-card">
          <dl className="about-dl">
            <dt>Product</dt>
            <dd>{info.name}</dd>

            <dt>Version</dt>
            <dd>{info.version ?? 'not reported by this deployment'}</dd>

            <dt>Build</dt>
            <dd>
              {shortSha
                ? <span className="mono" title={info.commit ?? undefined}>{shortSha}</span>
                : <span>not reported by this deployment</span>}
            </dd>

            <dt>Source</dt>
            <dd>
              <a className="about-link" href={info.sourceUrl} rel="noreferrer">
                {repositoryName(info.sourceRepo)} ↗
              </a>
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
              <span className="about-row">
                <span>{info.license ?? 'not reported'}</span>
                <a className="pill" href={LICENCE_URL} rel="noreferrer">Full text</a>
              </span>
            </dd>

            {/* The row names it, so the value does not say "Copyright" a second time. */}
            <dt>Copyright</dt>
            <dd>{info.copyright.replace(/^Copyright\s+/i, '')}</dd>

            {/* BRING YOUR OWN ACCESS, said plainly and once. The operational fact leads and the licence
                clause follows it. Aligned with the README (the reasoning stages ride whatever access you
                already have; the paid registers are your own agreements) and promises nothing the README
                does not. */}
            <dt>Model access</dt>
            <dd>
              This runs on your own model access — a subscription, an API key, or your own cloud account — and
              the paid registers on your own agreements with those providers. The reasoning stages are a
              third-party command-line program, Claude Code (proprietary) or the Codex CLI (Apache-2.0), that
              you install and license under that vendor&rsquo;s own terms; this licence grants nothing over any
              of them.
            </dd>

            {/* The mark is NOT licensed with the code, and this is the surface where someone reads the
                licence and reasonably assumes otherwise. §7(e) of the AGPL expressly permits declining to
                grant trademark rights, and TRADEMARKS.md is where that declination is written down. */}
            <dt>Trade marks</dt>
            <dd>
              <strong>{info.name}</strong> and the mountain mark are trade marks of Cordillera Sàrl. The
              licence above covers the software; it does not grant any right in the name or the mark. See{' '}
              <a className="about-link" href={`${info.sourceRepo}/blob/main/TRADEMARKS.md`} rel="noreferrer">TRADEMARKS.md</a>.
            </dd>
          </dl>

          {/* THE REPO'S OWN DOCUMENTS, LINKED. Each points at the file in the source repository rather
              than at prose describing it. SECURITY.md and CODE_OF_CONDUCT.md are included because both
              are present at the repo root and are standard for a public repository.
              `sourceRepo`, not `sourceUrl`: the second is commit-pinned where the deployment could report
              one, and a document link pinned to a build would rot the moment that build is superseded,
              while these files are meant to be read as they stand today. */}
          <div className="about-docs">
            <a className="pill" href={`${info.sourceRepo}/blob/main/NOTICES.md`} rel="noreferrer">Notices</a>
            <a className="pill" href={`${info.sourceRepo}/blob/main/TRADEMARKS.md`} rel="noreferrer">Trademarks</a>
            <a className="pill" href={`${info.sourceRepo}/blob/main/CONTRIBUTING.md`} rel="noreferrer">Contributing</a>
            <a className="pill" href={`${info.sourceRepo}/blob/main/SECURITY.md`} rel="noreferrer">Security</a>
            <a className="pill" href={`${info.sourceRepo}/blob/main/CODE_OF_CONDUCT.md`} rel="noreferrer">Code of conduct</a>
            <a className="pill" href={info.sourceRepo} rel="noreferrer">GitHub</a>
            <a className="pill" href="https://clearotron.ai" rel="noreferrer">clearotron.ai</a>
          </div>
        </div>
      </div>
    </section>
  )
}
