# switch-session

Select which connected Chrome profile (Browser Bridge session) `ask`, `read` and `switch` talk to. The choice is stored in `~/.chatgptcli/settings.json`.

```bash
chatgptcli switch-session                # list profiles, pick interactively
chatgptcli switch-session 2             # pick by list number, no prompt
chatgptcli switch-session <contextId>   # pick by contextId, no prompt
chatgptcli switch-session none          # clear the stored pick
```

## When you need it

When more than one Chrome profile runs the OpenCLI extension, the bridge daemon refuses to guess and `ask`/`read` fail with:

```
CONFIG_INVALID: Multiple Browser Bridge profiles are connected
Hint: Run: chatgptcli switch-session
```

## Behavior

- Lists connected profiles as `[n] <contextId> v<extensionVersion>`, marking the stored one `(current)`.
- No argument + multiple profiles: prompts `Select profile [1-N]:` on stdin.
- No argument + exactly one profile: selects it automatically, no prompt.
- Invalid number/contextId: exits 2 (`INPUT_INVALID`).
- Daemon not running: exits 6 (`CONFIG_INVALID`) with a hint to run `chatgptcli launch` first.

## Storage and fallback

The pick is saved as `chrome.bridgeProfile` in `~/.chatgptcli/settings.json` and passed to the bridge as a *preference*, not a hard requirement:

- Stored profile connected → used.
- Stored profile gone, exactly one other connected → that one is used automatically.
- Stored profile gone, several others connected → error again; rerun `switch-session`.

See `docs/CHROME_SESSIONS.md` for the full session model.

## Notes

- Works in the compiled `chatgptcli.exe` (queries the daemon directly, does not spawn the opencli CLI).
- contextIds are assigned by the OpenCLI extension per Chrome profile (e.g. `qfqeup77`).
