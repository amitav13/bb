// @vitest-environment jsdom

import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PromptTextMention } from "@bb/domain";
import type { ComposerTypeaheadRegistration } from "@get-bb/plugin-sdk";
import {
  EMPTY_ORDERED_MENTION_SUGGESTIONS,
  type PromptDraftState,
} from "@bb/client-core";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  PluginComposerHostProvider,
  type PluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import {
  openComposerTypeahead,
  useComposerTypeaheadApi,
} from "@/components/plugin/ComposerTypeaheadHost";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  PromptBoxInternal,
} from "./PromptBoxInternal";

afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => setTimeout(resolve, 2));
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.clearAllMocks();
});

const MENTION: PromptTextMention = {
  start: 4,
  end: 9,
  resource: {
    kind: "path",
    source: "workspace",
    entryKind: "file",
    path: "src/a.ts",
    label: "a.ts",
  },
};

function PickerTypeahead() {
  const typeahead = useComposerTypeaheadApi();
  const draftText = typeahead.draft
    .flatMap((chunk) => (chunk.type === "text" ? [chunk.text] : []))
    .join("");
  return (
    <div>
      <input aria-label="Search prompts" autoFocus />
      <span data-testid="typeahead-draft">{draftText}</span>
      <button
        type="button"
        onClick={() =>
          typeahead.insert([
            { type: "text", text: "see @a.ts", mentions: [MENTION] },
            { type: "localImage", path: ".bb/attachments/shot.png" },
          ])
        }
      >
        Insert starred prompt
      </button>
      <button type="button" onClick={() => typeahead.close()}>
        Close picker
      </button>
    </div>
  );
}

function registerPicker(
  overrides: Partial<ComposerTypeaheadRegistration> = {},
) {
  setPluginSlotRegistrations(
    "prompt-library",
    makePluginRegistrationSet({
      composerCustomizations: [
        {
          id: "library",
          experimental_typeaheads: [
            {
              id: "prompts",
              label: "Prompts…",
              component: PickerTypeahead,
              ...overrides,
            },
          ],
        },
      ],
    }),
  );
}

interface RenderedComposer {
  changes: PromptDraftState[];
  setDraft: ReturnType<typeof vi.fn>;
}

async function renderComposer(initialValue: string): Promise<RenderedComposer> {
  const changes: PromptDraftState[] = [];
  const setDraft = vi.fn();

  function Harness() {
    const [value, setValue] = useState(initialValue);
    const [mentionRanges, setMentionRanges] = useState<PromptTextMention[]>([]);
    const [host] = useState<PluginComposerHost>(() => ({
      scope: { kind: "thread", threadId: "thread-1" },
      textEffectKey: "typeahead-test",
      getCurrent: () => ({ text: value, mentions: [], attachments: [] }),
      subscribeDraft: () => () => {},
      setDraft: (next) => {
        setDraft(next);
        setValue(next.text);
        setMentionRanges(next.mentions);
      },
      focus: () => {},
    }));
    return (
      <PluginComposerHostProvider value={host}>
        <PromptBoxInternal
          value={value}
          mentionRanges={mentionRanges}
          onChange={(nextValue, nextMentions) => {
            changes.push({
              text: nextValue,
              mentions: nextMentions,
              attachments: [],
            });
            setValue(nextValue);
            setMentionRanges(nextMentions);
          }}
          onSubmit={vi.fn()}
          mentionMenuPlacement="top"
          typeahead={{
            mention: {
              results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
              isLoading: false,
              isError: false,
              onQueryChange: vi.fn(),
            },
            command: INERT_TYPEAHEAD_COMMAND_CONFIG,
          }}
        />
      </PluginComposerHostProvider>
    );
  }

  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(document.activeElement).toBe(document.querySelector(".ProseMirror")),
  );
  return { changes, setDraft };
}

function getEditor() {
  const element = document.querySelector(".ProseMirror");
  const editor = (element as TiptapEditorHTMLElement | null)?.editor;
  if (!editor) throw new Error("Prompt editor was not mounted");
  return editor;
}

function placeCaret(position: number) {
  const editor = getEditor();
  act(() => {
    editor.commands.focus();
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, position),
      ),
    );
  });
}

async function openFromPlusMenu(label: string) {
  const trigger = screen.getByRole("button", { name: "Prompt actions" });
  fireEvent.pointerDown(trigger, { button: 0 });
  const menu = await screen.findByRole("menu", { name: "Prompt actions" });
  fireEvent.click(within(menu).getByRole("menuitem", { name: label }));
  return screen.findByRole("dialog", { name: label });
}

describe("PromptBoxInternal plugin typeaheads", () => {
  it("opens from the + menu with the draft and inserts at the caret it opened from", async () => {
    registerPicker();
    const { changes } = await renderComposer("hello world");
    placeCaret(7);

    const dialog = await openFromPlusMenu("Prompts…");
    expect(
      document
        .querySelector("[data-promptbox-typeahead-menu]")
        ?.contains(dialog),
    ).toBe(true);
    expect(within(dialog).getByTestId("typeahead-draft").textContent).toBe(
      "hello world",
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole("textbox", { name: "Search prompts" }),
      ),
    );

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Insert starred prompt" }),
    );

    await waitFor(() =>
      expect(changes.at(-1)?.text).toBe("hello see @a.tsworld"),
    );
    expect(changes.at(-1)?.mentions).toEqual([
      { ...MENTION, start: 10, end: 15 },
    ]);
    expect(screen.queryByRole("dialog", { name: "Prompts…" })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector(".ProseMirror"),
      ),
    );
  });

  it("restores the whole prompt, attachments included, into an empty draft", async () => {
    registerPicker();
    const { setDraft } = await renderComposer("");

    const dialog = await openFromPlusMenu("Prompts…");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Insert starred prompt" }),
    );

    await waitFor(() => expect(setDraft).toHaveBeenCalledTimes(1));
    expect(setDraft).toHaveBeenCalledWith({
      text: "see @a.ts",
      mentions: [MENTION],
      attachments: [
        {
          type: "localImage",
          path: ".bb/attachments/shot.png",
          name: "shot.png",
          sizeBytes: 0,
        },
      ],
    });
  });

  it("closes back to the caret without changing the draft", async () => {
    registerPicker();
    const { changes } = await renderComposer("hello world");
    placeCaret(3);

    const dialog = await openFromPlusMenu("Prompts…");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close picker" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Prompts…" })).toBeNull(),
    );
    expect(changes).toEqual([]);
    expect(getEditor().state.selection.from).toBe(3);
  });

  it("opens from a command in the last focused composer and rejects unknown ids", async () => {
    registerPicker({ plusMenu: false });
    await renderComposer("draft");
    placeCaret(1);

    let opened = false;
    act(() => {
      opened = openComposerTypeahead("prompt-library", "prompts");
    });
    expect(opened).toBe(true);
    expect(
      await screen.findByRole("dialog", { name: "Prompts…" }),
    ).toBeTruthy();
    expect(openComposerTypeahead("prompt-library", "missing")).toBe(false);
    expect(openComposerTypeahead("other-plugin", "prompts")).toBe(false);
  });

  it("omits the + menu row when plusMenu is false", async () => {
    registerPicker({ plusMenu: false });
    await renderComposer("");

    expect(screen.queryByRole("button", { name: "Prompt actions" })).toBeNull();
  });
});
