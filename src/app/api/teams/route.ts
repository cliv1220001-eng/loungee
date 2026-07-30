import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { startingLr } from "@/lib/lr";
import {
  generateTeams,
  type BalanceBasis,
  type BalanceMode,
  type BalanceResult,
} from "@/lib/balance";
import type { Player, Role } from "@/lib/types";

// --- Route -------------------------------------------------------------------

interface PlayerInput {
  id?: string;
  name?: string;
  mmr?: number | string;
  role?: number | string | null;
  email?: string | null;
}
interface TeamsBody {
  players?: PlayerInput[];
  numTeams?: number;
  mode?: BalanceMode;
  basis?: BalanceBasis;
  /**
   * Canonical "idA|idB" pairs teamed on the PREVIOUS generation. The balancer
   * penalizes recreating them so reshuffles break up prior duos.
   */
  recentPairs?: string[];
}

function normalize(p: PlayerInput, i: number): Player {
  const roleNum = Number(p.role);
  return {
    id: p.id && String(p.id) ? String(p.id) : `p-${i}`,
    name: (p.name ?? "").trim(),
    mmr: Math.max(0, Math.round(Number(p.mmr) || 0)),
    role: roleNum >= 1 && roleNum <= 5 ? (roleNum as Role) : null,
    email: (p.email ?? "").trim().toLowerCase() || null,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TeamsBody;
    const numTeams = Math.max(1, Math.floor(Number(body.numTeams) || 0));
    const mode: BalanceMode =
      body.mode === "role" || body.mode === "random" ? body.mode : "mmr";
    // Default to LR — the ladder rating is the app's primary measure of strength.
    const basis: BalanceBasis = body.basis === "mmr" ? "mmr" : "lr";
    const players = (body.players ?? []).map(normalize).filter((p) => p.name !== "");

    // Anti-repeat: pairs teamed last generation, so reshuffles churn rosters.
    const balanceOpts = {
      recentPairs: new Set((body.recentPairs ?? []).filter((k) => typeof k === "string")),
    };

    if (players.length === 0) {
      return NextResponse.json({ teams: [], spread: 0 } satisfies BalanceResult);
    }

    // Current LR per email (resilient: if unavailable, treat everyone as net 0
    // so team generation still succeeds — it just won't prioritize negatives).
    const lrByEmail = new Map<string, number>();
    try {
      const sb = getSupabase();
      // Page through the registry: PostgREST caps responses at 1,000 rows and
      // gives no truncation signal, which would silently drop LR for everyone
      // past that row and balance those players on their starting LR instead.
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data } = await sb
          .from("players")
          .select("email,lr")
          .range(from, from + PAGE - 1);
        const page = (data ?? []) as { email: string; lr: number }[];
        for (const r of page) lrByEmail.set(r.email, r.lr);
        if (page.length < PAGE) break;
      }
    } catch {
      // no LR data — continue
    }
    const currentLr = (p: Player): number => {
      const e = (p.email ?? "").trim().toLowerCase();
      return e && lrByEmail.has(e) ? lrByEmail.get(e)! : startingLr(p.mmr);
    };

    let res: BalanceResult;
    if (mode === "mmr" || mode === "role") {
      // Balance and Spread Roles both weight teams by the chosen basis. The
      // balancer only ever reads `mmr`, so on an LR basis we copy each player's
      // current LR into that field, then map back to the real players so their
      // real mmr/email are never altered. On an MMR basis the copies keep their
      // real MMR (the map-back is then a no-op for weights). In role mode the
      // balancer may assign a lane to an "Any" player, so keep the role IT chose
      // while restoring the real mmr/email/name.
      const weighted =
        basis === "lr"
          ? players.map((p) => ({ ...p, mmr: Math.round(currentLr(p)) }))
          : players;
      const out = generateTeams(weighted, numTeams, mode, balanceOpts);
      const byId = new Map(players.map((p) => [p.id, p]));
      res = {
        spread: out.spread,
        teams: out.teams.map((t) => {
          const real = t.players.map((cp) => {
            const orig = byId.get(cp.id);
            return orig ? { ...orig, role: cp.role } : cp;
          });
          return { id: t.id, players: real, totalMmr: real.reduce((s, p) => s + p.mmr, 0) };
        }),
      };
    } else {
      res = generateTeams(players, numTeams, mode, balanceOpts);
    }

    // Return the exact Team shape the bracket/LR expect — real player fields only,
    // with the internal lockGroup tag stripped so nothing leaks to the client.
    const teams = res.teams.map((t) => ({
      id: t.id,
      totalMmr: t.totalMmr,
      players: t.players.map((p) => ({
        id: p.id,
        name: p.name,
        mmr: p.mmr,
        role: p.role,
        email: p.email ?? null,
      })),
    }));
    return NextResponse.json({ teams, spread: res.spread });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not generate teams.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
