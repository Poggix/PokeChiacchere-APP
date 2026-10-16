# Scontorno prodotti: Poof + BGNinja

L'app prova prima Poof, tramite una Supabase Edge Function che mantiene segreta la chiave API. Se Poof non è configurato o non è disponibile (incluso esaurimento crediti), l'app riprova automaticamente con BGNinja.

## Configurazione una tantum

1. Crea un account gratuito su https://poof.bg/ (100 immagini gratis al mese, senza carta di credito) e copia la API key.
2. Nel progetto Supabase collegato all'app, crea una Edge Function chiamata `remove-product-background` con il codice in `supabase/functions/remove-product-background/index.ts`.
3. Imposta il secret `POOF_API_KEY` con la chiave Poof nelle secrets delle Edge Functions. Non inserire mai questa chiave in `App.js` o in GitHub.
4. Distribuisci la funzione nel progetto Supabase. Con Supabase CLI: `supabase functions deploy remove-product-background`.
5. Ricompila/reinstalla l'app con questa versione di `App.js`.

La funzione usa l'autenticazione JWT standard di Supabase Edge Functions. L'app invia il token di sessione dell'utente.

## Quote e fallback

- **Poof:** 100 immagini/mese gratis, senza carta di credito; 4 richieste/minuto secondo la pagina ufficiale. Non attivare un piano a pagamento se vuoi restare a costo zero.
- **BGNinja:** fallback gratuito fino a 10 immagini al giorno per indirizzo IP, secondo i limiti pubblicati dal provider.
- Se non configuri il secret o la funzione, l'app continua a usare BGNinja come fallback.

## Nota sulla qualità

L'integrazione non garantisce automaticamente un risultato migliore con prodotti bianchi su sfondo bianco. Dopo la configurazione, confronta il risultato delle due API sulle stesse foto prima di considerare Poof il provider migliore. Le immagini vengono inviate al provider esterno necessario per effettuare lo scontorno.
