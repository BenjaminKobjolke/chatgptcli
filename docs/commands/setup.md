# setup

Preflight check. Validates local prerequisites and prints next steps. Changes nothing.

```bash
chatgptcli setup
```

No options.

## Checks

- Bun available on PATH
- opencli root resolved (env override or `.omx/reference/opencli` default)
- opencli built entry (`dist/src/main.js`)
- opencli browser bridge module (`dist/src/browser/index.js`)
- Browser Bridge extension directory (`<root>/extension`)

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

`0` when all checks pass, `2` (config error) otherwise.

## After setup passes

1. Have Chrome running with the Browser Bridge extension loaded (dedicated profile via `scripts/launch-chatgpt-browser.bat` on Windows / `.sh` on macOS, or your normal profile with the unpacked extension).
2. Log into `https://chatgpt.com/` once in that browser.
3. Verify: `chatgptcli ask "hello"`.
