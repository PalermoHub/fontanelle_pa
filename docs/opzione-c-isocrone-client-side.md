# Opzione C — Isocrone client-side per fontanelle_pa

Isocrone dinamiche calcolate interamente nel browser, senza backend né API esterne: il client scarica una volta un estratto della rete pedonale di Palermo, costruisce un grafo in memoria ed esegue un Dijkstra troncato ad ogni click sulla mappa.

Coerente con la scelta di mantenere `fontanelle_pa` come sito statico su GitHub Pages.

---

## 1. Preparazione dati (fase offline, nel repo/CI)

Punto di partenza: estratto OSM di Palermo (osmium/GDAL, come già nel workflow di altri progetti).

**Filtro tag percorribili a piedi**
`highway=footway|pedestrian|steps|path|residential|living_street|unclassified|tertiary`, escludendo `foot=no`. Gli `steps` non vanno esclusi ma penalizzati (fattore tempo ~×1.5).

**Topologia**
Dedup dei nodi condivisi tra archi (snap a 1-2 cm). Struttura dati risultante:

```
nodes: { node_id: [lon, lat] }
edges: { edge_id: [from, to, length_m, weight_sec] }
```

Può essere costruita con `pgr_createTopology` in PostGIS (già in uso in altri progetti) ed esportata come JSON/Arrow piatto, senza tenerla in Postgres.

**Pesatura**
Non velocità piatta a 5 km/h, ma tempo modulato sulla pendenza reale del segmento (es. Tobler's hiking function adattata al passo cittadino), usando il DTM 5m già disponibile. Palermo ha dislivelli non banali tra centro e Zisa/Noce/Monte Pellegrino: è un vantaggio rispetto a un motore di routing generico che ignora la pendenza.

**Output**
Un file compatto (`rete_pedonale.json`, oppure Arrow/Parquet via DuckDB-WASM per restare nello stesso ecosistema dati) con nodi e archi. Target: sotto 2-3 MB gzippati per l'intera città; oltre questa soglia conviene passare al tiling spaziale (vedi §4).

---

## 2. Caricamento e costruzione del grafo nel browser

```js
import Graph from 'graphology';

async function buildGraph() {
  const res = await fetch('/data/rete_pedonale.json');
  const { nodes, edges } = await res.json();
  const g = new Graph({ type: 'undirected' });
  nodes.forEach(n => g.addNode(n.id, { lon: n.lon, lat: n.lat }));
  edges.forEach(e => g.addEdge(e.from, e.to, { weight: e.weight_sec }));
  return g;
}
```

`graphology` non offre un Dijkstra "cutoff" nativo comodo per isocrone: conviene scriverne uno a mano con una coda a priorità che si ferma non appena il costo cumulato supera il minutaggio richiesto (non serve visitare tutto il grafo).

```js
function isochroneNodes(graph, startNodeId, maxSeconds) {
  const dist = new Map([[startNodeId, 0]]);
  const visited = new Set();
  const queue = new MinHeap(); // implementazione semplice, o libreria tinyqueue
  queue.push({ id: startNodeId, cost: 0 });

  while (!queue.isEmpty()) {
    const { id, cost } = queue.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    if (cost > maxSeconds) continue;

    graph.forEachNeighbor(id, (neighbor) => {
      const edgeWeight = graph.getEdgeAttribute(id, neighbor, 'weight');
      const newCost = cost + edgeWeight;
      if (newCost <= maxSeconds && (!dist.has(neighbor) || newCost < dist.get(neighbor))) {
        dist.set(neighbor, newCost);
        queue.push({ id: neighbor, cost: newCost });
      }
    });
  }
  return dist; // Map<nodeId, secondiRaggiunti>
}
```

---

## 3. Da nodi raggiunti a poligono isocrona

### A. Buffer + union degli archi raggiunti (consigliato)

Più fedele alla rete stradale reale: segue davvero le strade percorribili invece di produrre un blob generico che ignora isolati non attraversabili o parchi recintati.

```js
import buffer from '@turf/buffer';
import union from '@turf/union';

const reachedEdges = getEdgesBetweenReachedNodes(graph, dist); // entrambi gli estremi raggiunti
const buffers = reachedEdges.map(edge =>
  buffer(edgeToLineString(edge), 15, { units: 'meters' })
);
const isochronePolygon = buffers.reduce((acc, b) => union(acc, b));
```

### B. Concave hull sui punti raggiunti (più semplice, meno preciso)

```js
import concave from '@turf/concave';

const points = turf.featureCollection(
  [...dist.keys()].map(id => turf.point(coordsOf(id)))
);
const isochronePolygon = concave(points, { maxEdge: 0.05 }); // km
```

Più veloce da implementare come primo MVP, ma può "mangiare" vuoti urbani o estendersi oltre le strade reali. Da sostituire con l'opzione A in una seconda iterazione.

In entrambi i casi, chiudere con `@turf/simplify` per alleggerire il poligono prima di renderlo su MapLibre.

---

## 4. Performance e scalabilità

Rischio principale: caricare l'intero grafo cittadino ad ogni interazione. Mitigazioni:

- **Bounding box query**: tilizzare la rete in chunk spaziali (griglia di 500m, o layer PMTiles dedicato con attributi di peso). Al click si caricano solo i tile entro un raggio ragionevole (es. 2 km — oltre, nessuna isocrona pedonale a 20 min arriverebbe comunque).
- **Web Worker**: spostare build del grafo e Dijkstra in un worker per non bloccare il thread principale.
- **Cache IndexedDB**: chunk di rete già scaricati restano in cache locale; chi esplora la stessa zona non ri-scarica nulla.
- **Debounce sul click**: annullare calcoli precedenti se l'utente clicca più punti in rapida successione.

---

## 5. Casi limite da non sottovalutare

- **Barriere pedonali**: cancelli, recinzioni di ville/parchi chiusi la notte (`barrier=gate`, `access=private`) — da escludere o penalizzare fortemente se mappati in OSM.
- **Attraversamenti**: un incrocio senza attraversamento pedonale segnalato può falsare la connettività tra due lati della stessa strada; arricchire con `highway=crossing` dove possibile.
- **Isole pedonali/ponti**: verificare che la topologia non "salti" collegamenti reali per problemi di snap (nodi a pochi cm di distanza rimasti scollegati).
- **Degrado su mobile datati**: testare il Dijkstra su un telefono di fascia bassa reale. Se il calcolo supera ~300-400ms, rivedere il raggio di caricamento o passare a un worker con progress feedback.

---

## 6. Percorso di sviluppo incrementale consigliato

1. MVP con concave hull (opzione B), rete pedonale dell'intera città in un unico file, nessun tiling — per validare l'esperienza utente.
2. Se funziona, passare al buffer+union (opzione A) per poligoni più fedeli alla rete reale.
3. Se il file cresce troppo o il traffico aumenta, introdurre tiling spaziale e caching (§4).
4. Validare un campione di isocrone generate contro un motore di riferimento (ORS o pgRouting) per calibrare i pesi prima di pubblicare.
