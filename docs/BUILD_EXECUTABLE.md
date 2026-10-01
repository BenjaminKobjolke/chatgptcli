# Build a Standalone Windows Executable

Compile the CLI into a single self-contained `chatgptcli.exe` using Bun's `--compile`. The opencli Browser Bridge (and its dependencies, including the bridge daemon) is bundled into the exe, so at runtime it needs **no Bun, no Node, and no `.omx/reference/opencli` checkout**.

## Build

```bash
bun run build
# or
tools\build.bat
```

Both run:

```bash
bun build --compile --outfile chatgptcli.exe src/main.js
```

Output: `chatgptcli.exe` in the repo root (~100 MB, gitignored). Copy it anywhere or add the repo directory to your `PATH`:

```bash
chatgptcli.exe read
chatgptcli.exe ask "hello" -f text
```

### Install the local build for the Claude plugin

```bash
tools\install_local.bat
```

Builds, then copies the exe to `%USERPROFILE%\.chatgptcli\bin\chatgptcli.exe` — the path the Claude plugin skill uses outside this repo. Use it to test an unreleased build from other projects. It kills running `chatgptcli.exe` daemons first (they lock the file). The skill text itself is not touched; that only updates through a release plus `claude plugin update` (see [CREATE_NEW_RELEASE.md](CREATE_NEW_RELEASE.md)).

## Runtime requirements

- Google Chrome / Chromium with the OpenCLI extension installed and enabled
- A browser profile already logged into `chatgpt.com`

That's it — the bridge daemon starts automatically from inside the exe.

## What works in the exe

| Command | Compiled exe | Notes |
|---|---|---|
| `ask` | ✅ | In-process bundled BrowserBridge |
| `read` | ✅ | In-process bundled BrowserBridge |
| `switch` | ✅ | In-process bundled BrowserBridge |
| `setup` | ✅ | |
| `set-chrome` | ✅ | Writes `~/.chatgptcli/settings.json` |
| `launch` | ✅ | Starts the configured Chrome; no `--load-extension` (the exe carries no extension dir — install the extension in Chrome manually); prints the next step (log in, then `setup`) |
| `switch-session` | ✅ | Lists connected bridge profiles, stores the pick in `~/.chatgptcli/settings.json` |
| `doctor` | ❌ | Spawns the opencli CLI; hidden from `--help`, exits 6 pointing at `setup`. Run `bun run src/main.js doctor` from the repo instead. |

## How the compiled build works

Three things break naively when Bun compiles this project, and how they are handled:

1. **Detecting compiled mode.** Inside a compiled exe, module paths live on a virtual filesystem (`B:\~BUN\root\...` on Windows, `/$bunfs/` on POSIX). `IS_COMPILED` in `src/core/opencli.js` checks `Bun.main` for these markers. Note: `import.meta.url` URL-encodes `~` as `%7E`, so it cannot be string-matched for `~BUN` — use `Bun.main`.

2. **Loading the BrowserBridge.** In dev, `loadBrowserBridge()` dynamically imports `.omx/reference/opencli/dist/src/browser/index.js` from disk. When compiled, it uses a *literal* import specifier for the same file so the bundler embeds the bridge and its node_modules dependencies into the exe.

3. **The bridge daemon spawn.** The bridge starts its daemon with `spawn(process.execPath, [<dir>/daemon.js])`. In the compiled exe, `process.execPath` is `chatgptcli.exe` itself and the script path is a virtual `B:\~BUN\...\daemon.js` that doesn't exist on disk. `src/main.js` intercepts this exact argument shape (contains `~BUN`, ends with `daemon.js`) and runs the *bundled* daemon module in-process instead of treating it as a CLI command.

Dev mode (`bun run src/main.js ...`) is unaffected: it still resolves opencli from `.omx/reference/opencli` (or `CHATGPTCLI_OPENCLI_ROOT`) and spawns it with the real Bun.

## Rebuilding

Rebuild after any change to `src/` **or** to the opencli checkout under `.omx/reference/opencli/dist` — the bridge code is baked in at build time.

## Verifying a build

```bash
chatgptcli.exe --version
chatgptcli.exe read            # from a directory outside the repo
```

`read` should return bridge JSON (e.g. `{"ok": true, ...}`), not `CONFIG_INVALID: opencli reference repo not found`.
