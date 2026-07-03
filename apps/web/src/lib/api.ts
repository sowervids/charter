import type { CommittedEvent } from "@charter/schema";

const TOKEN_KEY = "charter.token";

/** Read ?token= once (printed by charterd at startup), persist, strip URL. */
export function adoptTokenFromUrl(): void {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    url.searchParams.delete("token");
    window.history.replaceState(null, "", url.toString());
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    throw new ApiError(res.status, `${init?.method ?? "GET"} ${path} → ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface ChannelInfo {
  channel_id: string;
  name: string;
  topic: string | null;
  created_at: string;
}

export interface RosterEntry {
  id: string;
  name: string;
  role: string;
  kind: "human" | "agent";
}

export interface TaskInfo {
  task_id: string;
  task_num: number;
  title: string;
  body: string | null;
  status: "triage" | "todo" | "doing" | "review" | "done" | "dropped";
  assignee_id: string | null;
  assignee_kind: "human" | "agent" | null;
  pr_number: number | null;
  pr_url: string | null;
  branch: string | null;
  created_at: string;
  updated_at: string;
}

export interface Bootstrap {
  company: { id: string; name: string };
  channels: ChannelInfo[];
  roster: RosterEntry[];
  lastSeq: number;
}

export const api = {
  bootstrap: () => request<Bootstrap>("/api/bootstrap"),
  timeline: (channelId: string, after = 0) =>
    request<{ events: CommittedEvent[] }>(
      `/api/channels/${encodeURIComponent(channelId)}/timeline?after=${after}`,
    ),
  postMessage: (channelId: string, body: string) =>
    request<{ event: CommittedEvent }>(
      `/api/channels/${encodeURIComponent(channelId)}/messages`,
      { method: "POST", body: JSON.stringify({ body }) },
    ),
  log: (after = 0, limit = 200) =>
    request<{ events: CommittedEvent[] }>(
      `/api/log?after=${after}&limit=${limit}`,
    ),
  tasks: () => request<{ tasks: TaskInfo[] }>("/api/tasks"),
  createTask: (input: {
    title: string;
    body?: string;
    assignee_id?: string;
    assignee_kind?: "human" | "agent";
    origin_event_id?: string;
    origin_channel_id?: string;
  }) =>
    request<{ event: CommittedEvent; task_num: number }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  patchTask: (
    taskId: string,
    patch: {
      status?: TaskInfo["status"];
      assignee_id?: string;
      assignee_kind?: "human" | "agent";
    },
  ) =>
    request<{ events: CommittedEvent[] }>(
      `/api/tasks/${encodeURIComponent(taskId)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),
  taskTimeline: (taskId: string) =>
    request<{ events: CommittedEvent[] }>(
      `/api/tasks/${encodeURIComponent(taskId)}/timeline`,
    ),
};
