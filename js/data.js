const BASE_PATH = "geo";

async function loadJson(name) {
  const response = await fetch(`${BASE_PATH}/${name}`);
  if (!response.ok) {
    throw new Error(`Impossibile caricare ${name}: ${response.status}`);
  }
  return response.json();
}

// The full, un-tiled fontanelle point list is needed in JS for filtering,
// search, and nearest-fountain lookups — a vector tile source only exposes
// whatever is in the currently rendered viewport/zoom, which isn't reliable
// for "give me all 147 fountains". Map rendering instead uses
// fontanelle.pmtiles (see pmtilesUrl below).
export function loadFontanelle() {
  return loadJson("fontanelle.geojson");
}

export function loadStats() {
  return loadJson("stats.json");
}

export function loadRoadNetwork() {
  return loadJson("rete_stradale.json");
}

export function pmtilesUrl(name) {
  return `pmtiles://${BASE_PATH}/${name}.pmtiles`;
}
