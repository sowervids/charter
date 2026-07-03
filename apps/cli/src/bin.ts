#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { styleText } from "node:util";
import { Command } from "commander";
import { rebuild, verify } from "@charter/core";
import { SYSTEM_STREAM, channelStream } from "@charter/schema";
import {
  createDefaultCompany,
  findRoot,
  openCharter,
  requireRoot,
} from "./context.js";
import { formatEvent } from "./format.js";

const program = new Command("charter")
  .description("Charter — the company's book of record")
  .version("0.1.0");

program
  .command("init")
  .description("create the company and its event log")
  .action(() => {
    const root = findRoot() ?? process.cwd();
    if (!existsSync(join(root, "company", "company.json"))) {
      createDefaultCompany(root);
      console.log(styleText("dim", `created company/company.json`));
    }
    const ctx = openCharter(root);
    const existing = ctx.log.read({ limit: 1 }).length;
    const founded = ctx.db
      .prepare(
        "SELECT COUNT(*) AS n FROM events WHERE company_id = ? AND type = 'company.created'",
      )
      .get(ctx.company.id) as { n: number };
    if (founded.n === 0) {
      const event = ctx.log.append({
        company_id: ctx.company.id,
        stream: SYSTEM_STREAM,
        type: "company.created",
        actor: { kind: "human", id: "founder" },
        payload: { name: ctx.company.name },
      });
      console.log(formatEvent(event));
    }
    const defaults: Array<{ id: string; name: string; topic: string }> = [
      { id: "general", name: "general", topic: "Company-wide conversation." },
      { id: "devlog", name: "devlog", topic: "The development journal of Charter itself." },
      { id: "founder-log", name: "founder-log", topic: "The founder's working notes." },
    ];
    for (const ch of defaults) {
      const exists = ctx.db
        .prepare(
          "SELECT 1 FROM channels WHERE company_id = ? AND channel_id = ?",
        )
        .get(ctx.company.id, ch.id);
      if (exists) continue;
      const event = ctx.log.append({
        company_id: ctx.company.id,
        stream: channelStream(ch.id),
        type: "channel.created",
        actor: { kind: "human", id: "founder" },
        payload: { channel_id: ch.id, name: ch.name, topic: ch.topic },
      });
      console.log(formatEvent(event));
    }
    console.log(
      `${styleText("bold", ctx.company.name)} (${ctx.company.id}) — ` +
        `${ctx.log.lastSeq() || existing} event(s) in var/charter.db`,
    );
  });

program
  .command("note")
  .description("append a devlog.note event")
  .argument("<text...>", "the note")
  .option("-t, --tags <tags>", "comma-separated tags")
  .action((text: string[], options: { tags?: string }) => {
    const ctx = openCharter(requireRoot());
    const tags = options.tags
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const event = ctx.log.append({
      company_id: ctx.company.id,
      stream: channelStream("devlog"),
      type: "devlog.note",
      actor: { kind: "human", id: "founder" },
      payload: tags?.length
        ? { note: text.join(" "), tags }
        : { note: text.join(" ") },
    });
    console.log(formatEvent(event));
  });

program
  .command("append")
  .description("append an arbitrary registered event")
  .argument("<type>", "event type (must exist in @charter/schema)")
  .requiredOption("-s, --stream <stream>", "target stream")
  .requiredOption("-p, --payload <json>", "payload as JSON")
  .option("--actor-kind <kind>", "actor kind", "human")
  .option("--actor-id <id>", "actor id", "founder")
  .action(
    (
      type: string,
      options: {
        stream: string;
        payload: string;
        actorKind: string;
        actorId: string;
      },
    ) => {
      const ctx = openCharter(requireRoot());
      const event = ctx.log.append({
        company_id: ctx.company.id,
        stream: options.stream,
        type,
        actor: {
          kind: options.actorKind as "human" | "agent" | "system" | "integration",
          id: options.actorId,
        },
        payload: JSON.parse(options.payload) as unknown,
      });
      console.log(formatEvent(event));
    },
  );

program
  .command("tail")
  .description("stream the event log (backlog, then live)")
  .option("-n, --lines <n>", "backlog size", "20")
  .option("-s, --stream <stream>", "filter to one stream")
  .option("-i, --interval <ms>", "poll interval", "250")
  .action((options: { lines: string; stream?: string; interval: string }) => {
    const ctx = openCharter(requireRoot());
    const filter = options.stream
      ? { stream: options.stream }
      : {};

    const last = ctx.log.lastSeq();
    const backlogFrom = Math.max(0, last - Number(options.lines));
    for (const event of ctx.log.read({ afterSeq: backlogFrom, ...filter })) {
      console.log(formatEvent(event));
    }

    let cursor = last;
    const poll = setInterval(() => {
      for (const event of ctx.log.read({ afterSeq: cursor, ...filter })) {
        console.log(formatEvent(event));
        cursor = Math.max(cursor, event.seq);
      }
    }, Number(options.interval));

    process.on("SIGINT", () => {
      clearInterval(poll);
      process.exit(0);
    });
  });

program
  .command("stats")
  .description("print event log statistics")
  .action(() => {
    const ctx = openCharter(requireRoot());

    const total = (
      ctx.db
        .prepare("SELECT COUNT(*) AS n FROM events WHERE company_id = ?")
        .get(ctx.company.id) as { n: number }
    ).n;

    const byType = ctx.db
      .prepare(
        "SELECT type, COUNT(*) AS n FROM events WHERE company_id = ? GROUP BY type ORDER BY n DESC",
      )
      .all(ctx.company.id) as Array<{ type: string; n: number }>;

    const byActor = ctx.db
      .prepare(
        "SELECT actor_kind, COUNT(*) AS n FROM events WHERE company_id = ? GROUP BY actor_kind ORDER BY n DESC",
      )
      .all(ctx.company.id) as Array<{ actor_kind: string; n: number }>;

    console.log(
      styleText("bold", "Total events: ") + styleText("cyan", String(total)),
    );

    console.log();
    console.log(styleText("dim", "By event type:"));
    const typeWidth = Math.max(10, ...byType.map((r) => r.type.length));
    for (const row of byType) {
      console.log(
        `  ${styleText("cyan", row.type.padEnd(typeWidth))}  ${String(row.n).padStart(6)}`,
      );
    }

    console.log();
    console.log(styleText("dim", "By actor kind:"));
    for (const row of byActor) {
      console.log(
        `  ${styleText("yellow", row.actor_kind.padEnd(12))}  ${String(row.n).padStart(6)}`,
      );
    }
  });

program
  .command("rebuild")
  .description("rebuild projections from the event log")
  .argument("[name]", "projection name (default: all)")
  .action((name?: string) => {
    const ctx = openCharter(requireRoot());
    const rebuilt = rebuild(ctx.db, name);
    console.log(`rebuilt: ${rebuilt.join(", ")}`);
  });

program
  .command("doctor")
  .description("verify the substrate: runtime, db, chain, daemon")
  .action(async () => {
    const { execFileSync } = await import("node:child_process");
    const { statSync } = await import("node:fs");
    const results: Array<[string, boolean, string]> = [];
    const check = (name: string, ok: boolean, detail: string) =>
      results.push([name, ok, detail]);

    const major = Number(process.versions.node.split(".")[0]);
    check("node ≥ 22", major >= 22, `v${process.versions.node}`);
    try {
      const v = execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
      check("claude CLI", true, v);
    } catch {
      check("claude CLI", false, "not found on PATH — agents cannot run");
    }
    try {
      const root = requireRoot();
      const ctx = openCharter(root);
      const result = verify(ctx.db);
      check(
        "hash chain",
        result.ok,
        result.ok
          ? `${result.checked} events verified`
          : `BROKEN at seq ${result.firstBadSeq}`,
      );
      const wal = ctx.db.pragma("journal_mode", { simple: true });
      check("WAL mode", wal === "wal", String(wal));
      try {
        const mode = statSync(join(root, "var", "api_token")).mode & 0o777;
        check("token perms", mode === 0o600, `0${mode.toString(8)}`);
      } catch {
        check("token perms", false, "var/api_token missing (start charterd once)");
      }
      try {
        const { readFileSync } = await import("node:fs");
        const token = readFileSync(join(root, "var", "api_token"), "utf8").trim();
        const res = await fetch("http://127.0.0.1:4614/api/health", {
          headers: { authorization: `Bearer ${token}` },
        });
        check("charterd", res.ok, res.ok ? "listening on :4614" : `status ${res.status}`);
      } catch {
        check("charterd", false, "not running (fine if intentional)");
      }
    } catch (error) {
      check("company", false, String(error));
    }

    let failed = 0;
    for (const [name, ok, detail] of results) {
      if (!ok) failed += 1;
      console.log(
        `${ok ? styleText("green", " ok ") : styleText("red", "FAIL")} ${name.padEnd(12)} ${styleText("dim", detail)}`,
      );
    }
    process.exit(failed > 0 ? 1 : 0);
  });

program
  .command("verify")
  .description("verify the hash chain")
  .action(() => {
    const ctx = openCharter(requireRoot());
    const result = verify(ctx.db);
    if (result.ok) {
      console.log(
        styleText("green", `chain ok — ${result.checked} events verified`),
      );
    } else {
      console.error(
        styleText(
          "red",
          `CHAIN BROKEN at seq ${result.firstBadSeq}: ${result.reason}`,
        ),
      );
      process.exit(1);
    }
  });

program.parse();
