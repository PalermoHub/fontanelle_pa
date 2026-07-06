#!/usr/bin/env python3
"""Costruisce geo/rete_stradale.json dal gpkg OSM di Rete-Stradale e dal raster
di pendenza di palermo_dtm_5m. Va eseguito nell'ambiente qgis-headless (GDAL/OGR):

MAMBA_ROOT_PREFIX=$HOME/micromamba QT_QPA_PLATFORM=offscreen \
  ~/.local/bin/micromamba run -n qgis python3 scripts/build_rete_stradale.py
"""
import json
import math
import re
from pathlib import Path

from osgeo import ogr, osr

REPO = Path(__file__).resolve().parents[1]
GPKG = Path("/home/coseerobe/GitHub-Clone/coseerobe/Rete-Stradale/dati_qgis/082053_Palermo-2026-07-01T09Z.gpkg")
SLOPE_TIF = Path("/home/coseerobe/GitHub-Clone/coseerobe/palermo_dtm_5m/dati/analisi/slope_percent.tif")
DTM_TIF = Path("/home/coseerobe/GitHub-Clone/coseerobe/palermo_dtm_5m/dati/palermo_dtm5m.tif")
FONTANELLE_JSON = REPO / "geo" / "fontanelle.geojson"
OUT_JSON = REPO / "geo" / "rete_stradale.json"

WALKABLE = {
    "footway", "pedestrian", "steps", "path", "residential",
    "living_street", "unclassified", "tertiary",
}
COORD_PRECISION = 7  # ~1.1cm a queste latitudini, per lo snap dei nodi condivisi
FLAT_WALK_KMH = 5.0  # passo cittadino in piano, come nell'implementazione precedente
STEPS_PENALTY = 1.5

OTHER_TAG_RE = re.compile(r'"([^"]+)"=>"([^"]*)"')


def parse_other_tags(raw):
    if not raw:
        return {}
    return dict(OTHER_TAG_RE.findall(raw))


def haversine_m(a, b):
    lon1, lat1 = a
    lon2, lat2 = b
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def tobler_speed_kmh(slope_ratio):
    """Tobler's hiking function, rinormalizzata per dare FLAT_WALK_KMH in piano."""
    base = 6.0 * math.exp(-3.5 * abs(slope_ratio + 0.05))
    flat = 6.0 * math.exp(-3.5 * abs(0.05))
    return FLAT_WALK_KMH * (base / flat)


class RasterSampler:
    """Campiona un raster mono-banda in lon/lat WGS84, con cache per pixel."""

    def __init__(self, tif_path, valid_min, valid_max, fallback=0.0):
        from osgeo import gdal

        self.ds = gdal.Open(str(tif_path))
        self.gt = self.ds.GetGeoTransform()
        self.band = self.ds.GetRasterBand(1)
        self.xsize = self.ds.RasterXSize
        self.ysize = self.ds.RasterYSize
        self.valid_min = valid_min
        self.valid_max = valid_max
        self.fallback = fallback
        wgs84 = osr.SpatialReference()
        wgs84.ImportFromEPSG(4326)
        wgs84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        raster_srs = osr.SpatialReference(wkt=self.ds.GetProjection())
        raster_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        self.transform = osr.CoordinateTransformation(wgs84, raster_srs)
        self._cache = {}

    def sample(self, lon, lat):
        x, y, _ = self.transform.TransformPoint(lon, lat)
        gt = self.gt
        px = int((x - gt[0]) / gt[1])
        py = int((y - gt[3]) / gt[5])
        if px < 0 or py < 0 or px >= self.xsize or py >= self.ysize:
            return self.fallback
        key = (px, py)
        if key not in self._cache:
            val = self.band.ReadAsArray(px, py, 1, 1)
            v = float(val[0][0]) if val is not None else self.fallback
            if v < self.valid_min or v > self.valid_max or math.isnan(v):
                v = self.fallback
            self._cache[key] = v
        return self._cache[key]


def load_ways():
    ds = ogr.Open(str(GPKG))
    lyr = ds.GetLayer("lines")
    ways = []
    for f in lyr:
        highway = f.GetField("highway")
        if highway not in WALKABLE:
            continue
        tags = parse_other_tags(f.GetField("other_tags"))
        if tags.get("foot") == "no" or tags.get("access") == "no":
            continue
        geom = f.GetGeometryRef()
        if geom is None:
            continue
        pts = [geom.GetPoint(i)[:2] for i in range(geom.GetPointCount())]
        if len(pts) < 2:
            continue
        ways.append((pts, highway == "steps"))
    return ways


def build_graph(ways, slope_sampler, ele_sampler):
    node_id_by_key = {}
    nodes = []

    def node_id(lon, lat):
        key = (round(lon, COORD_PRECISION), round(lat, COORD_PRECISION))
        nid = node_id_by_key.get(key)
        if nid is None:
            nid = len(nodes)
            node_id_by_key[key] = nid
            ele_m = ele_sampler.sample(key[0], key[1])
            nodes.append({"id": nid, "lon": key[0], "lat": key[1], "ele": round(ele_m, 1)})
        return nid

    edges = []
    seen_pairs = set()
    for pts, is_steps in ways:
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            if a == b:
                continue
            u, v = node_id(*a), node_id(*b)
            if u == v:
                continue
            pair = (min(u, v), max(u, v))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)

            length_m = haversine_m(a, b)
            mid_lon, mid_lat = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            slope_pct = slope_sampler.sample(mid_lon, mid_lat)
            speed_kmh = tobler_speed_kmh(slope_pct / 100.0)
            weight_sec = (length_m / 1000.0) / speed_kmh * 3600.0
            if is_steps:
                weight_sec *= STEPS_PENALTY

            edges.append({
                "u": u, "v": v,
                "len_m": round(length_m, 1),
                "weight_sec": round(weight_sec, 2),
                "slope_pct": round(slope_pct, 1),
            })
    return nodes, edges


def snap_fontanelle(nodes):
    data = json.loads(FONTANELLE_JSON.read_text())
    fontanella_nodes = {}
    for feature in data["features"]:
        fid = feature["properties"]["id"]
        lon, lat = feature["geometry"]["coordinates"]
        best_id, best_d = None, math.inf
        for n in nodes:
            d = haversine_m((lon, lat), (n["lon"], n["lat"]))
            if d < best_d:
                best_d, best_id = d, n["id"]
        fontanella_nodes[fid] = best_id
    return fontanella_nodes


def main():
    print("Carico archi percorribili dal gpkg...")
    ways = load_ways()
    print(f"  {len(ways)} way percorribili")

    print("Campiono pendenza e quota, costruisco grafo...")
    slope_sampler = RasterSampler(SLOPE_TIF, valid_min=0, valid_max=300, fallback=0.0)
    ele_sampler = RasterSampler(DTM_TIF, valid_min=-10, valid_max=1200, fallback=0.0)
    nodes, edges = build_graph(ways, slope_sampler, ele_sampler)
    print(f"  {len(nodes)} nodi, {len(edges)} archi")

    print("Aggancio fontanelle ai nodi piu' vicini...")
    fontanella_nodes = snap_fontanelle(nodes)
    print(f"  {len(fontanella_nodes)} fontanelle agganciate")

    OUT_JSON.write_text(json.dumps({
        "nodes": nodes,
        "edges": edges,
        "fontanellaNodes": fontanella_nodes,
    }, separators=(",", ":")))
    size_kb = OUT_JSON.stat().st_size / 1024
    print(f"Scritto {OUT_JSON} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
