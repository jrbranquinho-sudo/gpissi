function estimateDurationSeconds(distanceKm, transportType) {
  const averageSpeedKmh = transportType === 'ÔNIBUS' ? 80 : 110;
  const travelSeconds = (distanceKm / averageSpeedKmh) * 3600;
  const twoHoursSeconds = 2 * 3600;
  // A cada 2 horas de viagem previstas, adiciona uma parada de 25 minutos para abastecimento e banheiro
  const stopCount = travelSeconds > twoHoursSeconds ? Math.floor(travelSeconds / twoHoursSeconds) : 0;
  const stopSeconds = stopCount * 25 * 60;
  return {
    durationSeconds: travelSeconds + stopSeconds,
    averageSpeedKmh,
    stopMinutes: stopSeconds / 60,
    stopCount
  };
}

module.exports = { estimateDurationSeconds };