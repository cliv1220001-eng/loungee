"use client";

import { useState } from "react";

import ForestRanger from "../forest-ranger";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const from = new URLSearchParams(window.location.search).get("from");
        // Full navigation so the proxy + layout see the new cookie.
        window.location.href = from && from.startsWith("/") ? from : "/";
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Invalid username or password.");
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setLoading(false);
  }

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-20">
      {/* Woodland ranger keeping watch beside the sign-in. Hidden on small
          screens so it never crowds the form. */}
      <ForestRanger className="pointer-events-none absolute bottom-0 left-4 hidden h-[26rem] w-auto opacity-30 lg:block xl:left-24 xl:opacity-40" />
      <ForestRanger className="pointer-events-none absolute bottom-0 right-4 hidden h-[22rem] w-auto -scale-x-100 opacity-20 xl:block" />

      <form
        onSubmit={submit}
        className="panel animate-pop relative z-10 flex w-full max-w-sm flex-col gap-5 rounded-2xl p-8"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/loungee-logo.png"
            alt="LounGee"
            width={72}
            height={72}
            className="h-[72px] w-[72px] rounded-xl object-contain"
          />
          <h1 className="text-2xl font-semibold tracking-tight">LounGee</h1>
          <p className="text-sm text-zinc-400">Sign in</p>
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-zinc-400">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            className="field rounded-lg px-3 py-2.5 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-zinc-400">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="field rounded-lg px-3 py-2.5 text-sm"
          />
        </label>

        {error && <p className="text-sm font-medium text-red-400">{error}</p>}

        <button type="submit" disabled={loading} className="btn-neon rounded-full px-6 py-3 text-sm">
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
