# Workflows

| File | What it checks or does | When it runs |
|---|---|---|
| `ci.yml` | The offline test suites, lint, licence headers and the other repository checks, on Linux. | On every pull request and every push to `main`. |
| `cla.yml` | Whether each contributor has signed the contributor licence agreement. | On pull requests and their comments. |
| `release.yml` | Turns the pending release notes into a version, then tags, releases and publishes it to npm. | On a push to `main`, every five minutes, and by hand. |
| `macos.yml` | Installs the packed package on macOS, runs `clearotron doctor`, and starts and stops the demo. | Daily, by hand, and from the release before a stable. |
| `windows.yml` | The same install, doctor and demo on Windows from PowerShell, plus Ctrl-C on `clearotron start`, a whole clearance on each engine against stand-in engine programs, and the whole driver suite in four shards. | Daily, by hand, and from the release on every beta and stable, where the suite does not run; a red run holds a stable. |

No workflow here calls an AI model, queries a trademark register or holds a key for either.
