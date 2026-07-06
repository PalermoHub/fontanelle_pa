// maplibre-gl è una globale (script classico in index.html), non un import ESM.
const maplibregl = window.maplibregl;
import {
  buildFontanelleFilterExpression,
  filterByCircoscrizione,
  filterByQuartiere,
  getMatchingFontanellaIds,
} from "./filters.js";
import { loadFontanelle, loadRoadNetwork, loadStats } from "./data.js";
import {
  clearIsochroneFilter,
  getCoperturaColorRamp,
  HOME_ZOOM,
  initMap,
  PALERMO_CENTER,
  setBasemapTheme,
  setCoperturaFilterActive,
  setCoperturaHoverFilter,
  setFontanelleFilter,
  setIsochroneFilterByIds,
  setIsochroneVisibility,
  setIsochroneVisibilityOverride,
  setRouteLine,
} from "./map.js";
import { buildRoutingIndex, findRouteToNearestFontanella } from "./routing.js";
import { buildStatsViewModel } from "./stats.js";
import { wireSearch } from "./search.js";

// Colore fisso per circoscrizione (I-VIII), usato da donut e legenda —
// coerente con i toni blu/arancio già impiegati nella toolbar isocrone.
const CIRC_COLORS = {
  I: "#4d90c2",
  II: "#d9713c",
  III: "#5cb85c",
  IV: "#9b59b6",
  V: "#e91e63",
  VI: "#f0ad4e",
  VII: "#00acc1",
  VIII: "#8d6e63",
};

function escHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

// Grafico ad anello: stessa geometria (raggi/angoli) del pannello dx di
// bivariate/tpl, riadattata alle 8 circoscrizioni di Palermo.
function buildCircoscrizioneDonut(rows) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (total === 0) return "";

  const R = 45, r = 28, cx = 65, cy = 65;
  let startAngle = -Math.PI / 2;
  const paths = [];
  const legRows = [];

  for (const { circoscrizione, count } of rows) {
    if (count === 0) continue;
    const color = CIRC_COLORS[circoscrizione] || "#999";
    const angle = (count / total) * 2 * Math.PI;
    const end = startAngle + angle;
    const x1 = cx + R * Math.cos(startAngle), y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(end), y2 = cy + R * Math.sin(end);
    const x3 = cx + r * Math.cos(end), y3 = cy + r * Math.sin(end);
    const x4 = cx + r * Math.cos(startAngle), y4 = cy + r * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    paths.push(
      `<path d="M${x1},${y1} A${R},${R} 0 ${largeArc},1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${largeArc},0 ${x4},${y4} Z" fill="${color}" data-circ="${escHtml(circoscrizione)}" class="donut-seg"/>`
    );

    const pct = ((count / total) * 100).toFixed(0);
    const barW = Math.round((count / total) * 40);
    legRows.push(`<div class="donut-leg-row" data-circ="${escHtml(circoscrizione)}">
      <div class="donut-dot" style="background:${color}"></div>
      <span class="donut-leg-label">Circ. ${escHtml(circoscrizione)}</span>
      <div class="donut-leg-bar-wrap"><div class="donut-leg-bar" style="width:${barW}px;background:${color}"></div></div>
      <span class="donut-leg-count">${count}</span>
      <span class="donut-leg-pct">${pct}%</span>
    </div>`);

    startAngle = end;
  }

  return `<div class="donut-card">
    <div class="donut-svg-wrap"><svg class="donut-svg" viewBox="0 0 130 130">${paths.join("")}<text x="${cx}" y="${cy - 5}" text-anchor="middle" class="donut-total">${total}</text><text x="${cx}" y="${cy + 11}" text-anchor="middle" class="donut-label">fontanelle</text></svg></div>
    <div class="donut-legend">${legRows.join("")}</div>
  </div>`;
}

// Grafico a classifica: stessa struttura .rank-section/.rank-row del
// pannello dx di bivariate/tpl, con i primi 5 quartieri per numero di fontanelle.
function buildQuartiereRanking(rows) {
  const top = rows.slice(0, 5);
  if (top.length === 0) return "";
  const max = top[0].count;

  const rowsHtml = top
    .map(
      ({ quartiere, count }, i) => `<div class="rank-row rank-clickable" data-quartiere="${escHtml(quartiere)}">
        <div class="rank-num">${i + 1}</div>
        <div class="rank-name" title="${escHtml(quartiere)}">${escHtml(quartiere)}</div>
        <div class="rank-bar-wrap"><div class="rank-bar" style="width:${max > 0 ? Math.round((count / max) * 50) : 0}px;background:#4d90c2"></div></div>
        <div class="rank-val">${count}</div>
      </div>`
    )
    .join("");

  return `<div class="rank-section">
    <div class="rank-hdr">Top quartieri<span class="rank-hdr-unit">fontanelle</span></div>
    ${rowsHtml}
  </div>`;
}

// Click su segmento/legenda donut o riga classifica → riusa i filtri
// circoscrizione/quartiere già esistenti (stesso comportamento del
// pannello bivariate: "clicca per filtrare la mappa").
function wireStatsInteractions(root) {
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
      circoscrizioneSelect.value = "";
      circoscrizioneSelect.dispatchEvent(new Event("change"));
      quartiereSelect.value = node.dataset.quartiere;
      quartiereSelect.dispatchEvent(new Event("change"));
    });
  });
}

function renderStatsPanel(viewModel) {
  const el = document.querySelector("#panel-content");
  if (!el) return;

  const statsBlock = document.createElement("div");
  statsBlock.id = "stats-block";
  statsBlock.innerHTML = `
    <h2>Fontanelle Palermo</h2>
    <p class="panel-subtitle">Un progetto per scoprire le fontanelle di acqua potabile</p>
    <p>Puoi non usare l'acqua imbottigliata nella plastica, puoi usare l'acqua pubblica: scopri le fontanelle più vicine a te e aiutaci a scoprire quanto sarebbe bella Palermo senza le montagne di plastica.</p>
    <div class="fsec">
      <h3>Distribuzione per circoscrizione</h3>
      ${buildCircoscrizioneDonut(viewModel.perCircoscrizione)}
      <div class="stats-inline">
        <span><strong>${viewModel.totale}</strong> fontanelle</span>
        <span><strong>${viewModel.numCircoscrizioni}</strong> circoscrizioni</span>
        <span><strong>${viewModel.numQuartieri}</strong> quartieri</span>
      </div>
    </div>
    <hr class="sep">
    <div class="fsec">
      ${buildQuartiereRanking(viewModel.perQuartiere)}
    </div>
    <hr class="sep">
    <div class="fsec">
      <table class="stats-table">
        <thead>
          <tr><th>circoscrizione</th><th>fontanelle</th><th>residenti</th><th>residenti/ fontanella</th></tr>
        </thead>
        <tbody>
          <tr><td>I</td><td>25</td><td>26.685</td><td>1.067</td></tr>
          <tr><td>VII</td><td>39</td><td>78.533</td><td>2.013</td></tr>
          <tr><td>II</td><td>26</td><td>73.483</td><td>2.826</td></tr>
          <tr><td>IV</td><td>21</td><td>103.058</td><td>4.907</td></tr>
          <tr><td>III</td><td>9</td><td>74.825</td><td>8.313</td></tr>
          <tr><td>VI</td><td>8</td><td>73.241</td><td>9.155</td></tr>
          <tr><td>VIII</td><td>12</td><td>121.262</td><td>10.105</td></tr>
          <tr><td>V</td><td>10</td><td>114.443</td><td>11.444</td></tr>
        </tbody>
      </table>
      <p>Per alcune bastano <strong>5 minuti</strong> a piedi, se ti piace camminare, in <strong>10 minuti</strong> sono ancora di più da tutta la città almeno una in auto in 5 minuti</p>
      <p>Se in un anno l'1% degli abitanti di Palermo cambiasse abitudini 1.500.000 bottiglie di plastica non verrebbero consumate!</p>
    </div>
  `;
  el.appendChild(statsBlock);
  wireStatsInteractions(statsBlock);
}

function wirePanelTabs() {
  const tabs = document.querySelectorAll(".panel-tab");
  const panes = document.querySelectorAll(".panel-tab-pane");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      panes.forEach((pane) => {
        const active = pane.dataset.pane === tab.dataset.tab;
        pane.classList.toggle("active", active);
        pane.hidden = !active;
      });
    });
  });
}

function wirePlasticFreeGallery() {
  const lightbox = document.getElementById("pf-lightbox");
  const lightboxImg = document.getElementById("pf-lightbox-img");
  const lightboxCaption = document.getElementById("pf-lightbox-caption");
  const closeBtn = lightbox?.querySelector(".pf-lightbox-close");
  if (!lightbox || !lightboxImg || !lightboxCaption || !closeBtn) return;

  function open(src, caption) {
    lightboxImg.src = src;
    lightboxImg.alt = caption;
    lightboxCaption.textContent = caption;
    lightbox.hidden = false;
  }

  function close() {
    lightbox.hidden = true;
    lightboxImg.src = "";
  }

  document.querySelectorAll(".pf-thumb").forEach((thumb) => {
    thumb.addEventListener("click", () => {
      const img = thumb.querySelector("img");
      open(img.src, thumb.dataset.caption || img.alt);
    });
  });

  closeBtn.addEventListener("click", close);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.hidden) close();
  });
}

function wirePanelToggle() {
  const panelEl = document.getElementById("panel");
  const toggleBtn = document.getElementById("panel-toggle");
  if (!panelEl || !toggleBtn) return;

  function setPanelOpen(open) {
    panelEl.classList.toggle("closed", !open);
    document.body.classList.toggle("panel-closed", !open);
    toggleBtn.textContent = open ? "›" : "‹";
    toggleBtn.title = open ? "Chiudi pannello" : "Apri pannello";
  }

  toggleBtn.addEventListener("click", () =>
    setPanelOpen(panelEl.classList.contains("closed"))
  );
}

function addSelectOption(selectEl, value) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = value;
  selectEl.appendChild(option);
}

function addFontanellaOption(selectEl, id, label) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = label;
  selectEl.appendChild(option);
}

function resetSelectOptions(selectEl) {
  const placeholder = selectEl.querySelector("option[value='']");
  selectEl.innerHTML = "";
  selectEl.appendChild(placeholder || new Option("", ""));
}

function populateFilterOptions(fontanelle) {
  const circoscrizioneSelect = document.querySelector("#filter-circoscrizione");
  const circoscrizioni = new Set();
  for (const f of fontanelle.features) {
    if (f.properties.circoscrizione) circoscrizioni.add(f.properties.circoscrizione);
  }
  for (const value of [...circoscrizioni].sort()) {
    addSelectOption(circoscrizioneSelect, value);
  }

  refreshCascadeOptions(fontanelle);
}

// Quartiere è ristretto alla circoscrizione scelta, fontanella è ristretta a
// circoscrizione+quartiere: mantengono coerenza a cascata senza auto-fill
// all'indietro (vedi decisione utente: "narrow only").
function refreshCascadeOptions(fontanelle) {
  const circoscrizioneSelect = document.querySelector("#filter-circoscrizione");
  const quartiereSelect = document.querySelector("#filter-quartiere");
  const fontanellaSelect = document.querySelector("#filter-fontanella");

  const scopedToCircoscrizione = filterByCircoscrizione(fontanelle, circoscrizioneSelect.value);

  const previousQuartiere = quartiereSelect.value;
  const quartieri = new Set();
  for (const f of scopedToCircoscrizione.features) {
    if (f.properties.quartiere) quartieri.add(f.properties.quartiere);
  }
  resetSelectOptions(quartiereSelect);
  for (const value of [...quartieri].sort()) {
    addSelectOption(quartiereSelect, value);
  }
  quartiereSelect.value = quartieri.has(previousQuartiere) ? previousQuartiere : "";

  const scopedToQuartiere = filterByQuartiere(scopedToCircoscrizione, quartiereSelect.value);
  const previousFontanella = fontanellaSelect.value;
  const fontanelleSorted = [...scopedToQuartiere.features].sort((a, b) =>
    (a.properties.indirizzo || "").localeCompare(b.properties.indirizzo || "")
  );
  resetSelectOptions(fontanellaSelect);
  for (const f of fontanelleSorted) {
    addFontanellaOption(fontanellaSelect, f.properties.id, f.properties.indirizzo || f.properties.id);
  }
  const validIds = new Set(fontanelleSorted.map((f) => f.properties.id));
  fontanellaSelect.value = validIds.has(previousFontanella) ? previousFontanella : "";
}

function getCoperturaToggleStates() {
  const states = {};
  document.querySelectorAll("[data-copertura-toggle]").forEach((input) => {
    states[Number(input.dataset.coperturaToggle)] = input.checked;
  });
  return states;
}

function getIsochroneToggleStates() {
  const states = {};
  document.querySelectorAll("[data-isochrone-toggle]").forEach((input) => {
    states[Number(input.dataset.isochroneToggle)] = input.checked;
  });
  return states;
}

function buildCoperturaLegendBlock(minutes) {
  const ramp = getCoperturaColorRamp(minutes);
  const block = document.createElement("div");
  block.className = "copertura-legend-block";

  const title = document.createElement("div");
  title.className = "copertura-legend-title";
  title.textContent = `Copertura ${minutes} min — n. fontanelle raggiungibili`;
  block.appendChild(title);

  const bar = document.createElement("div");
  bar.className = "copertura-legend-bar";
  for (const color of ramp) {
    const step = document.createElement("span");
    step.style.background = color;
    bar.appendChild(step);
  }
  block.appendChild(bar);

  const scale = document.createElement("div");
  scale.className = "copertura-legend-scale";
  const min = document.createElement("span");
  min.textContent = "1";
  const max = document.createElement("span");
  max.textContent = `${ramp.length}+`;
  scale.append(min, max);
  block.appendChild(scale);

  return block;
}

function refreshCoperturaLegend(visibleMinutes) {
  const legend = document.querySelector("#copertura-legend");
  legend.innerHTML = "";
  for (const minutes of visibleMinutes) {
    legend.appendChild(buildCoperturaLegendBlock(minutes));
  }
  legend.hidden = visibleMinutes.length === 0;
}

function refreshIsochroneCopertura(map, fontanelle, selection) {
  const toggleStates = getCoperturaToggleStates();
  const isochroneToggleStates = getIsochroneToggleStates();

  if (selection.hoveredFontanellaId) {
    setIsochroneVisibility(map, 5, false);
    setIsochroneVisibility(map, 10, false);
    setCoperturaHoverFilter(map, selection.hoveredFontanellaId);
    refreshCoperturaLegend([5, 10]);
    return;
  }
  setCoperturaHoverFilter(map, null);

  if (selection.selectedFontanellaId) {
    setIsochroneVisibilityOverride(map, true, isochroneToggleStates);
    setIsochroneFilterByIds(map, [selection.selectedFontanellaId]);
    setCoperturaFilterActive(map, true, toggleStates);
    refreshCoperturaLegend([]);
    return;
  }

  const filters = {
    circoscrizione: selection.filterInputs.circoscrizioneSelect.value,
    quartiere: selection.filterInputs.quartiereSelect.value,
    query: selection.filterInputs.searchInput.value,
    fontanellaId: selection.filterInputs.fontanellaSelect.value,
  };
  const hasActiveFilter = Boolean(
    filters.circoscrizione || filters.quartiere || filters.query.trim() || filters.fontanellaId
  );

  setIsochroneVisibilityOverride(map, hasActiveFilter, isochroneToggleStates);
  if (hasActiveFilter) {
    setIsochroneFilterByIds(map, getMatchingFontanellaIds(fontanelle, filters));
  } else {
    clearIsochroneFilter(map);
  }
  setCoperturaFilterActive(map, hasActiveFilter, toggleStates);
  refreshCoperturaLegend(hasActiveFilter ? [] : [5, 10].filter((minutes) => toggleStates[minutes]));
}

function wireIsochroneToggles(map, selection) {
  document.querySelectorAll("[data-isochrone-toggle]").forEach((input) => {
    setIsochroneVisibility(map, Number(input.dataset.isochroneToggle), input.checked);
    input.addEventListener("change", (e) => {
      setIsochroneVisibility(map, Number(e.target.dataset.isochroneToggle), e.target.checked);
    });
  });
  document.querySelectorAll("[data-copertura-toggle]").forEach((input) => {
    input.addEventListener("change", () => selection.refresh());
  });
}

function zoomToFilteredFeatures(map, fontanelle, filters) {
  const hasActiveFilter = Boolean(
    filters.circoscrizione || filters.quartiere || filters.query.trim() || filters.fontanellaId
  );
  if (!hasActiveFilter) return;

  const matchingIds = new Set(getMatchingFontanellaIds(fontanelle, filters));
  const matched = fontanelle.features.filter((f) => matchingIds.has(f.properties.id));
  if (matched.length === 0) return;

  if (matched.length === 1) {
    map.flyTo({ center: matched[0].geometry.coordinates, zoom: 16 });
    return;
  }

  const bounds = new maplibregl.LngLatBounds();
  for (const f of matched) {
    bounds.extend(f.geometry.coordinates);
  }
  map.fitBounds(bounds, { padding: 60, maxZoom: 16 });
}

function wireFilters(map, fontanelle, selection) {
  selection.filterInputs = {
    circoscrizioneSelect: document.querySelector("#filter-circoscrizione"),
    quartiereSelect: document.querySelector("#filter-quartiere"),
    searchInput: document.querySelector("#filter-search"),
    fontanellaSelect: document.querySelector("#filter-fontanella"),
  };

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
  }

  selection.refresh = applyFilters;
  selection.refreshCascade = () => refreshCascadeOptions(fontanelle);

  const { circoscrizioneSelect, quartiereSelect, searchInput, fontanellaSelect } = selection.filterInputs;
  circoscrizioneSelect.addEventListener("change", () => {
    refreshCascadeOptions(fontanelle);
    applyFilters();
  });
  quartiereSelect.addEventListener("change", () => {
    refreshCascadeOptions(fontanelle);
    applyFilters();
  });
  searchInput.addEventListener("input", applyFilters);
  fontanellaSelect.addEventListener("change", applyFilters);
}

function wireMapToolbar(map) {
  document.querySelector("#btn-home").addEventListener("click", () => {
    map.flyTo({ center: PALERMO_CENTER, zoom: HOME_ZOOM });
  });

  document.querySelector("#btn-fs").addEventListener("click", () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  });

  const zoomSlider = document.querySelector("#zoom-slider");
  const zoomBadge = document.querySelector("#zoom-badge");
  zoomSlider.addEventListener("input", () => {
    map.setZoom(+zoomSlider.value);
  });
  map.on("zoom", () => {
    const z = map.getZoom();
    zoomSlider.value = z;
    zoomBadge.textContent = z.toFixed(1);
  });

  const themeButtons = {
    light: document.querySelector("#btn-theme-light"),
    dark: document.querySelector("#btn-theme-dark"),
    satellite: document.querySelector("#btn-theme-satellite"),
  };
  function applyTheme(theme) {
    Object.entries(themeButtons).forEach(([key, btn]) => btn.classList.toggle("active", key === theme));
    document.body.classList.remove("theme-light", "theme-dark", "theme-satellite");
    document.body.classList.add(`theme-${theme}`);
    setBasemapTheme(map, theme);
    localStorage.setItem("fontanelle-theme", theme);
  }
  Object.entries(themeButtons).forEach(([key, btn]) => {
    btn.addEventListener("click", () => applyTheme(key));
  });
  applyTheme(localStorage.getItem("fontanelle-theme") || "light");
}

function wireGeolocation(map) {
  const button = document.querySelector("#locate-nearest");
  let routingIndex = null;
  let awaitingMapClick = false;

  async function getRoutingIndex() {
    if (!routingIndex) {
      const graph = await loadRoadNetwork();
      routingIndex = buildRoutingIndex(graph);
    }
    return routingIndex;
  }

  async function routeFrom(point) {
    const index = await getRoutingIndex();
    const route = findRouteToNearestFontanella(point, index);
    if (!route) {
      window.alert("Percorso non disponibile: nessuna fontanella raggiungibile da questo punto.");
      return;
    }
    setRouteLine(map, route.pathCoordinates);
    const bounds = route.pathCoordinates.reduce(
      (b, coord) => b.extend(coord),
      new maplibregl.LngLatBounds(route.pathCoordinates[0], route.pathCoordinates[0])
    );
    map.fitBounds(bounds, { padding: 60 });
  }

  button.addEventListener("click", () => {
    if (!navigator.geolocation) {
      window.alert("Geolocalizzazione non disponibile su questo browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        routeFrom([position.coords.longitude, position.coords.latitude]);
      },
      () => {
        window.alert(
          "Permesso di geolocalizzazione negato. Clicca sulla mappa per impostare il punto di partenza."
        );
        awaitingMapClick = true;
      }
    );
  });

  map.on("click", (e) => {
    if (!awaitingMapClick) return;
    awaitingMapClick = false;
    routeFrom([e.lngLat.lng, e.lngLat.lat]);
  });
}

async function main() {
  const selection = { selectedFontanellaId: null, hoveredFontanellaId: null, filterInputs: null, refresh: null };

  const map = await initMap({
    onFontanellaSelect: (id) => {
      selection.selectedFontanellaId = id;
      selection.refresh?.();
    },
    onFontanellaDeselect: () => {
      selection.selectedFontanellaId = null;
      selection.refresh?.();
    },
    onFontanellaHover: (id) => {
      if (selection.hoveredFontanellaId === id) return;
      selection.hoveredFontanellaId = id;
      selection.refresh?.();
    },
    onFontanellaHoverEnd: () => {
      selection.hoveredFontanellaId = null;
      selection.refresh?.();
    },
  });
  const fontanelle = await loadFontanelle();
  wireMapToolbar(map);
  const stats = await loadStats();

  populateFilterOptions(fontanelle);
  renderStatsPanel(buildStatsViewModel(stats));
  wirePanelTabs();
  wirePlasticFreeGallery();
  wirePanelToggle();
  wireIsochroneToggles(map, selection);
  wireFilters(map, fontanelle, selection);
  wireSearch({
    fontanelle,
    filterInputs: selection.filterInputs,
    refreshCascade: selection.refreshCascade,
    onApply: selection.refresh,
  });
  wireGeolocation(map);
}

main();
