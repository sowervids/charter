import { useEffect, useRef, useState } from "react";
import {
  Bot,
  GitPullRequest,
  MoreHorizontal,
  Plus,
  Send,
  User,
  X,
} from "lucide-react";
import type { CommittedEvent } from "@charter/schema";
import type { TaskInfo, TaskPriority } from "../lib/api.js";
import { useStore } from "../lib/store.js";
import { agentHueVar } from "../lib/identity.js";
import { Dialog } from "./Dialog.js";
import { EventRow } from "./EventRow.js";
import { Menu, MenuItem } from "./Menu.js";

const COLUMNS: Array<{ status: TaskInfo["status"]; label: string }> = [
  { status: "triage", label: "Triage" },
  { status: "todo", label: "Todo" },
  { status: "doing", label: "In progress" },
  { status: "review", label: "In review" },
  { status: "done", label: "Done" },
];

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  none: "var(--color-line-2)",
  low: "var(--color-info)",
  med: "var(--color-warn)",
  high: "var(--color-danger)",
  urgent: "var(--color-danger)",
};

export function BoardView({ taskId }: { taskId?: string }) {
  const { state, ensureTasks, navigate, patchTask } = useStore();
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    ensureTasks();
  }, [ensureTasks]);

  const selected = state.tasks.find((t) => t.task_id === taskId) ?? null;
  const open = state.tasks.filter((t) => t.status !== "done" && t.status !== "dropped");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line-1 px-6">
        <h1 className="text-[13px] font-semibold">Board</h1>
        <span className="tnum font-mono text-[11px] text-text-3">{open.length} open</span>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto flex items-center gap-1.5 rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1 text-[12px] text-text-2 hover:border-line-2 hover:text-text-1"
        >
          <Plus size={14} strokeWidth={1.5} /> New task
        </button>
      </header>

      <div className="flex flex-1 gap-3 overflow-x-auto p-3">
        {!state.tasksLoaded && <BoardSkeleton />}
        {state.tasksLoaded &&
          COLUMNS.map((column) => {
            const tasks = state.tasks
              .filter((t) => t.status === column.status)
              .sort((a, b) => b.task_num - a.task_num);
            return (
              <section
                key={column.status}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(column.status);
                }}
                onDragLeave={() => setDragOver((d) => (d === column.status ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const id = e.dataTransfer.getData("text/task");
                  const task = state.tasks.find((t) => t.task_id === id);
                  if (task && task.status !== column.status) {
                    void patchTask(id, { status: column.status });
                  }
                }}
                className={`flex min-w-[240px] flex-1 flex-col rounded-lg transition-colors duration-(--motion-fast) ${
                  dragOver === column.status ? "bg-bg-1" : ""
                }`}
              >
                <div className="flex items-baseline gap-2 px-2 py-2.5">
                  <h2 className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">{column.label}</h2>
                  <span className="tnum font-mono text-[10px] text-text-3">{tasks.length}</span>
                </div>
                <div className="flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-3">
                  {tasks.map((task) => (
                    <TaskCard
                      key={task.task_id}
                      task={task}
                      selected={task.task_id === taskId}
                      onOpen={() => navigate({ kind: "board", taskId: task.task_id })}
                    />
                  ))}
                  {tasks.length === 0 && (
                    <div className="rounded-md border border-dashed border-line-1 px-2 py-6 text-center font-mono text-[10px] text-text-3">
                      empty
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        {state.tasksLoaded && state.tasks.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/3 mx-auto max-w-md px-8 text-center text-[13px] text-text-2">
            No tasks yet. Create one, or promote any message from a channel —
            assigning a task to an agent starts the work.
          </div>
        )}
      </div>

      {selected && <TaskDrawer task={selected} onClose={() => navigate({ kind: "board" })} />}
      {creating && <NewTaskDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function TaskCard({
  task,
  selected,
  onOpen,
}: {
  task: TaskInfo;
  selected: boolean;
  onOpen: () => void;
}) {
  const { deleteTask, patchTask } = useStore();
  const [menu, setMenu] = useState(false);
  const isAgent = task.assignee_kind === "agent";
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/task", task.task_id)}
      onClick={onOpen}
      className={`group relative cursor-pointer rounded-md border bg-bg-1 px-2.5 py-2 transition-colors duration-(--motion-fast) ${
        selected ? "border-accent-dim bg-bg-2" : "border-line-1 hover:border-line-2 hover:bg-bg-2"
      }`}
    >
      <div className="flex items-center gap-1.5">
        {task.priority !== "none" && (
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: PRIORITY_COLOR[task.priority] }} title={task.priority} />
        )}
        <span className="tnum font-mono text-[10px] text-text-3">CH-{task.task_num}</span>
        {task.pr_number !== null && (
          <span className="flex items-center gap-0.5 font-mono text-[10px] text-info">
            <GitPullRequest size={11} strokeWidth={1.5} />#{task.pr_number}
          </span>
        )}
        {task.assignee_id && (
          <span className="ml-auto flex items-center gap-1 font-mono text-[10px]" style={isAgent ? { color: agentHueVar(task.assignee_id) } : { color: "var(--color-text-3)" }}>
            {isAgent ? <Bot size={11} strokeWidth={1.5} /> : <User size={11} strokeWidth={1.5} />}
            {task.assignee_id}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenu((m) => !m);
          }}
          aria-label="Task options"
          className="absolute right-1.5 top-1.5 hidden h-5 w-5 items-center justify-center rounded-sm text-text-3 hover:bg-bg-3 hover:text-text-1 group-hover:flex"
        >
          <MoreHorizontal size={13} strokeWidth={1.5} />
        </button>
        {menu && (
          <div className="absolute right-1.5 top-6 z-30" onClick={(e) => e.stopPropagation()}>
            <Menu onClose={() => setMenu(false)} align="right">
              {task.status !== "dropped" && (
                <MenuItem onClick={() => { setMenu(false); void patchTask(task.task_id, { status: "dropped" }); }}>Drop</MenuItem>
              )}
              <MenuItem tone="danger" onClick={() => { setMenu(false); void deleteTask(task); }}>Delete</MenuItem>
            </Menu>
          </div>
        )}
      </div>
      <div className="mt-1 pr-4 text-[12px] leading-[17px] text-text-1">{task.title}</div>
    </div>
  );
}

function TaskDrawer({ task, onClose }: { task: TaskInfo; onClose: () => void }) {
  const { state, ensureTaskTimeline, patchTask, deleteTask, commentTask, navigate } = useStore();
  const events = (state.taskTimelines[task.task_id] ?? []).filter(
    (e) => e.type !== "message.deleted" && !state.deleted[e.id],
  );
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body ?? "");
  const [comment, setComment] = useState("");
  const [menu, setMenu] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureTaskTimeline(task.task_id);
  }, [task.task_id, ensureTaskTimeline]);
  useEffect(() => {
    setTitle(task.title);
    setBody(task.body ?? "");
  }, [task.task_id, task.title, task.body]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [events.length]);

  const saveTitle = () => {
    const t = title.trim();
    if (t && t !== task.title) void patchTask(task.task_id, { title: t });
  };
  const saveBody = () => {
    if (body !== (task.body ?? "")) void patchTask(task.task_id, { body });
  };

  return (
    <>
      <div className="animate-overlay absolute inset-0 z-20 bg-bg-0/40" onClick={onClose} />
      <aside className="animate-drawer absolute right-0 top-0 z-30 flex h-full w-[400px] flex-col border-l border-line-1 bg-bg-1 shadow-[var(--shadow-3)]">
        <header className="flex items-center gap-2 border-b border-line-1 px-4 py-2.5">
          <span className="tnum font-mono text-[10px] text-text-3">CH-{task.task_num}</span>
          {task.pr_url && (
            <a href={task.pr_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-mono text-[10px] text-info hover:underline">
              <GitPullRequest size={11} strokeWidth={1.5} />#{task.pr_number}
            </a>
          )}
          <div className="relative ml-auto">
            <button type="button" onClick={() => setMenu((m) => !m)} aria-label="Options" className="flex h-6 w-6 items-center justify-center rounded-sm text-text-3 hover:bg-bg-2 hover:text-text-1">
              <MoreHorizontal size={15} strokeWidth={1.5} />
            </button>
            {menu && (
              <Menu onClose={() => setMenu(false)} align="right">
                {task.origin_event_id && (
                  <MenuItem onClick={() => { setMenu(false); onClose(); }}>Open origin message</MenuItem>
                )}
                <MenuItem tone="danger" onClick={() => { setMenu(false); void deleteTask(task); onClose(); }}>Delete task</MenuItem>
              </Menu>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-6 w-6 items-center justify-center rounded-sm text-text-3 hover:bg-bg-2 hover:text-text-1">
            <X size={15} strokeWidth={1.5} />
          </button>
        </header>

        <div className="space-y-4 border-b border-line-1 px-4 py-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur())}
            className="w-full rounded-sm bg-transparent text-[15px] font-semibold text-text-1 outline-none focus:bg-bg-2 focus:px-1"
          />
          <div className="grid grid-cols-3 gap-2">
            <Field label="Status">
              <Select value={task.status} onChange={(v) => void patchTask(task.task_id, { status: v as TaskInfo["status"] })} options={["triage", "todo", "doing", "review", "done", "dropped"]} />
            </Field>
            <Field label="Priority">
              <Select value={task.priority} onChange={(v) => void patchTask(task.task_id, { priority: v as TaskPriority })} options={["none", "low", "med", "high", "urgent"]} />
            </Field>
            <Field label="Assignee">
              <AssigneeSelect task={task} roster={state.roster} onChange={(id, kind) => void patchTask(task.task_id, { assignee_id: id, assignee_kind: kind })} />
            </Field>
          </div>
          <Field label="Details">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={saveBody}
              rows={4}
              placeholder="Add a description…"
              className="w-full resize-none rounded-sm border border-line-1 bg-bg-2 px-2 py-1.5 text-[12px] leading-[18px] text-text-1 has-[:focus]:border-accent-dim placeholder:text-text-3"
            />
          </Field>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          <div className="px-4 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">Activity</div>
          {events.length === 0 && <p className="px-4 py-2 font-mono text-[11px] text-text-3">no activity yet</p>}
          {events.map((e: CommittedEvent, i) => (
            <EventRow key={e.id} event={e} prev={events[i - 1]} roster={state.roster} onTrace={(runId) => navigate({ kind: "trace", runId })} />
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-line-1 p-3">
          <div className="flex items-end gap-2 rounded-md border border-line-1 bg-bg-2 px-2.5 py-1.5 has-[textarea:focus]:border-accent-dim">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const b = comment.trim();
                  if (b) {
                    void commentTask(task.task_id, b);
                    setComment("");
                  }
                }
              }}
              rows={1}
              placeholder="Comment on this task…"
              className="max-h-24 min-h-[20px] flex-1 resize-none bg-transparent text-[13px] leading-5 text-text-1 outline-none placeholder:text-text-3"
            />
            <button
              type="button"
              onClick={() => {
                const b = comment.trim();
                if (b) {
                  void commentTask(task.task_id, b);
                  setComment("");
                }
              }}
              disabled={comment.trim().length === 0}
              aria-label="Comment"
              className="flex h-6 w-6 items-center justify-center rounded-sm text-text-3 enabled:text-accent enabled:hover:bg-bg-3 disabled:opacity-30"
            >
              <Send size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-sm border border-line-1 bg-bg-2 px-1.5 py-1 text-[12px] text-text-1 has-[:focus]:border-accent-dim"
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

function AssigneeSelect({
  task,
  roster,
  onChange,
}: {
  task: TaskInfo;
  roster: { id: string; name: string; kind: "human" | "agent" }[];
  onChange: (id: string, kind: "human" | "agent") => void;
}) {
  return (
    <select
      value={task.assignee_id ?? ""}
      onChange={(e) => {
        const entry = roster.find((r) => r.id === e.target.value);
        if (entry) onChange(entry.id, entry.kind);
      }}
      className="w-full rounded-sm border border-line-1 bg-bg-2 px-1.5 py-1 text-[12px] text-text-1 has-[:focus]:border-accent-dim"
    >
      <option value="" disabled>—</option>
      {roster.map((entry) => (
        <option key={entry.id} value={entry.id}>{entry.kind === "agent" ? `@${entry.id}` : entry.name}</option>
      ))}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">{label}</div>
      {children}
    </div>
  );
}

export function NewTaskDialog({
  onClose,
  initial,
}: {
  onClose: () => void;
  initial?: { title?: string; origin_event_id?: string; origin_channel_id?: string };
}) {
  const { state, createTask } = useStore();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState("");
  const [assignee, setAssignee] = useState("");

  const submit = async () => {
    if (title.trim().length === 0) return;
    const entry = state.roster.find((r) => r.id === assignee);
    await createTask({
      title: title.trim(),
      ...(body.trim() ? { body: body.trim() } : {}),
      ...(entry ? { assignee_id: entry.id, assignee_kind: entry.kind } : {}),
      ...(initial?.origin_event_id ? { origin_event_id: initial.origin_event_id } : {}),
      ...(initial?.origin_channel_id ? { origin_channel_id: initial.origin_channel_id } : {}),
    });
    onClose();
  };

  return (
    <Dialog title="New task" onClose={onClose} onSubmit={() => void submit()} submitLabel="Create" submitDisabled={title.trim().length === 0}>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="mb-2 w-full rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1.5 text-[13px] text-text-1 has-[:focus]:border-accent-dim placeholder:text-text-3"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Details / acceptance criteria (optional)"
        rows={4}
        className="mb-2 w-full resize-none rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1.5 text-[12px] text-text-1 has-[:focus]:border-accent-dim placeholder:text-text-3"
      />
      <select
        value={assignee}
        onChange={(e) => setAssignee(e.target.value)}
        className="w-full rounded-sm border border-line-1 bg-bg-2 px-2 py-1.5 text-[12px] text-text-1 has-[:focus]:border-accent-dim"
      >
        <option value="">Unassigned</option>
        {state.roster.map((entry) => (
          <option key={entry.id} value={entry.id}>{entry.kind === "agent" ? `@${entry.id} — ${entry.role}` : `${entry.name} — ${entry.role}`}</option>
        ))}
      </select>
      <p className="mt-2 font-mono text-[10px] text-text-3">assigning to an agent starts the work immediately</p>
    </Dialog>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3" aria-hidden>
      {COLUMNS.map((c) => (
        <div key={c.status} className="min-w-[240px] flex-1 px-1.5 pt-10">
          {[1, 2].map((i) => (
            <div key={i} className="mb-1.5 h-14 rounded-md bg-bg-2" />
          ))}
        </div>
      ))}
    </div>
  );
}
