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
  type TaskPriority,
} from "./api.js";
import { connectEvents, type ConnectionStatus } from "./sse.js";

export type View =
  | { kind: "channel"; channelId: string }
  | { kind: "board"; taskId?: string }
  | { kind: "approvals" }
  | { kind: "treasury" }
  | { kind: "people" }
  | { kind: "agent"; agentId: string }
  | { kind: "connections" }
  | { kind: "trace"; runId: string }
  | { kind: "log" }
  | { kind: "gallery" };

export interface PendingMessage {
  tempId: string;
  channelId: string;
  body: string;
  at: string;
  failed?: boolean;
}

export interface Toast {
  id: string;
  text: string;
  tone: "default" | "ok" | "danger";
  undo?: () => void;
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

interface State {
  phase: "loading" | "ready" | "error";
  company: { id: string; name: string } | null;
  channels: ChannelInfo[];
  view: View;
  connection: ConnectionStatus;
  timelines: Record<string, CommittedEvent[]>;
  loaded: Record<string, boolean>;
  /** message_event_id → true; folds message.deleted over any timeline */
  deleted: Record<string, true>;
  pending: PendingMessage[];
  lastSeq: number;
  runs: Record<string, AgentRunState>;
  roster: RosterEntry[];
  tasks: TaskInfo[];
  tasksLoaded: boolean;
  approvalsPending: number;
  taskTimelines: Record<string, CommittedEvent[]>;
  toasts: Toast[];
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
  | { t: "task_timeline"; taskId: string; events: CommittedEvent[] }
  | { t: "roster"; roster: RosterEntry[] }
  | { t: "approvals_pending"; count: number }
  | { t: "toast"; toast: Toast }
  | { t: "toast_dismiss"; id: string };

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
    case "roster":
      return { ...state, roster: action.roster };
    case "tasks":
      return { ...state, tasks: action.tasks, tasksLoaded: true };
    case "approvals_pending":
      return { ...state, approvalsPending: action.count };
    case "toast":
      return { ...state, toasts: [...state.toasts, action.toast] };
    case "toast_dismiss":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
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
      const event = action.event;
      const next: State = { ...state, lastSeq: Math.max(state.lastSeq, event.seq) };

      if (event.type.startsWith("agent.run_")) {
        const p = event.payload as {
          run_id: string;
          agent_id?: string;
          channel_id?: string;
          reason?: string;
        };
        const prior = state.runs[p.run_id];
        const status =
          event.type === "agent.run_queued"
            ? ("queued" as const)
            : event.type === "agent.run_started"
              ? ("running" as const)
              : event.type === "agent.run_completed"
                ? ("completed" as const)
                : event.type === "agent.run_failed"
                  ? ("failed" as const)
                  : event.type === "agent.run_interrupted"
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
              startedAt: prior?.startedAt ?? event.created_at,
              ...(status === "completed" || status === "failed" || status === "interrupted"
                ? { endedAt: event.created_at }
                : {}),
            },
          };
        }
      }

      if (event.type === "channel.created") {
        const p = event.payload as { channel_id: string; name: string; topic?: string };
        if (!state.channels.some((c) => c.channel_id === p.channel_id)) {
          next.channels = [
            ...state.channels,
            {
              channel_id: p.channel_id,
              name: p.name,
              topic: p.topic ?? null,
              created_at: event.created_at,
            },
          ];
        }
      }
      if (event.type === "channel.updated") {
        const p = event.payload as { channel_id: string; name?: string; topic?: string };
        next.channels = state.channels.map((c) =>
          c.channel_id === p.channel_id
            ? { ...c, ...(p.name ? { name: p.name } : {}), ...(p.topic !== undefined ? { topic: p.topic } : {}) }
            : c,
        );
      }
      if (event.type === "channel.archived") {
        const p = event.payload as { channel_id: string };
        next.channels = state.channels.filter((c) => c.channel_id !== p.channel_id);
      }
      if (event.type === "message.deleted") {
        const p = event.payload as { message_event_id: string };
        next.deleted = { ...state.deleted, [p.message_event_id]: true };
      }

      const channelId = channelOf(event.stream);
      if (channelId !== null && event.visibility === "company") {
        next.timelines = {
          ...next.timelines,
          [channelId]: mergeEvents(state.timelines[channelId] ?? [], [event]),
        };
      }
      if (event.stream.startsWith("task:") && event.visibility === "company") {
        const taskId = event.stream.slice(5);
        next.taskTimelines = {
          ...next.taskTimelines,
          [taskId]: mergeEvents(state.taskTimelines[taskId] ?? [], [event]),
        };
      }
      return next;
    }
    case "pending_add":
      return { ...state, pending: [...state.pending, action.message] };
    case "pending_resolve":
      return { ...state, pending: state.pending.filter((p) => p.tempId !== action.tempId) };
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
  if (path === "/approvals") return { kind: "approvals" };
  if (path === "/treasury") return { kind: "treasury" };
  if (path === "/people") return { kind: "people" };
  if (path === "/connections") return { kind: "connections" };
  if (path.startsWith("/people/")) return { kind: "agent", agentId: path.slice(8) };
  if (path.startsWith("/trace/")) return { kind: "trace", runId: path.slice(7) };
  if (path === "/board") return { kind: "board" };
  if (path.startsWith("/board/")) return { kind: "board", taskId: path.slice(7) };
  if (path.startsWith("/c/")) return { kind: "channel", channelId: path.slice(3) };
  return { kind: "channel", channelId: "general" };
}

function pathOf(view: View): string {
  switch (view.kind) {
    case "channel":
      return `/c/${view.channelId}`;
    case "board":
      return view.taskId !== undefined ? `/board/${view.taskId}` : "/board";
    case "approvals":
      return "/approvals";
    case "treasury":
      return "/treasury";
    case "people":
      return "/people";
    case "agent":
      return `/people/${view.agentId}`;
    case "connections":
      return "/connections";
    case "trace":
      return `/trace/${view.runId}`;
    case "log":
      return "/log";
    case "gallery":
      return "/dev/gallery";
  }
}

const initial: State = {
  phase: "loading",
  company: null,
  channels: [],
  view: initialView(),
  connection: "connecting",
  timelines: {},
  loaded: {},
  deleted: {},
  pending: [],
  lastSeq: 0,
  runs: {},
  roster: [],
  tasks: [],
  tasksLoaded: false,
  approvalsPending: 0,
  taskTimelines: {},
  toasts: [],
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
      title?: string;
      body?: string;
      priority?: TaskPriority;
    },
  ) => Promise<void>;
  deleteTask: (task: TaskInfo) => Promise<void>;
  commentTask: (taskId: string, body: string) => Promise<void>;
  createChannel: (name: string, topic?: string) => Promise<string | null>;
  archiveChannel: (channelId: string) => Promise<void>;
  deleteMessage: (channelId: string, eventId: string) => Promise<void>;
  toast: (text: string, tone?: Toast["tone"], undo?: () => void) => void;
  dismissToast: (id: string) => void;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    let disconnect = () => {};
    let cancelled = false;
    const refreshRoster = () =>
      void api
        .bootstrap()
        .then((d) => dispatch({ t: "roster", roster: d.roster }))
        .catch(() => {});
    const refreshTasks = () =>
      void api.tasks().then(({ tasks }) => dispatch({ t: "tasks", tasks })).catch(() => {});
    const refreshApprovals = () =>
      void api
        .approvals("pending")
        .then(({ approvals }) => dispatch({ t: "approvals_pending", count: approvals.length }))
        .catch(() => {});

    void api
      .bootstrap()
      .then((data) => {
        if (cancelled) return;
        dispatch({ t: "bootstrap", data });
        refreshApprovals();
        disconnect = connectEvents({
          after: 0,
          onEvent: (event) => {
            dispatch({ t: "event", event });
            if (event.type.startsWith("task.")) refreshTasks();
            if (event.type.startsWith("approval.")) refreshApprovals();
            if (event.type.startsWith("agent.hired") || event.type.startsWith("agent.paused") || event.type.startsWith("agent.resumed")) {
              refreshRoster();
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
      window.history.pushState(null, "", pathOf(view));
      dispatch({ t: "view", view });
    };
    const toast = (text: string, tone: Toast["tone"] = "default", undo?: () => void) => {
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      dispatch({ t: "toast", toast: { id, text, tone, ...(undo ? { undo } : {}) } });
    };
    const refetchTasks = async () => {
      const { tasks } = await api.tasks();
      dispatch({ t: "tasks", tasks });
    };
    return {
      state,
      navigate,
      toast,
      dismissToast: (id) => dispatch({ t: "toast_dismiss", id }),
      openChannel: (channelId) => navigate({ kind: "channel", channelId }),
      ensureTimeline: (channelId) => {
        if (state.loaded[channelId]) return;
        void api.timeline(channelId).then(({ events }) =>
          dispatch({ t: "timeline", channelId, events }),
        );
      },
      ensureTasks: () => {
        if (state.tasksLoaded) return;
        void api.tasks().then(({ tasks }) => dispatch({ t: "tasks", tasks }));
      },
      refreshTasks: () => void refetchTasks(),
      ensureTaskTimeline: (taskId) => {
        void api.taskTimeline(taskId).then(({ events }) =>
          dispatch({ t: "task_timeline", taskId, events }),
        );
      },
      createTask: async (input) => {
        await api.createTask(input);
        await refetchTasks();
      },
      patchTask: async (taskId, patch) => {
        await api.patchTask(taskId, patch);
        await refetchTasks();
      },
      deleteTask: async (task) => {
        await api.deleteTask(task.task_id);
        await refetchTasks();
        toast(`CH-${task.task_num} deleted`, "danger", () => {
          void api
            .createTask({
              title: task.title,
              ...(task.body ? { body: task.body } : {}),
              ...(task.assignee_id && task.assignee_kind
                ? { assignee_id: task.assignee_id, assignee_kind: task.assignee_kind }
                : {}),
            })
            .then(refetchTasks);
        });
      },
      commentTask: async (taskId, body) => {
        const { event } = await api.taskComment(taskId, body);
        dispatch({ t: "event", event });
      },
      createChannel: async (name, topic) => {
        try {
          const { channel_id } = await api.createChannel(name, topic);
          navigate({ kind: "channel", channelId: channel_id });
          return channel_id;
        } catch (error) {
          toast(
            error instanceof Error && error.message.includes("409")
              ? "That channel already exists"
              : "Couldn't create channel",
            "danger",
          );
          return null;
        }
      },
      archiveChannel: async (channelId) => {
        await api.archiveChannel(channelId);
        toast(`#${channelId} archived`, "default");
        navigate({ kind: "channel", channelId: "general" });
      },
      deleteMessage: async (channelId, eventId) => {
        await api.deleteMessage(channelId, eventId);
      },
      sendMessage: async (channelId, body) => {
        const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        dispatch({
          t: "pending_add",
          message: { tempId, channelId, body, at: new Date().toISOString() },
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
