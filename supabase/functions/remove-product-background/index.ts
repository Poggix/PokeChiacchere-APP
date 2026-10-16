// Supabase Edge Function: securely proxy Poof background removal.
// Configure the POOF_API_KEY secret in Supabase; never put the provider key in the mobile app.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("POOF_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Poof non configurato: manca il secret POOF_API_KEY." }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const incoming = await req.formData();
    const image = incoming.get("file");
    if (!(image instanceof File)) {
      return new Response(JSON.stringify({ error: "Campo file mancante." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!image.type.startsWith("image/")) {
      return new Response(JSON.stringify({ error: "Il file deve essere un'immagine." }), {
        status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (image.size > 20 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "Immagine troppo grande (massimo 20 MB)." }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const poofForm = new FormData();
    poofForm.append("image_file", image, image.name || "product-photo.jpg");
    const upstream = await fetch("https://api.poof.bg/v1/remove", {
      method: "POST", headers: { "x-api-key": apiKey }, body: poofForm,
    });

    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 1200);
      return new Response(JSON.stringify({
        error: "Poof ha rifiutato la richiesta.", providerStatus: upstream.status, detail,
      }), {
        status: upstream.status >= 400 && upstream.status < 500 ? 502 : 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentType = upstream.headers.get("content-type") || "image/png";
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength < 100) {
      return new Response(JSON.stringify({ error: "Poof ha restituito un'immagine vuota." }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(bytes, {
      status: 200, headers: { ...corsHeaders, "Content-Type": contentType, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Errore durante lo scontorno.",
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
