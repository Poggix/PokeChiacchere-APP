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

function avatarUrl(value: unknown, depth = 0): string {
  if (depth > 5 || value == null) return "";
  if (typeof value === "string") {
    const candidate = value.trim();
    return /^https?:\/\//i.test(candidate) ? candidate : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = avatarUrl(item, depth + 1);
      if (url) return url;
    }
    return "";
  }
  if (typeof value === "object") {
    const data = value as Record<string, unknown>;
    for (const key of ["urlList", "url_list", "urls", "uri", "url", "avatarLarger", "avatarMedium", "avatarThumb", "avatar_larger", "avatar_medium", "avatar_thumb", "avatar", "avatar_300x300", "avatar_168x168", "avatar_100x100"]) {
      const url = avatarUrl(data[key], depth + 1);
      if (url) return url;
    }
  }
  return "";
}

function firstAvatar(user: Record<string, any>): string {
  const preferred = [
    user.avatarLarger, user.avatar_larger, user.avatarLarge, user.avatar_large,
    user.avatarMedium, user.avatar_medium, user.avatarThumb, user.avatar_thumb,
    user.avatar_300x300, user.avatar_168x168, user.avatar_100x100, user.avatar,
    user.profilePicture, user.profile_picture, user.avatarUri, user.avatar_uri,
    user.profilePhoto, user.profile_photo, user.photo, user.picture,
  ];
  for (const value of preferred) {
    const url = avatarUrl(value);
    if (url) return url;
  }

  // TikTok changes avatar field names between response versions. Search nested
  // user objects for avatar/photo fields without logging or returning raw profile data.
  const visited = new Set<object>();
  function scan(value: unknown, depth = 0): string {
    if (depth > 6 || value == null || typeof value !== "object") return "";
    if (visited.has(value as object)) return "";
    visited.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = scan(item, depth + 1);
        if (found) return found;
      }
      return "";
    }
    const record = value as Record<string, unknown>;
    for (const [key, item] of Object.entries(record)) {
      if (/avatar|profile.?photo|profile.?picture/i.test(key)) {
        const found = avatarUrl(item);
        if (found) return found;
      }
    }
    for (const item of Object.values(record)) {
      const found = scan(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  return scan(user);
}

function avatarFromMeta(html: string): string {
  const tags = html.match(/<meta\\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/(?:property|name)=[\"'](?:og:image|twitter:image)[\"']/i.test(tag)) continue;
    const match = tag.match(/content=[\"']([^\"']+)[\"']/i);
    if (match?.[1] && /^https?:\\/\\//i.test(match[1])) {
      return match[1].replace(/&amp;/g, "&");
    }
  }
  return "";
}

function normalizeProfile(user: Record<string, any>) {
  const avatar = firstAvatar(user);
  return {
    id: user.id == null ? "" : String(user.id),
    sec_uid: user.secUid == null ? String(user.sec_uid || "") : String(user.secUid),
    unique_id: String(user.uniqueId || user.unique_id || ""),
    nickname: String(user.nickname || ""),
    avatar_larger: avatar,
    avatar_medium: avatar,
    avatar_thumb: avatar,
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
    ...(expectedId ? [
      { userId: expectedId, uniqueId: "", aid: "1988", app_name: "tiktok_web" },
      { user_id: expectedId, uniqueId: "", aid: "1988", app_name: "tiktok_web" },
      { id: expectedId, uniqueId: "", aid: "1988", app_name: "tiktok_web" },
    ] : []),
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
    if (secUid && profile.sec_uid !== secUid) {
      lastReason = "Il sec_uid restituito da TikTok non coincide con quello salvato.";
      continue;
    }
    if (expectedId && profile.id !== expectedId) {
      lastReason = "L'ID numerico restituito da TikTok non coincide con quello salvato.";
      continue;
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

  // Some private-profile page responses expose the avatar only in Open Graph metadata.
  if (!profile.avatar_larger) {
    const metaAvatar = avatarFromMeta(html);
    if (metaAvatar) {
      profile.avatar_larger = metaAvatar;
      profile.avatar_medium = metaAvatar;
      profile.avatar_thumb = metaAvatar;
    }
  }
  return profile;
}


async function lookupByFetchLayer(apiKey: string, username: string | null, secUid: string, expectedId: string) {
  // FetchLayer is a fallback only: the regular TikTok lookup is attempted first.
  // Send exactly one identity parameter, as required by the API documentation.
  const identity = secUid
    ? { key: "secUid", value: secUid }
    : (/^\\d+$/.test(expectedId) ? { key: "userId", value: expectedId } : null)
      || (username ? { key: "username", value: username } : null);

  if (!identity) throw new Error("FetchLayer non può essere usato: manca uno username o un identificativo TikTok valido.");

  const response = await fetch("https://api.fetchlayer.dev/tiktok/user-profile", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ [identity.key]: identity.value }),
    signal: AbortSignal.timeout(25000),
  });

  const responseText = await response.text();
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error("FetchLayer ha restituito una risposta non JSON (HTTP " + response.status + ").");
  }

  if (!response.ok) {
    const apiMessage = String(payload?.error || payload?.message || payload?.detail || "");
    throw new Error("FetchLayer ha risposto con HTTP " + response.status + (apiMessage ? ": " + apiMessage : "."));
  }

  const rawProfile = payload?.profile || payload?.data?.profile || payload?.result?.profile;
  if (!rawProfile || typeof rawProfile !== "object") {
    throw new Error("FetchLayer non ha restituito il campo profile atteso.");
  }

  const profile = normalizeProfile(rawProfile);
  if (!profile.id || !profile.sec_uid || !profile.unique_id) {
    throw new Error("FetchLayer ha restituito un profilo senza tutti gli identificativi necessari.");
  }

  // Never open/update a different account if the persistent identity does not match.
  if (secUid && profile.sec_uid !== secUid) {
    throw new Error("FetchLayer ha restituito un secUid diverso da quello salvato. Profilo rifiutato.");
  }
  if (expectedId && profile.id !== expectedId) {
    throw new Error("FetchLayer ha restituito un ID numerico diverso da quello salvato. Profilo rifiutato.");
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
    const primaryMessage = error instanceof Error ? error.message : String(error);
    const apiKey = Deno.env.get("FETCHLAYER_API_KEY");

    // Only spend a FetchLayer request after the existing TikTok lookup has failed.
    if (apiKey) {
      try {
        const fallbackProfile = await lookupByFetchLayer(apiKey, username, secUid, expectedId);
        const lookupMethod = "fetchlayer_" + (secUid ? "sec_uid" : (/^\\d+$/.test(expectedId) ? "user_id" : "username"));
        console.info("[tiktok-profile-lookup] lookup_succeeded", JSON.stringify({
          requestId,
          lookupMethod,
          fallback: true,
          primaryError: primaryMessage,
        }));
        return json({
          ok: true,
          request_id: requestId,
          user: {
            ...fallbackProfile,
            profile_url: "https://www.tiktok.com/@" + encodeURIComponent(fallbackProfile.unique_id),
          },
          checked_at: new Date().toISOString(),
          lookup_method: lookupMethod,
        });
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.error("[tiktok-profile-lookup] fetchlayer_fallback_failed", JSON.stringify({
          requestId,
          primaryError: primaryMessage,
          fallbackError: fallbackMessage,
        }));
        return json({
          ok: false,
          error: primaryMessage + " Fallback FetchLayer non riuscito: " + fallbackMessage,
          retryable: true,
          request_id: requestId,
        }, 502);
      }
    }

    console.error("[tiktok-profile-lookup] lookup_failed", JSON.stringify({
      requestId,
      lookupMethod: secUid ? "sec_uid" : "username",
      error: primaryMessage,
      fetchLayerConfigured: false,
    }));
    return json({ ok: false, error: primaryMessage, retryable: true, request_id: requestId }, 502);
  }
});
