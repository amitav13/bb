import type { PromptInputChunk } from "./contract.js";

export function promptText(input: readonly PromptInputChunk[]): string {
  return input
    .flatMap((chunk) => (chunk.type === "text" ? [chunk.text] : []))
    .join("\n\n");
}
