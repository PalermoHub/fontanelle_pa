export function buildStatsViewModel(stats) {
  const perCircoscrizione = Object.entries(stats.per_circoscrizione || {})
    .map(([circoscrizione, count]) => ({ circoscrizione, count }))
    .sort((a, b) => b.count - a.count);

  const perQuartiere = Object.entries(stats.per_quartiere || {})
    .map(([quartiere, count]) => ({ quartiere, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totale: stats.totale_fontanelle,
    perCircoscrizione,
    perQuartiere,
    numCircoscrizioni: perCircoscrizione.length,
    numQuartieri: perQuartiere.length,
  };
}
