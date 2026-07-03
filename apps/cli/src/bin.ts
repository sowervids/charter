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
  .command("rebuild")
  .description("rebuild projections from the event log")
  .argument("[name]", "projection name (default: all)")
  .action((name?: string) => {
    const ctx = openCharter(requireRoot());
    const rebuilt = rebuild(ctx.db, name);
    console.log(`rebuilt: ${rebuilt.join(", ")}`);
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
