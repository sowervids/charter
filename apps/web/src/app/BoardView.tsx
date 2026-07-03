import { useEffect, useState } from "react";
import { Bot, GitPullRequest, Plus, User, X } from "lucide-react";
import type { TaskInfo } from "../lib/api.js";
import { useStore } from "../lib/store.js";
import { EventRow } from "./EventRow.js";

const COLUMNS: Array<{ status: TaskInfo["status"]; label: string }> = [
  { status: "triage", label: "Triage" },
  { status: "todo", label: "Todo" },
  { status: "doing", label: "In progress" },
  { status: "review", label: "In review" },
  { status: "done", label: "Done" },
];

export function BoardView({ taskId }: { taskId?: string }) {
  const { state, ensureTasks, navigate } = useStore();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    ensureTasks();
  }, [ensureTasks]);

  const selected = state.tasks.find((t) => t.task_id === taskId) ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line-1 px-6">
          <h1 className="text-[13px] font-semibold">Board</h1>
          <span className="tnum font-mono text-[11px] text-text-3">
            {state.tasks.filter((t) => t.status !== "done" && t.status !== "dropped").length} open
          </span>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="ml-auto flex items-center gap-1.5 rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1 text-[12px] text-text-2 transition-colors duration-(--motion-fast) hover:border-line-2 hover:text-text-1"
          >
            <Plus size={14} strokeWidth={1.5} /> New task
          </button>
        </header>

        <div className="flex flex-1 gap-px overflow-x-auto bg-line-1 p-px">
          {!state.tasksLoaded && <BoardSkeleton />}
          {state.tasksLoaded &&
            COLUMNS.map((column) => {
              const tasks = state.tasks
                .filter((t) => t.status === column.status)
                .sort((a, b) => b.task_num - a.task_num);
              return (
                <section
                  key={column.status}
                  className="flex w-56 shrink-0 flex-col bg-bg-0"
                >
                  <div className="flex items-baseline gap-2 px-3 py-2.5">
                    <h2 className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">
                      {column.label}
                    </h2>
                    <span className="tnum font-mono text-[10px] text-text-3">
                      {tasks.length}
                    </span>
                  </div>
                  <div className="flex-1 space-y-1.5 overflow-y-auto px-2 pb-3">
                    {tasks.map((task) => (
                      <TaskCard
                        key={task.task_id}
                        task={task}
                        selected={task.task_id === taskId}
                        onOpen={() =>
                          navigate({ kind: "board", taskId: task.task_id })
                        }
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          {state.tasksLoaded && state.tasks.length === 0 && (
            <div className="absolute inset-x-0 bottom-16 px-8 text-[13px] text-text-2">
              No tasks yet. Create one here, or promote any message from a
              channel — assigning a task to an agent starts the work.
            </div>
          )}
        </div>
      </div>

      {selected && (
        <TaskDetail
          task={selected}
          onClose={() => navigate({ kind: "board" })}
        />
      )}
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
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors duration-(--motion-fast) ${
        selected
          ? "border-accent-dim bg-bg-2"
          : "border-line-1 bg-bg-1 hover:border-line-2 hover:bg-bg-2"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="tnum font-mono text-[10px] text-text-3">
          CH-{task.task_num}
        </span>
        {task.pr_number !== null && (
          <span className="flex items-center gap-0.5 font-mono text-[10px] text-info">
            <GitPullRequest size={11} strokeWidth={1.5} />#{task.pr_number}
          </span>
        )}
        {task.assignee_id && (
          <span
            className={`ml-auto flex items-center gap-1 font-mono text-[10px] ${
              task.assignee_kind === "agent" ? "text-agent-1" : "text-text-3"
            }`}
          >
            {task.assignee_kind === "agent" ? (
              <Bot size={11} strokeWidth={1.5} />
            ) : (
              <User size={11} strokeWidth={1.5} />
            )}
            {task.assignee_id}
          </span>
        )}
      </div>
      <div className="mt-1 text-[12px] leading-[17px] text-text-1">
        {task.title}
      </div>
    </button>
  );
}

function TaskDetail({ task, onClose }: { task: TaskInfo; onClose: () => void }) {
  const { state, ensureTaskTimeline, patchTask } = useStore();
  const events = state.taskTimelines[task.task_id] ?? [];

  useEffect(() => {
    ensureTaskTimeline(task.task_id);
  }, [task.task_id, ensureTaskTimeline]);

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line-1 bg-bg-1">
      <header className="flex items-start gap-2 border-b border-line-1 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="tnum font-mono text-[10px] text-text-3">
            CH-{task.task_num}
          </div>
          <h2 className="text-[13px] font-semibold leading-5 text-text-1">
            {task.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-sm p-1 text-text-3 hover:bg-bg-2 hover:text-text-1"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </header>

      <div className="space-y-3 border-b border-line-1 px-4 py-3">
        <Field label="Status">
          <select
            value={task.status}
            onChange={(e) =>
              void patchTask(task.task_id, {
                status: e.target.value as TaskInfo["status"],
              })
            }
            className="w-full rounded-sm border border-line-1 bg-bg-2 px-2 py-1 text-[12px] text-text-1 outline-none"
          >
            {["triage", "todo", "doing", "review", "done", "dropped"].map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ),
            )}
          </select>
        </Field>
        <Field label="Assignee">
          <AssigneeSelect task={task} />
        </Field>
        {task.pr_url && (
          <Field label="Pull request">
            <a
              href={task.pr_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 font-mono text-[12px] text-info hover:underline"
            >
              <GitPullRequest size={13} strokeWidth={1.5} />#{task.pr_number} ·{" "}
              {task.branch}
            </a>
          </Field>
        )}
        {task.body && (
          <Field label="Details">
            <p className="whitespace-pre-wrap text-[12px] leading-[18px] text-text-2">
              {task.body}
            </p>
          </Field>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {events.length === 0 && (
          <div className="px-4 py-3 font-mono text-[11px] text-text-3">
            activity will appear here
          </div>
        )}
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </div>
    </aside>
  );
}

function AssigneeSelect({ task }: { task: TaskInfo }) {
  const { state, patchTask } = useStore();
  return (
    <select
      value={task.assignee_id ?? ""}
      onChange={(e) => {
        const entry = state.roster.find((r) => r.id === e.target.value);
        if (entry) {
          void patchTask(task.task_id, {
            assignee_id: entry.id,
            assignee_kind: entry.kind,
          });
        }
      }}
      className="w-full rounded-sm border border-line-1 bg-bg-2 px-2 py-1 text-[12px] text-text-1 outline-none"
    >
      <option value="" disabled>
        unassigned
      </option>
      {state.roster.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.kind === "agent" ? "◆ " : ""}
          {entry.name} — {entry.role}
        </option>
      ))}
    </select>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">
        {label}
      </div>
      {children}
    </div>
  );
}

export function NewTaskDialog({
  onClose,
  initial,
}: {
  onClose: () => void;
  initial?: {
    title?: string;
    origin_event_id?: string;
    origin_channel_id?: string;
  };
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
      ...(initial?.origin_event_id
        ? { origin_event_id: initial.origin_event_id }
        : {}),
      ...(initial?.origin_channel_id
        ? { origin_channel_id: initial.origin_channel_id }
        : {}),
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-bg-0/70 pt-[18vh]"
      onClick={onClose}
    >
      <div
        className="w-[480px] rounded-lg border border-line-2 bg-bg-3 p-4 shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-[13px] font-semibold">New task</h2>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="Title"
          className="mb-2 w-full rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1.5 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-accent-dim"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Details / acceptance criteria (optional)"
          rows={4}
          className="mb-2 w-full resize-none rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1.5 text-[12px] text-text-1 outline-none placeholder:text-text-3 focus:border-accent-dim"
        />
        <div className="flex items-center gap-2">
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="flex-1 rounded-sm border border-line-1 bg-bg-2 px-2 py-1.5 text-[12px] text-text-1 outline-none"
          >
            <option value="">unassigned</option>
            {state.roster.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.kind === "agent" ? "◆ " : ""}
                {entry.name} — {entry.role}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={title.trim().length === 0}
            className="rounded-sm bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink transition-opacity duration-(--motion-fast) disabled:opacity-40"
          >
            Create
          </button>
        </div>
        <p className="mt-2 font-mono text-[10px] text-text-3">
          assigning to an agent starts the work immediately
        </p>
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-px" aria-hidden>
      {COLUMNS.map((c) => (
        <div key={c.status} className="w-56 shrink-0 bg-bg-0 px-2 pt-10">
          {[1, 2].map((i) => (
            <div key={i} className="mb-1.5 h-14 rounded-md bg-bg-2" />
          ))}
        </div>
      ))}
    </div>
  );
}
