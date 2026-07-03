import { useEffect, useState } from "react";
import { adoptTokenFromUrl, getToken } from "../lib/api.js";
import { StoreProvider, useStore } from "../lib/store.js";
import { AppShell } from "./AppShell.js";
import { Gallery } from "./Gallery.js";

export function App() {
  const [tokenReady, setTokenReady] = useState(false);
  useEffect(() => {
    adoptTokenFromUrl();
    setTokenReady(true);
  }, []);

  if (!tokenReady) return null;
  // The gallery must render without a running daemon (design review surface).
  if (window.location.pathname === "/dev/gallery") return <Gallery />;
  if (getToken() === null) return <TokenMissing />;

  return (
    <StoreProvider>
      <Booted />
    </StoreProvider>
  );
}

function Booted() {
  const { state } = useStore();
  if (state.phase === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="font-mono text-text-3">opening the record…</div>
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <Centered>
        <h1 className="font-serif text-xl text-text-1">Keelson</h1>
        <p className="mt-3 max-w-md text-text-2">
          Couldn't reach charterd, or the token was rejected. Start the daemon
          and reopen the printed URL:
        </p>
        <pre className="mt-4 rounded-md border border-line-1 bg-bg-2 px-4 py-3 font-mono text-text-2">
          pnpm --filter @charter/server dev
        </pre>
      </Centered>
    );
  }
  return <AppShell />;
}

function TokenMissing() {
  return (
    <Centered>
      <h1 className="font-serif text-xl text-text-1">Charter</h1>
      <p className="mt-3 max-w-md text-text-2">
        No API token. Start charterd and open the URL it prints — the token
        rides along once and is remembered:
      </p>
      <pre className="mt-4 rounded-md border border-line-1 bg-bg-2 px-4 py-3 font-mono text-text-2">
        pnpm --filter @charter/server dev
      </pre>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg-0">
      <div className="flex flex-col items-start">{children}</div>
    </div>
  );
}
