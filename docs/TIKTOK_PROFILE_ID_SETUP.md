# Verifica e identificazione dei profili TikTok

La funzione `tiktok-profile-lookup` legge la pagina pubblica di un profilo TikTok (non effettua login e non usa credenziali TikTok) e prova a salvare `id`, `sec_uid`, username corrente e avatar nella scheda cliente.

## 1. Aggiornare lo schema Supabase

Aprire Supabase Dashboard → SQL Editor ed eseguire il file:

`supabase/migrations/20261016_customer_tiktok_identity.sql`

La migrazione è idempotente: aggiunge le colonne solo se mancanti. Il campo `tiktok_user_id` è `text` per conservare correttamente l'identificativo numerico lungo senza arrotondamenti JavaScript.

## 2. Pubblicare la Edge Function

Nel progetto Supabase `omovacbvfhmtjqrrgszx`:

1. Aprire Edge Functions.
2. Creare una funzione chiamata esattamente `tiktok-profile-lookup`.
3. Copiare il contenuto di `supabase/functions/tiktok-profile-lookup/index.ts` nell'editor.
4. Distribuirla lasciando attiva la verifica JWT (la app la chiama con la sessione autenticata dell'utente).

Endpoint atteso:

`https://omovacbvfhmtjqrrgszx.supabase.co/functions/v1/tiktok-profile-lookup`

La funzione non richiede una chiave TikTok. Le sole credenziali Supabase sono inviate dall'app, e non vengono passate a TikTok.

## 3. Compilare l'app

Dopo aver eseguito la migrazione e distribuito la funzione, aprire GitHub → Actions → Build PokeChiacchere IPA → Run workflow sul branch `main`.

## Pulsante “Verifica e apri profilo TikTok”

Nella scheda cliente il pulsante chiama la Edge Function passando lo `sec_uid` salvato. La funzione prova a interrogare l'endpoint web non ufficiale `/api/user/detail/?secUid=...` e restituisce lo username corrente. L'app confronta gli ID, aggiorna i campi se coincidono e poi apre il link del profilo aggiornato. Se l'endpoint non risponde o l'identificativo non coincide, non sostituisce il nome e non apre il vecchio link.

Questa richiesta usa un endpoint web non ufficiale, quindi TikTok può limitarla o modificarla. Se un cliente ha soltanto uno username e non è ancora stato salvato un ID stabile, il primo controllo parte dallo username corrente.

## Comportamento dell'importazione

- CSV / Excel: `Order ID` collega la riga alla vendita; `Buyer Username` fornisce lo username da verificare.
- Una ricerca viene eseguita per cliente quando manca l'ID stabile o quando lo username ricevuto è diverso da quello salvato.
- Se il profilo esistente ha già un ID e il profilo risolto restituisce un ID differente, l'aggiornamento viene bloccato per evitare di associare la persona sbagliata.
- Le vendite non vengono mai create, modificate o eliminate.
- Se TikTok blocca la richiesta o cambia la pagina, l'importazione continua in modalità prudente: il report mostra quante verifiche non sono riuscite.

## Limite importante

Questa implementazione risolve il profilo a partire da uno username disponibile. Il sito pubblico TikTok non offre in questa funzione un endpoint inverso affidabile che, dato soltanto `id` o `sec_uid`, restituisca il nuovo username dopo che una persona lo ha cambiato. Per questo il nuovo username viene aggiornato e confrontato quando arriva in un'importazione successiva; non è possibile promettere un monitoraggio automatico del cambio di nome senza una nuova fonte dati. Il recupero della pagina pubblica può inoltre essere limitato da TikTok e non è un'API ufficiale.
