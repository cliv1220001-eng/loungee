import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { matchDelta, startingLr } from "@/lib/lr";

function errorResponse(e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}

interface PlayerInput {
  email?: string;
  ign?: string;
  mmr?: number | string;
  position?: number | string | null;
}

interface MatchInput {
  matchId: string;
  championMatch?: boolean;
  winnerEmails?: string[];
  loserEmails?: string[];
}

interface SyncBody {
  runId?: string;
  players?: PlayerInput[];
  matches?: MatchInput[];
  /** How many teams are in this bracket — decides the champion bonus. */
  teamCount?: number;
}

function normEmail(e: string | undefined): string {
  return (e ?? "").trim().toLowerCase();
}

function toRegistryRow(p: PlayerInput) {
  const mmr = Math.max(0, Math.round(Number(p.mmr) || 0));
  const posNum = Number(p.position);
  return {
    email: normEmail(p.email),
    ign: (p.ign ?? "").trim(),
    mmr,
    position: posNum >= 1 && posNum <= 5 ? posNum : null,
    starting_lr: startingLr(mmr),
  };
}

/**
 * Sync one bracket run's results. The client sends the FULL current set of
 * decided matches; the server derives LR events (+40/−40, +60 for the champion
 * match) and full-replaces the run's events, so LR always matches the live
 * bracket (picking, undoing and reshuffling all stay consistent).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SyncBody;
    const runId = (body.runId ?? "").trim();
    if (!runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }

    // Registry rows (deduped by email) so any new player exists before events land.
    const byEmail = new Map<string, ReturnType<typeof toRegistryRow>>();
    for (const p of body.players ?? []) {
      const row = toRegistryRow(p);
      if (row.email) byEmail.set(row.email, row);
    }

    // Team count decides the champion bonus: a two-team bracket's final is just
    // an ordinary win. Fall back to a multi-team bracket when the client didn't
    // send a count, so older clients keep the bonus rather than silently losing it.
    const teamCount = Number.isFinite(Number(body.teamCount))
      ? Math.max(0, Math.floor(Number(body.teamCount)))
      : 3;

    // One event per (match, player); winners gain, losers lose.
    const events: { match_id: string; email: string; delta: number }[] = [];
    for (const m of body.matches ?? []) {
      if (!m.matchId) continue;
      const champ = Boolean(m.championMatch);
      for (const raw of m.winnerEmails ?? []) {
        const email = normEmail(raw);
        if (email) {
          events.push({ match_id: m.matchId, email, delta: matchDelta(true, champ, teamCount) });
        }
      }
      for (const raw of m.loserEmails ?? []) {
        const email = normEmail(raw);
        if (email) {
          events.push({ match_id: m.matchId, email, delta: matchDelta(false, champ, teamCount) });
        }
      }
    }

    const sb = getSupabase();
    const { error } = await sb.rpc("sync_run_lr", {
      p_run_id: runId,
      p_players: [...byEmail.values()],
      p_events: events,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, events: events.length });
  } catch (e) {
    return errorResponse(e);
  }
}
