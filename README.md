# chatgptcli

Browser-backed ChatGPT CLI for agent use.

It does not use the OpenAI API. It drives the authenticated `chatgpt.com` web UI through the local `opencli` Browser Bridge already installed in Chrome/Chromium.

## Commands

- [`chatgptcli ask <prompt> [--new] [--file <path>] [--timeout <seconds>] [--max-attempts <n>] [--retry-delay-ms <ms>] [-f json|text]`](docs/commands/ask.md)
- [`chatgptcli read [chat-url-or-id] [-f json|text]`](docs/commands/read.md)
- [`chatgptcli switch <chat-url-or-id>`](docs/commands/switch.md)
- [`chatgptcli switch-session [number|contextId|none]`](docs/commands/switch-session.md)
- [`chatgptcli set-chrome <path-to-chrome.exe> [--profile <dir>]`](docs/CHROME_SESSIONS.md)
- [`chatgptcli launch`](docs/CHROME_SESSIONS.md)
- [`chatgptcli doctor [--sessions] [--no-live]`](docs/commands/doctor.md)
- [`chatgptcli setup`](docs/commands/setup.md)

Chrome executable, profile dir and bridge-session selection are configured in `~/.chatgptcli/settings.json` — see [docs/CHROME_SESSIONS.md](docs/CHROME_SESSIONS.md).

`chatgptcli ask` includes a built-in retry plan. It reuses the `site:chatgpt` browser session, falls back to a fresh chat on retry, and returns JSON by default for agent consumption.

## Requirements

- Bun
- Google Chrome / Chromium
- [`opencli` Browser Bridge extension](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk) installed in Chrome/Chromium
- A browser profile that has already logged into `chatgpt.com` at least once

## Build Windows Executable

```bash
bun run build
# or
tools\build.bat
```

Produces a single self-contained `chatgptcli.exe` in the repo root — the opencli Browser Bridge is bundled into the exe, so `ask`/`read`/`switch` need no Bun and no opencli checkout at runtime. Copy the exe anywhere or add the repo directory to your PATH. The [Chrome extension](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk) must still be installed. `doctor` is unavailable in the exe; run it from the repo with `bun run src/main.js doctor`. Details: [docs/BUILD_EXECUTABLE.md](docs/BUILD_EXECUTABLE.md).

## Claude Code Plugin

Install the skill as a plugin (no clone, no build). This repo is also its own plugin marketplace, so first add it as a marketplace, then install the plugin from it:

```
# 1. Add this repo as a marketplace (GitHub shorthand or full URL)
/plugin marketplace add BenjaminKobjolke/chatgptcli
/plugin marketplace add https://github.com/BenjaminKobjolke/chatgptcli.git

# 2. Install the plugin from that marketplace
/plugin install chatgptcli@chatgptcli
```

Then say things like "ask chatgpt what is 2+2", "get the chatgpt chat", or "get the chat for https://chatgpt.com/c/<id>". On first use the skill downloads `chatgptcli.exe` from the latest GitHub release to `~/.chatgptcli/bin/`. Plugin source lives in [`plugin/`](plugin/).

To update the plugin to the latest version (also as `/plugin ...` slash commands in a session):

```
# 1. Refresh the marketplace (pulls the latest repo commits)
claude plugin marketplace update

# 2. Update the plugin
claude plugin update chatgptcli
```

Skill changes load immediately; for other plugin parts run `/reload-plugins` or restart the session. Note: this updates the skill only — `chatgptcli.exe` is updated separately via new GitHub releases.

To publish a new release with the exe attached (requires `gh` CLI, logged in):

```bash
tools\build_and_create_github_release.bat
```

Full release flow (version/build bump, release notes, publish): [docs/CREATE_NEW_RELEASE.md](docs/CREATE_NEW_RELEASE.md).

## One-Click Setup Check

Run:

```bash
bun run src/main.js setup
# or
scripts/setup.sh
```

This validates:
- Bun availability
- resolved `opencli` path (env override or default)
- built entry existence (`dist/src/main.js`)
- browser bridge module existence
- extension directory presence, plus exact browser/login next steps

## Fastest Browser Bootstrap

- Run `chatgptcli launch` (configure a custom Chrome first with `chatgptcli set-chrome <exe>`; `scripts/launch-chatgpt-browser.sh|.bat` still work as fallback)
- This opens a dedicated Chrome profile with the local `opencli` extension preloaded
- Log into `https://chatgpt.com/` once inside that profile
- If more than one extension-enabled Chrome profile is running, pick one with `chatgptcli switch-session`
- Future `chatgptcli ask` calls can reuse that browser profile

## Notes

- `chatgptcli ask` uses the ChatGPT web app, not the OpenAI API.
- `chatgptcli ask` talks directly to `opencli`'s `BrowserBridge`; it does not rely on the desktop-only `opencli chatgpt` adapter.
- `chatgptcli doctor` forwards to `opencli doctor`.
- `chatgptcli setup` is a local preflight checker and does not change the browser-backed execution model.
- By default, `chatgptcli` looks for `opencli` in `.omx/reference/opencli`.
- If your `opencli` lives somewhere else, set `CHATGPTCLI_OPENCLI_ROOT=/path/to/opencli`.
- If you want to point directly at a built entry file, set `CHATGPTCLI_OPENCLI_MAIN=/path/to/opencli/dist/src/main.js`.

## Examples

```bash
bun run src/main.js ask "Summarize this post"
bun run src/main.js ask "Reply with only OK" --new -f json
bun run src/main.js ask "Hello" --max-attempts 3 --retry-delay-ms 1000 -f json
bun run src/main.js doctor
bun run src/main.js setup
```
