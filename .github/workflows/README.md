# Workflows

| File | What it checks or does | When it runs |
|---|---|---|
| `ci.yml` | The offline test suites, lint, licence headers and the other repository checks, on Linux. | On every pull request and every push to `main`. |
| `cla.yml` | Whether each contributor has signed the contributor licence agreement. | On pull requests and their comments. |
| `release.yml` | Turns the pending release notes into a version, then tags, releases and publishes it to npm. | On a push to `main`, every five minutes, and by hand. |
| `macos.yml` | Installs the packed package on macOS, runs `clearotron doctor`, and starts and stops the demo. | Daily, by hand, and from the release before a stable. |
| `windows.yml` | The same install, doctor and demo on Windows from PowerShell, plus Ctrl-C on `clearotron start`, a whole clearance on each engine against stand-in engine programs, and the whole driver suite in four shards. | Daily, by hand, and from the release on every beta and stable, where the suite does not run; a red run holds a stable. |
| `scorecard.yml` | The OpenSSF Scorecard checks of the repository's security practices, published to the Scorecard site the README badge reads. | Weekly, on every push to `main`, and when branch protection changes. |
| `mcp-registry.yml` | Lists each stable release npm serves in the MCP Registry, oldest missing first. It never publishes to npm and never holds a release. | Every six hours, and by hand. |
| `bench-replay.yml` | When a push moves a model or an engine program's minimum version, sets a pending `bench replay` status on the pushed commit, which the machine holding saved cases answers with pass or flag. The release reads that answer before a cut. | On a push to `main` or a release-line branch that touches the engine's model or program settings. |

No workflow here calls an AI model, queries a trademark register or holds a key for either.
