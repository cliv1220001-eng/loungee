import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { startingLr } from "@/lib/lr";
import { generateTeams, type BalanceMode, type BalanceResult } from "@/lib/balance";
import type { Player, Role } from "@/lib/types";

// --- Server-only team-shaping config (never shipped to the browser) ----------

// Anchor players each seed a SEPARATE team (see stack()).
const ANCHORS = new Set(["zxc", "kenuuu"]);
// Players kept OFF the anchor teams — never drafted onto them.
const NEVER_STACK = new Set(["th1"]);
// How many of the most-negative-LR players to force onto EACH anchor's team.
// The remaining seats are left to normal balancing, so the team's total LR stays
// close to the others (only a couple of low players, not a whole stacked team).
const NEGATIVES_PER_ANCHOR = 2;

/** Normalize an IGN for matching: lowercase, trim, drop a trailing "(...)". */
function key(s: string): string {
  return s.trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, "");
}
function inSet(set: Set<string>, p: Player): boolean {
  return set.has(key(p.name)) || set.has((p.email ?? "").trim().toLowerCase());
}

/** Fisher–Yates shuffle (new array). */
function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Lock each anchor onto its own team with up to NEGATIVES_PER_ANCHOR negative-LR
 *  teammates chosen at RANDOM from the negative pool (so each shuffle differs).
 *  The rest of each anchor team is left for normal balancing. Mutates lockGroup. */
function stack(players: Player[], netLr: (p: Player) => number): void {
  const anchors = players.filter((p) => inSet(ANCHORS, p));
  if (anchors.length === 0) return;

  // Eligible negatives, shuffled so the picks vary between generations.
  const negatives = shuffle(
    players.filter((p) => !inSet(ANCHORS, p) && !inSet(NEVER_STACK, p) && netLr(p) < 0)
  );

  let ni = 0;
  anchors.forEach((anchor, i) => {
    const mates: Player[] = [];
    for (let s = 0; s < NEGATIVES_PER_ANCHOR && ni < negatives.length; s++) {
      mates.push(negatives[ni++]);
    }
    const group = [anchor, ...mates];
    if (group.length < 2) return; // no negatives left — anchor balances normally
    const ids = new Set(group.map((p) => p.id));
    for (const p of players) if (ids.has(p.id)) p.lockGroup = `lr-stack-${i}`;
  });
}

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

    stack(players, (p) => currentLr(p) - startingLr(p.mmr));

    let res: BalanceResult;
    if (mode === "mmr") {
      // "Balance LR" — weight by current LR on copies, then map back to the real
      // players so their real mmr/email are never altered.
      const weighted = players.map((p) => ({ ...p, mmr: Math.round(currentLr(p)) }));
      const out = generateTeams(weighted, numTeams, "mmr");
      const byId = new Map(players.map((p) => [p.id, p]));
      res = {
        spread: out.spread,
        teams: out.teams.map((t) => {
          const real = t.players.map((cp) => byId.get(cp.id) ?? cp);
          return { id: t.id, players: real, totalMmr: real.reduce((s, p) => s + p.mmr, 0) };
        }),
      };
    } else {
      res = generateTeams(players, numTeams, mode);
    }

    // Keep protected players (e.g. th1) OFF anchor teams. The balancer can place
    // them there incidentally when filling seats, so swap any protected player on
    // an anchor team with the nearest-LR non-anchor/non-protected player elsewhere
    // (nearest LR keeps team totals virtually unchanged).
    const isAnchorTeam = (t: BalanceResult["teams"][number]) =>
      t.players.some((p) => inSet(ANCHORS, p));
    for (const at of res.teams.filter(isAnchorTeam)) {
      for (let i = 0; i < at.players.length; i++) {
        const p = at.players[i];
        if (!inSet(NEVER_STACK, p)) continue;
        let best: { team: typeof at; idx: number; d: number } | null = null;
        for (const ot of res.teams) {
          if (isAnchorTeam(ot)) continue;
          for (let j = 0; j < ot.players.length; j++) {
            const q = ot.players[j];
            if (inSet(ANCHORS, q) || inSet(NEVER_STACK, q)) continue;
            const d = Math.abs(currentLr(q) - currentLr(p));
            if (!best || d < best.d) best = { team: ot, idx: j, d };
          }
        }
        if (best) {
          const q = best.team.players[best.idx];
          best.team.players[best.idx] = p;
          at.players[i] = q;
          at.totalMmr = at.totalMmr - p.mmr + q.mmr;
          best.team.totalMmr = best.team.totalMmr - q.mmr + p.mmr;
        }
      }
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
