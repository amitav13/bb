import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  promptInputSchema,
  type PromptInputChunk,
  type TextPromptInputChunk,
} from "./contract.js";
import { promptText } from "./prompt-text.js";

type PluginDatabase = ReturnType<BbPluginApi["storage"]["database"]>;

export const STARRED_PROMPT_MIGRATIONS = [
  `CREATE TABLE saved_prompts (
    id TEXT PRIMARY KEY,
    input_json TEXT NOT NULL,
    text TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  )`,
];

export interface StarredPrompt {
  id: string;
  input: TextPromptInputChunk[];
  text: string;
  createdAt: number;
  lastUsedAt: number | null;
}

interface StarredPromptRecord {
  id: string;
  input_json: string;
  text: string;
  created_at: number;
  last_used_at: number | null;
}

function textChunks(
  input: readonly PromptInputChunk[],
): TextPromptInputChunk[] {
  return input.flatMap((chunk) =>
    chunk.type === "text" && chunk.text.trim().length > 0 ? [chunk] : [],
  );
}

function fromRecord(record: StarredPromptRecord): StarredPrompt {
  return {
    id: record.id,
    input: textChunks(promptInputSchema.parse(JSON.parse(record.input_json))),
    text: record.text,
    createdAt: record.created_at,
    lastUsedAt: record.last_used_at,
  };
}

export interface StarredPromptStore {
  list(): StarredPrompt[];
  star(input: readonly PromptInputChunk[], now: number): StarredPrompt | null;
  unstar(id: string): boolean;
  markUsed(id: string, now: number): void;
}

export function createStarredPromptStore(
  db: PluginDatabase,
): StarredPromptStore {
  const listStatement = db.prepare<[], StarredPromptRecord>(
    `SELECT id, input_json, text, created_at, last_used_at
       FROM saved_prompts
      ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC`,
  );
  const findByTextStatement = db.prepare<[string], StarredPromptRecord>(
    `SELECT id, input_json, text, created_at, last_used_at
       FROM saved_prompts WHERE text = ?`,
  );
  const insertStatement = db.prepare(
    `INSERT INTO saved_prompts (id, input_json, text, created_at, last_used_at)
     VALUES (?, ?, ?, ?, NULL)`,
  );
  const deleteStatement = db.prepare(`DELETE FROM saved_prompts WHERE id = ?`);
  const markUsedStatement = db.prepare(
    `UPDATE saved_prompts SET last_used_at = ? WHERE id = ?`,
  );

  return {
    list: () => listStatement.all().map(fromRecord),
    star(input, now) {
      const chunks = textChunks(input);
      const text = promptText(chunks);
      if (text.trim().length === 0) return null;
      const existing = findByTextStatement.get(text);
      if (existing !== undefined) return fromRecord(existing);
      const id = `prompt_${randomUUID()}`;
      insertStatement.run(id, JSON.stringify(chunks), text, now);
      return { id, input: chunks, text, createdAt: now, lastUsedAt: null };
    },
    unstar: (id) => deleteStatement.run(id).changes > 0,
    markUsed(id, now) {
      markUsedStatement.run(now, id);
    },
  };
}
