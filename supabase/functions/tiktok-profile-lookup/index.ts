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
  // TikTok's web endpoint is undocumented and can change its response format.
  // Try both commonly observed parameter spellings and include the web app's aid.
  const attempts = [
    { secUid, uniqueId: "", aid: "1988", app_name: "tiktok_web" },
    { sec_uid: secUid, uniqueId: "", aid: "1988", app_name: "tiktok_web" },
  ];
  let lastReason = "TikTok non ha restituito dati JSON leggibili.";

  for (const params of attempts) {
    const endpoint = new URL("https://www.tiktok.com/api/user/detail/");
    for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(key, value);

    let response: Response;
    try {
      response = await fetch(endpoint.toString(), {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Referer": "https://www.tiktok.com/",
          "Origin": "https://www.tiktok.com",
          "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      lastReason = error instanceof Error && error.name === "TimeoutError"
        ? "TikTok non ha risposto entro 15 secondi."
        : "Impossibile raggiungere l'endpoint pubblico di TikTok.";
      continue;
    }

    if (!response.ok) {
      lastReason = "TikTok ha risposto con HTTP " + response.status + " alla ricerca tramite ID.";
      continue;
    }

    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    let payload: Record<string, any> | null = null;
    try {
      payload = JSON.parse(text);
    } catch {
      lastReason = contentType.includes("text/html") || /<html|captcha|verify/i.test(text.slice(0, 500))
        ? "TikTok ha restituito una pagina HTML o una verifica anti-bot invece dei dati del profilo."
        : "TikTok ha restituito una risposta non JSON.";
      continue;
    }

    const candidates = [
      payload?.userInfo?.user,
      payload?.data?.userInfo?.user,
      payload?.user,
      payload?.data?.user,
      payload?.userInfo,
      payload?.data?.userInfo,
    ];
    const rawUser = candidates.find((candidate) =>
      candidate && typeof candidate === "object" &&
      (candidate.id != null || candidate.secUid != null || candidate.sec_uid != null ||
       candidate.uniqueId != null || candidate.unique_id != null)
    );
    const profile = rawUser ? normalizeProfile(rawUser) : null;

    if (!profile?.id || !profile.sec_uid || !profile.unique_id) {
      const code = payload?.statusCode ?? payload?.status_code ?? payload?.status_code;
      const statusMessage = String(payload?.statusMsg || payload?.status_msg || "");
      const keys = Object.keys(payload || {}).slice(0, 12).join(", ");
      lastReason = "TikTok non ha restituito username e identificativi completi per l'ID salvato" +
        (code != null ? " (codice " + code + ")" : "") +
        (statusMessage ? ": " + statusMessage : "") +
        (keys ? ". Campi risposta: " + keys : ".");
      continue;
    }
    if (profile.sec_uid !== secUid) {
      throw new Error("L'identificativo restituito da TikTok non coincide con quello salvato: profilo non aggiornato.");
    }
    if (expectedId && profile.id !== expectedId) {
      throw new Error("L'ID numerico del profilo restituito non coincide: profilo non aggiornato.");
    }
    return profile;
  }

  throw new Error(lastReason);
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
  const requestId = crypto.randomUUID();
  console.info("[tiktok-profile-lookup] request_received", JSON.stringify({
    requestId,
    method: req.method,
    timestamp: new Date().toISOString(),
  }));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    console.warn("[tiktok-profile-lookup] method_not_allowed", JSON.stringify({ requestId, method: req.method }));
    return json({ ok: false, error: "Metodo non consentito.", request_id: requestId }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    console.warn("[tiktok-profile-lookup] invalid_json", JSON.stringify({ requestId }));
    return json({ ok: false, error: "Richiesta JSON non valida.", request_id: requestId }, 400);
  }

  const username = normalizeUsername(body.username);
  const secUid = typeof body.sec_uid === "string" ? body.sec_uid.trim() : "";
  const expectedId = typeof body.user_id === "string" || typeof body.user_id === "number"
    ? String(body.user_id).trim()
    : "";

  console.info("[tiktok-profile-lookup] lookup_started", JSON.stringify({
    requestId,
    hasUsername: Boolean(username),
    hasSecUid: Boolean(secUid),
    hasExpectedUserId: Boolean(expectedId),
    lookupMethod: secUid ? "sec_uid" : "username",
  }));

  if (!username && !secUid) {
    console.warn("[tiktok-profile-lookup] missing_identity", JSON.stringify({ requestId }));
    return json({ ok: false, error: "Fornisci uno username oppure il sec_uid salvato.", request_id: requestId }, 400);
  }

  try {
    let profile: ReturnType<typeof normalizeProfile>;
    let lookupMethod = secUid ? "sec_uid" : "username";

    if (secUid) {
      try {
        profile = await lookupBySecUid(secUid, expectedId);
      } catch (idLookupError) {
        // If TikTok blocks its undocumented ID endpoint, try the saved username page.
        // Accept this fallback only when the returned profile still matches the stored IDs.
        if (!username) throw idLookupError;
        console.warn("[tiktok-profile-lookup] id_lookup_fallback_to_username", JSON.stringify({
          requestId,
          reason: idLookupError instanceof Error ? idLookupError.message : "unknown",
        }));
        const fallbackProfile = await lookupByUsername(username);
        if (fallbackProfile.sec_uid !== secUid || (expectedId && fallbackProfile.id !== expectedId)) {
          throw new Error("TikTok blocca la ricerca tramite ID e il profilo trovato dallo username non coincide con l'identità salvata. Nessun dato è stato modificato.");
        }
        profile = fallbackProfile;
        lookupMethod = "username_identity_verified";
      }
    } else {
      profile = await lookupByUsername(username!);
    }

    console.info("[tiktok-profile-lookup] lookup_succeeded", JSON.stringify({
      requestId,
      lookupMethod,
    }));
    return json({
      ok: true,
      request_id: requestId,
      user: {
        ...profile,
        profile_url: "https://www.tiktok.com/@" + encodeURIComponent(profile.unique_id),
      },
      checked_at: new Date().toISOString(),
      lookup_method: lookupMethod,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[tiktok-profile-lookup] lookup_failed", JSON.stringify({
      requestId,
      lookupMethod: secUid ? "sec_uid" : "username",
      error: message,
    }));
    return json({ ok: false, error: message, retryable: true, request_id: requestId }, 502);
  }
});
