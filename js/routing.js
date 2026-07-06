import { haversineDistance } from "./geo-utils.js";

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(priority, value) {
    this.items.push({ priority, value });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = i * 2 + 2;
        let smallest = i;
        if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left;
        if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

export function buildRoutingIndex(graph) {
  const nodeCoord = new Map();
  const nodeEle = new Map();
  const adjacency = new Map();
  for (const node of graph.nodes) {
    nodeCoord.set(node.id, [node.lon, node.lat]);
    nodeEle.set(node.id, node.ele ?? 0);
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.u)?.push({ to: edge.v, lenM: edge.len_m, weightSec: edge.weight_sec, slopePct: edge.slope_pct });
    adjacency.get(edge.v)?.push({ to: edge.u, lenM: edge.len_m, weightSec: edge.weight_sec, slopePct: edge.slope_pct });
  }
  const fontanellaByNode = new Map();
  for (const [fontanellaId, nodeId] of Object.entries(graph.fontanellaNodes)) {
    if (!fontanellaByNode.has(nodeId)) fontanellaByNode.set(nodeId, []);
    fontanellaByNode.get(nodeId).push(fontanellaId);
  }
  return { nodeCoord, nodeEle, adjacency, fontanellaByNode };
}

export function findNearestNodeId(point, nodeCoord) {
  let nearestId = null;
  let minDistance = Infinity;
  for (const [id, coord] of nodeCoord) {
    const distance = haversineDistance(point, coord);
    if (distance < minDistance) {
      minDistance = distance;
      nearestId = id;
    }
  }
  return nearestId;
}

// Ricava pendenza media/massima e profilo altimetrico (distanza cumulata + quota
// per nodo, dislivelli in salita/discesa) lungo il percorso finale, riguardando
// gli archi effettivamente attraversati (il Dijkstra non li tiene traccia
// mentre esplora, solo a percorso trovato).
function segmentStats(pathNodeIds, adjacency, nodeEle) {
  let weightedSlopeSum = 0;
  let lengthSum = 0;
  let maxSlopePercent = 0;
  let ascentMeters = 0;
  let descentMeters = 0;
  const elevationProfile = [{ distanceMeters: 0, elevationMeters: nodeEle.get(pathNodeIds[0]) ?? 0 }];

  for (let i = 0; i < pathNodeIds.length - 1; i++) {
    const from = pathNodeIds[i];
    const to = pathNodeIds[i + 1];
    const edge = (adjacency.get(from) || []).find((e) => e.to === to);
    if (!edge) continue;
    weightedSlopeSum += edge.slopePct * edge.lenM;
    lengthSum += edge.lenM;
    maxSlopePercent = Math.max(maxSlopePercent, edge.slopePct);

    const eleFrom = nodeEle.get(from) ?? 0;
    const eleTo = nodeEle.get(to) ?? 0;
    const delta = eleTo - eleFrom;
    if (delta > 0) ascentMeters += delta;
    else descentMeters += -delta;
    elevationProfile.push({ distanceMeters: lengthSum, elevationMeters: eleTo });
  }

  return {
    avgSlopePercent: lengthSum > 0 ? weightedSlopeSum / lengthSum : 0,
    maxSlopePercent,
    ascentMeters,
    descentMeters,
    elevationProfile,
  };
}

// Costo in secondi (pesato sulla pendenza reale, vedi scripts/build_rete_stradale.py),
// non sulla distanza in metri: due percorsi di pari lunghezza in salita/pianura
// impiegano tempi diversi, quindi il Dijkstra deve minimizzare il tempo.
export function shortestPathToNearestFontanella(startNodeId, index, maxSeconds = Infinity) {
  const { adjacency, fontanellaByNode, nodeCoord, nodeEle } = index;
  if (!adjacency.has(startNodeId)) return null;

  const timeSec = new Map([[startNodeId, 0]]);
  const lenM = new Map([[startNodeId, 0]]);
  const prev = new Map();
  const visited = new Set();
  const heap = new MinHeap();
  heap.push(0, startNodeId);

  while (heap.size > 0) {
    const { priority: t, value: nodeId } = heap.pop();
    if (visited.has(nodeId)) continue;
    if (t > maxSeconds) break;
    visited.add(nodeId);

    if (fontanellaByNode.has(nodeId)) {
      const pathNodeIds = [nodeId];
      let cur = nodeId;
      while (prev.has(cur)) {
        cur = prev.get(cur);
        pathNodeIds.unshift(cur);
      }
      return {
        fontanellaId: fontanellaByNode.get(nodeId)[0],
        distanceMeters: lenM.get(nodeId),
        durationSeconds: t,
        pathCoordinates: pathNodeIds.map((id) => nodeCoord.get(id)),
        ...segmentStats(pathNodeIds, adjacency, nodeEle),
      };
    }

    for (const { to, lenM: edgeLenM, weightSec } of adjacency.get(nodeId) || []) {
      if (visited.has(to)) continue;
      const newTime = t + weightSec;
      if (newTime > maxSeconds) continue;
      if (newTime < (timeSec.get(to) ?? Infinity)) {
        timeSec.set(to, newTime);
        lenM.set(to, lenM.get(nodeId) + edgeLenM);
        prev.set(to, nodeId);
        heap.push(newTime, to);
      }
    }
  }
  return null;
}

// Raggio "ridotto" ma progressivo: prova prima un cutoff breve (rete locale
// attorno al punto), e lo allarga solo se non trova nessuna fontanella entro
// quel tempo — evita di esplorare l'intero grafo cittadino nel caso comune.
const SEARCH_CUTOFFS_SECONDS = [900, 1800, 3600, Infinity];

export function findRouteToNearestFontanella(startPoint, index) {
  const startNodeId = findNearestNodeId(startPoint, index.nodeCoord);
  if (startNodeId == null) return null;
  for (const maxSeconds of SEARCH_CUTOFFS_SECONDS) {
    const route = shortestPathToNearestFontanella(startNodeId, index, maxSeconds);
    if (route) return route;
  }
  return null;
}

// Dijkstra a sorgente singola senza target: esplora tutta la rete raggiungibile
// entro maxSeconds e ritorna, per ogni arco interamente dentro il cutoff, la
// fascia oraria a cui appartiene ("band" = il piu' dei due tempi cumulati agli
// estremi, arrotondato alla soglia superiore piu' vicina in bandsSeconds).
// Usato per l'isocrona attorno alla fontanella sotto cursore — a differenza
// della ricerca sulla fontanella non si ferma al primo target, quindi il
// cutoff e' l'unico limite naturale.
export function reachableNetwork(startPoint, index, bandsSeconds) {
  const { adjacency, nodeCoord } = index;
  const startNodeId = findNearestNodeId(startPoint, index.nodeCoord);
  if (startNodeId == null || !adjacency.has(startNodeId)) return null;

  const maxSeconds = bandsSeconds[bandsSeconds.length - 1];
  const timeSec = new Map([[startNodeId, 0]]);
  const visited = new Set();
  const heap = new MinHeap();
  heap.push(0, startNodeId);

  while (heap.size > 0) {
    const { priority: t, value: nodeId } = heap.pop();
    if (visited.has(nodeId)) continue;
    if (t > maxSeconds) break;
    visited.add(nodeId);

    for (const { to, weightSec } of adjacency.get(nodeId) || []) {
      if (visited.has(to)) continue;
      const newTime = t + weightSec;
      if (newTime > maxSeconds) continue;
      if (newTime < (timeSec.get(to) ?? Infinity)) {
        timeSec.set(to, newTime);
        heap.push(newTime, to);
      }
    }
  }

  const bandFor = (seconds) => bandsSeconds.find((b) => seconds <= b) ?? null;
  const seenPairs = new Set();
  const features = [];
  for (const nodeId of timeSec.keys()) {
    for (const { to } of adjacency.get(nodeId) || []) {
      if (!timeSec.has(to)) continue;
      const pair = nodeId < to ? `${nodeId}_${to}` : `${to}_${nodeId}`;
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);
      const band = bandFor(Math.max(timeSec.get(nodeId), timeSec.get(to)));
      if (band == null) continue;
      features.push({
        type: "Feature",
        properties: { band },
        geometry: { type: "LineString", coordinates: [nodeCoord.get(nodeId), nodeCoord.get(to)] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
