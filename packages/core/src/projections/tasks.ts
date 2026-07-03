import type { EventPayload } from "@charter/schema";
import type { Projector } from "./types.js";

export const tasksProjector: Projector = {
  name: "tasks",
  version: 2,
  types: [
    "task.created",
    "task.assigned",
    "task.status_changed",
    "task.pr_opened",
    "task.updated",
    "task.deleted",
  ],
  apply(db, event) {
    switch (event.type) {
      case "task.created": {
        const p = event.payload as EventPayload<"task.created">;
        const { next } = db
          .prepare(
            "SELECT COALESCE(MAX(task_num), 0) + 1 AS next FROM tasks WHERE company_id = ?",
          )
          .get(event.company_id) as { next: number };
        db.prepare(
          `INSERT INTO tasks (task_id, task_num, company_id, title, body,
             status, assignee_id, assignee_kind, origin_event_id,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'triage', ?, ?, ?, ?, ?)
           ON CONFLICT (task_id) DO NOTHING`,
        ).run(
          p.task_id,
          next,
          event.company_id,
          p.title,
          p.body ?? null,
          p.assignee_id ?? null,
          p.assignee_kind ?? null,
          p.origin_event_id ?? null,
          event.created_at,
          event.created_at,
        );
        break;
      }
      case "task.assigned": {
        const p = event.payload as EventPayload<"task.assigned">;
        db.prepare(
          `UPDATE tasks SET assignee_id = ?, assignee_kind = ?, updated_at = ?
           WHERE task_id = ?`,
        ).run(p.assignee_id, p.assignee_kind, event.created_at, p.task_id);
        break;
      }
      case "task.status_changed": {
        const p = event.payload as EventPayload<"task.status_changed">;
        db.prepare(
          "UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?",
        ).run(p.status, event.created_at, p.task_id);
        break;
      }
      case "task.pr_opened": {
        const p = event.payload as EventPayload<"task.pr_opened">;
        db.prepare(
          `UPDATE tasks SET pr_number = ?, pr_url = ?, branch = ?, updated_at = ?
           WHERE task_id = ?`,
        ).run(p.pr_number, p.pr_url, p.branch, event.created_at, p.task_id);
        break;
      }
      case "task.updated": {
        const p = event.payload as EventPayload<"task.updated">;
        const sets: string[] = [];
        const vals: unknown[] = [];
        if (p.title !== undefined) {
          sets.push("title = ?");
          vals.push(p.title);
        }
        if (p.body !== undefined) {
          sets.push("body = ?");
          vals.push(p.body);
        }
        if (p.priority !== undefined) {
          sets.push("priority = ?");
          vals.push(p.priority);
        }
        if (sets.length === 0) break;
        sets.push("updated_at = ?");
        vals.push(event.created_at, p.task_id);
        db.prepare(
          `UPDATE tasks SET ${sets.join(", ")} WHERE task_id = ?`,
        ).run(...(vals as never[]));
        break;
      }
      case "task.deleted": {
        const p = event.payload as EventPayload<"task.deleted">;
        // Idempotent tombstone: delete-if-exists replays cleanly on rebuild.
        db.prepare("DELETE FROM tasks WHERE task_id = ?").run(p.task_id);
        break;
      }
    }
  },
  truncate(db) {
    db.exec("DELETE FROM tasks");
  },
};
