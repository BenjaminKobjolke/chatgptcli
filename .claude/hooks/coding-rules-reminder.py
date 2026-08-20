"""Claude Code reminder hook for CODING_RULES.md. Serves two events:

- PostToolUse (matcher: ExitPlanMode) — plan accepted: always remind.
- PreToolUse (matcher: Edit|Write|MultiEdit) — first code edit of a session:
  remind once, tracked by a per-session marker file in the temp dir.

Plain stdout is NOT shown to Claude for either event; only the
hookSpecificOutput.additionalContext JSON field is injected.
Installed into projects by /coding-rules:apply. Managed by the coding-rules plugin.
"""
import json
import re
import sys
import tempfile
import time
from pathlib import Path

MARKER_PREFIX = "coding-rules-reminded-"
MARKER_MAX_AGE = 7 * 24 * 3600

PLAN_ACCEPTED = (
    "The plan was just accepted. MANDATORY before implementing: Read the "
    "project's CODING_RULES.md in full in this session and follow every "
    "applicable rule while writing code. If already read this session, "
    "re-confirm the rules relevant to the files you are about to change."
)
FIRST_EDIT = (
    "First code edit this session. If you have not read the project's "
    "CODING_RULES.md in this session, Read it in full before continuing "
    "and follow every applicable rule."
)


def emit(event, text):
    print(json.dumps({
        "hookSpecificOutput": {"hookEventName": event, "additionalContext": text}
    }))


def main():
    if Path(__file__).with_name("coding-rules-reminder.off").exists():
        return  # disabled via /coding-rules:hooks off
    try:
        data = json.load(sys.stdin)
    except Exception:
        return  # never block tools on malformed input
    event = data.get("hook_event_name", "")
    if event == "PostToolUse":
        emit("PostToolUse", PLAN_ACCEPTED)
    elif event == "PreToolUse":
        session = re.sub(r"[^A-Za-z0-9_-]", "", str(data.get("session_id", "")))
        if not session:
            return
        tmp = Path(tempfile.gettempdir())
        now = time.time()
        for stale in tmp.glob(MARKER_PREFIX + "*"):
            try:
                if now - stale.stat().st_mtime > MARKER_MAX_AGE:
                    stale.unlink()
            except OSError:
                pass
        marker = tmp / (MARKER_PREFIX + session)
        if marker.exists():
            return
        try:
            marker.touch()
        except OSError:
            pass
        emit("PreToolUse", FIRST_EDIT)


if __name__ == "__main__":
    main()
