# setup

Preflight check. Validates local prerequisites, the Browser Bridge connection, and whether the selected browser profile is logged into ChatGPT.

```bash
chatgptcli setup
```

No options.

## Checks

After the Browser Bridge connects, setup opens `https://chatgpt.com/` only when the tab is not already on a ChatGPT page, then checks ChatGPT's session state:

| Line | Meaning |
|---|---|
| `[OK] ChatGPT logged in (profile <id>)` | The browser profile has a ChatGPT session. |
| `[FAIL] ChatGPT is not logged in in the bridge browser (profile <id>)` | Log in at `https://chatgpt.com/` in the bridge browser window and rerun setup. |
| `[FAIL] ChatGPT login state could not be checked: <reason>` | The session check failed or returned no result. Open `https://chatgpt.com/` in the bridge browser and rerun setup. |

A failed login check makes setup exit with code `6`, like other configuration failures.

Run from source (`bun run src/main.js setup`):

- Bun available on PATH
- opencli root resolved (env override or `.omx/reference/opencli` default)
- opencli built entry (`dist/src/main.js`)
- opencli browser bridge module (`dist/src/browser/index.js`)
- Browser Bridge extension directory (`<root>/extension`)

The compiled exe bundles the bridge and needs no Bun, so it prints one
`[OK] opencli Browser Bridge: bundled` line instead of those five.

Both then ask the bridge daemon which browser profiles are connected (skipped
from source while an on-disk check fails, since loading the bridge would
bootstrap opencli). When stopped, setup starts the bridge, which keeps running
in the background as it does after `read`, and waits up to 30 seconds for the
extension to connect:

| Line | Meaning |
|---|---|
| `[OK] Browser Bridge connected: <profile>` | Ready. |
| `[OK] Browser Bridge connected: <profile> (stored default <old> is not connected)` | Works — the daemon fell back to the only connected profile — but the pick stored by `switch-session` is stale. Run `chatgptcli switch-session`. |
| `[FAIL] Browser Bridge daemon could not be started` | Retry `chatgptcli setup`; if it keeps failing, make sure no other program uses the bridge port and the exe is not blocked. |
| `[FAIL] Browser Bridge: no browser profile connected` | Chrome is not running, or the OpenCLI extension is missing or disabled. |
| `[FAIL] Browser Bridge: several profiles connected (...), none selected` | Run `chatgptcli switch-session`. |

## Path resolution

| Env var | Meaning |
|---|---|
| `CHATGPTCLI_OPENCLI_ROOT` | Path to the opencli checkout |
| `CHATGPTCLI_OPENCLI_MAIN` | Direct path to a built opencli entry file |

Without overrides, `.omx/reference/opencli` under this repo is used. A directory junction/symlink to an existing checkout works:

```powershell
New-Item -ItemType Junction -Path .omx\reference\opencli -Target D:\path\to\OpenCLI
```

## Exit codes

`0` when all checks pass, `6` (config error) otherwise.

## After setup passes

1. Have Chrome running with the Browser Bridge extension loaded (dedicated profile via `scripts/launch-chatgpt-browser.bat` on Windows / `.sh` on macOS, or your normal profile with the unpacked extension).
2. Log into `https://chatgpt.com/` once in that browser.
3. Verify: `chatgptcli ask "hello"`.
