# Portale web PokeChiacchere

Portale responsive e installabile su Mac, Windows, iPad e iPhone. Usa Supabase Auth e le tabelle già lette dall'app Expo iOS; l'accesso richiede lo stesso account. La schermata offre un riepilogo e una vista consultiva delle vendite, degli acquisti, dei prodotti, dei clienti, dei pagamenti interni e dei prelievi. Le autorizzazioni restano affidate alle policy RLS di Supabase.

## Prova in locale

Dalla cartella principale del repository:

```sh
python3 -m http.server 4173 --directory web
```

Apri http://localhost:4173, accedi con le credenziali dell'app iOS e verifica che le sezioni mostrino i dati consentiti a quell'utente. Il server locale serve la pagina: per il login e il caricamento serve una connessione Internet. L'app è in sola consultazione; inserimenti, modifiche, notifiche, mappa e altre funzioni native restano nell'app iOS.

## Pubblicazione

Pubblicare il contenuto della cartella `web/` su un hosting statico HTTPS (ad esempio GitHub Pages, Cloudflare Pages o Netlify). Dopo la pubblicazione, su macOS aprire il sito in Safari e scegliere **File > Aggiungi al Dock**; su Windows, usare l'azione **Installa app** del browser compatibile. Il manifest abilita l'installazione PWA. Il service worker conserva la struttura della pagina per riaprirla, ma i dati richiedono rete e una sessione Supabase valida.

La chiave presente nel browser è la chiave pubblica Supabase, come quella usata dall'app. Non inserire mai una service-role key nel client. La sicurezza dei dati dipende dalle policy RLS già configurate nel progetto Supabase.
