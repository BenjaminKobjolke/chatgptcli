# doctor

Forward to `opencli doctor` to diagnose the Browser Bridge (daemon, extension connection, sessions).

```bash
chatgptcli doctor [--sessions] [--no-live]
```

## Options

| Option | Description |
|---|---|
| `--sessions` | Include session details |
| `--no-live` | Skip live checks |

## Notes

- Source checkout only. The compiled exe does not carry the opencli CLI: there `doctor` is left out of `--help` and exits 6 pointing at [`setup`](setup.md), which reports the bridge connection.
- Thin wrapper: arguments are passed straight to the resolved opencli checkout (`opencli doctor ...`); output and exit code come from opencli.
- Useful when `ask` fails with bridge/profile errors (e.g. "Multiple Browser Bridge profiles are connected" — then run `opencli profile list` / `opencli profile use <name>`).
