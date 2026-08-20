# Creating a New Release

Release label = `<version>_<build>` (e.g. `0.1.0_1`).

- `version` — semver from `package.json` (`version` field). Bump **by hand** when needed. `src/cli.js` imports it, so the exe's `--version` follows automatically.
- `build` — plain integer in `build_version.txt` (project root).

## 1. Get the current version

```bash
tools\version_get.bat    # full label, e.g. 0.1.0_1
tools\build_get.bat      # build number only
```

## 2. Increment the build number

```bash
tools\build_increment.bat    # +1, prints new value
tools\build_decrement.bat    # -1 (undo)
```

Bump the semver in `package.json` by hand only for feature/breaking releases — the GitHub tag is `v<version>`, and `gh` fails if the tag already exists. The Claude plugin manifest (`plugin/.claude-plugin/plugin.json`) is synced to the `package.json` version automatically by the release bat — `claude plugin update` reads that file, so a stale value there makes updates report "already at the latest version".

### Min exe version

The exe self-checks `plugin/skills/chatgptcli/min_exe_version.txt` on every start (shipped with the plugin, found via the Claude plugin cache) and reports `UPDATE_REQUIRED` (exit 7) when it is older — that is what makes users re-download the exe. Hand-maintained, no bat sync. **When to update it:**

- Release contains `src/` changes the skill depends on (new command/flag/output the skill uses, changed output format, bug fix the skill needs) → bump the semver in `package.json` AND write that same semver into the min-version file. Installed exes older than it will self-report `UPDATE_REQUIRED` and get re-downloaded.
- Release is skill-only, docs-only, or the exe change is backward compatible for the skill → leave the min-version file untouched. Users keep their working exe; no forced 116 MB re-download.
- Never set it higher than the `package.json` semver being released — the freshly downloaded "latest" exe must satisfy it, or every user loops on `UPDATE_REQUIRED`.

## 3. Create the release notes

Create `release-notes/<label>/en.json`, where `<label>` is the output of `tools\version_get.bat`:

```json
{
  "version": "0.1.0",
  "build": 1,
  "date": "YYYY-MM-DD",
  "title": "Short headline",
  "notes": ["bullet one", "bullet two"]
}
```

- The actual release text goes in the **`notes`** array.
- **Create only `en.json`.** This project is English-only — the translation step is intentionally skipped (no translation bat). If other locales are ever needed, wire up GPT-json-translator (`D:\GIT\BenjaminKobjolke\GPT-json-translator`, recursive mode) with a wrapper bat in `tools/`.

## 4. Build and publish the release

```bash
tools\build_and_create_github_release.bat        # interactive: asks about exe upload
tools\build_and_create_github_release.bat Y      # automated: upload exe, no prompt
tools\build_and_create_github_release.bat N      # automated: no exe, no prompt
```

What it does:

1. Kills stale `chatgptcli.exe` daemon instances (they lock the exe).
2. Builds `chatgptcli.exe` via `tools/build.bat` (Bun `--compile`).
3. Reads the semver from `package.json` and the label from `tools/version_get.bat`.
4. Uses `release-notes/<label>/en.json` (title + notes bullets) as the GitHub release body; falls back to `--generate-notes` with a warning if the folder is missing.
5. **Asks on every run whether to upload `chatgptcli.exe`** to the release (Y/N). No = release is created without the exe asset. Pass `Y` or `N` as the first argument to skip the prompt (automated/skill runs).
6. Creates GitHub release `v<version>` via `gh release create`.

## Release notes distribution

Release notes live **in git only** (`release-notes/`). Deliberate decisions, don't re-ask in future setups:

- No in-app release notes view (CLI tool; users read GitHub releases / the repo).
- Release notes are not bundled into the exe.
- No Windows installer — the single self-contained exe on GitHub releases is the artifact.
