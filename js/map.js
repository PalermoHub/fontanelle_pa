// maplibre-gl è caricato come <script> classico (vedi index.html), che
// crea la globale window.maplibregl: il bundle UMD non espone export ESM,
// quindi non può essere importato con un import map.
const maplibregl = window.maplibregl;
import { Protocol } from "pmtiles";
import { pmtilesUrl } from "./data.js";

export const PALERMO_CENTER = [13.3554, 38.1363];
export const HOME_ZOOM = 11.35;
const BASE_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const SATELLITE_STYLE = {
  version: 8,
  sources: {
    "google-satellite": {
      type: "raster",
      tiles: [
        "https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
        "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
        "https://mt2.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
        "https://mt3.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
      ],
      tileSize: 256,
      attribution: "© Google",
    },
  },
  layers: [{ id: "google-satellite", type: "raster", source: "google-satellite" }],
};
const THEME_STYLES = {
  light: BASE_STYLE,
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  satellite: SATELLITE_STYLE,
};

let protocolRegistered = false;

const FONTANELLA_POPUP_FIELDS = [
  ["indirizzo", "Indirizzo"],
  ["tipo_ubicazione", "Tipo"],
  ["denominazione", "Denominazione"],
  ["civico", "Civico"],
  ["quartiere", "Quartiere"],
  ["upl", "UPL"],
  ["circoscrizione", "Circoscrizione"],
  ["note", "Note"],
  ["id", "ID fontanella"],
];

function buildFontanellaTooltipContent(properties) {
  const container = document.createElement("div");
  container.className = "fontanella-tooltip";

  const label = document.createElement("strong");
  label.textContent = "Fontanella";
  container.appendChild(label);

  if (properties.indirizzo) {
    container.appendChild(document.createElement("br"));
    container.appendChild(document.createTextNode(properties.indirizzo));
  }

  return container;
}

function buildIsocronaTooltipContent(minutes, properties) {
  const container = document.createElement("div");
  container.className = "fontanella-tooltip";

  const label = document.createElement("strong");
  label.textContent = `Isocrona ${minutes} min`;
  container.appendChild(label);

  const count = (properties.fontanella_ids?.match(/,\d+/g) || []).length;
  container.appendChild(document.createElement("br"));
  container.appendChild(document.createTextNode(`${count} fontanell${count === 1 ? "a" : "e"} raggiungibil${count === 1 ? "e" : "i"}`));

  return container;
}

function buildFontanellePopupContent(properties, coordinates) {
  const container = document.createElement("div");
  container.className = "fontanella-popup";

  const heading = document.createElement("h3");
  heading.textContent = properties.denominazione || properties.indirizzo || "Fontanella";
  container.appendChild(heading);

  const list = document.createElement("dl");
  for (const [key, label] of FONTANELLA_POPUP_FIELDS) {
    const value = properties[key];
    if (!value) continue;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    list.append(dt, dd);
  }
  container.appendChild(list);

  const [lng, lat] = coordinates;
  const params = new URLSearchParams({
    api: "1",
    destination: `${lat},${lng}`,
    travelmode: "walking",
  });
  const link = document.createElement("a");
  link.href = `https://www.google.com/maps/dir/?${params.toString()}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Apri in Google Maps";
  container.appendChild(link);

  return container;
}

// Coverage fragments carry an `nro` property (how many fontanelle reach that
// fragment within the cutoff) inherited from the legacy HERE-isoline dataset
// (dati/fontanelle_webmaps.gpkg, layers tp_300 / tp_600_bucato_link). These
// ramps replicate that dataset's categorized QGIS styles (ColorBrewer Blues
// for 5min, Reds for 10min) so the reused geometry keeps its original look.
const COPERTURA_COLOR_RAMPS = {
  5: [
    "rgb(222,235,247)", "rgb(198,219,239)", "rgb(158,202,225)", "rgb(107,174,214)",
    "rgb(66,146,198)", "rgb(33,113,181)", "rgb(8,81,156)", "rgb(8,48,107)",
  ],
  10: [
    "rgb(254,224,210)", "rgb(254,213,196)", "rgb(253,202,181)", "rgb(253,191,167)",
    "rgb(252,172,144)", "rgb(252,148,116)", "rgb(252,124,92)", "rgb(250,99,70)",
    "rgb(243,71,52)", "rgb(228,47,39)", "rgb(206,27,30)", "rgb(182,19,24)", "rgb(151,11,19)",
  ],
};

export function getCoperturaColorRamp(minutes) {
  return COPERTURA_COLOR_RAMPS[minutes];
}

function buildCoperturaColorExpression(minutes) {
  const ramp = COPERTURA_COLOR_RAMPS[minutes];
  const expression = ["step", ["get", "nro"], ramp[0]];
  for (let i = 1; i < ramp.length; i++) {
    expression.push(i + 1, ramp[i]);
  }
  return expression;
}

// Isocrone fill uses a flat tone per cutoff (blue = 5min, red = 10min),
// matching the #isochrone-legend swatches in index.html.
const ISOCRONE_COLORS = {
  5: "#6baed6",
  10: "#fc9474",
};

function registerPmtilesProtocol() {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

// Isochrone/coverage fills are added first so they render as a base
// overlay; the fontanelle circle layer is added last (on top of the
// stack), so fountain markers stay visible and clickable above them.
// 10-min layers are added before 5-min ones so the (larger) 10-min area
// sits below the (smaller) 5-min area instead of covering it.
function addDataLayers(map) {
  for (const minutes of [10, 5]) {
    map.addSource(`isocrone-${minutes}`, { type: "vector", url: pmtilesUrl(`isocrone_${minutes}min`) });
    map.addLayer({
      id: `isocrone-${minutes}-fill`,
      type: "fill",
      source: `isocrone-${minutes}`,
      "source-layer": `isocrone_${minutes}min`,
      paint: { "fill-color": ISOCRONE_COLORS[minutes], "fill-opacity": 0.3, "fill-outline-color": "transparent" },
      layout: { visibility: "none" },
    });

    map.addSource(`copertura-${minutes}`, { type: "vector", url: pmtilesUrl(`copertura_${minutes}min`) });
    map.addLayer({
      id: `copertura-${minutes}-fill`,
      type: "fill",
      source: `copertura-${minutes}`,
      "source-layer": `copertura_${minutes}min`,
      paint: { "fill-color": buildCoperturaColorExpression(minutes), "fill-opacity": 0.6, "fill-outline-color": "transparent" },
      layout: { visibility: "none" },
    });
  }

  map.addSource("fontanelle", { type: "vector", url: pmtilesUrl("fontanelle") });
  map.addLayer({
    id: "fontanelle-points",
    type: "circle",
    source: "fontanelle",
    "source-layer": "fontanelle",
    paint: {
      "circle-color": "#0b6e99",
      "circle-radius": 6,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
    },
  });
}

export async function initMap({
  onFontanellaSelect,
  onFontanellaDeselect,
  onFontanellaHover,
  onFontanellaHoverEnd,
} = {}) {
  registerPmtilesProtocol();

  const map = new maplibregl.Map({
    container: "map",
    style: BASE_STYLE,
    center: PALERMO_CENTER,
    zoom: HOME_ZOOM,
    minZoom: 11,
    maxZoom: 17,
    maxBounds: [
      [13.08, 38.0],
      [13.6, 38.3],
    ],
    hash: true,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: { compact: true },
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();

  // MapLibre apre da solo l'attribuzione compatta al primo render
  // (vedi AttributionControl._updateCompact): forziamola chiusa.
  const attribEl = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
  attribEl?.classList.remove("maplibregl-compact-show");
  attribEl?.removeAttribute("open");

  await new Promise((resolve) => map.on("load", resolve));

  addDataLayers(map);

  map.on("click", "fontanelle-points", (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const coordinates = feature.geometry.coordinates.slice();
    const popup = new maplibregl.Popup()
      .setLngLat(coordinates)
      .setDOMContent(buildFontanellePopupContent(feature.properties, coordinates))
      .addTo(map);
    onFontanellaSelect?.(feature.properties.id);
    popup.on("close", () => onFontanellaDeselect?.());
  });
  let tooltip = null;
  map.on("mousemove", "fontanelle-points", (e) => {
    map.getCanvas().style.cursor = "pointer";
    const feature = e.features?.[0];
    if (!feature) return;
    const { width, height } = map.getCanvas();
    // Ancora il tooltip sul lato opposto al centro mappa: il box si estende
    // verso il bordo (zona con meno poligoni sovrapposti), non verso il centro.
    const vertical = e.point.y < height / 2 ? "bottom" : "top";
    const horizontal = e.point.x < width / 2 ? "right" : "left";
    tooltip?.remove();
    tooltip = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 18,
      maxWidth: "220px",
      className: "fontanella-tooltip-popup",
      anchor: `${vertical}-${horizontal}`,
    })
      .setLngLat(feature.geometry.coordinates.slice())
      .setDOMContent(buildFontanellaTooltipContent(feature.properties))
      .addTo(map);
    onFontanellaHover?.(feature.properties.id);
  });
  map.on("mouseleave", "fontanelle-points", () => {
    map.getCanvas().style.cursor = "";
    tooltip?.remove();
    tooltip = null;
    onFontanellaHoverEnd?.();
  });

  let isocronaTooltip = null;
  for (const minutes of [5, 10]) {
    map.on("mousemove", `isocrone-${minutes}-fill`, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      isocronaTooltip?.remove();
      isocronaTooltip = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 8,
        maxWidth: "220px",
        className: "fontanella-tooltip-popup",
      })
        .setLngLat(e.lngLat)
        .setDOMContent(buildIsocronaTooltipContent(minutes, feature.properties))
        .addTo(map);
    });
    map.on("mouseleave", `isocrone-${minutes}-fill`, () => {
      isocronaTooltip?.remove();
      isocronaTooltip = null;
    });
  }

  return map;
}

export function setIsochroneVisibility(map, minutes, visible) {
  map.setLayoutProperty(`isocrone-${minutes}-fill`, "visibility", visible ? "visible" : "none");
}

export function setCoperturaVisibility(map, minutes, visible) {
  map.setLayoutProperty(`copertura-${minutes}-fill`, "visibility", visible ? "visible" : "none");
}

export function setFontanelleFilter(map, filterExpression) {
  map.setFilter("fontanelle-points", filterExpression);
}

const ISOCHRONE_MINUTES = [5, 10];

export function setIsochroneVisibilityOverride(map, active, toggleStates = {}) {
  for (const minutes of ISOCHRONE_MINUTES) {
    const visible = active ? true : Boolean(toggleStates[minutes]);
    map.setLayoutProperty(`isocrone-${minutes}-fill`, "visibility", visible ? "visible" : "none");
  }
}

// Restricts isochrone fills to only the fontanelle ids passed in, reusing the
// same delimited fontanella_ids string matching as setCoperturaHoverFilter.
// Called whenever a circoscrizione/quartiere/search/fontanella filter is
// active, so the isochrone overlay never shows areas for fontanelle excluded
// by the filter.
export function setIsochroneFilterByIds(map, ids) {
  const expression =
    ids && ids.length > 0
      ? ["any", ...ids.map((id) => ["in", `,${id},`, ["get", "fontanella_ids"]])]
      : ["boolean", false];
  for (const minutes of ISOCHRONE_MINUTES) {
    map.setFilter(`isocrone-${minutes}-fill`, expression);
  }
}

export function clearIsochroneFilter(map) {
  for (const minutes of ISOCHRONE_MINUTES) {
    map.setFilter(`isocrone-${minutes}-fill`, null);
  }
}

export function setCoperturaFilterActive(map, active, toggleStates = {}) {
  for (const minutes of ISOCHRONE_MINUTES) {
    const visible = active ? false : Boolean(toggleStates[minutes]);
    map.setLayoutProperty(`copertura-${minutes}-fill`, "visibility", visible ? "visible" : "none");
  }
}

// Coverage fragments carry a comma-bounded `fontanella_ids` string
// (",12,45,116,") listing every fontanella that reaches them (see
// pipeline/import_legacy_coverage.py). MVT/PMTiles properties are scalar
// only, so a real per-feature array isn't possible; `in` against a string
// does a substring match, hence the delimiters on both the property and the
// needle to avoid id-prefix collisions (e.g. "1" matching inside "116").
export function setCoperturaHoverFilter(map, fontanellaId) {
  if (fontanellaId == null) {
    for (const minutes of ISOCHRONE_MINUTES) {
      map.setFilter(`copertura-${minutes}-fill`, null);
      map.setLayoutProperty(`copertura-${minutes}-fill`, "visibility", "none");
    }
    return;
  }
  const needle = `,${fontanellaId},`;
  for (const minutes of ISOCHRONE_MINUTES) {
    map.setFilter(`copertura-${minutes}-fill`, ["in", needle, ["get", "fontanella_ids"]]);
    map.setLayoutProperty(`copertura-${minutes}-fill`, "visibility", "visible");
  }
}

const DATA_LAYER_IDS = [
  "isocrone-10-fill",
  "isocrone-5-fill",
  "copertura-10-fill",
  "copertura-5-fill",
  "fontanelle-points",
  "percorso-fontanella-line",
];

const DATA_SOURCE_IDS = [
  "isocrone-10",
  "isocrone-5",
  "copertura-10",
  "copertura-5",
  "fontanelle",
  "percorso-fontanella",
];

// setStyle() normalmente butta via layer/source custom, e ri-aggiungerli
// dentro "style.load" corre il rischio che lo style non sia ancora
// "fully loaded" (sprite/glyphs pending): il layer viene silenziosamente
// scartato (vedi maplibre-gl-js#2587). transformStyle fonde i nostri
// source/layer nello style nuovo prima che venga applicato, evitando la
// race: nessun re-add, quindi filtri/visibilità restano quelli originali.
export function setBasemapTheme(map, theme) {
  const styleUrl = THEME_STYLES[theme] || THEME_STYLES.light;
  map.setStyle(styleUrl, {
    transformStyle: (previousStyle, nextStyle) => {
      if (!previousStyle) return nextStyle;
      const customSources = {};
      for (const id of DATA_SOURCE_IDS) {
        if (previousStyle.sources[id]) customSources[id] = previousStyle.sources[id];
      }
      const customLayers = previousStyle.layers.filter((layer) => DATA_LAYER_IDS.includes(layer.id));
      return {
        ...nextStyle,
        sources: { ...nextStyle.sources, ...customSources },
        layers: [...nextStyle.layers, ...customLayers],
      };
    },
  });
}

export function setRouteLine(map, coordinates) {
  const geojson = {
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties: {},
  };
  const source = map.getSource("percorso-fontanella");
  if (source) {
    source.setData(geojson);
    return;
  }
  map.addSource("percorso-fontanella", { type: "geojson", data: geojson });
  map.addLayer({
    id: "percorso-fontanella-line",
    type: "line",
    source: "percorso-fontanella",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#e74c3c", "line-width": 4, "line-opacity": 0.85 },
  });
}

export function clearRouteLine(map) {
  const source = map.getSource("percorso-fontanella");
  if (source) source.setData({ type: "FeatureCollection", features: [] });
}
