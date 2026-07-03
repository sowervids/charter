import { useEffect } from "react";
import { useStore } from "../lib/store.js";
import { BoardView } from "./BoardView.js";
import { ChannelView } from "./ChannelView.js";
import { LogView } from "./LogView.js";
import { Palette } from "./Palette.js";
import { Rail } from "./Rail.js";

export function AppShell() {
  const { state } = useStore();

  useEffect(() => {
    document.title = state.company ? `${state.company.name} — Charter` : "Charter";
  }, [state.company]);

  return (
    <div className="flex h-full bg-bg-0 text-text-1">
      <Rail />
      <main className="flex min-w-0 flex-1 flex-col border-l border-line-1 bg-bg-0">
        {state.view.kind === "channel" && (
          <ChannelView channelId={state.view.channelId} />
        )}
        {state.view.kind === "board" && <BoardView taskId={state.view.taskId} />}
        {state.view.kind === "log" && <LogView />}
      </main>
      <Palette />
      {state.connection === "reconnecting" && (
        <div className="fixed inset-x-0 top-0 h-px bg-warn" aria-live="polite" />
      )}
    </div>
  );
}
