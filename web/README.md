# Portale web PokeChiacchere

Gestionale responsive e installabile su Mac, Windows, iPad e iPhone. Usa Supabase Auth e le tabelle condivise con l'app Expo iOS; l'accesso richiede lo stesso account. Include panoramica e saldo soci, vendite con ordini multi-prodotto e calcolo FIFO, commissioni TikTok, acquisti, clienti e prodotti, pagamenti interni, prelievi, magazzino, registro attività e notifiche al socio. Le autorizzazioni restano affidate alle policy RLS di Supabase.

## Prova in locale

Dalla cartella principale del repository:

```sh
python3 -m http.server 4173 --directory web
```

Apri http://localhost:4173, accedi con le credenziali dell'app iOS e verifica che le sezioni mostrino i dati consentiti a quell'utente. Il server locale serve la pagina: per il login e il caricamento serve una connessione Internet. Le registrazioni e le modifiche vengono salvate su Supabase. Posizione in background e distribuzione SideStore richiedono le API native e restano nell'app iOS.

## Pubblicazione

Pubblicare il contenuto della cartella `web/` su un hosting statico HTTPS (ad esempio GitHub Pages, Cloudflare Pages o Netlify). Dopo la pubblicazione, su macOS aprire il sito in Safari e scegliere **File > Aggiungi al Dock**; su Windows, usare l'azione **Installa app** del browser compatibile. Il manifest abilita l'installazione PWA. Il service worker conserva la struttura della pagina per riaprirla, ma i dati richiedono rete e una sessione Supabase valida.

La chiave presente nel browser è la chiave pubblica Supabase, come quella usata dall'app. Non inserire mai una service-role key nel client. La sicurezza dei dati dipende dalle policy RLS già configurate nel progetto Supabase. Il registro attività e il profilo socio richiedono le rispettive tabelle già previste dall'app. Nel codice iOS consultato non è presente un flusso di approvazione del rendiconto.
