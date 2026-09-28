import { afterEach, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  events,
  getThread,
  listQueuedThreadMessagesWaitingOnKind,
} from "@bb/db";
import { maintainMachine } from "../../../src/services/machines/lifecycle.js";
import { HostOnlineRpcTimeoutError } from "../../../src/ws/hub.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedThread,
  seedTurnStarted,
} from "../../helpers/seed.js";
import { textInput } from "../../helpers/prompt-input.js";
import { withTestHarness } from "../../helpers/test-app.js";

afterEach(() => {
  vi.restoreAllMocks();
});

it("preserves a machine whose daemon never answers the stop, and frees the queue", async () =>
  withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, { id: "unanswered-stop" });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "active",
    });
    seedTurnStarted(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      turnId: "turn-unanswered",
    });
    vi.spyOn(harness.hub, "requestHostOnlineRpc").mockImplementation(
      async () => {
        seedQueuedMessage(harness.deps, {
          threadId: thread.id,
          content: textInput("okay push it when you're ready"),
          waitingOn: { kind: "stopping" },
        });
        throw new HostOnlineRpcTimeoutError();
      },
    );
    const save = vi.fn(async () => {});

    await maintainMachine(harness.deps, host.id, "operation-unanswered", save);

    expect(save).toHaveBeenCalledOnce();
    expect(getThread(harness.db, thread.id)?.status).toBe("idle");
    expect(
      harness.db
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.threadId, thread.id),
            eq(events.type, "system/error"),
            sql`json_extract(${events.data}, '$.code') = 'machine_maintenance'`,
          ),
        )
        .all(),
    ).toHaveLength(1);
    await vi.waitFor(() => {
      expect(
        listQueuedThreadMessagesWaitingOnKind(harness.db, {
          threadId: thread.id,
          kind: "stopping",
        }),
      ).toHaveLength(0);
    });
  }));
