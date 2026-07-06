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
  const adjacency = new Map();
  for (const node of graph.nodes) {
    nodeCoord.set(node.id, [node.lon, node.lat]);
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.u)?.push({ to: edge.v, lenM: edge.len_m });
    adjacency.get(edge.v)?.push({ to: edge.u, lenM: edge.len_m });
  }
  const fontanellaByNode = new Map();
  for (const [fontanellaId, nodeId] of Object.entries(graph.fontanellaNodes)) {
    if (!fontanellaByNode.has(nodeId)) fontanellaByNode.set(nodeId, []);
    fontanellaByNode.get(nodeId).push(fontanellaId);
  }
  return { nodeCoord, adjacency, fontanellaByNode };
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

export function shortestPathToNearestFontanella(startNodeId, index) {
  const { adjacency, fontanellaByNode, nodeCoord } = index;
  if (!adjacency.has(startNodeId)) return null;

  const dist = new Map([[startNodeId, 0]]);
  const prev = new Map();
  const visited = new Set();
  const heap = new MinHeap();
  heap.push(0, startNodeId);

  while (heap.size > 0) {
    const { priority: d, value: nodeId } = heap.pop();
    if (visited.has(nodeId)) continue;
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
        distanceMeters: d,
        pathCoordinates: pathNodeIds.map((id) => nodeCoord.get(id)),
      };
    }

    for (const { to, lenM } of adjacency.get(nodeId) || []) {
      if (visited.has(to)) continue;
      const newDist = d + lenM;
      if (newDist < (dist.get(to) ?? Infinity)) {
        dist.set(to, newDist);
        prev.set(to, nodeId);
        heap.push(newDist, to);
      }
    }
  }
  return null;
}

export function findRouteToNearestFontanella(startPoint, index) {
  const startNodeId = findNearestNodeId(startPoint, index.nodeCoord);
  if (startNodeId == null) return null;
  return shortestPathToNearestFontanella(startNodeId, index);
}
