import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OWNER_USER_ID =
  Deno.env.get("OWNER_USER_ID") ?? "01bf546e-bf28-46ac-8370-b4fe30d8a8fd";

const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const WHATSAPP_API_VERSION = Deno.env.get("WHATSAPP_API_VERSION");
const WHATSAPP_TEMPLATE_NAME = Deno.env.get("WHATSAPP_TEMPLATE_NAME");
const WHATSAPP_TEMPLATE_LANGUAGE =
  Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE") ?? "it";

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

const tableUrl = `${SUPABASE_URL}/rest/v1/whatsapp_recipients`;

function serviceHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phone = value.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

async function getRecipients(enabledOnly = false) {
  const url = new URL(tableUrl);
  url.searchParams.set("select", "id,name,phone_e164,enabled,created_at");
  url.searchParams.set("order", "created_at.asc");
  if (enabledOnly) url.searchParams.set("enabled", "eq.true");
  const response = await fetch(url, { headers: serviceHeaders() });
  const data = await response.json().catch(() => []);
  if (!response.ok) {
    console.error("WHATSAPP RECIPIENTS READ ERROR", JSON.stringify(data));
    throw new Error("Impossibile leggere i destinatari WhatsApp.");
  }
  return Array.isArray(data) ? data : [];
}

async function sendWhatsAppTemplate(phone: string, title: string, body: string) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_API_VERSION || !WHATSAPP_TEMPLATE_NAME) {
    throw new Error("Configura i Secrets WhatsApp e il template prima dell'invio.");
  }
  const endpoint = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone.replace(/^\+/, ""),
      type: "template",
      template: {
        name: WHATSAPP_TEMPLATE_NAME,
        language: { code: WHATSAPP_TEMPLATE_LANGUAGE },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: title },
            { type: "text", text: body },
          ],
        }],
      },
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("WHATSAPP API ERROR", JSON.stringify(result));
    return {
      ok: false,
      error: result?.error?.message ?? "Meta ha rifiutato il messaggio.",
      code: result?.error?.code ?? null,
    };
  }
  return { ok: true, messageId: result?.messages?.[0]?.id ?? null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const jwt = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "Missing bearer token" }, 401);

    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!userResponse.ok) return json({ error: "Sessione non valida" }, 401);
    const user = await userResponse.json();
    if (user.id !== OWNER_USER_ID) return json({ error: "Non autorizzato" }, 403);

    const input = await req.json().catch(() => ({}));
    const action = input?.action ?? "whatsapp-send";

    if (action === "whatsapp-list") {
      return json({ ok: true, recipients: await getRecipients() });
    }

    if (action === "whatsapp-add") {
      const name = String(input?.name ?? "").trim().slice(0, 100);
      const phone = normalizePhone(input?.phone);
      if (!name || !phone) {
        return json({ error: "Inserisci un nome e un numero internazionale valido, ad esempio +393331234567." }, 400);
      }
      const response = await fetch(tableUrl, {
        method: "POST",
        headers: serviceHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify({ name, phone_e164: phone, enabled: input?.enabled !== false }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 || result?.code === "23505") {
          return json({ error: "Questo numero è già presente in rubrica." }, 409);
        }
        console.error("WHATSAPP RECIPIENT INSERT ERROR", JSON.stringify(result));
        return json({ error: "Impossibile salvare il destinatario." }, 502);
      }
      return json({ ok: true, recipient: Array.isArray(result) ? result[0] : result }, 201);
    }

    if (action === "whatsapp-toggle") {
      const id = String(input?.id ?? "");
      const enabled = input?.enabled;
      if (!/^[0-9a-f-]{36}$/i.test(id) || typeof enabled !== "boolean") {
        return json({ error: "Destinatario o stato non valido." }, 400);
      }
      const url = new URL(tableUrl);
      url.searchParams.set("id", `eq.${id}`);
      const response = await fetch(url, {
        method: "PATCH",
        headers: serviceHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify({ enabled }),
      });
      const result = await response.json().catch(() => []);
      if (!response.ok) {
        console.error("WHATSAPP RECIPIENT UPDATE ERROR", JSON.stringify(result));
        return json({ error: "Impossibile modificare il destinatario." }, 502);
      }
      if (!Array.isArray(result) || result.length === 0) return json({ error: "Destinatario non trovato." }, 404);
      return json({ ok: true, recipient: result[0] });
    }

    if (action === "whatsapp-delete") {
      const id = String(input?.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "ID destinatario non valido." }, 400);
      const url = new URL(tableUrl);
      url.searchParams.set("id", `eq.${id}`);
      const response = await fetch(url, {
        method: "DELETE",
        headers: serviceHeaders({ Prefer: "return=representation" }),
      });
      const result = await response.json().catch(() => []);
      if (!response.ok) {
        console.error("WHATSAPP RECIPIENT DELETE ERROR", JSON.stringify(result));
        return json({ error: "Impossibile eliminare il destinatario." }, 502);
      }
      if (!Array.isArray(result) || result.length === 0) return json({ error: "Destinatario non trovato." }, 404);
      return json({ ok: true });
    }

    if (action === "whatsapp-send-group") {
      return json({ error: "Invio ai gruppi disabilitato: l'idoneità del tuo account Meta non è stata verificata." }, 403);
    }

    if (action !== "whatsapp-send") return json({ error: "Azione non riconosciuta." }, 400);
    const title = String(input?.title ?? "PokeChiacchere").trim().slice(0, 120);
    const body = String(input?.body ?? "").trim().slice(0, 1000);
    if (!title || !body) return json({ error: "Titolo e messaggio sono obbligatori." }, 400);

    const recipients = await getRecipients(true);
    if (recipients.length === 0) return json({ error: "Non ci sono destinatari WhatsApp attivi in rubrica." }, 400);

    const results = [];
    for (const recipient of recipients) {
      const phone = normalizePhone(recipient.phone_e164);
      if (!phone) {
        results.push({ id: recipient.id, name: recipient.name, ok: false, error: "Numero salvato non valido." });
        continue;
      }
      try {
        const result = await sendWhatsAppTemplate(phone, title, body);
        results.push({
          id: recipient.id,
          name: recipient.name,
          ok: result.ok,
          ...(result.ok ? { messageId: result.messageId } : { error: result.error, code: result.code }),
        });
      } catch (error) {
        results.push({
          id: recipient.id,
          name: recipient.name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const accepted = results.filter((result) => result.ok).length;
    const failed = results.length - accepted;
    return json({ ok: failed === 0, channel: "whatsapp", total: results.length, accepted, failed, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("ERRORE WHATSAPP-NOTIFICATIONS", message);
    return json({ error: message }, 500);
  }
});
