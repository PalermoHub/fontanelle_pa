# Legende stats come filtri a cascata interconnessi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le legende del pannello stats (donut, rank quartieri, griglia bivariata) diventano filtri interconnessi a cascata: click su un livello restringe lo scope senza azzerare i livelli superiori, i pannelli si aggiornano/dimmano di conseguenza, un breadcrumb mostra e permette di rimuovere i filtri attivi, e il donut mostra un tooltip col nome della circoscrizione su ogni porzione.

**Architecture:** Nessun nuovo store di stato: `#filter-circoscrizione`/`#filter-quartiere` (già cascata "narrow only" via `refreshCascadeOptions`) restano l'unica fonte di verità. Le legende dispatchano `change` su questi select invece di manipolarli in modo mutuamente esclusivo. Dopo ogni `applyFilters`, un nuovo `refreshStatsScope` ricalcola il rank quartieri da `fontanelle.geojson` live (non più da `stats.json`), dimma le porzioni fuori scope e aggiorna il breadcrumb.

**Tech Stack:** Vanilla JS (ES modules), MapLibre GL, nessun bundler/test runner nel repo — verifica manuale in browser via `http-server` (richiesto per il supporto Range su PMTiles, vedi memoria progetto).

## Global Constraints

- Nessun cambio a `js/filters.js`, `js/map.js`, `js/stats.js`, `geo/stats.json` (spec: fuori scope).
- Nessuna persistenza filtro tra sessioni (no URL param, no localStorage).
- Il filtro `#filter-fontanella` e la ricerca testuale (`#filter-search`) restano fuori dal breadcrumb/cascata legende.
- Tutto il testo utente (tooltip, breadcrumb) in italiano, coerente con lo stile esistente ("Circ. {numero}").
- Commenti nel codice solo dove il perché non è ovvio (workaround, invariante) — niente commenti descrittivi di cosa fa il codice.

---

## File Structure

- Modifica: `js/main.js` — tooltip donut, mappa quartiere→circoscrizione, fix wiring click rank, ricalcolo scoped del rank, dimming, breadcrumb. Nessun file nuovo: le funzioni aggiuntive sono piccole e vivono accanto alle funzioni `build*`/`wire*` che estendono.
- Modifica: `css/style.css` — classi `.donut-dim`, `.biv-dot-dim`, blocco breadcrumb.
- Nessuna modifica a `index.html` (il contenitore breadcrumb viene iniettato da `renderStatsPanel`, già responsabile di generare tutto `#stats-block`).

---

### Task 1: Tooltip nome circoscrizione sul donut

**Files:**
- Modify: `js/main.js:54-94` (`buildCircoscrizioneDonut`)

**Interfaces:**
- Consumes: nessuna dipendenza da altri task.
- Produces: nessuna funzione nuova esposta; solo markup arricchito, riusato tale e quale dai task successivi (dimming aggiungerà classi sugli stessi nodi `.donut-seg`/`.donut-leg-row`).

- [ ] **Step 1: Aggiungi `<title>` al path SVG e attributo `title` alla riga legenda**

In `js/main.js`, dentro `buildCircoscrizioneDonut` (righe 73-85), modifica:

```js
    paths.push(
      `<path d="M${x1},${y1} A${R},${R} 0 ${largeArc},1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${largeArc},0 ${x4},${y4} Z" fill="${color}" data-circ="${escHtml(circoscrizione)}" class="donut-seg"><title>Circ. ${escHtml(circoscrizione)}</title></path>`
    );

    const pct = ((count / total) * 100).toFixed(0);
    const barW = Math.round((count / total) * 40);
    legRows.push(`<div class="donut-leg-row" data-circ="${escHtml(circoscrizione)}" title="Circ. ${escHtml(circoscrizione)}">
      <div class="donut-dot" style="background:${color}"></div>
      <span class="donut-leg-label">Circ. ${escHtml(circoscrizione)}</span>
      <div class="donut-leg-bar-wrap"><div class="donut-leg-bar" style="width:${barW}px;background:${color}"></div></div>
      <span class="donut-leg-count">${count}</span>
      <span class="donut-leg-pct">${pct}%</span>
    </div>`);
```

(unica differenza dall'originale: `<title>...</title>` dentro il `<path>`, e attributo `title="..."` sul `div.donut-leg-row`.)

- [ ] **Step 2: Verifica manuale in browser**

Avvia il server statico (dalla root del repo):

```bash
npx http-server . -p 8080
```

Apri `http://localhost:8080`, apri il pannello stats, passa il mouse su una porzione dell'anello del donut per almeno 1 secondo: deve comparire il tooltip nativo del browser con testo "Circ. {numero}". Ripeti sulla riga legenda sotto il donut.

- [ ] **Step 3: Commit**

```bash
git add js/main.js
git commit -m "$(cat <<'EOF'
Aggiunge tooltip circoscrizione alle porzioni del donut stats

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Mappa quartiere→circoscrizione e fix click rank quartiere (no reset)

**Files:**
- Modify: `js/main.js:96-127` (`buildQuartiereRanking`, invariata — solo riferimento)
- Modify: `js/main.js:231-256` (`wireStatsInteractions`)
- Modify: `js/main.js:258-291` (`renderStatsPanel` — nuova firma con `fontanelle`)
- Modify: `js/main.js:718-723` (`main()` — passa `fontanelle` a `renderStatsPanel`)

**Interfaces:**
- Consumes: `fontanelle` è la `FeatureCollection` GeoJSON già caricata in `main()` da `loadFontanelle()` (`js/data.js`), con `properties.quartiere` e `properties.circoscrizione` su ogni feature (verificato in `geo/fontanelle.geojson`).
- Produces: `buildQuartiereCircMap(fontanelle) → Map<string, string>` (quartiere → circoscrizione), usata anche nei Task 3 e 5. `wireStatsInteractions(root, fontanelle)` — nuova firma, usata anche nei Task 3/4/5.

- [ ] **Step 1: Aggiungi `buildQuartiereCircMap` sopra `wireStatsInteractions`**

In `js/main.js`, subito prima della funzione `wireStatsInteractions` (riga 231), aggiungi:

```js
// Il quartiere non ha la propria circoscrizione in stats.json (conteggi
// aggregati piatti): la deriviamo dai dati grezzi già caricati, dove ogni
// fontanella porta entrambe le proprietà.
function buildQuartiereCircMap(fontanelle) {
  const map = new Map();
  for (const f of fontanelle.features) {
    const { quartiere, circoscrizione } = f.properties;
    if (quartiere && circoscrizione && !map.has(quartiere)) {
      map.set(quartiere, circoscrizione);
    }
  }
  return map;
}
```

- [ ] **Step 2: Cambia firma di `wireStatsInteractions` e correggi il click sulla riga quartiere**

Sostituisci l'intera funzione `wireStatsInteractions` (righe 231-256) con:

```js
// Click su segmento/legenda donut o riga classifica → riusa i filtri
// circoscrizione/quartiere già esistenti (stesso comportamento del
// pannello bivariate: "clicca per filtrare la mappa"). Il click sulla
// riga quartiere NON azzera più la circoscrizione: deriva quella del
// quartiere cliccato e la applica solo se diversa da quella attiva,
// così i due livelli si compongono invece di escludersi a vicenda.
function wireStatsInteractions(root, fontanelle) {
  const quartiereCircMap = buildQuartiereCircMap(fontanelle);

  root.querySelectorAll("[data-circ]").forEach((node) => {
    node.addEventListener("click", () => {
      const select = document.querySelector("#filter-circoscrizione");
      select.value = select.value === node.dataset.circ ? "" : node.dataset.circ;
      select.dispatchEvent(new Event("change"));
    });
  });
  root.querySelectorAll("[data-quartiere]").forEach((node) => {
    node.addEventListener("click", () => {
      const circoscrizioneSelect = document.querySelector("#filter-circoscrizione");
      const quartiereSelect = document.querySelector("#filter-quartiere");
      const quartiere = node.dataset.quartiere;

      if (quartiereSelect.value === quartiere) {
        quartiereSelect.value = "";
        quartiereSelect.dispatchEvent(new Event("change"));
        return;
      }

      const targetCirc = quartiereCircMap.get(quartiere) || "";
      if (circoscrizioneSelect.value !== targetCirc) {
        circoscrizioneSelect.value = targetCirc;
        circoscrizioneSelect.dispatchEvent(new Event("change"));
      }
      quartiereSelect.value = quartiere;
      quartiereSelect.dispatchEvent(new Event("change"));
    });
  });
  root.querySelectorAll(".rank-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.closest(".rank-section");
      const expanded = section.classList.toggle("rank-expanded");
      btn.textContent = expanded ? btn.dataset.expandedLabel : btn.dataset.collapsedLabel;
    });
  });
}
```

- [ ] **Step 3: Passa `fontanelle` a `renderStatsPanel` e al suo call site**

In `js/main.js`, riga 258, cambia la firma:

```js
function renderStatsPanel(viewModel, fontanelle) {
```

Riga 290 (fine funzione, chiamata a `wireStatsInteractions`):

```js
  wireStatsInteractions(statsBlock, fontanelle);
```

In `main()` (riga 723), cambia la chiamata:

```js
  renderStatsPanel(buildStatsViewModel(stats), fontanelle);
```

(`fontanelle` è già in scope a quel punto, caricata a riga 718.)

- [ ] **Step 4: Verifica manuale in browser**

Con il server già avviato (Task 1), ricarica la pagina:
1. Click su "Circ. III" nel donut → mappa filtrata, select `#filter-circoscrizione` mostra "III".
2. Click su una riga della classifica quartieri appartenente a un'altra circoscrizione (es. un quartiere della circ "VII") → il select circoscrizione passa a "VII" (non si azzera), il select quartiere mostra il quartiere cliccato, la mappa mostra solo quella circoscrizione+quartiere.
3. Ri-clicca la stessa riga quartiere → il quartiere si deseleziona, la circoscrizione resta "VII".
4. Apri la console browser (F12): nessun errore.

- [ ] **Step 5: Commit**

```bash
git add js/main.js
git commit -m "$(cat <<'EOF'
Fix click riga quartiere: non azzera più la circoscrizione attiva

Deriva la circoscrizione del quartiere cliccato da una mappa
quartiere→circoscrizione costruita dai dati grezzi fontanelle, così
i due livelli di filtro si compongono a cascata invece di escludersi.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Ricalcolo scoped del rank quartieri da dati live

**Files:**
- Modify: `js/main.js:258-291` (`renderStatsPanel` — avvolge il rank in un contenitore con id)
- Modify: `js/main.js` (nuove funzioni `computeQuartiereCounts`, `refreshStatsScope`)
- Modify: `js/main.js:562-602` (`wireFilters`/`applyFilters` — chiama `refreshStatsScope` a fine `applyFilters`)

**Interfaces:**
- Consumes: `buildQuartiereRanking(rows)` (Task esistente, invariata), `wireStatsInteractions(root, fontanelle)` (Task 2), `buildQuartiereCircMap` (Task 2, uso interno di `wireStatsInteractions`).
- Produces: `computeQuartiereCounts(fontanelle, circoscrizione) → Array<{quartiere, count}>` ordinato per count decrescente. `refreshStatsScope(fontanelle) → void`, chiamata anche dai Task 4 e 5 (dimming e breadcrumb vivono dentro questa funzione).

- [ ] **Step 1: Avvolgi il rank quartieri in un contenitore identificabile**

In `js/main.js`, dentro `renderStatsPanel` (righe 278-280), cambia:

```js
    <hr class="sep">
    <div class="fsec">
      ${buildQuartiereRanking(viewModel.perQuartiere)}
    </div>
```

in:

```js
    <hr class="sep">
    <div class="fsec">
      <div id="quartiere-rank-container">${buildQuartiereRanking(viewModel.perQuartiere)}</div>
    </div>
```

- [ ] **Step 2: Aggiungi `computeQuartiereCounts`**

Subito sotto `buildQuartiereCircMap` (aggiunta nel Task 2), aggiungi:

```js
// Sostituisce viewModel.perQuartiere (aggregato globale da stats.json)
// quando è attivo un filtro circoscrizione: ricalcola dai dati live così
// il pannello resta sempre coerente con ciò che la mappa mostra.
function computeQuartiereCounts(fontanelle, circoscrizione) {
  const counts = new Map();
  for (const f of fontanelle.features) {
    const { quartiere, circoscrizione: circ } = f.properties;
    if (!quartiere) continue;
    if (circoscrizione && circ !== circoscrizione) continue;
    counts.set(quartiere, (counts.get(quartiere) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([quartiere, count]) => ({ quartiere, count }))
    .sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 3: Aggiungi `refreshStatsScope` (senza ancora dimming/breadcrumb, aggiunti nei Task 4/5)**

Subito sotto `computeQuartiereCounts`, aggiungi:

```js
function refreshStatsScope(fontanelle) {
  const circoscrizioneSelect = document.querySelector("#filter-circoscrizione");
  const container = document.querySelector("#quartiere-rank-container");
  if (!container) return;

  const circ = circoscrizioneSelect.value;
  container.innerHTML = buildQuartiereRanking(computeQuartiereCounts(fontanelle, circ));
  wireStatsInteractions(container, fontanelle);
}
```

- [ ] **Step 4: Chiama `refreshStatsScope` a fine `applyFilters`**

In `js/main.js`, dentro `wireFilters` (righe 570-586), aggiungi la chiamata in fondo ad `applyFilters`:

```js
  function applyFilters() {
    const { circoscrizioneSelect, quartiereSelect, searchInput, fontanellaSelect } = selection.filterInputs;
    const expression = buildFontanelleFilterExpression({
      circoscrizione: circoscrizioneSelect.value,
      quartiere: quartiereSelect.value,
      query: searchInput.value,
      fontanellaId: fontanellaSelect.value,
    });
    setFontanelleFilter(map, expression);
    refreshIsochroneCopertura(map, fontanelle, selection);
    zoomToFilteredFeatures(map, fontanelle, {
      circoscrizione: circoscrizioneSelect.value,
      quartiere: quartiereSelect.value,
      query: searchInput.value,
      fontanellaId: fontanellaSelect.value,
    });
    refreshStatsScope(fontanelle);
  }
```

(`fontanelle` è già un parametro di `wireFilters(map, fontanelle, selection)`, quindi è in scope.)

- [ ] **Step 5: Verifica manuale in browser**

Ricarica la pagina:
1. Click "Circ. I" nel donut → la classifica quartieri sotto mostra solo quartieri della circ I (confronta con `geo/fontanelle.geojson`: i quartieri con `circoscrizione: "I"`), non più tutti gli 8.
2. Click di nuovo "Circ. I" (toggle off) → la classifica torna a mostrare tutti i quartieri della città.
3. Click su una riga quartiere dentro lo scope filtrato → funziona come nel Task 2 (nessuna regressione).
4. Console browser senza errori.

- [ ] **Step 6: Commit**

```bash
git add js/main.js
git commit -m "$(cat <<'EOF'
Ricalcola il rank quartieri dallo scope circoscrizione attivo

Il pannello classifica quartieri ora si ricalcola dai dati live
fontanelle (non più dall'aggregato statico stats.json) ogni volta
che cambia il filtro circoscrizione, restando coerente con la mappa.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Dimming donut/griglia bivariata fuori scope

**Files:**
- Modify: `css/style.css` (nuove classi `.donut-dim`, `.donut-leg-row.donut-dim`, `.biv-dot-dim`)
- Modify: `js/main.js` (nuova funzione `updateStatsDimming`, chiamata da `refreshStatsScope`)

**Interfaces:**
- Consumes: `refreshStatsScope` (Task 3, la estende).
- Produces: `updateStatsDimming(circoscrizione) → void`, nessun altro task ne dipende.

- [ ] **Step 1: Aggiungi le classi CSS**

In `css/style.css`, subito dopo il blocco `.donut-seg:hover` (righe 996-999), aggiungi:

```css
.donut-seg.donut-dim {
  opacity: 0.25;
}

.donut-leg-row {
  transition: background 0.12s, opacity 0.15s;
}

.donut-leg-row.donut-dim {
  opacity: 0.4;
}
```

(la seconda regola `.donut-leg-row` ridichiara la proprietà esistente aggiungendo `opacity` alla transition; le proprietà `display/align-items/gap/padding/border-radius/cursor` restano quelle già definite alla riga 1017, CSS successivo vince solo su `transition`.)

Subito dopo il blocco `.biv-dot` (righe 927-939), aggiungi:

```css
.biv-dot {
  transition: opacity 0.15s;
}

.biv-dot-dim {
  opacity: 0.25;
}
```

- [ ] **Step 2: Aggiungi `updateStatsDimming` e chiamala da `refreshStatsScope`**

In `js/main.js`, subito sotto `refreshStatsScope` (aggiunta nel Task 3), aggiungi:

```js
function updateStatsDimming(circoscrizione) {
  document.querySelectorAll(".donut-seg[data-circ], .donut-leg-row[data-circ]").forEach((node) => {
    node.classList.toggle("donut-dim", Boolean(circoscrizione) && node.dataset.circ !== circoscrizione);
  });
  document.querySelectorAll(".biv-dot[data-circ]").forEach((node) => {
    node.classList.toggle("biv-dot-dim", Boolean(circoscrizione) && node.dataset.circ !== circoscrizione);
  });
}
```

Poi aggiorna `refreshStatsScope` (Task 3, Step 3) aggiungendo la chiamata in fondo:

```js
function refreshStatsScope(fontanelle) {
  const circoscrizioneSelect = document.querySelector("#filter-circoscrizione");
  const container = document.querySelector("#quartiere-rank-container");
  if (!container) return;

  const circ = circoscrizioneSelect.value;
  container.innerHTML = buildQuartiereRanking(computeQuartiereCounts(fontanelle, circ));
  wireStatsInteractions(container, fontanelle);
  updateStatsDimming(circ);
}
```

- [ ] **Step 3: Verifica manuale in browser**

Ricarica la pagina:
1. Click "Circ. II" nel donut → tutte le altre porzioni dell'anello e righe legenda si attenuano (opacity ridotta), "Circ. II" resta piena; nella griglia bivariata sotto, tutti i pallini tranne quello con etichetta "II" si attenuano.
2. Toggle off (click di nuovo "Circ. II") → tutto torna opaco al 100%.
3. Hover su un pallino attenuato → tooltip esistente (numeri) ancora leggibile (nessuna regressione sul `title` già presente su `.biv-dot`).

- [ ] **Step 4: Commit**

```bash
git add css/style.css js/main.js
git commit -m "$(cat <<'EOF'
Attenua donut e griglia bivariata fuori dalla circoscrizione filtrata

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Breadcrumb filtri attivi con rimozione per livello

**Files:**
- Modify: `js/main.js:258-291` (`renderStatsPanel` — inserisce il contenitore breadcrumb)
- Modify: `js/main.js` (nuova funzione `renderStatsBreadcrumb`, chiamata da `refreshStatsScope`)
- Modify: `css/style.css` (nuove classi `.stats-breadcrumb`, `.breadcrumb-item`, `.breadcrumb-sep`, `.breadcrumb-x`)

**Interfaces:**
- Consumes: `refreshStatsScope` (Task 3/4, la estende ulteriormente); `escHtml` (già definita in cima a `js/main.js:42-50`).
- Produces: `renderStatsBreadcrumb(circoscrizione, quartiere) → void`. Nessun altro task ne dipende (ultimo della sequenza).

- [ ] **Step 1: Aggiungi il contenitore breadcrumb nel markup**

In `js/main.js`, dentro `renderStatsPanel` (righe 264-268), inserisci il contenitore subito dopo il subtitle:

```js
  statsBlock.innerHTML = `
    <h2>Fontanelle Palermo</h2>
    <p class="panel-subtitle">Un progetto per scoprire le fontanelle di acqua potabile</p>
    <div id="stats-breadcrumb" class="stats-breadcrumb" hidden></div>
    <p>Puoi non usare l'acqua imbottigliata nella plastica, puoi usare l'acqua pubblica: scopri le fontanelle più vicine a te e aiutaci a scoprire quanto sarebbe bella Palermo senza le montagne di plastica.</p>
```

- [ ] **Step 2: Aggiungi le classi CSS**

In `css/style.css`, in fondo al blocco stats (dopo `.rank-toggle:hover`, circa riga 1206), aggiungi:

```css
.stats-breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.3rem;
  font-size: 0.68rem;
  padding: 0.35rem 0.5rem;
  margin: 0.4rem 0;
  background: rgba(127, 127, 127, 0.1);
  border-radius: 6px;
}

.breadcrumb-item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 600;
}

.breadcrumb-sep {
  opacity: 0.5;
}

.breadcrumb-x {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 0.7rem;
  opacity: 0.6;
  padding: 0 0.15rem;
  line-height: 1;
}

.breadcrumb-x:hover {
  opacity: 1;
}
```

- [ ] **Step 3: Aggiungi `renderStatsBreadcrumb` e chiamala da `refreshStatsScope`**

In `js/main.js`, subito sotto `updateStatsDimming` (aggiunta nel Task 4), aggiungi:

```js
// Rimuovere la circoscrizione azzera anche il quartiere: il quartiere
// dipende dallo scope circoscrizione (refreshCascadeOptions lo terrebbe
// altrimenti selezionato se il nome esiste anche fuori scope).
function renderStatsBreadcrumb(circoscrizione, quartiere) {
  const el = document.querySelector("#stats-breadcrumb");
  if (!el) return;

  if (!circoscrizione && !quartiere) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }

  const parts = [];
  if (circoscrizione) {
    parts.push(
      `<span class="breadcrumb-item">Circ. ${escHtml(circoscrizione)}<button type="button" class="breadcrumb-x" data-clear="circ" title="Rimuovi filtro circoscrizione">✕</button></span>`
    );
  }
  if (quartiere) {
    parts.push(`<span class="breadcrumb-sep">›</span>`);
    parts.push(
      `<span class="breadcrumb-item">${escHtml(quartiere)}<button type="button" class="breadcrumb-x" data-clear="quartiere" title="Rimuovi filtro quartiere">✕</button></span>`
    );
  }
  el.innerHTML = parts.join("");
  el.hidden = false;

  el.querySelectorAll("[data-clear]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const circoscrizioneSelect = document.querySelector("#filter-circoscrizione");
      const quartiereSelect = document.querySelector("#filter-quartiere");
      if (btn.dataset.clear === "circ") {
        quartiereSelect.value = "";
        circoscrizioneSelect.value = "";
        circoscrizioneSelect.dispatchEvent(new Event("change"));
      } else {
        quartiereSelect.value = "";
        quartiereSelect.dispatchEvent(new Event("change"));
      }
    });
  });
}
```

Poi aggiorna `refreshStatsScope` (versione finale) aggiungendo la chiamata:

```js
function refreshStatsScope(fontanelle) {
  const circoscrizioneSelect = document.querySelector("#filter-circoscrizione");
  const quartiereSelect = document.querySelector("#filter-quartiere");
  const container = document.querySelector("#quartiere-rank-container");
  if (!container) return;

  const circ = circoscrizioneSelect.value;
  container.innerHTML = buildQuartiereRanking(computeQuartiereCounts(fontanelle, circ));
  wireStatsInteractions(container, fontanelle);
  updateStatsDimming(circ);
  renderStatsBreadcrumb(circ, quartiereSelect.value);
}
```

- [ ] **Step 4: Verifica manuale in browser**

Ricarica la pagina:
1. Nessun filtro attivo → nessun breadcrumb visibile.
2. Click "Circ. IV" nel donut → breadcrumb mostra "Circ. IV ✕".
3. Click una riga quartiere di quella circoscrizione → breadcrumb mostra "Circ. IV ✕ › {quartiere} ✕".
4. Click la ✕ sul quartiere → breadcrumb torna a "Circ. IV ✕", rank quartieri e dimming donut/biv-grid restano scoped alla sola circ IV (nessuna regressione Task 3/4).
5. Click la ✕ sulla circoscrizione → breadcrumb sparisce, select circoscrizione e quartiere entrambi vuoti, rank/donut/biv-grid tornano alla vista globale.
6. Console browser senza errori in tutto il flusso.

- [ ] **Step 5: Commit**

```bash
git add js/main.js css/style.css
git commit -m "$(cat <<'EOF'
Aggiunge breadcrumb filtri attivi al pannello stats

Mostra circoscrizione/quartiere filtrati sopra le sezioni stats,
con rimozione per livello: la X sul quartiere toglie solo quello,
la X sulla circoscrizione azzera entrambi i livelli.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** tooltip donut (Task 1), fix reset quartiere→circ (Task 2), rank scoped live (Task 3), dimming donut+biv-grid (Task 4), breadcrumb con rimozione per livello (Task 5) — tutti i punti della spec `docs/superpowers/specs/2026-07-06-legende-filtri-cascata-design.md` coperti. Nessun cambio a `filters.js`/`map.js`/`stats.js`/`stats.json` in nessun task, come da vincolo.
- **Placeholder scan:** nessun TBD/TODO; ogni step ha codice completo o comando+output atteso concreto.
- **Type consistency:** `computeQuartiereCounts` produce `{quartiere, count}` — stesso shape consumato da `buildQuartiereRanking` (che già distruttura `{ quartiere, count }`, riga 108 esistente). `wireStatsInteractions(root, fontanelle)` firma coerente in tutti i call site (renderStatsPanel Task 2, refreshStatsScope Task 3). `refreshStatsScope(fontanelle)` stessa firma dal Task 3 in poi, solo il corpo cresce.
