function estimateDurationSeconds(distanceKm, transportType) {
  const averageSpeedKmh = transportType === 'ÔNIBUS' ? 80 : 110;
  const travelSeconds = (distanceKm / averageSpeedKmh) * 3600;
  // Quando o cálculo da duração da viagem exceder 2 horas, considera parada de 25 minutos
  const stopSeconds = travelSeconds > 2 * 3600 ? 25 * 60 : 0;
  return { durationSeconds: travelSeconds + stopSeconds, averageSpeedKmh, stopMinutes: stopSeconds / 60 };
}

module.exports = { estimateDurationSeconds };