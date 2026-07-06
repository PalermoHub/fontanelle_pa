const EARTH_RADIUS_M = 6371000;

export function haversineDistance([lon1, lat1], [lon2, lat2]) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function findNearestFeature(point, featureCollection) {
  let nearest = null;
  let minDistance = Infinity;
  for (const feature of featureCollection.features) {
    const distance = haversineDistance(point, feature.geometry.coordinates);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = feature;
    }
  }
  return nearest ? { feature: nearest, distanceMeters: minDistance } : null;
}
