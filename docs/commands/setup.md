# setup

Preflight check. Validates local prerequisites and the Browser Bridge connection, and prints next steps. Changes nothing.

```bash
chatgptcli setup
```

No options.

## Checks

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
bootstrap opencli):

| Line | Meaning |
|---|---|
| `[OK] Browser Bridge connected: <profile>` | Ready. |
| `[OK] Browser Bridge connected: <profile> (stored default <old> is not connected)` | Works — the daemon fell back to the only connected profile — but the pick stored by `switch-session` is stale. Run `chatgptcli switch-session`. |
| `[OK] Browser Bridge daemon not running yet (...)` | Not a failure: the daemon starts with the first `ask` or `read`. |
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
