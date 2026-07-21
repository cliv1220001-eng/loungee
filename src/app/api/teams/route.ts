import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { startingLr } from "@/lib/lr";
import { generateTeams, type BalanceMode, type BalanceResult } from "@/lib/balance";
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
    const players = (body.players ?? []).map(normalize).filter((p) => p.name !== "");

    if (players.length === 0) {
      return NextResponse.json({ teams: [], spread: 0 } satisfies BalanceResult);
    }

    // Current LR per email (resilient: if unavailable, treat everyone as net 0
    // so team generation still succeeds — it just won't prioritize negatives).
    const lrByEmail = new Map<string, number>();
    try {
      const sb = getSupabase();
      const { data } = await sb.from("players").select("email,lr");
      for (const r of (data ?? []) as { email: string; lr: number }[]) lrByEmail.set(r.email, r.lr);
    } catch {
      // no LR data — continue
    }
    const currentLr = (p: Player): number => {
      const e = (p.email ?? "").trim().toLowerCase();
      return e && lrByEmail.has(e) ? lrByEmail.get(e)! : startingLr(p.mmr);
    };

    let res: BalanceResult;
    if (mode === "mmr" || mode === "role") {
      // "Balance LR" and "Spread Roles" both balance on current LR: weight by LR
      // on copies (LR written into the mmr field the balancer reads), then map
      // back to the real players so their real mmr/email are never altered. In
      // role mode the balancer may assign a lane to an "Any" player, so keep the
      // role IT chose while restoring the real mmr/email/name.
      const weighted = players.map((p) => ({ ...p, mmr: Math.round(currentLr(p)) }));
      const out = generateTeams(weighted, numTeams, mode);
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
      res = generateTeams(players, numTeams, mode);
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
