"use client";

import { useEffect, useRef, useState } from "react";

/**
 * PUBLIC cash-in page (no login — allow-listed in proxy.ts). A player enters their
 * in-game name, the amount they sent, and uploads a payment screenshot. This only
 * FILES a request; an admin reviews and approves before any coins are credited.
 */
export default function CashInPage() {
  const [ign, setIgn] = useState("");
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Suggest registered IGNs as the player types, so they enter the exact name the
  // admin can match to their account. Debounced; only IGN text is fetched.
  useEffect(() => {
    const q = ign.trim();
    // All setState happens inside the debounced callback (never synchronously in
    // the effect body), so short/empty queries just clear via the timer too.
    const t = window.setTimeout(() => {
      if (q.length < 2) {
        setSuggestions([]);
        return;
      }
      fetch(`/api/cashin/lookup?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : { igns: [] }))
        .then((b: { igns?: string[] }) => setSuggestions(b.igns ?? []))
        .catch(() => setSuggestions([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [ign]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ign.trim()) return setError("Enter your in-game name.");
    if (!(Number(amount) > 0)) return setError("Enter the amount you sent.");
    if (!file) return setError("Attach your payment proof.");

    setLoading(true);
    try {
      const fd = new FormData();
      fd.set("ign", ign.trim());
      fd.set("amount", String(Math.trunc(Number(amount))));
      fd.set("proof", file);
      const res = await fetch("/api/cashin", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setDoneId(data.id ?? "submitted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
    setLoading(false);
  }

  if (doneId) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-20">
        <div className="panel animate-pop flex w-full max-w-md flex-col items-center gap-4 rounded-2xl p-8 text-center">
          <span className="text-4xl">✅</span>
          <h1 className="text-2xl font-bold text-zinc-100">Request submitted</h1>
          <p className="text-sm text-zinc-400">
            Thanks! An admin will review your payment and credit your coins once
            it&apos;s confirmed. Keep your reference in case they need to reach you.
          </p>
          <p className="rounded-lg bg-white/5 px-3 py-2 text-xs font-mono text-zinc-500">
            Ref: {doneId}
          </p>
          <button
            onClick={() => {
              setDoneId(null);
              setIgn("");
              setAmount("");
              setFile(null);
              setPreview(null);
              if (fileRef.current) fileRef.current.value = "";
            }}
            className="btn-neon rounded-full px-6 py-2.5 text-sm"
          >
            Submit another
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <form
        onSubmit={submit}
        className="panel animate-pop flex w-full max-w-md flex-col gap-5 rounded-2xl p-8"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/loungee-logo.png"
            alt="LounGee"
            width={64}
            height={64}
            className="h-16 w-16 rounded-xl object-contain"
          />
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Cash In</h1>
          <p className="text-sm text-zinc-400">
            Send your payment, then submit proof here. Your cash-in request are credited after an
            admin <span className="text-[var(--lg-glow)]">confirms it.</span>
          </p>
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-zinc-400">In-game name (IGN)</span>
          <input
            value={ign}
            onChange={(e) => setIgn(e.target.value)}
            placeholder="Start typing to find your IGN"
            list="ign-suggestions"
            autoFocus
            autoComplete="off"
            className="field rounded-lg px-3 py-2.5 text-sm"
          />
          <datalist id="ign-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {ign.trim().length >= 2 && suggestions.length === 0 && (
            <span className="text-[11px] text-zinc-500">
              No match yet — that&apos;s fine, an admin will confirm your account.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-zinc-400">Amount sent (₱)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder="e.g. 100"
            className="field rounded-lg px-3 py-2.5 text-sm tabular-nums"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-zinc-400">Payment proof (screenshot)</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onFile}
            className="field rounded-lg px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-[var(--accent)]/20 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-[var(--lg-glow)]"
          />
        </label>

        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Proof preview"
            className="max-h-56 w-full rounded-lg border border-[var(--panel-border)] object-contain"
          />
        )}

        {error && <p className="text-sm font-medium text-red-400">{error}</p>}

        <button type="submit" disabled={loading} className="btn-neon rounded-full px-6 py-3 text-sm">
          {loading ? "Submitting…" : "Submit for review"}
        </button>
      </form>
    </main>
  );
}
