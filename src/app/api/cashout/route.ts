import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getSessionUser, isAdminRequest } from "@/lib/auth";
import { audit } from "@/lib/audit";

const PROOF_BUCKET = "cashout-proofs";
const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
const MAX_AMOUNT = 1_000_000;

function errorResponse(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status });
}

/**
 * ADMIN: record a completed cash-out (payout). The admin picks the player,
 * amount, and payout details, and attaches a REQUIRED proof screenshot (the
 * player's request + proof the admin sent the money). In one atomic step the
 * coins are debited and the record is filed as 'paid'.
 *
 * Multipart form fields: `email` (target player), `amount`, `method?`,
 * `account?`, `proof` (image file, required).
 */
export async function POST(req: NextRequest) {
  try {
    const user = getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const form = await req.formData();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const amount = Math.trunc(Number(form.get("amount")));
    const method = (String(form.get("method") ?? "").trim() || null) as string | null;
    const account = (String(form.get("account") ?? "").trim() || null) as string | null;
    const proof = form.get("proof");

    if (!email) return errorResponse(new Error("Choose a player."), 400);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return errorResponse(new Error("Enter a valid amount."), 400);
    }
    if (!(proof instanceof File) || proof.size === 0) {
      return errorResponse(new Error("Attach the payout proof screenshot."), 400);
    }
    if (proof.size > MAX_PROOF_BYTES) {
      return errorResponse(new Error("Proof image is too large (max 5MB)."), 400);
    }
    if (!ALLOWED_TYPES.has(proof.type)) {
      return errorResponse(new Error("Proof must be an image (PNG/JPG/WebP)."), 400);
    }

    const sb = getSupabase();

    // Confirm the player exists + has the balance (friendly error before upload).
    const { data: player } = await sb
      .from("players")
      .select("email,ign,coins")
      .eq("email", email)
      .maybeSingle();
    if (!player) return errorResponse(new Error("Player not found."), 400);
    if (player.coins < amount) {
      return errorResponse(new Error(`Not enough coins — balance is ${player.coins}.`), 400);
    }

    // Upload the proof to the private bucket.
    const ext = proof.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const path = `${new Date().getUTCFullYear()}/${crypto.randomUUID()}.${ext}`;
    const bytes = new Uint8Array(await proof.arrayBuffer());
    const { error: upErr } = await sb.storage
      .from(PROOF_BUCKET)
      .upload(path, bytes, { contentType: proof.type, upsert: false });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    // Debit + file the paid record in one atomic RPC.
    const { data: newId, error } = await sb.rpc("pay_cashout", {
      p_email: email,
      p_ign: player.ign,
      p_amount: amount,
      p_method: method,
      p_account: account,
      p_proof_path: path,
      p_reviewed_by: user.username,
    });
    if (error) {
      const msg = error.message.includes("insufficient")
        ? "Not enough coins for that amount."
        : error.message;
      return errorResponse(new Error(msg), 400);
    }

    void audit(user.username, "cashout.pay", email, { amount, method, cashoutId: newId });
    return NextResponse.json({ ok: true, id: newId });
  } catch (e) {
    return errorResponse(e);
  }
}

/** ADMIN: list recorded cash-outs, newest first, each with a signed proof URL. */
export async function GET(req: NextRequest) {
  try {
    if (!isAdminRequest(req)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const sb = getSupabase();
    const { data, error } = await sb
      .from("cashout_requests")
      .select("id,email,ign,amount,method,account,proof_path,status,reviewed_by,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const enriched = await Promise.all(
      (data ?? []).map(async (r) => {
        let proofUrl: string | null = null;
        if (r.proof_path) {
          const { data: signed } = await sb.storage
            .from(PROOF_BUCKET)
            .createSignedUrl(r.proof_path, 60 * 10);
          proofUrl = signed?.signedUrl ?? null;
        }
        return { ...r, proofUrl };
      })
    );

    return NextResponse.json({ requests: enriched });
  } catch (e) {
    return errorResponse(e);
  }
}
