import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { PromptInputChunk } from "./contract.js";
import plugin from "./server.js";

interface HistoryEntry {
  id: string;
  createdAt: number;
  input: PromptInputChunk[];
  projectId: string;
  threadId: string;
}

interface HistoryQuery {
  scope: "thread" | "project" | "global";
  projectId?: string;
  threadId?: string;
  query?: string;
  limit?: string;
}

function text(value: string): PromptInputChunk[] {
  return [{ type: "text", text: value, mentions: [] }];
}

function entry(
  id: string,
  createdAt: number,
  value: string,
  location: { projectId?: string; threadId?: string } = {},
): HistoryEntry {
  return {
    id,
    createdAt,
    input: text(value),
    projectId: location.projectId ?? "proj_a",
    threadId: location.threadId ?? "thr_a",
  };
}

function historySearch(entries: readonly HistoryEntry[], windowSize: number) {
  return vi.fn(async (args: HistoryQuery) => {
    const terms = (args.query ?? "")
      .toLowerCase()
      .split(/\s+/u)
      .filter(Boolean);
    const matches = [...entries]
      .filter((candidate) =>
        args.scope === "thread"
          ? candidate.threadId === args.threadId
          : args.scope === "project"
            ? candidate.projectId === args.projectId
            : true,
      )
      .filter((candidate) => {
        const haystack = candidate.input
          .flatMap((chunk) => (chunk.type === "text" ? [chunk.text] : []))
          .join("\n\n")
          .toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort((left, right) => right.createdAt - left.createdAt);
    return terms.length === 0 ? matches.slice(0, windowSize) : matches;
  });
}

async function setup(entries: readonly HistoryEntry[], windowSize = 300) {
  const search = historySearch(entries, windowSize);
  const fake = createFakePluginHost({
    pluginId: "prompt-library",
    sdk: {
      promptHistory: { search },
      projects: {
        list: async () => [
          { id: "proj_a", name: "Alpha" },
          { id: "proj_b", name: "Beta" },
        ],
      },
    },
  });
  await plugin(fake.bb);
  const call = (method: string, input: unknown) =>
    fake.harness.behavior.callRpc(method, input);
  return { ...fake, search, call };
}

const GLOBAL = { scope: "global", projectId: null, threadId: null } as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("prompt library server", () => {
  it("lists starred prompts first and collapses repeated history, newest first", async () => {
    const { call } = await setup([
      entry("h1", 1, "write the release notes"),
      entry("h2", 2, "fix the timeline cache", { projectId: "proj_b" }),
      entry("h3", 3, "write the release notes"),
    ]);
    const starred = await call("star", {
      input: text("fix the timeline cache"),
    });

    const result = await call("search", { ...GLOBAL, query: "" });

    expect(result).toMatchObject({
      starred: [{ id: (starred as { id: string }).id }],
      recent: [
        { id: "h3", projectName: "Alpha", starredId: null },
        {
          id: "h2",
          projectName: "Beta",
          starredId: (starred as { id: string }).id,
        },
      ],
    });
  });

  it("fuzzy-matches every word and highlights the matched characters", async () => {
    const { call } = await setup([
      entry("h1", 1, "fix the timeline cache"),
      entry("h2", 2, "timeline only"),
      entry("h3", 3, "unrelated prompt"),
    ]);

    const result = (await call("search", {
      ...GLOBAL,
      query: "tmln cach",
    })) as {
      recent: {
        id: string;
        snippet: { text: string; highlights: number[][] };
      }[];
    };

    expect(result.recent.map((row) => row.id)).toEqual(["h1"]);
    expect(result.recent[0]?.snippet.highlights.length).toBeGreaterThan(0);
  });

  it("finds exact matches older than the recent candidate window", async () => {
    const entries = [
      entry("old", 1, "migrate the billing tables"),
      ...Array.from({ length: 5 }, (_, index) =>
        entry(`new-${index}`, 10 + index, `recent prompt ${index}`),
      ),
    ];
    const { call } = await setup(entries, 3);

    const result = (await call("search", { ...GLOBAL, query: "billing" })) as {
      recent: { id: string }[];
    };

    expect(result.recent.map((row) => row.id)).toEqual(["old"]);
  });

  it("scopes history to the thread or project and skips a missing target", async () => {
    const { call, search } = await setup([
      entry("h1", 1, "in thread a", { threadId: "thr_a" }),
      entry("h2", 2, "in thread b", { threadId: "thr_b" }),
    ]);

    const thread = (await call("search", {
      query: "",
      scope: "thread",
      projectId: "proj_a",
      threadId: "thr_b",
    })) as { recent: { id: string }[] };
    expect(thread.recent.map((row) => row.id)).toEqual(["h2"]);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "thread", threadId: "thr_b" }),
    );

    search.mockClear();
    const missing = (await call("search", {
      query: "",
      scope: "project",
      projectId: null,
      threadId: null,
    })) as { recent: unknown[] };
    expect(missing.recent).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it("stars text and mentions only, dedupes by text, and orders by last use", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    const { call } = await setup([]);
    const first = (await call("star", {
      input: [
        ...text("first prompt"),
        { type: "localImage", path: ".bb/attachments/shot.png" },
      ],
    })) as { id: string };
    vi.setSystemTime(2_000);
    const second = (await call("star", { input: text("second prompt") })) as {
      id: string;
    };
    const duplicate = (await call("star", { input: text("first prompt") })) as {
      id: string;
    };
    expect(duplicate.id).toBe(first.id);

    vi.setSystemTime(3_000);
    await call("markUsed", { id: first.id });
    const listed = (await call("search", { ...GLOBAL, query: "" })) as {
      starred: { id: string; input: PromptInputChunk[] }[];
    };
    expect(listed.starred.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(listed.starred[0]?.input).toEqual(text("first prompt"));

    await expect(call("unstar", { id: second.id })).resolves.toEqual({
      unstarred: true,
    });
    await expect(call("unstar", { id: second.id })).resolves.toEqual({
      unstarred: false,
    });
  });

  it("rejects saving a prompt with no text", async () => {
    const { call } = await setup([]);
    await expect(
      call("star", {
        input: [{ type: "localImage", path: ".bb/attachments/shot.png" }],
      }),
    ).rejects.toThrow("A starred prompt needs some text.");
  });

  it("manages starred prompts and searches from the CLI", async () => {
    const { harness } = await setup([entry("h1", 1, "deploy the preview")]);

    const starred = await harness.behavior.runCli([
      "star",
      "review",
      "this",
      "diff",
      "--json",
    ]);
    expect(starred.exitCode).toBe(0);
    const { id } = JSON.parse(starred.stdout ?? "") as { id: string };

    const list = await harness.behavior.runCli(["list"]);
    expect(list.stdout).toBe(`${id}  review this diff`);

    const search = await harness.behavior.runCli([
      "search",
      "deploy",
      "--json",
    ]);
    expect(JSON.parse(search.stdout ?? "")).toMatchObject({
      starred: [],
      recent: [{ id: "h1" }],
    });

    await expect(
      harness.behavior.runCli(["unstar", id]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: `Unstarred ${id}`,
    });
    await expect(
      harness.behavior.runCli(["unstar", id]),
    ).resolves.toMatchObject({
      exitCode: 1,
    });
  });
});
