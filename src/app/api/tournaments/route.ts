import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

function errorResponse(e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}

interface SavedTeam {
  id: number;
  players: { name?: string; email?: string | null }[];
}

/**
 * List saved tournaments, enriched for the history view: kind (lobby vs
 * tournament), team count, and the reconstructed champion. The champion comes
 * from LR match history (winners have positive delta) mapped back to the saved
 * teams — the same reconstruction the [id]/champion endpoint does, but batched
 * across all tournaments in a single pass so the list stays one round trip.
 */
export async function GET() {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("tournaments")
      .select("id,name,created_at,data")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as {
      id: string;
      name: string;
      created_at: string;
      data: {
        result?: { teams?: SavedTeam[] };
        kind?: "lobby" | "tournament";
        championTeamId?: number | null;
      } | null;
    }[];

    // All match events, grouped by run_id (== tournament id), in one query.
    const wonByRun = new Map<string, Set<number>>();
    const lostByRun = new Map<string, Set<number>>();
    // email→team per run, built from saved data.
    const teamOfByRun = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const m = new Map<string, number>();
      for (const t of r.data?.result?.teams ?? []) {
        for (const p of t.players ?? []) {
          const e = (p.email ?? "").trim().toLowerCase();
          if (e) m.set(e, t.id);
        }
      }
      teamOfByRun.set(r.id, m);
    }

    const runIds = rows.map((r) => r.id);
    if (runIds.length > 0) {
      for (let from = 0; ; from += 1000) {
        const { data: evs, error: eErr } = await sb
          .from("lr_events")
          .select("run_id,email,delta,kind")
          .in("run_id", runIds)
          .eq("kind", "match")
          .range(from, from + 999);
        if (eErr) throw new Error(eErr.message);
        const page = (evs ?? []) as {
          run_id: string;
          email: string;
          delta: number;
        }[];
        for (const ev of page) {
          const team = teamOfByRun.get(ev.run_id)?.get((ev.email ?? "").trim().toLowerCase());
          if (team == null) continue;
          const set = (map: Map<string, Set<number>>) => {
            let s = map.get(ev.run_id);
            if (!s) map.set(ev.run_id, (s = new Set()));
            return s;
          };
          if (ev.delta > 0) set(wonByRun).add(team);
          else if (ev.delta < 0) set(lostByRun).add(team);
        }
        if (page.length < 1000) break;
      }
    }

    const tournaments = rows.map((r) => {
      const teams = r.data?.result?.teams ?? [];
      const teamCount = teams.length;
      // Kind: honor the explicit choice at creation; else infer from team count.
      // Reflect reality: once teams exist, the count decides the label (2 = Lobby,
      // 3+ = Tournament). Only fall back to the creation-time choice when no
      // teams were generated yet.
      const kind: "lobby" | "tournament" =
        teamCount > 0
          ? teamCount <= 2
            ? "lobby"
            : "tournament"
          : r.data?.kind ?? "tournament";

      // Prefer the DB-saved champion (persisted per-round from the bracket); fall
      // back to reconstructing it from LR history for older tournaments that
      // never saved bracket state.
      const won = wonByRun.get(r.id) ?? new Set<number>();
      const lost = lostByRun.get(r.id) ?? new Set<number>();
      const unbeaten = [...won].filter((t) => !lost.has(t));
      const savedChampion = r.data?.championTeamId ?? null;
      const championTeamId =
        savedChampion != null ? savedChampion : unbeaten.length === 1 ? unbeaten[0] : null;

      // The winning team's player names, for the history row.
      const championPlayers =
        championTeamId != null
          ? (teams.find((t) => t.id === championTeamId)?.players ?? [])
              .map((p) => (p.name ?? "").trim())
              .filter((n) => n !== "")
          : [];

      // Completion: a decided champion → complete; teams but no result → in
      // progress; no teams yet → draft.
      const status: "complete" | "in-progress" | "draft" =
        championTeamId != null ? "complete" : teamCount > 0 ? "in-progress" : "draft";

      return {
        id: r.id,
        name: r.name,
        created_at: r.created_at,
        kind,
        teamCount,
        championTeamId,
        championPlayers,
        status,
      };
    });

    return NextResponse.json({ tournaments });
  } catch (e) {
    return errorResponse(e);
  }
}

// Create a new tournament from the current balancer session.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: string; data?: unknown };
    const name = (body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Tournament name is required." }, { status: 400 });
    }
    const sb = getSupabase();
    const { data, error } = await sb
      .from("tournaments")
      .insert({ name, data: body.data ?? {} })
      .select("id,name,created_at")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ tournament: data });
  } catch (e) {
    return errorResponse(e);
  }
}
