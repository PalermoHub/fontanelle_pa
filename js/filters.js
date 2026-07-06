export function filterByCircoscrizione(featureCollection, circoscrizione) {
  if (!circoscrizione) return featureCollection;
  return {
    type: "FeatureCollection",
    features: featureCollection.features.filter(
      (f) => f.properties.circoscrizione === circoscrizione
    ),
  };
}

export function filterByQuartiere(featureCollection, quartiere) {
  if (!quartiere) return featureCollection;
  return {
    type: "FeatureCollection",
    features: featureCollection.features.filter(
      (f) => f.properties.quartiere === quartiere
    ),
  };
}

export function filterByFontanellaId(featureCollection, fontanellaId) {
  if (!fontanellaId) return featureCollection;
  return {
    type: "FeatureCollection",
    features: featureCollection.features.filter(
      (f) => f.properties.id === fontanellaId
    ),
  };
}

export function searchByAddress(featureCollection, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return featureCollection;
  return {
    type: "FeatureCollection",
    features: featureCollection.features.filter((f) =>
      (f.properties.indirizzo || "").toLowerCase().includes(normalized)
    ),
  };
}

// fontanelle is rendered from a PMTiles vector tile source on the map, which
// has no .setData(): visual filtering happens via map.setFilter() with a
// MapLibre expression instead of re-filtering a JS FeatureCollection.
export function buildFontanelleFilterExpression({ circoscrizione, quartiere, query, fontanellaId } = {}) {
  const conditions = ["all"];
  if (circoscrizione) {
    conditions.push(["==", ["get", "circoscrizione"], circoscrizione]);
  }
  if (quartiere) {
    conditions.push(["==", ["get", "quartiere"], quartiere]);
  }
  const normalized = (query || "").trim().toLowerCase();
  if (normalized) {
    conditions.push(["in", normalized, ["downcase", ["get", "indirizzo"]]]);
  }
  if (fontanellaId) {
    conditions.push(["==", ["get", "id"], fontanellaId]);
  }
  return conditions;
}

export function getMatchingFontanellaIds(fontanelle, { circoscrizione, quartiere, query, fontanellaId } = {}) {
  let result = filterByCircoscrizione(fontanelle, circoscrizione);
  result = filterByQuartiere(result, quartiere);
  result = searchByAddress(result, query || "");
  result = filterByFontanellaId(result, fontanellaId);
  return result.features.map((f) => f.properties.id);
}
