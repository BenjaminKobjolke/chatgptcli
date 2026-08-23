# Install & Chrome profile setup

chatgptcli drives your own logged-in Chrome via the OpenCLI Browser Bridge extension.
The one thing that needs a decision is **which Chrome profile** it talks to — and whether you
also want to reach that profile by launching Chrome manually. Three solutions below; pick one.

## 1. Install the tool

Requirements:

- [Bun](https://bun.sh) >= 1.0 (only to build/run from source)
- Chrome/Chromium with the [OpenCLI Browser Bridge extension](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk)
- An OpenCLI checkout reachable via the `.omx/reference/opencli` junction (see `docs/BUILD_EXECUTABLE.md`)

Build the exe (or run from source):

```bash
bun build --compile --outfile chatgptcli.exe src/main.js   # or: bun run src/main.js …
```

## 2. How the profile is chosen

`set-chrome` writes two things to `~/.chatgptcli/settings.json`:

| Key | Meaning |
|---|---|
| `chrome.executable` | which Chrome binary `launch` starts |
| `chrome.profileDir` | passed verbatim to Chrome's `--user-data-dir` — **this is the profile** |

The profile is decided by `--user-data-dir`, **not** by which `.exe` you run. Two exes with
different names (`chrome.exe`, `chatgpt.exe`) in the same folder are identical copies and load
the same profile if given the same flag. See `docs/CHROME_SESSIONS.md` for the bridge-routing layer.

`launch` also adds `--load-extension=<opencli>/extension` **only** when that dir resolves on disk.
The compiled exe often can't resolve it and prints a note — in that case the extension must be
**installed permanently** in the profile (solution A), or you launch Chrome yourself with the flag
(solution C).

## 3. Pick a profile solution

### A. Chrome's default profile — bare `chrome.exe` works too (recommended)

Point the tool at the dir Chrome uses when launched with no flags, and install the extension
permanently there. Then manual launch and tool launch hit the same profile with the bridge
always on.

```bash
chatgptcli set-chrome "D:\Apps\chrome-chatgpt\chrome.exe" --profile "C:\Users\XIDA\AppData\Local\Chromium\User Data"
```

- Find your build's default dir: `%LOCALAPPDATA%\Chromium\User Data` for a plain Chromium build,
  `%LOCALAPPDATA%\Google\Chrome\User Data` for branded Chrome.
- **Install the OpenCLI extension from the Web Store** into that profile once (so bare launch keeps
  the bridge — bare launch passes no `--load-extension`).
- Log into chatgpt.com once.

**This is the currently configured setup.**

### B. A dedicated per-tool profile — isolated

Let the tool own a private profile (the default if you never pass `--profile`):
`~/.chatgptcli/chrome-profile`. Clean separation, but logins do not carry to any other tool, and
you must use `chatgptcli launch` (which loads the extension via the flag) — bare `chrome.exe` will
not use it.

```bash
chatgptcli set-chrome "D:\Apps\chrome-chatgpt\chrome.exe"    # no --profile -> private default
chatgptcli launch
```

### C. A neutral profile shared across tools (chatgptcli + tolinocli + …)

One profile every OpenCLI tool points at, so a single Chrome window is logged into all sites at
once. Owned by no single tool.

```bash
# optional: seed from an already-logged-in profile (Chrome fully closed first)
robocopy "C:\Users\XIDA\.chatgptcli\chrome-profile" "C:\Users\XIDA\.opencli\chrome-profile" /E /R:1 /W:1

chatgptcli set-chrome "D:\Apps\chrome-chatgpt\chrome.exe" --profile "C:\Users\XIDA\.opencli\chrome-profile"
tolinocli  set-chrome "D:\Apps\chrome-chatgpt\chrome.exe" --profile "C:\Users\XIDA\.opencli\chrome-profile"
```

Launch via a tool (or a shortcut carrying `--user-data-dir` + `--load-extension`), because a
neutral dir has no store-installed extension unless you add one. See the
"Sharing one Chrome profile across tools" section in `docs/CHROME_SESSIONS.md`.

## 4. Verify

```bash
chatgptcli launch         # (or manual launch for solution A)
chatgptcli ask "hello"    # a real answer -> live login OK
```

`Multiple Browser Bridge profiles are connected` → `chatgptcli switch-session`.
