import type { CommittedEvent } from "@charter/schema";
import type { AgentConfig } from "./types.js";

function renderEvent(event: CommittedEvent): string | null {
  const time = event.created_at.slice(11, 16);
  const who = `${event.actor.id}${event.actor.kind === "agent" ? " (agent)" : ""}`;
  switch (event.type) {
    case "message.posted":
      return `[${time}] ${who}: ${(event.payload as { body: string }).body}`;
    case "devlog.note":
      return `[${time}] ${who} (note): ${(event.payload as { note: string }).note}`;
    default:
      return null;
  }
}

export function buildPrompt(options: {
  agent: AgentConfig;
  companyName: string;
  channelId: string;
  timeline: CommittedEvent[];
  trigger: CommittedEvent;
}): string {
  const { agent, companyName, channelId, timeline, trigger } = options;
  const context = timeline
    .map(renderEvent)
    .filter((line): line is string => line !== null)
    .join("\n");
  const triggerBody = (trigger.payload as { body: string }).body;

  return `You are ${agent.name} (@${agent.id}), ${agent.role} at ${companyName}.

Your charter:
${agent.charter.trim()}

Recent conversation in #${channelId} (oldest first):
${context || "(the channel is empty so far)"}

${trigger.actor.id} just mentioned you: "${triggerBody}"

Reply to #${channelId}. Your entire final output is posted verbatim as your message — no preamble, no sign-off, just the reply. Be concrete and brief.`;
}
