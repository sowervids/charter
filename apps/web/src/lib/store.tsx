import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { CommittedEvent } from "@charter/schema";
import {
  api,
  type Bootstrap,
  type ChannelInfo,
  type RosterEntry,
  type TaskInfo,
} from "./api.js";
import { connectEvents, type ConnectionStatus } from "./sse.js";

export type View =
  | { kind: "channel"; channelId: string }
  | { kind: "board"; taskId?: string }
  | { kind: "log" }
  | { kind: "gallery" };

export interface PendingMessage {
  tempId: string;
  channelId: string;
  body: string;
  at: string;
  failed?: boolean;
}

interface State {
  phase: "loading" | "ready" | "error";
  company: { id: string; name: string } | null;
  channels: ChannelInfo[];
  view: View;
  connection: ConnectionStatus;
  /** channelId → events sorted by seq (deduped by id) */
  timelines: Record<string, CommittedEvent[]>;
  /** channelId → true once the backlog fetch completed */
  loaded: Record<string, boolean>;
  pending: PendingMessage[];
  lastSeq: number;
  /** runId → live agent run state (from agent.run_* events) */
  runs: Record<string, AgentRunState>;
  roster: RosterEntry[];
  tasks: TaskInfo[];
  tasksLoaded: boolean;
  /** taskId → its stream events (detail panel) */
  taskTimelines: Record<string, CommittedEvent[]>;
}

export interface AgentRunState {
  runId: string;
  agentId: string;
  channelId: string;
  status: "queued" | "running" | "completed" | "failed" | "interrupted";
  reason?: string;
  startedAt: string;
  endedAt?: string;
}

type Action =
  | { t: "bootstrap"; data: Bootstrap }
  | { t: "bootstrap_failed" }
  | { t: "view"; view: View }
  | { t: "connection"; status: ConnectionStatus }
  | { t: "timeline"; channelId: string; events: CommittedEvent[] }
  | { t: "event"; event: CommittedEvent }
  | { t: "pending_add"; message: PendingMessage }
  | { t: "pending_resolve"; tempId: string }
  | { t: "pending_failed"; tempId: string }
  | { t: "tasks"; tasks: TaskInfo[] }
  | { t: "task_timeline"; taskId: string; events: CommittedEvent[] };

function channelOf(stream: string): string | null {
  return stream.startsWith("channel:") ? stream.slice(8) : null;
}

function mergeEvents(
  existing: CommittedEvent[],
  incoming: CommittedEvent[],
): CommittedEvent[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

function reducer(state: State, action: Action): State {
  switch (action.t) {
    case "bootstrap":
      return {
        ...state,
        phase: "ready",
        company: action.data.company,
        channels: action.data.channels,
        roster: action.data.roster,
        lastSeq: action.data.lastSeq,
      };
    case "tasks":
      return { ...state, tasks: action.tasks, tasksLoaded: true };
    case "task_timeline":
      return {
        ...state,
        taskTimelines: {
          ...state.taskTimelines,
          [action.taskId]: mergeEvents(
            state.taskTimelines[action.taskId] ?? [],
            action.events,
          ),
        },
      };
    case "bootstrap_failed":
      return { ...state, phase: "error" };
    case "view":
      return { ...state, view: action.view };
    case "connection":
      return { ...state, connection: action.status };
    case "timeline":
      return {
        ...state,
        loaded: { ...state.loaded, [action.channelId]: true },
        timelines: {
          ...state.timelines,
          [action.channelId]: mergeEvents(
            state.timelines[action.channelId] ?? [],
            action.events,
          ),
        },
      };
    case "event": {
      const next: State = {
        ...state,
        lastSeq: Math.max(state.lastSeq, action.event.seq),
      };
      if (action.event.type.startsWith("agent.run_")) {
        const p = action.event.payload as {
          run_id: string;
          agent_id?: string;
          channel_id?: string;
          reason?: string;
        };
        const prior = state.runs[p.run_id];
        const status =
          action.event.type === "agent.run_queued"
            ? ("queued" as const)
            : action.event.type === "agent.run_started"
              ? ("running" as const)
              : action.event.type === "agent.run_completed"
                ? ("completed" as const)
                : action.event.type === "agent.run_failed"
                  ? ("failed" as const)
                  : action.event.type === "agent.run_interrupted"
                    ? ("interrupted" as const)
                    : null;
        if (status !== null) {
          next.runs = {
            ...state.runs,
            [p.run_id]: {
              runId: p.run_id,
              agentId: p.agent_id ?? prior?.agentId ?? "agent",
              channelId: p.channel_id ?? prior?.channelId ?? "",
              status,
              ...(p.reason !== undefined ? { reason: p.reason } : {}),
              startedAt: prior?.startedAt ?? action.event.created_at,
              ...(status === "completed" ||
              status === "failed" ||
              status === "interrupted"
                ? { endedAt: action.event.created_at }
                : {}),
            },
          };
        }
      }
      if (
        action.event.type === "channel.created" &&
        !state.channels.some(
          (c) =>
            c.channel_id ===
            (action.event.payload as { channel_id: string }).channel_id,
        )
      ) {
        const p = action.event.payload as {
          channel_id: string;
          name: string;
          topic?: string;
        };
        next.channels = [
          ...state.channels,
          {
            channel_id: p.channel_id,
            name: p.name,
            topic: p.topic ?? null,
            created_at: action.event.created_at,
          },
        ].sort((a, b) => a.name.localeCompare(b.name));
      }
      const channelId = channelOf(action.event.stream);
      if (channelId !== null && action.event.visibility === "company") {
        next.timelines = {
          ...next.timelines,
          [channelId]: mergeEvents(state.timelines[channelId] ?? [], [
            action.event,
          ]),
        };
      }
      if (
        action.event.stream.startsWith("task:") &&
        action.event.visibility === "company"
      ) {
        const taskId = action.event.stream.slice(5);
        next.taskTimelines = {
          ...next.taskTimelines,
          [taskId]: mergeEvents(state.taskTimelines[taskId] ?? [], [
            action.event,
          ]),
        };
      }
      return next;
    }
    case "pending_add":
      return { ...state, pending: [...state.pending, action.message] };
    case "pending_resolve":
      return {
        ...state,
        pending: state.pending.filter((p) => p.tempId !== action.tempId),
      };
    case "pending_failed":
      return {
        ...state,
        pending: state.pending.map((p) =>
          p.tempId === action.tempId ? { ...p, failed: true } : p,
        ),
      };
  }
}

function initialView(): View {
  const path = window.location.pathname;
  if (path === "/log") return { kind: "log" };
  if (path === "/dev/gallery") return { kind: "gallery" };
  if (path === "/board") return { kind: "board" };
  if (path.startsWith("/board/")) {
    return { kind: "board", taskId: path.slice(7) };
  }
  if (path.startsWith("/c/")) {
    return { kind: "channel", channelId: path.slice(3) };
  }
  return { kind: "channel", channelId: "general" };
}

const initial: State = {
  phase: "loading",
  company: null,
  channels: [],
  view: initialView(),
  connection: "connecting",
  timelines: {},
  loaded: {},
  pending: [],
  lastSeq: 0,
  runs: {},
  roster: [],
  tasks: [],
  tasksLoaded: false,
  taskTimelines: {},
};

export interface Store {
  state: State;
  navigate: (view: View) => void;
  openChannel: (channelId: string) => void;
  sendMessage: (channelId: string, body: string) => Promise<void>;
  ensureTimeline: (channelId: string) => void;
  ensureTasks: () => void;
  refreshTasks: () => void;
  ensureTaskTimeline: (taskId: string) => void;
  createTask: (input: {
    title: string;
    body?: string;
    assignee_id?: string;
    assignee_kind?: "human" | "agent";
    origin_event_id?: string;
    origin_channel_id?: string;
  }) => Promise<void>;
  patchTask: (
    taskId: string,
    patch: {
      status?: TaskInfo["status"];
      assignee_id?: string;
      assignee_kind?: "human" | "agent";
    },
  ) => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    let disconnect = () => {};
    let cancelled = false;
    void api
      .bootstrap()
      .then((data) => {
        if (cancelled) return;
        dispatch({ t: "bootstrap", data });
        disconnect = connectEvents({
          // Replay from 0 on first connect: the whole record is the app state.
          after: 0,
          onEvent: (event) => {
            dispatch({ t: "event", event });
            // Task projections carry server-derived fields (task_num) —
            // refetch the list when task state changes.
            if (event.type.startsWith("task.")) {
              void api
                .tasks()
                .then(({ tasks }) => dispatch({ t: "tasks", tasks }))
                .catch(() => {});
            }
          },
          onStatus: (status) => dispatch({ t: "connection", status }),
        });
      })
      .catch(() => dispatch({ t: "bootstrap_failed" }));
    return () => {
      cancelled = true;
      disconnect();
    };
  }, []);

  const store = useMemo<Store>(() => {
    const navigate = (view: View) => {
      const path =
        view.kind === "channel"
          ? `/c/${view.channelId}`
          : view.kind === "board"
            ? view.taskId !== undefined
              ? `/board/${view.taskId}`
              : "/board"
            : view.kind === "log"
              ? "/log"
              : "/dev/gallery";
      window.history.pushState(null, "", path);
      dispatch({ t: "view", view });
    };
    return {
      state,
      navigate,
      openChannel: (channelId) => navigate({ kind: "channel", channelId }),
      ensureTimeline: (channelId) => {
        if (state.loaded[channelId]) return;
        void api.timeline(channelId).then(({ events }) => {
          dispatch({ t: "timeline", channelId, events });
        });
      },
      ensureTasks: () => {
        if (state.tasksLoaded) return;
        void api.tasks().then(({ tasks }) => dispatch({ t: "tasks", tasks }));
      },
      refreshTasks: () => {
        void api.tasks().then(({ tasks }) => dispatch({ t: "tasks", tasks }));
      },
      ensureTaskTimeline: (taskId) => {
        void api.taskTimeline(taskId).then(({ events }) => {
          dispatch({ t: "task_timeline", taskId, events });
        });
      },
      createTask: async (input) => {
        await api.createTask(input);
        const { tasks } = await api.tasks();
        dispatch({ t: "tasks", tasks });
      },
      patchTask: async (taskId, patch) => {
        await api.patchTask(taskId, patch);
        const { tasks } = await api.tasks();
        dispatch({ t: "tasks", tasks });
      },
      sendMessage: async (channelId, body) => {
        const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        dispatch({
          t: "pending_add",
          message: {
            tempId,
            channelId,
            body,
            at: new Date().toISOString(),
          },
        });
        try {
          const { event } = await api.postMessage(channelId, body);
          dispatch({ t: "event", event });
          dispatch({ t: "pending_resolve", tempId });
        } catch {
          dispatch({ t: "pending_failed", tempId });
        }
      },
    };
  }, [state]);

  useEffect(() => {
    const onPop = () => dispatch({ t: "view", view: initialView() });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (store === null) throw new Error("useStore outside StoreProvider");
  return store;
}
