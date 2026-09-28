import {
  cliCommand,
  defineCli,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import {
  promptLibraryRpcContract,
  type PromptInputChunk,
  type RecentPromptRow,
  type StarredPromptRow,
  type SearchPromptsInput,
} from "./contract.js";
import { promptText } from "./prompt-text.js";
import { buildSnippet, rankByQuery } from "./ranking.js";
import {
  createStarredPromptStore,
  STARRED_PROMPT_MIGRATIONS,
  type StarredPrompt,
} from "./store.js";

const HISTORY_CANDIDATE_LIMIT = "300";
const STARRED_RESULT_LIMIT = 20;
const RECENT_RESULT_LIMIT = 30;

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

interface HistoryCandidate {
  id: string;
  createdAt: number;
  input: PromptInputChunk[];
  projectId: string;
  threadId: string;
}

export default function promptLibraryPlugin(bb: BbPluginApi): void {
  const db = bb.storage.database();
  bb.storage.migrate(db, STARRED_PROMPT_MIGRATIONS);
  const store = createStarredPromptStore(db);

  async function historyCandidates(
    input: SearchPromptsInput,
    query: string | undefined,
  ): Promise<HistoryCandidate[]> {
    const common = {
      limit: HISTORY_CANDIDATE_LIMIT,
      ...(query !== undefined ? { query } : {}),
    };
    if (input.scope === "thread") {
      if (input.threadId === null) return [];
      return bb.sdk.promptHistory.search({
        ...common,
        scope: "thread",
        threadId: input.threadId,
      });
    }
    if (input.scope === "project") {
      if (input.projectId === null) return [];
      return bb.sdk.promptHistory.search({
        ...common,
        scope: "project",
        projectId: input.projectId,
      });
    }
    return bb.sdk.promptHistory.search({ ...common, scope: "global" });
  }

  async function searchHistory(
    input: SearchPromptsInput,
  ): Promise<HistoryCandidate[]> {
    const query = input.query.trim();
    const [recent, substringMatches] = await Promise.all([
      historyCandidates(input, undefined),
      query.length === 0 ? [] : historyCandidates(input, query),
    ]);
    const seen = new Set<string>();
    const candidates: HistoryCandidate[] = [];
    for (const candidate of [...recent, ...substringMatches].sort(
      (left, right) => right.createdAt - left.createdAt,
    )) {
      const text = promptText(candidate.input);
      if (text.trim().length === 0 || seen.has(text)) continue;
      seen.add(text);
      candidates.push(candidate);
    }
    return candidates;
  }

  async function projectNames(
    projectIds: ReadonlySet<string>,
  ): Promise<Map<string, string>> {
    if (projectIds.size === 0) return new Map();
    const projects = await bb.sdk.projects.list({ includePersonal: true });
    return new Map(
      projects
        .filter((project) => projectIds.has(project.id))
        .map((project) => [project.id, project.name]),
    );
  }

  function starredRow(
    prompt: StarredPrompt,
    positions: readonly number[],
  ): StarredPromptRow {
    return {
      id: prompt.id,
      input: prompt.input,
      snippet: buildSnippet(prompt.text, positions),
      createdAt: prompt.createdAt,
      lastUsedAt: prompt.lastUsedAt,
    };
  }

  async function search(input: SearchPromptsInput) {
    const starredPrompts = store.list();
    const starredIdsByText = new Map(
      starredPrompts.map((prompt) => [prompt.text, prompt.id]),
    );
    const starred = rankByQuery(
      starredPrompts,
      input.query,
      (prompt) => prompt.text,
    )
      .slice(0, STARRED_RESULT_LIMIT)
      .map((match) => starredRow(match.item, match.positions));
    const history = rankByQuery(
      await searchHistory(input),
      input.query,
      (candidate) => promptText(candidate.input),
    ).slice(0, RECENT_RESULT_LIMIT);
    const names = await projectNames(
      new Set(history.map((match) => match.item.projectId)),
    );
    const recent: RecentPromptRow[] = history.map(({ item, positions }) => {
      const text = promptText(item.input);
      return {
        id: item.id,
        input: item.input,
        snippet: buildSnippet(text, positions),
        createdAt: item.createdAt,
        projectId: item.projectId,
        projectName: names.get(item.projectId) ?? null,
        threadId: item.threadId,
        starredId: starredIdsByText.get(text) ?? null,
      };
    });
    return { starred, recent };
  }

  function star(input: readonly PromptInputChunk[]): StarredPrompt {
    const starred = store.star(input, Date.now());
    if (starred === null) {
      throw new Error("A starred prompt needs some text.");
    }
    return starred;
  }

  bb.rpc.register(promptLibraryRpcContract, {
    search,
    star: ({ input }) => ({ id: star(input).id }),
    unstar: ({ id }) => ({ unstarred: store.unstar(id) }),
    markUsed({ id }) {
      store.markUsed(id, Date.now());
      return null;
    },
  });

  bb.cli.register(
    defineCli({
      name: "prompts",
      summary: "Search previous prompts and manage starred prompts",
      description:
        "Starred prompts appear first in the composer's Prompts… picker (Ctrl+R). Previous prompts come from bb's prompt history.",
      commands: {
        search: cliCommand({
          summary: "Search starred and previous prompts",
          positionals: [
            {
              name: "query",
              description: "Words to fuzzy-match; omit to list the most recent",
              variadic: true,
            },
          ],
          options: {
            project: {
              type: "string",
              description: "Search this project's prompts",
            },
            thread: {
              type: "string",
              description: "Search this thread's prompts",
            },
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "at-most-one", options: ["project", "thread"] },
          ],
          async run({ options, positionals }) {
            const result = await search({
              query: positionals.query.join(" "),
              scope:
                options.thread !== undefined
                  ? "thread"
                  : options.project !== undefined
                    ? "project"
                    : "global",
              projectId: options.project ?? null,
              threadId: options.thread ?? null,
            });
            if (options.json) {
              return { exitCode: 0, stdout: JSON.stringify(result) };
            }
            const lines = [
              ...result.starred.map(
                (row) => `★ ${row.id}  ${row.snippet.text}`,
              ),
              ...result.recent.map(
                (row) =>
                  `  ${new Date(row.createdAt).toISOString()}  ${row.snippet.text}`,
              ),
            ];
            return {
              exitCode: 0,
              stdout: lines.length > 0 ? lines.join("\n") : "No prompts found",
            };
          },
        }),
        list: cliCommand({
          summary: "List starred prompts, most recently used first",
          options: { json: JSON_OPTION },
          run({ options }) {
            const prompts = store.list();
            if (options.json) {
              return {
                exitCode: 0,
                stdout: JSON.stringify(
                  prompts.map((prompt) => ({
                    id: prompt.id,
                    text: prompt.text,
                    input: prompt.input,
                    createdAt: prompt.createdAt,
                    lastUsedAt: prompt.lastUsedAt,
                  })),
                ),
              };
            }
            return {
              exitCode: 0,
              stdout:
                prompts.length > 0
                  ? prompts
                      .map(
                        (prompt) =>
                          `${prompt.id}  ${buildSnippet(prompt.text, []).text}`,
                      )
                      .join("\n")
                  : "No starred prompts",
            };
          },
        }),
        star: cliCommand({
          summary: "Star a prompt",
          positionals: [
            {
              name: "text",
              description: "The prompt text",
              required: true,
              variadic: true,
            },
          ],
          options: { json: JSON_OPTION },
          run({ options, positionals }) {
            const starred = star([
              { type: "text", text: positionals.text.join(" "), mentions: [] },
            ]);
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify({ id: starred.id, text: starred.text })
                : starred.id,
            };
          },
        }),
        unstar: cliCommand({
          summary: "Unstar a prompt",
          positionals: [
            {
              name: "id",
              description: "Starred prompt id, as `bb prompts list` prints it",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run({ options, positionals }) {
            if (!store.unstar(positionals.id)) {
              throw new PluginCliError(
                `Unknown starred prompt: ${positionals.id}`,
                {
                  code: "unknown_prompt",
                  hint: "Run `bb prompts list` for starred prompt ids.",
                },
              );
            }
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify({ id: positionals.id, unstarred: true })
                : `Unstarred ${positionals.id}`,
            };
          },
        }),
      },
    }),
  );
}
