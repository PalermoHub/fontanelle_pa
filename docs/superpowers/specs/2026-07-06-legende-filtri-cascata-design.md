# Legende pannello stats come filtri interconnessi a cascata

## Problema
Le legende del pannello stats (donut circoscrizioni, classifica quartieri, griglia bivariata copertura) filtrano la mappa in modo mutuamente esclusivo: click su una riga quartiere azzera la circoscrizione selezionata invece di restare dentro il suo scope. I pannelli non riflettono mai lo scope attivo (restano render statici su tutti i dati) e non c'è modo di vedere/rimuovere i livelli di filtro attivi.

## Stato attuale (verificato nel codice)
- `#filter-circoscrizione` → `#filter-quartiere` → `#filter-fontanella` hanno già una cascata "narrow only" (`refreshCascadeOptions`, `js/main.js:400`): selezionare una circoscrizione restringe le opzioni quartiere disponibili, mai il contrario.
- `applyFilters` (`js/main.js:570`) combina circoscrizione+quartiere+ricerca+fontanella in AND (`buildFontanelleFilterExpression`, `js/filters.js`) e aggiorna mappa, copertura isocrona, zoom.
- Le legende stats (`wireStatsInteractions`, `js/main.js:231`) settano UN select e dispatchano `change`, ma il click su riga quartiere azzera prima la circoscrizione — comportamento da correggere.
- `buildQuartiereRanking`/`buildCoperturaBivariateGrid`/`buildCircoscrizioneDonut` sono render statici da `stats.json` (aggregato globale), non da `fontanelle.geojson` (dati live per feature, con `circoscrizione`+`quartiere`+`id`).

## Design

### 1. Stato = select esistenti
Nessun nuovo store: `circoscrizioneSelect.value` / `quartiereSelect.value` restano l'unica fonte di verità, già letta da `applyFilters`.

### 2. Fix wiring legende (`js/main.js`)
- Click cella/pallino con `data-circ` (donut, biv-grid): invariato — dispatch `change` su `circoscrizioneSelect`, la cascata esistente narrowa già `quartiereSelect`.
- Click riga rank quartiere (`data-quartiere`): non azzera più la circoscrizione. Deriva la circoscrizione del quartiere da una mappa `quartiere → circoscrizione` costruita una volta da `fontanelle.features` (proprietà già presenti: `circoscrizione`, `quartiere`). Se la circoscrizione derivata è diversa da quella attualmente selezionata, la imposta e dispatcha `change` (che ricostruisce le opzioni quartiere) **prima** di impostare il quartiere e dispatchare il suo `change`.

### 3. Re-render pannelli sullo scope attivo
Dopo ogni `applyFilters`:
- **Rank quartieri**: ricalcolato da `fontanelle.features` live (group-by quartiere, filtrato per circoscrizione se selezionata) — sostituisce `stats.json` per questo pannello così i numeri restano coerenti con la mappa filtrata. Mantiene tutti i quartieri della circoscrizione anche a 0? No: solo quelli con almeno 1 fontanella (comportamento identico all'attuale, cambia solo la sorgente/scope).
- **Griglia bivariata**: nessun ricalcolo geometria/tercili (restano sugli 8 valori fissi `COPERTURA_ROWS`); i pallini fuori dalla circoscrizione selezionata prendono classe `.biv-dot-dim` (opacity ridotta via CSS).
- **Donut**: i segmenti/righe legenda fuori dalla circoscrizione selezionata prendono classe `.donut-dim` (opacity ridotta via CSS). Nessun ricalcolo angoli.
- **Tooltip donut** (richiesta utente): ogni `<path class="donut-seg">` e ogni pallino/arco riceve un `<title>` SVG figlio col nome esteso "Circoscrizione {numero}" (usando la stessa label "Circ. {circ}" già presente nelle righe legenda), così il tooltip nativo del browser mostra il nome anche passando sopra la sola porzione di anello (oggi solo `data-circ`, nessun testo visibile al hover).

### 4. Breadcrumb
Riga sopra le sezioni stats (dentro `#stats-block`, sotto il subtitle): es. `Circ. III › Quartiere X ✕`. Visibile solo se almeno un filtro attivo. Click `✕`:
- su segmento quartiere: rimuove solo il quartiere (`quartiereSelect.value = ""`, dispatch change).
- su segmento circoscrizione (o `✕` unico se solo circ attiva): rimuove tutto (circ e quartiere, dato che quartiere dipende dallo scope circ).

## File toccati
- `js/main.js`: wiring legende, mappa quartiere→circ, recompute rank, breadcrumb build/wire, `<title>` nei path/pallini donut.
- `css/style.css`: `.biv-dot-dim`, `.donut-dim`, stili breadcrumb.
- Nessun cambio a `js/filters.js`, `js/map.js`, `js/stats.js`, `geo/stats.json`.

## Fuori scope
- Filtro fontanella singola (select `#filter-fontanella`) non ha legenda propria, resta invariato.
- Ricerca testuale (`#filter-search`) non entra nella cascata legende/breadcrumb.
- Nessuna persistenza filtro tra sessioni (no URL param, no localStorage).

## Test manuale (no test automatici nel repo)
1. Click circoscrizione nel donut → mappa filtrata, rank quartieri mostra solo quartieri di quella circ, biv-grid dimma pallini altre circ, breadcrumb mostra "Circ. X ✕".
2. Da lì, click riga rank quartiere → mappa filtrata a circ+quartiere, breadcrumb mostra "Circ. X › Quartiere Y ✕✕", circ resta quella corretta (non si azzera).
3. Click ✕ sul quartiere nel breadcrumb → torna a solo circ attiva, rank/biv-grid tornano a mostrare l'intera circoscrizione.
4. Click ✕ sulla circoscrizione → tutto reset, pannelli tornano alla vista globale.
5. Hover su ogni porzione del donut → tooltip nativo mostra "Circ. {numero}".
