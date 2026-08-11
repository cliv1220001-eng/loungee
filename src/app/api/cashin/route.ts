import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { isAdminRequest } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** Private Storage bucket that holds payment-proof screenshots. */
const PROOF_BUCKET = "cashin-proofs";
/** Max proof upload size (bytes). Screenshots are small; cap to deter abuse. */
const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
const MAX_AMOUNT = 1_000_000;

function errorResponse(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status });
}

/**
 * PUBLIC submit endpoint (allow-listed in proxy.ts). A player states their IGN,
 * the amount they sent, and uploads a payment screenshot. This ONLY creates a
 * `pending` cash-in request — no coins are credited until an admin approves it.
 *
 * Multipart form fields: `ign` (text), `amount` (text/number), `proof` (file).
 */
export async function POST(req: NextRequest) {
  try {
    // Public endpoint — throttle spam: at most 5 submissions per 10 min per IP.
    const ip = clientIp(req);
    const rl = rateLimit(`cashin:${ip}`, 5, 10 * 60_000, Date.now());
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a bit and try again." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const form = await req.formData();
    const ign = String(form.get("ign") ?? "").trim();
    const amount = Math.trunc(Number(form.get("amount")));
    const proof = form.get("proof");

    if (!ign) {
      return errorResponse(new Error("Please enter your in-game name."), 400);
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return errorResponse(new Error("Enter a valid amount."), 400);
    }
    if (!(proof instanceof File) || proof.size === 0) {
      return errorResponse(new Error("Please attach your payment proof."), 400);
    }
    if (proof.size > MAX_PROOF_BYTES) {
      return errorResponse(new Error("Proof image is too large (max 5MB)."), 400);
    }
    if (!ALLOWED_TYPES.has(proof.type)) {
      return errorResponse(new Error("Proof must be an image (PNG/JPG/WebP)."), 400);
    }

    const sb = getSupabase();

    // Upload the proof under a random path. crypto.randomUUID keeps names unique
    // and unguessable; the bucket is private so paths are only reachable via the
    // admin's signed URLs.
    const ext = proof.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const path = `${new Date().getUTCFullYear()}/${crypto.randomUUID()}.${ext}`;
    const bytes = new Uint8Array(await proof.arrayBuffer());
    const { error: upErr } = await sb.storage
      .from(PROOF_BUCKET)
      .upload(path, bytes, { contentType: proof.type, upsert: false });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const { data: row, error: insErr } = await sb
      .from("cashin_requests")
      .insert({ ign, amount, proof_path: path, status: "pending" })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    return NextResponse.json({ ok: true, id: row.id });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * ADMIN: list cash-in requests, newest first, optionally filtered by status
 * (?status=pending). Each row is enriched with a short-lived signed proof URL and
 * a best-guess player match (by IGN). Re-checks auth in-handler — the proxy only
 * makes the bare POST public, but this defends against any path confusion.
 */
export async function GET(req: NextRequest) {
  try {
    if (!isAdminRequest(req)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const status = req.nextUrl.searchParams.get("status");
    const sb = getSupabase();

    let query = sb
      .from("cashin_requests")
      .select("id,ign,email,amount,proof_path,status,note,reviewed_at,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (status) query = query.eq("status", status);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    // Candidate player matches by IGN (case-insensitive), so the admin can
    // confirm who the coins should go to.
    const { data: players } = await sb.from("players").select("email,ign,coins");
    const byIgn = new Map<string, { email: string; ign: string; coins: number }>();
    for (const p of players ?? []) byIgn.set((p.ign ?? "").trim().toLowerCase(), p);

    const enriched = await Promise.all(
      (rows ?? []).map(async (r) => {
        let proofUrl: string | null = null;
        if (r.proof_path) {
          const { data: signed } = await sb.storage
            .from(PROOF_BUCKET)
            .createSignedUrl(r.proof_path, 60 * 10); // 10 minutes
          proofUrl = signed?.signedUrl ?? null;
        }
        const match = byIgn.get(r.ign.trim().toLowerCase()) ?? null;
        return { ...r, proofUrl, match };
      })
    );

    return NextResponse.json({ requests: enriched });
  } catch (e) {
    return errorResponse(e);
  }
}
