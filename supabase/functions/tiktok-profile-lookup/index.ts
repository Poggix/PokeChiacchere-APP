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
  if (!username) return json({ ok: false, error: "Username TikTok mancante o non valido." }, 400);

  try {
    // Reads only the publicly accessible profile page. It does not log in to TikTok
    // and does not use or store any TikTok credentials.
    const profileUrl = "https://www.tiktok.com/@" + encodeURIComponent(username);
    const upstream = await fetch(profileUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      return json({
        ok: false,
        error: "TikTok ha risposto con HTTP " + upstream.status + ". Il profilo non è stato modificato.",
        retryable: upstream.status === 429 || upstream.status >= 500,
      }, 502);
    }

    const html = await upstream.text();
    const match = html.match(/<script[^>]*id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match || !match[1]) {
      return json({
        ok: false,
        error: "TikTok non ha restituito i dati pubblici del profilo (possibile blocco o modifica della pagina).",
        retryable: true,
      }, 502);
    }

    let pageData: Record<string, any>;
    try {
      pageData = JSON.parse(match[1]);
    } catch {
      return json({ ok: false, error: "La pagina TikTok non contiene JSON leggibile.", retryable: true }, 502);
    }

    const detail = pageData?.__DEFAULT_SCOPE__?.["webapp.user-detail"];
    const rawUser = detail?.userInfo?.user;
    if (!rawUser || (detail?.statusCode != null && Number(detail.statusCode) !== 0)) {
      return json({ ok: false, error: "Profilo non trovato o dati non disponibili pubblicamente.", retryable: false }, 404);
    }

    const id = rawUser.id == null ? "" : String(rawUser.id);
    const secUid = rawUser.secUid == null ? "" : String(rawUser.secUid);
    const currentUsername = String(rawUser.uniqueId || "").trim();
    if (!id || !secUid || !currentUsername) {
      return json({ ok: false, error: "TikTok non ha fornito tutti gli identificativi del profilo.", retryable: true }, 502);
    }

    return json({
      ok: true,
      user: {
        id,
        sec_uid: secUid,
        unique_id: currentUsername,
        nickname: String(rawUser.nickname || ""),
        avatar_larger: String(rawUser.avatarLarger || ""),
        avatar_medium: String(rawUser.avatarMedium || ""),
        avatar_thumb: String(rawUser.avatarThumb || ""),
        verified: Boolean(rawUser.verified),
        private_account: Boolean(rawUser.privateAccount),
        profile_url: "https://www.tiktok.com/@" + encodeURIComponent(currentUsername),
      },
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({
      ok: false,
      error: "Impossibile verificare il profilo TikTok: " + message,
      retryable: true,
    }, 502);
  }
});
