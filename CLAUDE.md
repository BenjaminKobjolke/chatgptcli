# Version
2

# Coding Rules (Pointer)

This project's rules live in two files in the project root:

- `CODING_RULES.md` — code quality and conventions. BINDING for all code work in
  this repository, always.
- `IMPLEMENTATION_FLOW.md` — the end-to-end flow to follow when planning and
  implementing a change (checks, gates, Definition of Done).

MANDATORY: Before writing or editing ANY code, you MUST Read BOTH files in full
**in the current session**. Do not rely on memory of a previous session, a
summary, or partial reads.

If you are about to make a code change and have not read both files in this
session: STOP, read them, then continue.

An external tool may orchestrate the implementation itself. When a skill or run
states that the implementation is orchestrated, ignore `IMPLEMENTATION_FLOW.md`
entirely — the orchestrator runs those steps as its own phases. `CODING_RULES.md`
stays binding either way.

Do not inline rules back into this file and do not use `@import` for either file —
they are intentionally referenced, not imported.


# chatgptcli

## Graphify

Scan root is `src` only, built with `/graphify src --directed` into the root
`graphify-out/` (gitignored). Rebuild at that same scope; never the repo root.

## Code Analysis

Two analysis modes — pick by situation:

**Changed-files run (default after implementing a feature, finishing a plan, or
fixing a bug):**

```bash
powershell -Command "cd 'D:\GIT\GitHub\chatgptcli'; cmd /c '.\tools\analyze_changed_and_new_files.bat'"
```

Uses `--only-changed`: the report is filtered to files new/modified vs git `HEAD`
(includes untracked). Project-wide analyzers still run; only the report is
filtered. Fast feedback, no noise from pre-existing violations elsewhere.

**Full run (whole-project audits):**

```bash
powershell -Command "cd 'D:\GIT\GitHub\chatgptcli'; cmd /c '.\tools\analyze_code.bat'"
```

Use the full run for: an explicit audit request (`/analyze:run-and-fix`),
exception maintenance (`/analyze:improve-exceptions`), before a release/merge,
after refactors that touch shared code, or when the working tree is clean vs
`HEAD` (a changed-files run would report nothing).

Results are written to `code_analysis_results/` as **per-rule CSV files** (e.g.
`eslint_analyze.csv`, `line_count_report.csv`, `duplicate_code.csv`) — there is
no `.md` report, and a missing CSV means that rule found nothing. Fix any
reported issues before committing.

## Skill sync after feature work (MANDATORY)

The plugin skill `plugin/skills/chatgptcli/SKILL.md` is what Claude Code actually
reads at runtime. Users only get it through `claude plugin update`, which reads
`plugin/.claude-plugin/plugin.json` — so a feature that never reaches the skill,
or a skill change that never reaches a release, is invisible to every user.

After adding or changing ANY user-facing command, flag, or output format:

1. Update `plugin/skills/chatgptcli/SKILL.md` — the command-mapping table (new
   user intent -> command) AND the notes (when to reach for it, what it returns).
   If the feature is a recovery path for a wrong-looking result, say that
   explicitly; the skill must tell the agent when to retry with the new flag.
2. Bump the semver in `package.json` and, if the skill now depends on the new
   exe behaviour, write that same semver into
   `plugin/skills/chatgptcli/min_exe_version.txt` (never higher than the
   released semver). See `docs/CREATE_NEW_RELEASE.md`.
3. Update `docs/commands/<command>.md` and `README.md` if the surface changed.
4. Ship a release (`tools\build_increment.bat` then
   `tools\build_and_create_github_release.bat`). Without it the plugin version
   is unchanged and `claude plugin update` reports "already at the latest
   version" while serving the old skill.

A feature is not done at the code — it is done when the skill describes it and a
release carries it.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
