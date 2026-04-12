---
status: Draft
date: 2026-03-23
deciders:
  - aaronsb
  - claude
related:
  - ADR-101
---

# ADR-200: Close CLI parity gaps — add daily notes, tasks, templates, and properties operations

## Context

Obsidian 1.12 (February 2026) introduced a first-party CLI with ~90 commands covering file operations, search, properties, daily notes, tasks, templates, bookmarks, tags, workspace management, and developer tools. Many of these overlap directly with our MCP server's semantic operations.

A feature-by-feature comparison reveals our MCP server is significantly ahead in areas that matter for AI agents — graph traversal, structured editing, fuzzy find/replace, dataview integration, fragment retrieval, and TF-IDF search ranking. However, the CLI covers four operational domains that we currently lack dedicated support for:

| Gap | CLI Coverage | Our Current State |
|-----|-------------|-------------------|
| **Daily notes** | `daily`, `daily:path`, `daily:read`, `daily:append`, `daily:prepend` | Not supported — agents must know the daily note path convention and use `vault` operations manually |
| **Tasks** | `tasks` (list/filter), `task` (show/toggle/status) | Only via `dataview` TASK queries — no direct task manipulation |
| **Templates** | `templates`, `template:read`, `template:insert` | Not supported — agents must manually read template files and replicate variable resolution |
| **Properties** | `properties`, `property:set`, `property:remove`, `property:read`, `aliases`, `tags` | Partially covered via `edit patch` on frontmatter and `vault search` by tag — but no first-class property discovery or bulk operations |

Our moat is ergonomic tool definitions — semantic routing, rich descriptions, and structured parameters that let AI agents discover and use operations without fumbling. The CLI has none of this; it's designed for humans typing commands. But gaps in coverage give agents a reason to fall back to shell-wrapping the CLI, which defeats the purpose of having an MCP server.

## Decision

Add four new semantic operation groups to close the parity gaps, following the existing pattern in `semantic-tools.ts`:

### 1. `daily` operation
- **Actions**: `read`, `append`, `prepend`, `path`, `open`
- **Implementation**: Use Obsidian's Daily Notes plugin API (`getDailyNote`, `createDailyNote`, `getAllDailyNotes`) via `app.internalPlugins`
- **Parameters**: `content`, `date` (optional, defaults to today), `inline` (no newline), standard `raw` flag
- **Why dedicated**: Daily notes are the most common journaling/capture pattern. Agents shouldn't need to reverse-engineer the date format and folder convention from settings.

### 2. `tasks` operation
- **Actions**: `list`, `get`, `toggle`, `set_status`, `add`
- **Implementation**: Parse task syntax (`- [ ]`, `- [x]`, `- [-]`, etc.) from vault files using Obsidian's metadata cache for task positions
- **Parameters**: `path` (scope to file), `status` (filter by character), `done`/`todo` (convenience filters), `ref` (file:line for targeted operations), `content` (for add)
- **Why dedicated**: Task manipulation requires understanding checkbox syntax, line positions, and status characters. A dedicated operation handles this cleanly instead of making agents do regex surgery through `edit`.

### 3. `templates` operation
- **Actions**: `list`, `read`, `insert`, `resolve`
- **Implementation**: Use Obsidian's Templates plugin API for folder discovery and variable resolution (`{{date}}`, `{{time}}`, `{{title}}`)
- **Parameters**: `name` (template name), `title` (for variable resolution), `resolve` (process variables), `path` (target file for insert)
- **Why dedicated**: Template variable resolution is opaque without plugin API access. An agent reading a template file sees `{{date}}` — it shouldn't have to guess the configured date format.

### 4. `properties` operation (promote from edit)
- **Actions**: `list`, `get`, `set`, `remove`, `list_tags`, `list_aliases`
- **Implementation**: Use Obsidian's metadata cache (`app.metadataCache`) for reads, frontmatter manipulation for writes
- **Parameters**: `path` (target file), `name` (property name), `value`, `type` (text/list/number/checkbox/date/datetime)
- **Why dedicated**: Property operations through `edit patch frontmatter` work but are unnecessarily indirect. First-class support enables property discovery across the vault (list all properties with counts, find all values of a property) which `edit` can't do.

### Tool visibility gating (ADR-101)

New operations are subject to the tree-based tool visibility gating system defined in ADR-101. Each new action maps to the `toolVisibility` permission map and appears in the settings tree UI automatically (derived from `getActionsForOperation()` at render time).

New operations map to existing `OperationType`s for runtime enforcement through `SecureObsidianAPI`:

| New Operation | Actions | OperationType |
|--------------|---------|---------------|
| `daily:read`, `daily:path` | Read daily note | `READ` |
| `daily:append`, `daily:prepend` | Modify daily note | `UPDATE` |
| `tasks:list`, `tasks:get` | Query tasks | `READ` |
| `tasks:toggle`, `tasks:set_status`, `tasks:add` | Modify tasks | `UPDATE` / `CREATE` |
| `templates:list`, `templates:read` | Browse templates | `READ` |
| `templates:insert` | Apply template to file | `CREATE` |
| `properties:list`, `properties:get` | Read properties | `READ` |
| `properties:set`, `properties:remove` | Modify frontmatter | `UPDATE` |

### Registration pattern

Each new operation follows the existing semantic-tools pattern:
- Added to `getActionsForOperation()`, `getOperationDescription()`, `getParametersForOperation()`
- Routed through the existing `case` dispatch in the tool handler
- Gated by ADR-101 tool visibility check before registration — disabled actions skip registration
- Implementation in new files under `src/tools/` (e.g., `daily-operations.ts`, `task-operations.ts`)
- Reuses existing `ObsidianAPI` methods where possible, adds new ones where needed

## Consequences

### Positive

- Eliminates every functional gap where the CLI currently has coverage and we don't
- Agents never need to shell out to the CLI for standard vault operations
- Properties and tasks get proper ergonomic treatment instead of being awkward workarounds
- Daily notes integration removes the most common "how do I journal with MCP?" friction
- Integrates with ADR-101 tool visibility gating — new tools get granular user control for free
- Strengthens the argument for community plugin approval — combined with ADR-101, reviewers see full user control over agent capabilities

### Negative

- Four new operation groups increase the tool surface area — more to maintain and test
- Daily notes and templates depend on core plugin APIs that could change across Obsidian versions
- Properties operation partially overlaps with existing `edit patch` frontmatter — need clear guidance on when to use which

### Neutral

- Does not attempt to cover CLI-only concerns (workspace/tab management, plugin admin, themes, sync, publish, dev tools) — these are UI/admin operations that don't belong in an agent-facing MCP server
- The `eval` escape hatch in the CLI means a sufficiently motivated user can always do what we do — but without tool definitions, no agent will discover it

## Alternatives Considered

- **Wrap the CLI**: Shell out to `obsidian` commands from the MCP server. Rejected — adds a process dependency, loses type safety, and the CLI requires Obsidian 1.12+ while our plugin works on older versions.
- **Do nothing and let dataview/edit cover it**: The current workarounds function but they're not discoverable. An agent has to already know that `edit patch frontmatter` handles properties or that `dataview query "TASK FROM ..."` gets tasks. First-class operations with descriptions solve this.
- **Add everything the CLI has**: Workspace management, plugin admin, themes, sync, publish. Rejected — these are human-interactive or admin operations. Scope creep for an agent-facing tool. Close the functional gaps, not the categorical ones.
