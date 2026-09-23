# Fonts

The two typefaces every report, pool index and portal page is set in. They ship inside the package, and
each report carries them inside its own file, so opening a report fetches nothing from anywhere.

| File | Typeface | Licence |
|---|---|---|
| `plus-jakarta-sans.woff2` | Plus Jakarta Sans, the text face, weights 200–800 | SIL Open Font License 1.1, [`OFL-plus-jakarta-sans.txt`](OFL-plus-jakarta-sans.txt) |
| `fira-code.woff2` | Fira Code, the code face, weights 300–700 | SIL Open Font License 1.1, [`OFL-fira-code.txt`](OFL-fira-code.txt) |

Neither licence reserves a font name, so these subsets keep their names.

## Where they come from

Each file is a subset of the variable font in the [google/fonts](https://github.com/google/fonts)
repository:

| File | Source | Last upstream commit to that folder | sha256 of the source file |
|---|---|---|---|
| `plus-jakarta-sans.woff2` | `ofl/plusjakartasans/PlusJakartaSans[wght].ttf` | `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5` | `89b3fb38aa0d275d7a731d0d817a4f1622b316b4d7fbdedcf02ee9099ff68bc8` |
| `fira-code.woff2` | `ofl/firacode/FiraCode[wght].ttf` | `5020a98352f1909554697e1da4132da253727138` | `9335b082b3c7850d98a64b584f3417f65355f3471278bb5eeb8c6c0e8657aeeb` |

The licence files are that repository's `OFL.txt` for each family.

The subset keeps the Latin and Latin Extended ranges Google Fonts serves, plus the four arrows U+2190–2193,
which the reports use and Google's Latin range leaves out. It keeps every layout feature, the whole
weight axis and every name record, so the copyright and licence notices stay inside each file. Made with
fonttools 4.65.0:

```sh
pyftsubset <source>.ttf --flavor=woff2 --layout-features='*' --name-IDs='*' --name-languages='*' \
  --name-legacy --notdef-outline --output-file=<file>.woff2 \
  --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD,U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"
```

A character outside that set, such as Japanese or Greek, is drawn by the reader's own system fonts, as it
was before these files existed.
