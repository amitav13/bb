import {
  defineRpcContract,
  type ComposerTypeaheadApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

export type PromptInputChunk = ComposerTypeaheadApi["draft"][number];
export type TextPromptInputChunk = Extract<PromptInputChunk, { type: "text" }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextMention(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value.start) &&
    Number.isInteger(value.end) &&
    isRecord(value.resource) &&
    typeof value.resource.kind === "string"
  );
}

function isPromptInputChunk(value: unknown): value is PromptInputChunk {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "text":
      return (
        typeof value.text === "string" &&
        Array.isArray(value.mentions) &&
        value.mentions.every(isTextMention)
      );
    case "image":
      return typeof value.url === "string";
    case "localImage":
    case "localFile":
      return typeof value.path === "string";
    default:
      return false;
  }
}

export const promptInputSchema = z.array(
  z.custom<PromptInputChunk>(isPromptInputChunk, "Invalid prompt input"),
);

export const promptScopeSchema = z.enum(["thread", "project", "global"]);
export type PromptScope = z.infer<typeof promptScopeSchema>;

const snippetSchema = z
  .object({
    text: z.string(),
    highlights: z.array(z.tuple([z.number().int(), z.number().int()])),
  })
  .strict();
export type PromptSnippet = z.infer<typeof snippetSchema>;

const starredPromptSchema = z
  .object({
    id: z.string(),
    input: promptInputSchema,
    snippet: snippetSchema,
    createdAt: z.number(),
    lastUsedAt: z.number().nullable(),
  })
  .strict();
export type StarredPromptRow = z.infer<typeof starredPromptSchema>;

const recentPromptSchema = z
  .object({
    id: z.string(),
    input: promptInputSchema,
    snippet: snippetSchema,
    createdAt: z.number(),
    projectId: z.string(),
    projectName: z.string().nullable(),
    threadId: z.string(),
    starredId: z.string().nullable(),
  })
  .strict();
export type RecentPromptRow = z.infer<typeof recentPromptSchema>;

export const searchPromptsInputSchema = z
  .object({
    query: z.string().max(256),
    scope: promptScopeSchema,
    projectId: z.string().min(1).nullable(),
    threadId: z.string().min(1).nullable(),
  })
  .strict();
export type SearchPromptsInput = z.infer<typeof searchPromptsInputSchema>;

export const promptLibraryRpcContract = defineRpcContract({
  search: {
    input: searchPromptsInputSchema,
    output: z
      .object({
        starred: z.array(starredPromptSchema),
        recent: z.array(recentPromptSchema),
      })
      .strict(),
  },
  star: {
    input: z.object({ input: promptInputSchema }).strict(),
    output: z.object({ id: z.string() }).strict(),
  },
  unstar: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.object({ unstarred: z.boolean() }).strict(),
  },
  markUsed: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.null(),
  },
});
