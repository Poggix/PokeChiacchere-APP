import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().replace(/^@/, "");
  return /^[a-zA-Z0-9._]{2,32}$/.test(username) ? username : null;
}

function normalizeProfile(user: Record<string, any>) {
  return {
    id: user.id == null ? "" : String(user.id),
    sec_uid: user.secUid == null ? String(user.sec_uid || "") : String(user.secUid),
    unique_id: String(user.uniqueId || user.unique_id || ""),
    nickname: String(user.nickname || ""),
    avatar_larger: String(user.avatarLarger || user.avatar_larger || ""),
    avatar_medium: String(user.avatarMedium || user.avatar_medium || ""),
    avatar_thumb: String(user.avatarThumb || user.avatar_thumb || ""),
    verified: Boolean(user.verified),
    private_account: Boolean(user.privateAccount ?? user.private_account),
  };
}

async function lookupBySecUid(secUid: string, expectedId: string) {
  // TikTok's web profile-detail endpoint accepts secUid. This is the important
  // reverse lookup: it can return the current uniqueId even when the old username changed.
  const endpoint = new URL("https://www.tiktok.com/api/user/detail/");
  endpoint.searchParams.set("secUid", secUid);
  endpoint.searchParams.set("uniqueId", "");

  const response = await fetch(endpoint.toString(), {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://www.tiktok.com/",
      "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error("TikTok non ha consentito la ricerca tramite ID (HTTP " + response.status + ").");
  }

  const payload = await response.json().catch(() => null);
  const rawUser = payload?.userInfo?.user
    ?? payload?.data?.userInfo?.user
    ?? payload?.user
    ?? payload?.data?.user;
  const profile = rawUser && typeof rawUser === "object" ? normalizeProfile(rawUser) : null;

  if (!profile?.id || !profile.sec_uid || !profile.unique_id) {
    const code = payload?.statusCode ?? payload?.status_code ?? payload?.status_code;
    const statusMessage = String(payload?.statusMsg || payload?.status_msg || "");
    throw new Error(
      "TikTok non ha restituito i dati completi per l'ID salvato" +
      (code != null ? " (codice " + code + ")" : "") +
      (statusMessage ? ": " + statusMessage : ".")
    );
  }
  if (profile.sec_uid !== secUid) {
    throw new Error("L'identificativo restituito da TikTok non coincide con quello salvato: profilo non aggiornato.");
  }
  if (expectedId && profile.id !== expectedId) {
    throw new Error("L'ID numerico del profilo restituito non coincide: profilo non aggiornato.");
  }
  return profile;
}

async function lookupByUsername(username: string) {
  const profileUrl = "https://www.tiktok.com/@" + encodeURIComponent(username);
  const response = await fetch(profileUrl, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error("TikTok ha risposto con HTTP " + response.status + " cercando @" + username + ".");
  }

  const html = await response.text();
  const match = html.match(/<script[^>]*id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) {
    throw new Error("TikTok non ha restituito i dati pubblici del profilo (possibile blocco o modifica della pagina).");
  }

  let pageData: Record<string, any>;
  try {
    pageData = JSON.parse(match[1]);
  } catch {
    throw new Error("La pagina TikTok non contiene JSON leggibile.");
  }

  const detail = pageData?.__DEFAULT_SCOPE__?.["webapp.user-detail"];
  const rawUser = detail?.userInfo?.user;
  if (!rawUser || (detail?.statusCode != null && Number(detail.statusCode) !== 0)) {
    throw new Error("Profilo non trovato o dati non disponibili pubblicamente.");
  }

  const profile = normalizeProfile(rawUser);
  if (!profile.id || !profile.sec_uid || !profile.unique_id) {
    throw new Error("TikTok non ha fornito tutti gli identificativi del profilo.");
  }
  return profile;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Metodo non consentito." }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Richiesta JSON non valida." }, 400);
  }

  const username = normalizeUsername(body.username);
  const secUid = typeof body.sec_uid === "string" ? body.sec_uid.trim() : "";
  const expectedId = typeof body.user_id === "string" || typeof body.user_id === "number"
    ? String(body.user_id).trim()
    : "";

  if (!username && !secUid) {
    return json({ ok: false, error: "Fornisci uno username oppure il sec_uid salvato." }, 400);
  }

  try {
    const profile = secUid
      ? await lookupBySecUid(secUid, expectedId)
      : await lookupByUsername(username!);

    return json({
      ok: true,
      user: {
        ...profile,
        profile_url: "https://www.tiktok.com/@" + encodeURIComponent(profile.unique_id),
      },
      checked_at: new Date().toISOString(),
      lookup_method: secUid ? "sec_uid" : "username",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message, retryable: true }, 502);
  }
});
