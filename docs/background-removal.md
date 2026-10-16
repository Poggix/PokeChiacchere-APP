# Scontorno prodotti: Poof + BGNinja

L'app consente di scegliere manualmente il servizio per rimuovere lo sfondo dalla schermata del prodotto. Il selettore offre **BGNinja** e **Poof**; viene chiamato esclusivamente il servizio selezionato e non è previsto alcun fallback automatico. Se il servizio restituisce un errore, l'app mostra un messaggio e l'utente può selezionare l'altro provider.

## Configurazione una tantum

1. Crea un account su https://poof.bg/ e recupera la API key secondo le condizioni e i limiti attuali del provider.
2. Nel progetto Supabase collegato all'app, crea una Edge Function chiamata `remove-product-background` con il codice in `supabase/functions/remove-product-background/index.ts`.
3. Imposta il secret `POOF_API_KEY` nelle secrets delle Edge Functions. Non inserire mai questa chiave in `App.js` o nel repository GitHub.
4. Distribuisci la funzione nel progetto Supabase. Con Supabase CLI: `supabase functions deploy remove-product-background`.
5. Ricompila/reinstalla l'app con la versione aggiornata di `App.js`.

La funzione usa l'autenticazione JWT standard di Supabase Edge Functions. L'app invia il token di sessione dell'utente.

## Scelta del provider e costi

- **Poof:** l'app lo usa solo quando è selezionato manualmente. Verifica quote, prezzi e requisiti aggiornati sul sito ufficiale prima dell'uso.
- **BGNinja:** l'app lo usa solo quando è selezionato manualmente. Verifica quote e limiti aggiornati sul sito ufficiale prima dell'uso.
- Se un provider non è configurato o non è disponibile, l'app non passa automaticamente all'altro servizio: mostra l'errore e lascia all'utente la scelta.

## Verifiche prima del rilascio

La presenza del codice non dimostra che l'integrazione sia già funzionante. Verifica separatamente entrambi i provider con immagini di prova, controllando risposta HTTP, formato dell'immagine restituita, messaggi di errore e funzionamento su iPhone e iPad. L'endpoint e il formato richiesto da Poof devono essere confermati con la documentazione ufficiale attuale.

## Nota sulla qualità e sulla privacy

Confronta i risultati dei due provider sulle stesse foto, soprattutto per prodotti bianchi su sfondo chiaro. Le immagini vengono inviate al servizio esterno selezionato per effettuare lo scontorno; evita di caricare immagini contenenti dati personali non necessari.
