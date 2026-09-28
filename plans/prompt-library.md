# Prompt Library — v1 plan

A composer "+" menu entry (and Ctrl+R) that opens a searchable typeahead of previous prompts and starred prompts, and inserts the pick into the composer. A powerful version of arrow up/down history.

Status: design agreed 2026-09-25 (grilling session in thr_4yjkxkgb3d). Not started.

## Scope

### In v1

1. Core **composer typeahead slot** (`experimental_typeaheads`), with the native mention/command menus moved onto its container.
2. Thin core **prompt-history search**: `query` + global scope on the existing prompt-history surface, no new index.
3. Bundled **Prompt Library** plugin: typeahead, starred prompts, `bb prompts` CLI.

### Deferred (separate follow-ups)

- Settings page for starred prompts, and starred-prompt titles.
- `experimental_PromptInputEditor` host component (controlled `PromptInput[]` editor, editor-only mode of `PromptBoxInternal`) for creating/editing starred prompts outside the composer.
- Plugin-owned project attachments (new owner kind so unowned uploads survive the 7-day GC in `packages/db/src/data/project-attachments.ts`) so starred prompts can keep attachments.
- A prompt-history search index (e.g. trigram FTS5), only if the `LIKE` scan gets slow.
- Merging the prompt-history rerank helper with the shared thread-search rerank module from @thread:thr_6xemf4r6d8, whichever lands second.
- Recording child-thread starts and side-chat prompts in history (kept as today).

### No coupling to thread search

This work does not depend on @thread:thr_6xemf4r6d8. Different files (`prompt-history.ts` vs `threads.ts`), no migration here, and `@bb/fuzzy-match` is used as-is (multi-word handling stays local to Prompt Library). The only overlap is a short-lived duplicate rerank helper, consolidated by whichever PR lands second.

## 1. Composer typeahead slot (core)

### Why a slot

Plugins today can render above the composer (banners), but cannot: render in the composer's mention placement (new-thread composers can place menus _below_), open from a shortcut with a composer handle, remember the caret, or insert a `PromptInput[]` at a position (`setText` replaces the whole draft as plain text and drops mentions).

### Contract (`packages/plugin-sdk/src/app-contract.ts`)

`ComposerCustomization` gains:

```ts
experimental_typeaheads?: ComposerTypeaheadRegistration[];

interface ComposerTypeaheadRegistration {
  id: string;
  label: string;
  icon?: IconName;
  plusMenu?: boolean | { label?: string; description?: string };
  shortcut?: KeyChord;
  component: ComponentType;
}
```

Inside the typeahead component, `experimental_useComposerTypeahead()` returns:

```ts
interface ComposerTypeaheadApi {
  view: ComposerView;
  draft: PromptInput[];
  insert(input: PromptInput[]): void;
  close(): void;
}
```

`draft` gives the draft with its mention ranges, which "Star current draft" needs (the "+" menu `run` only sees `composer.text`).

Host behavior:

- **Placement**: renders the active typeahead in the same positioned container the native mention menu uses (above/below per `mentionMenuPlacement`), full composer width. Compact layouts use the shared persistent responsive drawer (AGENTS.md UI rules: transform first, realize content after two frames, retain).
- **One at a time**: opening a typeahead closes any other, including the native mention/command menu.
- **Openers**: `plusMenu` adds a row to the "+" menu; `shortcut` registers an app command (rebindable via the existing keybinding system, `packages/domain/src/app-keybindings.ts` + server defaults) active when that composer has focus. On web, the handler `preventDefault`s so Ctrl+R does not reload while the composer is focused.
- **Focus**: the typeahead owns focus (its own search input). On open the host records the editor selection; on close focus returns to the editor at that selection.
- **Insert**: `insert(input)` — if the draft is empty, restores the full input (text + mentions, same path as arrow-up recall via `promptInputToDraft`); otherwise inserts text + mentions at the recorded caret.
- **Scopes**: wherever `app.composer.customize` scopes apply (`thread`, `queued-message`, `side-chat`, `new-thread`).

### Native menus on the shared container

Extract the positioned container + placement + one-at-a-time state out of `PromptBoxInternal.tsx` (~L3262–3284). The native `MentionMenu` renders into it as a built-in typeahead but keeps its inline behavior (trigger detection, focus stays in the editor, draft-as-query, key handling in `handleEditorKeyDown`). **Zero behavior change** for `@ # $ ! ~ /`.

### SDK surface obligations

- `experimental_` prefix on new members; entries in `docs/api_to_audit.md`.
- Plugin Guide: `plugins/plugin-api-docs/src/surfaces.ts`, plus `plugins/bb-guide/skills/bb-plugin-authoring/references/frontend-hooks-and-ui.md`.
- Testing stubs in `packages/plugin-sdk/src/testing/app.tsx`; runtime export manifest regenerated.
- Bump plugin SDK version (`bump-plugin-sdk.mjs --patch`).

## 2. Prompt-history search (thin core)

No migration, no new index. Extends the existing prompt-history data layer and routes.

### Query (`packages/db/src/data/prompt-history.ts`)

`listPromptHistoryCandidates({ scope, projectId?, threadId?, query?, limit })`:

- scope `thread` → `thread_id = ?`; `project` → `project_id = ?` (every prompt in the project, both stored scopes); `global` → no filter. Soft-deleted threads excluded.
- `query` → each whitespace-separated term ANDed as case-insensitive `LIKE '%term%'` over `input`'s visible text (`agent-only` parts excluded).
- `ORDER BY created_at DESC LIMIT limit` (capped candidates, e.g. 300). Empty query → most recent in scope.
- Uses the existing `(project_id, …, created_at)` / `(thread_id, …, created_at)` indexes for scoped queries; global is a recency-ordered scan (~20–30 ms on a 12.5k-prompt db today, grows linearly).

Response entries gain `projectId` and `threadId` so global results can show where a prompt came from. Identical prompts collapsed server-side (keep most recent).

### API

- Route: `GET /prompt-history/search?query&scope&projectId&threadId&limit`.
- SDK: `sdk.promptHistory.search(...)`.
- CLI: `--query <q>` on `bb project history` and `bb thread history`; new `bb history search <q> [--project <id>] [--thread <id>] [--json]` for global.
- Update discoverable surfaces per `docs/cli-guide-and-skill.md`.
- Not a daemon wire change (no protocol bump).

Arrow up/down behavior and what gets recorded are unchanged.

## 3. Prompt Library plugin (`plugins/prompt-library`)

Bundled, enabled by default. Title "Prompt Library".

### Typeahead

- Registered via `app.composer.customize({ experimental_typeaheads: [{ id: "prompt-library", label: "Prompts…", plusMenu: true, shortcut: "Ctrl+R", component }] })`.
- Opens with an empty search box listing Starred then Recent.
- **Scope toggle**: follow-up composers `Thread | Project | Global`; new-thread composers `Project | Global`. Both default to Global; last choice sticky per composer kind, persisted per device (localStorage).
- **Sections**:
  - **Starred** — always shown regardless of scope toggle; most recently used first on empty query, fuzzy-ranked otherwise.
  - **Recent** — core search for the current scope; newest first on empty query, fuzzy-ranked otherwise.
- **Ranking**: the plugin reranks candidates with `@bb/fuzzy-match` (`fuzzyMatchText`), splitting the query on whitespace, requiring every term to match, and summing scores; highlight ranges from the match positions.
- **Row**: first line, one-line snippet with highlights, project/thread label when outside the current scope, relative time, star toggle.
- **Keys**: Up/Down move, Enter inserts and closes, Mod+S toggles the star on the highlighted row, Tab/Shift+Tab cycles scope, Esc closes.
- Debounced ~50–80 ms; previous results stay visible while the next query loads.

### Starred prompts

The UI, CLI, and code call these "starred" so they don't collide with the Drafts plugin's "Save draft…" in the same "+" menu. The plugin's SQLite table keeps its original name, `saved_prompts`.

- Stored in the plugin's own SQLite db (`bb.storage.database()` + `migrate`): `id, input (PromptInput[] JSON, text + mentions only), created_at, last_used_at`. No titles.
- Global (not per-project). Attachments are stripped when starring.
- Created by starring a Recent row, or the "Star current draft" row pinned at the top of the typeahead when the draft is non-empty (reads `draft` from `experimental_useComposerTypeahead()`, so mentions survive).
- `last_used_at` updated on insert. Unstar deletes.
- Changing content: insert, tweak, star as new, unstar the old one.

### Backend (`server.ts`)

- RPC contract: `search`, `star({ input })`, `unstar({ id })`, `markUsed({ id })`.
- CLI via `defineCli`: `bb prompts search <q> [--scope] [--json]` (starred + history via `bb.sdk.promptHistory.search`), `bb prompts list`, `bb prompts star <text>`, `bb prompts unstar <id>`.

## Verification

- **db**: `createConnection(":memory:")` + `migrate(db)`; scope filters, soft-deleted threads excluded, `agent-only` text not matched, multi-term AND, recency order, cap, dedupe.
- **server**: route validation, scope/param combinations.
- **app**: typeahead slot — one-at-a-time with native mentions, insert into empty vs non-empty draft at the recorded caret (mentions preserved), focus returns, Ctrl+R not reloading on web, native `@`/`/` behavior unchanged (existing PromptBoxInternal tests stay green).
- **plugin**: RPC handlers against a real plugin db; multi-term rerank; CLI commands.
- **CLI**: `bb history search`, `--query` flags.
- Manual: verify-bb recipes for composer + plugin in desktop and iOS Simulator Safari (drawer on compact).
- `pnpm exec turbo run typecheck lint test --filter='...[origin/main]'`.

## Delivery

One PR, independent of the thread-search work. Suggested commit order: (1) typeahead slot + native container extraction, (2) prompt-history search route + SDK + CLI, (3) plugin, (4) docs/guide/SDK version.
