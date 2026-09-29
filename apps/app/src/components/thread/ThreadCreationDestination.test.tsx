// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { ThreadCreationPlacement } from "@/lib/thread-creation-placement";
import { ThreadCreationDestination } from "./ThreadCreationDestination";

afterEach(cleanup);

function Harness() {
  const [placement, setPlacement] = useState<ThreadCreationPlacement>({
    sectionId: "sec_managers",
    pinned: true,
  });
  return (
    <ThreadCreationDestination
      placement={placement}
      onChange={setPlacement}
      sections={[
        { id: "sec_managers", name: "Managers" },
        { id: "sec_work", name: "Work" },
      ]}
    />
  );
}

it("shows the inherited destination and lets the user change section and pinning", async () => {
  render(<Harness />);
  const trigger = screen.getByRole("button", { name: "Thread destination" });
  expect(trigger.textContent).toBe("Pinned · Managers");
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Work" }));
  expect(trigger.textContent).toBe("Pinned · Work");
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Unpin new thread" }),
  );
  expect(trigger.textContent).toBe("Work");
});
