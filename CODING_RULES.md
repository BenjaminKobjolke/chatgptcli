<!-- Managed by /coding-rules:apply — do not edit rule blocks by hand -->
<!-- codex: disabled -->
<!-- deepseek: enabled -->

# Version
3

Increase this version number whenever this rule file changes.

# Common Rules (All Languages)

These rules apply to all projects, regardless of language. Language-specific rules live in the
corresponding `*_RULES.md` files.

---

## Keep CODING_RULES.md in Sync

When working on a project, copy all relevant rules into the project's `CODING_RULES.md` file
(project root). The project's `CLAUDE.md` carries only a small versioned pointer block that
mandates reading `CODING_RULES.md` before code work — never the full rules, and never an
`@import` of `CODING_RULES.md` (imports auto-expand into context every turn).

- Always include all rules from `COMMON_RULES.md` and `AI_RULES.md`
- Also include applicable language-specific, project-type, and supplemental rule files
  (see `PROJECT_TYPES.md` for the project-type overview)
- Include optional addon rule files only when the user has opted in to that addon
- If applicability is unclear, ask the user which rules to include
- Include each source file's `# Version` block with its copied rules
- If `CODING_RULES.md` already exists, compare each source file's version with the corresponding
  copied rule block and update only stale or unversioned blocks, keeping the result deduplicated
- If `CLAUDE.md` contains inlined rule blocks or coding-rule `@import` lines from an earlier run,
  migrate that content into `CODING_RULES.md` and leave only the pointer block in `CLAUDE.md`

---

## Use Objects for Related Values

When multiple related values must be passed between classes or methods, bundle them into a
dedicated object (e.g., DTO/Settings/Config) instead of passing many parameters. This improves
readability, reduces call-site churn, and makes changes safer.

---

## No Bag-of-Keys Returns at Module Boundaries

When a public method on a manager/repository/service returns data that crosses a module
boundary, the return type must be a typed object (DTO, value object, or domain model) — never
a raw associative array indexed by string keys. Plain `array` returns silently swallow shape
bugs: a missing key reads as `null`, a list-vs-single mix-up reads as "no data", and renames
go undetected by static analysis.

- **Anti-pattern.** `getSettingsValue(...)` returns `array|null`; callers do `$result['value']`,
  `$result['type']`. A consumer mis-indexes `$result[0]['value']` after a refactor; nothing
  flags the change. The function silently returns `null` and downstream defaults take over.
- **Correct pattern.** Return a class — `getSettingsElement(...): ?SettingsElement`. The class
  exposes `getValue()`, `getType()`, `exists()`. Typed, autocompleted, statically checked;
  renames propagate via the IDE.
- **Lists vs single must be obvious from the type and the name.** `getThing(): ?Thing`
  (zero or one) vs `getThings(): ThingList` or `iterable<Thing>`. Never overload the same
  return type to mean both.
- **Distinguish absent from empty.** `null` from a lookup means "not found"; an empty
  collection means "found, but had nothing". A typed return makes this contract explicit;
  a bag-of-keys array hides it.
- **JSON-decoded blobs are arrays too.** The rule applies equally to `json_decode($column, true)`
  results that cross a module boundary — wrap them in a value object before they leave the
  layer that owns the schema.
- **Internal helpers may stay arrays.** This rule targets *public* API on managers and the
  boundary where a domain abstraction starts. Pure-private array juggling inside a single
  method is fine.

---

## Reuse Existing Models Before Inventing Array Shapes

Before designing a new return type or DTO, search the codebase for an existing domain class
that already owns the same data. Most "should this be a DTO?" decisions are actually
"is there already a `Contest` / `User` / `Order` class that should absorb this method?"

- Grep for the table name, the primary key, and the most distinctive column.
- If a model already exists with a constructor that accepts the row shape, use it — don't
  invent a parallel array shape that mirrors the same columns.
- Adding a `getXxxObject()` alongside a legacy `getXxxData()` is acceptable as a migration
  step; keep both only until consumers are migrated, then delete the array-returning version.

---

## Tests Pin the Shape Before the Refactor

When converting a bag-of-keys return to a typed object, write a **characterization test
first** that locks the current behavior using the existing API, run it green against the
unrefactored code, and then refactor. The same test (or a renamed-but-equivalent one) must
remain green afterward.

This converts "I think the new object preserves behavior" into "the test proves it." Pair
with the "Test-Driven Development" rule below — characterization tests are TDD applied to
refactors instead of new features.

---

## Test-Driven Development for Features and Bug Fixes

Follow TDD when implementing features or fixing bugs:

1. Write tests first
2. Run the tests and confirm they fail
3. Implement the change or fix
4. Run the tests again and confirm they pass

---

## Integration Tests

Every project must include integration tests in addition to unit tests. Integration tests verify that
components work correctly together and catch issues that unit tests alone cannot detect.

---

## Test Runner Scripts

Every project must provide the following batch files in the `tools/` directory:

- `tools/run_tests.bat` — runs unit tests
- `tools/run_integration_tests.bat` — runs integration tests

These scripts ensure a consistent way to execute tests across environments.

---

## Prefer Type-Safe Values

Use strong, explicit types instead of loosely typed or stringly typed values (e.g., typed DTOs,
enums, generics, typed settings). This ensures mistakes are caught at compile time or by tests
early in development.

---

## String Constants

Centralize string constants in a dedicated module/class. Do not scatter raw strings across
the codebase. Use language-appropriate patterns for constants and reuse them consistently.

---

## Reusable Tooling

Before building project-specific infrastructure scripts (audits, codemods,
build helpers, lint checks, etc.) for a project, check the matching
language's `*_setup_files/` folder under this `coding-rules` repo for an
existing equivalent. If found, copy or reference it. If not:

1. Build the script in the project and prove it on real data.
2. Copy the script into the right `*_setup_files/tools/` folder.
3. Document it in that language's `*_RULES.md` so the next project picks
   it up automatically.

This keeps cross-project tooling consistent and prevents the same script
from being re-invented in every new project.

---

## README.md is Mandatory

Every project must have a `README.md` file in the root directory. It should include:

- Project name and description
- Installation/setup instructions
- Usage examples
- Dependencies and requirements

---

## Don't Repeat Yourself (DRY)

Avoid code duplication. If the same logic appears in multiple places, extract it into a
reusable function, class, module, or utility.

- Duplicate code is harder to maintain and leads to bugs
- Extract shared logic into helpers or base abstractions
- Use constants for repeated values

---

## Derive, Don't Duplicate — One Value Owns the Derivation

When one value strictly determines another, pass only the determinant and derive the rest —
never thread both side-by-side through call sites, constructors, and events. Two co-varying
parameters are a functional dependency in disguise; passing both lets them drift into illegal
combinations.

- **Anti-pattern.** `createLog(ActionCategory $cat, ActionType $type)` threaded through ~10
  sites. Nothing stops a caller passing `category: email, type: lead.created`.
- **Correct pattern.** The richer type owns the relationship: `ActionType::category()` returns
  its `ActionCategory` via a single exhaustive `match`. Call sites pass only `ActionType`;
  category is always derived, so a mismatch is unconstructable.
- **Apply when** one value *determines* the other (a true functional dependency).
- **Don't apply when** the relationship is many-to-many or genuinely independent — forcing a
  derivation that doesn't exist couples things that should stay separate.
- **Keep derivation cheap and pure** — a getter/match, no DB or IO behind a call that looks free.
- **Keep the mapping exhaustive** (enum + exhaustive match) so a new case cannot silently skip
  its derived value.

This is Single Source of Truth applied to parameters, and a form of "make illegal states
unrepresentable." Pairs with "Prefer Type-Safe Values" and "Self-Describing Classes".

---

## Keep It Simple (KISS)

Prefer the simplest solution that actually works. Complicated logic for a simple result must be
kept to a minimum — a future maintainer (or you, at 3am) has to understand it.

- **YAGNI.** Don't build for a need that isn't here yet: no interface with a single
  implementation, no factory for one product, no config for a value that never changes.
- **Boring over clever.** Clever is what someone decodes later. The obvious solution wins.
- **Deletion over addition.** The shortest working change is usually the right one.
- Pairs with "Don't Repeat Yourself" and "No God Classes" — simplicity is what those rules
  are protecting.

---

## Confirm Dependency Versions

Before adding any new package or library, confirm the version with the user to ensure we use
up-to-date dependencies.

- Do not assume which version to use
- Ask the user to verify the latest stable version
- Avoid outdated packages that may have security vulnerabilities or missing features

---

## Error Handling & Logging Strategy

Every project must have a centralized error handler rather than ad-hoc try/catch blocks scattered
throughout the codebase.

- Use structured logging (not `print`/`console.log`/`echo`)
- Log at appropriate levels: debug, info, warning, error
- Include context in log messages (module name, operation, relevant IDs)

---

## Centralized Logger — Single Off Switch

Route all logging through one dedicated logger class/module. Never call the language's
built-in output directly for logging (`print`, `console.log`, `echo`, `Debug.Log`,
`System.out`). Code calls the project logger; the project logger wraps the underlying sink.

- **One toggle.** Because every log goes through one place, logging can be turned off,
  level-filtered, or redirected (file, console, remote) from a single config flag — without
  touching call sites. Example: a `logEnabled` / `logLevel` setting the logger checks once.
- **Levels live in the logger.** Callers pass a level (debug/info/warning/error); the logger
  decides what is emitted based on central config. Callers never branch on "should I log?".
- **Wrap, don't scatter.** Built-in calls (`print`, framework loggers, `Debug.Log`) appear
  in exactly one file — the logger implementation. Everywhere else imports the logger.
- **Language specifics** still apply (e.g. Unity `[Conditional]` stripping, Flutter `logger`
  package, Python `logging`) — but they are configured inside the central logger, not at
  call sites.

The logger's name is fixed per language so it is the same known type in every project (see each
`*_RULES.md` for details):

| Language      | Class / export     | File                |
|---------------|--------------------|---------------------|
| Python        | `AppLogger`        | `app_logger.py`     |
| PHP           | `Logger`           | `Logger.php`        |
| Dart/Flutter  | `AppLogger`        | `app_logger.dart`   |
| Kotlin        | `AppLogger`        | `AppLogger.kt`      |
| C# (plain)    | `AppLogger`        | `AppLogger.cs`      |
| Unity C#      | `GameLog` (static) | `GameLog.cs`        |
| Svelte/JS/TS  | `logger` (export)  | `logger.ts`         |
| Arduino       | `Log`              | `Log.h` / `Log.cpp` |

---

## Input Validation at Boundaries

Always validate data at system boundaries — API inputs, user input, file uploads, external service
responses.

- Never trust external data; validate before processing
- Use language-appropriate validation libraries (e.g., Pydantic, Zod, FluentValidation)
- Fail fast with clear error messages when validation fails

---

## Maximum File Length — 300 Lines

Split files when they exceed 300 lines to keep code navigable during fast iteration.

- Extract classes, functions, or components into separate modules
- Group related extractions logically (by domain, not by type)
- Exceptions: generated files, configuration files, test files with many similar cases

---

## Naming Conventions

Be consistent within a project. Follow these defaults unless the language or framework dictates
otherwise:

- Files: `snake_case` (or language convention, e.g., `PascalCase` for C# classes)
- Classes: `PascalCase`
- Functions/methods: language convention (`snake_case` for Python/PHP, `camelCase` for Dart/JS/C#)
- Constants: `UPPER_SNAKE_CASE`
- Variables: language convention (`snake_case` for Python/PHP, `camelCase` for Dart/JS/C#)

---

## Comments Explain Why, Not What

Comment intent and non-obvious reasoning — not a restatement of the code. Good names carry the
*what*; comments carry the *why*.

- **Anti-pattern.** `i++ // increment i`. Redundant comments add noise and rot the moment the
  code changes.
- **Correct pattern.** Document *why* a workaround exists, why a non-obvious algorithm was
  chosen, or a constraint that isn't visible locally (`// API rejects batches > 500`).
- Prefer self-documenting code (clear names, small functions) over a comment that compensates
  for unclear code — see "Naming Conventions" and "Keep It Simple".
- Document the purpose of each module/class at its top.
- Keep comments in sync with the code; delete stale ones rather than letting them mislead.

---

## Security Baseline

Every project must follow these minimum security practices:

- Never commit secrets (`.env`, API keys, credentials, private keys)
- Escape output to prevent XSS/injection attacks
- Use parameterized queries or ORM-provided methods — never concatenate user input into queries
- Validate and sanitize all user input at system boundaries
- Keep dependencies updated to avoid known vulnerabilities

---

## No Hardcoded Environment Values

Never hardcode environment-specific values in code — filesystem paths, hostnames, IP addresses,
ports, base URLs. They differ across machines and environments and make code non-portable.

- **Anti-pattern.** `connect("192.168.1.50:5432")`, `open("C:\\Users\\bob\\data\\out.json")`.
- **Correct pattern.** Read them from the project's central config (the config class each
  `*_RULES.md` already mandates), with a committed `.example` template documenting every key.
- Distinct from the secrets rule above: this is about **portability** (runs anywhere), not
  secrecy. A non-secret hostname still belongs in config, not in code.

---

## No God Classes

A class that handles too many responsibilities becomes fragile, hard to test, and impossible to
reuse. Keep each class focused on a single purpose.

- **Warning signs**: more than 5 public methods, more than 4 constructor dependencies, or methods that span unrelated domains (e.g., a class that validates input, queries the database, and sends emails)
- Split by responsibility: extract collaborators (e.g., a `Validator`, a `Repository`, a `Notifier`) rather than piling logic into one class
- If you struggle to name the class without using "Manager", "Handler", "Service", or "Helper" as a catch-all, it likely does too much
- This complements the 300-line file rule — a short class can still be a god class if it owns too many concerns

---

## Self-Describing Classes

When behavior depends on which fields or properties a class has — such as search, serialization,
display, validation, or auditing — the class itself must declare those fields through a contract
(interface, abstract method, attribute/annotation, or introspection pattern). Never hardcode field
lists in consuming code.

- **Anti-pattern**: A search service contains a hardcoded list of fields to index for each entity;
  adding a new field requires updating every consumer manually
- **Correct pattern**: Each class implements a contract (e.g., `GetSearchableFields()`,
  `GetDisplayColumns()`) that returns its own relevant fields, so adding a field in one place
  automatically propagates everywhere
- This applies to any cross-cutting concern that operates over class fields: search, filtering,
  export, form generation, diffing, logging, etc.
- Combine with compile-time checks where the language supports them (e.g., sealed interfaces,
  exhaustive matching) to ensure new fields cannot be silently ignored

---

## Inject Collaborators, Don't Fold Dependencies In

Composition reuse comes in two shapes, and they differ sharply in how much coupling they add to
the reusing class. **Folding** a helper into a class (mixin, trait, multiple inheritance, copy-in
include) merges *all of the helper's own dependencies* into that class — reuse five such helpers
and every one of their imports is now the host's coupling. **Injecting** a collaborator adds a
single dependency: the collaborator, which is built once and shared as a hub.

Prefer injected collaborators. Reserve fold-in reuse for helpers that are stateless and carry no
dependencies of their own.

- **Anti-pattern**: A controller reuses five behavior mixins/traits; each brings its own service,
  DTO, and constant imports, so the controller transitively depends on a few dozen things and is
  hard to test in isolation.
- **Correct pattern**: Extract that behavior into a collaborator object injected via the
  constructor. The controller depends on the collaborator; the collaborator is reused across many
  controllers as a shared, well-tested hub.

### Inject services; never instantiate one inside a method

Constructing a service with `new` (or the language equivalent) inside a method hides the
dependency from the class's public contract and makes it impossible to substitute in a test. Pass
collaborators in through the constructor.

- **Anti-pattern**: A method does `helper = new EmailPreparer(); helper.prepare(...)`. Nothing in
  the class signature reveals the dependency, and no test can replace it.
- **Correct pattern**: Inject `EmailPreparer` once; the method calls the injected instance.

### Collapse config-callback swarms into one value object

When a base class pulls its configuration from the subclass through many small overridable getters
that the subclass fills in one-line-each, each getter is a separate touch-point and the wiring is
spread across dozens of methods. Bundle the related values into a single config object built once
and handed to the base (see **Use Objects for Related Values**). This also keeps such classes off
the wrong side of **No God Classes**.

- **Anti-pattern**: A subclass implements `getSendEndpoint()`, `getSendSuccessKey()`,
  `getSendFailureRedirect()`, and a dozen more one-line getters, each naming one constant.
- **Correct pattern**: The subclass builds one `SendConfig` value object once; the base reads its
  fields.

# Version
10

Increase this version number whenever this rule file changes.

# AI Workflow Rules (All Languages)

See `COMMON_RULES.md` for rules that apply to all languages.

Unlike the per-language `*_RULES.md` files, these rules are **language-independent** and
**always apply**. They are not subject to the "some rules may not apply to this project"
filtering — include them in every project's `CODING_RULES.md`.

These rules define the end-to-end workflow an AI agent must follow when planning and
implementing changes. Each step is an existing skill referenced by its slash name; run the
skill rather than reimplementing its behavior.

---

## Delegation backends (Codex / DeepSeek)

Some of the workflow steps below can be delegated to an external CLI instead
of being performed by the agent itself. Two backends are supported, and they
are **mutually exclusive** — at most one is enabled at a time:

- `<!-- codex: enabled -->` — delegate to Codex, running:
  `codex exec --dangerously-bypass-approvals-and-sandbox "<PROMPT>"`
- `<!-- deepseek: enabled -->` — delegate to DeepSeek, running:
  `reasonix run --auto "<PROMPT>"`
- Neither marker `enabled` (or no marker) — do NOT delegate; perform the same
  checks yourself via the listed fallback skills.

Read precedence if both markers somehow end up `enabled`: Codex wins, then
DeepSeek, then the self-fallback.

The markers are managed by `/coding-rules:codex on|off|status|test` and
`/coding-rules:deepseek on|off|status|test` (or set during
`/coding-rules:apply`). Do not flip them yourself without the user asking.

## Feature / Change Workflow

After a plan is proposed and the user approves it, follow this chain. The DRY
gate is a precondition for implementing — not just an earlier step.

The approved plan must first exist as an explicit Markdown file. Pass that same
path to both plan-DRY commands.

```
plan approved

plan DRY check
  delegate enabled (codex or deepseek — run <PROMPT> via that backend's CLI, see Delegation backends above):
    <PROMPT> = "FULL PATH TO PLAN - Can you check the plan for DRY opportunities and if you find any, apply them to the original plan file. Only edit the plan file — do NOT modify any source code or implement the plan. Always add a summary at the end called SUMMARY DRY — if you made changes, describe what and why; if you found nothing, write 'No DRY opportunities found.'"
  delegate disabled:
    /plan:dry <plan-file>

plan convention check
  delegate enabled (codex or deepseek — run <PROMPT> via that backend's CLI, see Delegation backends above):
    <PROMPT> = "FULL PATH TO PLAN $convention-check - If you want to make any changes, apply them to the original plan file. Only edit the plan file — do NOT modify any source code or implement the plan. Always add a summary at the end called SUMMARY CONVENTION CHECK — if you made changes, describe what and why; if you found nothing, write 'No convention issues found.'"
  delegate disabled:
    /convention:check — apply findings to the plan file

/plan:dry-checked    reload the DRY and convention adjusted plan

restate Definition-of-Done aloud

implement
  While implementing, keep the list of every file you created or modified in THIS
  session — you know it from your own edits; do NOT derive it from git (other
  sessions may have concurrent uncommitted changes). After implementing, write the
  list (one path per line) to a changed-files file next to the plan, named after it:
  <plan-file-path-without-.md>-changed-files.md
  (e.g. claude-plans/my-feature-changed-files.md). The plan file is unique per
  session, so concurrent sessions never collide.
  Include only source-code files. Exclude documentation and other non-code
  files (`.md`, plain-text docs, the plan file itself) — the DRY audit only
  looks at code.

post-implementation DRY audit — scope is ONLY the changed-files file above
  delegate enabled (codex or deepseek — run <PROMPT> via that backend's CLI, see Delegation backends above):
    <PROMPT> = "Read FULL PATH TO CHANGED-FILES FILE and check ONLY the files listed there for DRY opportunities. Do not use git status or git diff to widen the scope — other sessions may have concurrent uncommitted changes. Do NOT modify any code. Write your suggestions to <plan-file-path-without-.md>-post-implementation-check.md (next to the plan, same naming as the changed-files file), overwriting the file if it already exists. Include for each finding the affected files and a short rationale. Always write the file, even if you found nothing — in that case write a SUMMARY block stating 'No DRY opportunities found.'"
    then read that post-implementation-check file, validate each finding, and apply the valid ones. Bring a finding to the user only if a question arises — otherwise apply silently.
  delegate disabled:
    /dry:check <files from the changed-files file, as pathspec>

Post-Feature Verification + Post-Implementation Code Analysis (project-specific, below)

```

### DRY gate (precondition for implementing)

Do not write a single line until ALL are true. Restate this gate aloud at the
moment you start implementing — if you cannot, the gate is not cleared:

- [ ] `/plan:dry <plan-file>` adjusted that file and completed its Ponytail pass.
- [ ] `/plan:dry-checked <plan-file>` reloaded the same adjusted plan.
- [ ] `/convention:check` found the existing utilities/patterns to reuse.

The gate survives the `implement` step: if mid-implementation you add a new
helper, type, or pattern the gate would have caught, stop and re-clear it
before continuing.

### Definition of Done — restate aloud before implementing

Before the first edit, state in chat what "done" means for THIS change:

- [ ] Scope: <one line — what changes, what does not>
- [ ] Reuse: <existing function/component this builds on, with path>
- [ ] DRY gate cleared (above)
- [ ] `/dry:check <session changed-files>` clean (scoped to the changed-files file, never bare)
- [ ] `/verify:after-change` green (tests + analysis)

### Post-implementation DRY audit — paste-in template

Run `/dry:check` scoped to the session's changed-files file, then paste and fill:

```
DRY audit — <change name>
Changed files:     <list from the changed-files file, not git>
Duplication found: <none | describe>
Consolidated into: <shared fn/module + path | n/a>
Convention reused: <name + path>
Verdict:           <clean | needs rework>
```

---

## Bug-Fix Workflow

Bug fixes use a shorter variant (no plan-DRY phase):

```
bugs:fix
  → /verify:after-change
```

---

## Optional Addons

These live in `ai_rules_addons/` and are **not** always-on. Each is opt-in per project — ASK
the user whether they want it before wiring it into that project's `CODING_RULES.md`.

- [`ai_rules_addons/graphify.md`](ai_rules_addons/graphify.md) — graphify knowledge graph:
  scoped + directed AST build, folder layout, gitignore, and the query/refresh rules to paste
  into a project's `CODING_RULES.md`.

# Version
5

Increase this version number whenever this rule file changes.

# graphify Knowledge Graph (Optional Addon)

**Optional.** Before adding this to a project, ASK the user whether they want to use graphify.
Only wire it into the project's `CODING_RULES.md` if they say yes.

graphify turns a code folder into a queryable knowledge graph — god nodes, communities,
cross-file relationships, fan-in/fan-out. The build is AST-only: no LLM, no API cost. Use it to
orient before grep and to spot god classes.

---

## One-time setup

1. **Install the Claude Code integration** (writes a generic graphify section into `CLAUDE.md`
   plus PreToolUse hooks that consult the graph before grep/read):
   ```
   /graphify claude install
   ```
2. **Check `.claude/settings.json` for the Windows slash bug.** On Windows the installer writes
   the hook command with backslash paths, e.g. `C:\\Users\\<you>\\.local\\bin\\graphify.EXE`.
   Claude Code runs PreToolUse hooks through Git Bash, which strips the backslashes →
   `C:Users<you>.local...` → `command not found` on every Bash/Read/Glob. Fix: open
   `.claude/settings.json` and replace the backslashes in the hook `command`(s) with forward
   slashes — `C:/Users/<you>/.local/bin/graphify.EXE` (Git Bash accepts drive paths with `/`).
   Also dedupe: the installer may write a redundant backslash `Bash` entry alongside a correct
   `Bash|Grep` one — keep exactly two entries (`Bash|Grep`, `Read|Glob`), forward slashes.
   Then confirm it runs: `"C:/Users/<you>/.local/bin/graphify.EXE" hook-guard search`.
   Note: Claude Code may permission-block edits to `.claude/settings.json` — the user may need
   to explicitly request/approve the fix. Hooks written mid-session don't load until the user
   opens `/hooks` once or restarts the session.
   (Non-Windows hosts are unaffected — skip this step.)
3. **Build the first graph — scoped and directed.** Point it at the folder that holds the
   source code, NOT the repo root:
   ```
   /graphify <code-dir> --directed        # e.g. src/  app/  lib/  internal/
   ```
   - `<code-dir>` = the folder(s) with the code. Scoping keeps `vendor/`, `node_modules/`,
     build output, and tests out of the graph. A repo-root build drowns the signal in deps.
   - **If first-party code lives in MORE than one top-level dir (e.g. `application/` +
     `framework/`, `src/` + `lib/`), build ALL of them as one multi-path merged graph:**
     `/graphify application/ framework/ --directed`. Scoping to only one dir makes every class
     in the others invisible to every query — the graph then reports "not found" for code that
     exists, and the miss is indistinguishable from absence. (Real incident: a query for string
     sanitization helpers returned 61 irrelevant nodes because `FRK_StringHelper` lived in the
     unscanned `framework/` dir.) List the excluded siblings consciously, never by omission.
   - `--directed` is **required**. Without it the graph is undirected and total edge count blends
     incoming and outgoing — you cannot tell a healthy shared base (high fan-**in**) from a god
     class (high fan-**out**).
   - **Scoping does not exclude vendored code committed *inside* `<code-dir>`** (e.g.
     `application/libs/`, `src/vendor/`, a bundled third-party SDK) — those aren't
     gitignored, so graphify scans them and the graph drowns in someone else's classes
     instead of yours. Check `<code-dir>` for such folders before the first build; if
     any exist, add a `.graphifyignore` there first (see "In-tree vendored code" below).
4. **Relocate the `CLAUDE.md` section** the installer wrote: remove it from `CLAUDE.md` and
   instead add this file's `# Version` block and document title followed by the "Using" +
   "Refreshing" rules below to the project's `CODING_RULES.md`, replacing generic `.`/`src`
   references with the actual `<code-dir>`. Keeping the version with the copied rules allows
   `/coding-rules:apply` to detect stale copies.
5. **gitignore the output** — build artifacts + cache, never committed:
   ```
   graphify-out/
   <code-dir>/graphify-out/
   ```

## Folder layout (know which is which)

- `graphify-out/` at the **project root** = the **live graph** (`graph.json`, `GRAPH_REPORT.md`,
  `graph.html`). The only one queries read. Keep it `directed=True`.
- `<code-dir>/graphify-out/` = **AST cache only** (`cache/`). Scratch that speeds re-extraction.
  Never the live graph under the documented flow. Do not query it.

## What the graph knows (and does not)

- Knows: code structure — classes, methods, calls, references, extends/implements, plus
  fan-in/fan-out and community / god-node structure.
- Does NOT know: business rules, API response shape, or rendered template/view output. It is a
  snapshot — stale until rebuilt. Constants referenced by string can appear as isolated nodes
  (AST limitation, not a missing dependency).

---

## Rules to paste into the project's CODING_RULES.md (only if the user opted in)

Prepend this file's `# Version` block and `# graphify Knowledge Graph (Optional Addon)` title
when copying the following sections.

### Using the graph

- For codebase questions, run `graphify query "<question>"` first when `graphify-out/graph.json`
  exists. `graphify path "<A>" "<B>"` for relationships; `graphify explain "<concept>"` for a
  focused node. These return a small scoped subgraph vs. reading GRAPH_REPORT.md or raw grep.
- Judge coupling by direction: high **fan-in** + low fan-out (shared base / constants / DTO) is
  healthy; high **fan-out** (>~20 outgoing deps) is god-class risk and a refactor signal.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review, or when
  query/path/explain do not surface enough context.

### Refreshing after a code change

- After a feature or any code change, rebuild via the **directed skill flow**: re-run
  `/graphify <code-dir> --directed`, writing to the project-root `graphify-out/`.
- Do NOT use the bare `graphify update <code-dir>` CLI — it has no `--directed` flag and writes a
  full UNDIRECTED graph into `<code-dir>/graphify-out/` (wrong location), desyncing the live
  graph. If that stray graph appears, delete `<code-dir>/graphify-out/graph.json` (keep `cache/`).
- Verify after rebuild: `graph.json` has `directed: true` and lives in root `graphify-out/`.
  For a **multi-path merge**, also grep `graph.json` for a node-ID prefix belonging to a second
  scanned dir (e.g. `framework_`) to prove that dir actually landed — `directed: true` passes even
  if one dir silently dropped out of the merge.

### In-tree vendored code — exclude it, scoping alone won't

`--directed`-scoping the build to `<code-dir>` keeps external `vendor/`/`node_modules/` out
automatically, but a **committed** third-party library living *inside* `<code-dir>` (a bundled
SDK, a copied library folder) is not gitignored, so graphify scans it like first-party code.
Symptom: god-nodes / oversized communities in `GRAPH_REPORT.md` whose class names belong to a
library, not the app (e.g. hundreds of `Facebook*`/`GraphNode*` nodes from an in-tree Facebook
SDK).

Fix once per project:

1. Spot the vendored folder(s) under `<code-dir>` (e.g. `application/libs/`). Committed
   **asset/sprite dirs** are the same kind of noise — bundled UI images (jQuery-UI/colorbox
   sprites, e.g. `extensions/backend/assets/images/`) aren't code but graphify still scans them;
   exclude them the same way.
2. Drop a `.graphifyignore` at the scan root (gitignore syntax, honored by default):
   ```
   # Vendored / third-party code + bundled assets — not our architecture, noise in the graph
   libs/
   ```
3. Rebuild. A narrower corpus is a *smaller* graph, which trips the shrink guard (#479) — delete
   the stale `graphify-out/graph.json` first (keep `graphify-out/cache/`), then re-run
   `/graphify <code-dir> --directed`.
4. Verify: grep the vendored library's distinctive class name in the new `graph.json` — it
   should return only first-party code that *uses* the library (e.g. your own `FacebookManager`),
   never the library's own classes.

# Version
1

Increase this version number whenever this rule file changes.

# JavaScript Rules (Bun / Node, ESM)

See `COMMON_RULES.md` for rules that apply to all languages.
See `TYPESCRIPT_RULES.md` for the TypeScript type layer on top of these conventions.

## Runtime & Module System

Use Bun as the runtime. ESM is mandatory — no CommonJS in new code.

`package.json` must declare:

```json
{
  "type": "module",
  "bin": { "<appname>": "src/main.js" },
  "scripts": {
    "start": "bun run src/main.js",
    "build": "bun build --compile --outfile <appname>.exe src/main.js",
    "test": "bun test"
  },
  "engines": { "bun": ">=1.0.0" }
}
```

The entry point starts with a shebang so it is directly executable:

```js
#!/usr/bin/env bun
```

---

## Project Structure

CLI application layout (generalizes to libraries and servers — keep the
`core/` shared-module split either way):

```
project/
├── src/
│   ├── main.js          # Entry point (shebang, dispatches to cli.js, process.exit)
│   ├── cli.js           # Command router + dispatch, central try/catch → exit codes
│   ├── cli_args.js      # Hand-rolled arg parsers, one parseXxxArgs() per command
│   ├── commands/        # One file per command, each exports runXxx(input)
│   │   └── <cmd>.js
│   └── core/            # Shared modules: errors.js, settings.js, logger.js, …
├── tests/               # bun test files: *.test.js
├── tools/               # build.bat, run_tests.bat, run_integration_tests.bat
└── docs/
    └── commands/        # One md per command
```

`cli_args.js` is split from `cli.js` deliberately — router and parsers together
exceed the 300-line file rule.

---

## CLI Argument Parsing

Hand-roll the parser — no yargs/commander for small CLIs (KISS; zero runtime
deps). One `parseXxxArgs(args)` per command in `cli_args.js`, a plain `for`
loop over tokens, and a shared `requireValue()` helper. Invalid input throws
`AppError` with `INPUT_INVALID` (see Error Handling):

```js
export function parseAskArgs(args) {
  const positional = [];
  let timeoutSeconds = 120;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (!token.startsWith('-')) {
      positional.push(token);
      continue;
    }

    if (token === '--timeout') {
      const value = Number(requireValue(args, i, '--timeout'));
      if (!Number.isFinite(value) || value <= 0) {
        throw new AppError(ERROR_CODE.INPUT_INVALID, 'Invalid --timeout value', {
          hint: 'Use a positive number of seconds.'
        });
      }
      timeoutSeconds = Math.floor(value);
      i += 1;
      continue;
    }

    throw new AppError(ERROR_CODE.INPUT_INVALID, `Unknown option: ${token}`);
  }

  return { prompt: positional.join(' '), timeoutSeconds };
}

function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new AppError(ERROR_CODE.INPUT_INVALID, `Missing value for ${flag}`, {
      hint: `Provide a value after ${flag}.`
    });
  }
  return value;
}
```

---

## Error Handling

One `AppError` class for the whole app, plus const-object enums for error and
exit codes, all in `src/core/errors.js`. Freeze the enum objects
(`Object.freeze`) in new code. No scattered ad-hoc `throw new Error(...)` at
boundaries — normalize everything through `toAppError()` and map to process
exit codes in exactly one place:

```js
export const ERROR_CODE = Object.freeze({
  INPUT_INVALID: 'INPUT_INVALID',
  NETWORK_ERROR: 'NETWORK_ERROR',
  CONFIG_INVALID: 'CONFIG_INVALID',
  UNKNOWN: 'UNKNOWN'
});

export const EXIT_CODE = Object.freeze({
  SUCCESS: 0,
  GENERIC: 1,
  INPUT_INVALID: 2,
  NETWORK: 4,
  CONFIG: 6
});

export class AppError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.hint = extra.hint;
    this.details = extra.details;
    this.cause = extra.cause;
  }
}

// Every caught error becomes an AppError before it reaches the top-level handler.
export function toAppError(err) {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new AppError(ERROR_CODE.UNKNOWN, message || 'Unknown error');
}

export function exitCodeForError(err) {
  switch (err.code) {
    case ERROR_CODE.INPUT_INVALID: return EXIT_CODE.INPUT_INVALID;
    case ERROR_CODE.NETWORK_ERROR: return EXIT_CODE.NETWORK;
    case ERROR_CODE.CONFIG_INVALID: return EXIT_CODE.CONFIG;
    default: return EXIT_CODE.GENERIC;
  }
}
```

The router (`cli.js`) has the single top-level `try/catch`: it calls
`toAppError(err)`, writes `CODE: message` (+ optional `Hint: …`) to stderr,
and returns `exitCodeForError(err)`.

---

## Boundary Normalizers

Plain JS has no compile-time DTOs — enforce shapes at module boundaries with
`normalizeXxx()` functions that coerce loose external data (JSON, page
scraping, API responses) into a known object shape. Every field gets an
explicit type coercion and default; unknown input degrades to safe defaults
instead of `undefined` leaking through:

```js
function normalizeSurfaceState(value) {
  const object = value && typeof value === 'object' ? value : {};
  return {
    url: typeof object.url === 'string' ? object.url : '',
    editorReady: Boolean(object.editorFound),
    loginLike: Boolean(object.loginLike)
  };
}
```

This is the JS counterpart of COMMON_RULES "No Bag-of-Keys Returns at Module
Boundaries" — the normalizer's return shape IS the contract. In TypeScript
projects, typed DTOs replace these (see `TYPESCRIPT_RULES.md`).

---

## Settings / Config

Persist user settings as JSON at `~/.<appname>/settings.json`, owned by one
module `src/core/settings.js` with merge-write semantics. No hardcoded
environment values elsewhere (see COMMON_RULES):

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function settingsPath() {
  return join(homedir(), '.<appname>', 'settings.json');
}

export function loadSettings() {
  const path = settingsPath();
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return parsed && typeof parsed === 'object' ? parsed : {};
}

export function saveSettings(partial) {
  const path = settingsPath();
  const merged = { ...loadSettings(), ...partial };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}
```

Wrap parse/read failures in `AppError` with `CONFIG_INVALID` and a hint how
to fix or reset the file.

---

## Output & Logging

CLIs separate machine output from diagnostics strictly:

- **stdout** is for machine-readable results only: `JSON.stringify(result, null, 2)`.
- **stderr** carries errors as `CODE: message` plus optional `Hint: …` line.
- `console.*` is allowed only in interactive, human-facing commands (setup
  wizards, doctor checks) — never in machine-output paths.

For diagnostic logging use the central logger per the COMMON_RULES logger
table: a `logger` export in `src/core/logger.js` (`logger.ts` in TS) wrapping
the sink, with one config-driven level/off switch. Feature code never calls
`console.log` for logging.

---

## Linting

eslint with flat config (`eslint.config.js` at project root):

```js
export default [
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {
      'no-unused-vars': 'warn'
    }
  },
  {
    ignores: ['node_modules/**', 'coverage/**']
  }
];
```

---

## Build & Distribution

Ship CLIs as a single self-contained executable:

```bash
bun build --compile --outfile <appname>.exe src/main.js
```

When behavior must differ between compiled exe and source run, detect it once
in a core module and export the flag:

```js
export const IS_COMPILED =
  typeof Bun !== 'undefined' && (Bun.main.includes('~BUN') || Bun.main.includes('$bunfs'));
```

Dynamic imports that must land in the bundle need a literal specifier —
`bun build --compile` cannot follow computed paths.

---

## Testing

`bun test`, files under `tests/*.test.js`, importing from `bun:test`
(`describe`/`test`/`expect`/`beforeEach`/`afterEach`).

- **End-to-end CLI tests are the backbone**: drive `runCli([...argv])` and
  assert exit codes plus stdout/stderr substrings. This covers routing,
  parsing, and error mapping in one pass.
- **DI seams for side effects.** Modules with external effects (network,
  browser, sleep) export test-only setters so tests swap implementations
  without mocking frameworks:

```js
export function __setAskDepsForTest(deps) {
  if (deps.browserAskRunner) browserAskRunner = deps.browserAskRunner;
  if (deps.sleep) sleepImpl = deps.sleep;
}

export function __resetAskDepsForTest() {
  browserAskRunner = runBrowserAsk;
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
}
```

  Always reset in `afterEach` via the `__resetXxxDepsForTest()` counterpart.
- **Private functions** worth testing are exposed through one grouped export
  at the bottom of the module:

```js
export const __test__ = { normalizeSurfaceState, shouldRetry };
```

---

## 5 Essential Additional Rules (must-have)

1. **Required batch files** — `tools/build.bat` (runs the Bun compile build),
   `tools/run_tests.bat` and `tools/run_integration_tests.bat` (per
   COMMON_RULES Test Runner Scripts; they wrap `bun test`).
2. **Naming** — lowercase/snake file names (`cli_args.js`, `settings.js`),
   `camelCase` functions/variables, `PascalCase` classes, `UPPER_SNAKE`
   module-level constants.
3. **Constants placement** — const-object enums (`Object.freeze`) live in the
   module that owns the domain (`ERROR_CODE` in `errors.js`); per-feature
   string constants at the top of the owning command file. No stringly-typed
   values scattered through logic.
4. **Command docs** — one markdown per command under `docs/commands/<cmd>.md`
   (opens with `# <cmd>` + one-line purpose); topic docs at `docs/` root.
5. **Zero runtime dependencies by default** — Bun + `node:` builtins cover
   fs/path/os/fetch. Every new package needs the COMMON_RULES version
   confirmation, and a few lines of stdlib beat a dependency.
