function estimateDurationSeconds(distanceKm, transportType) {
  const averageSpeedKmh = transportType === 'ÔNIBUS' ? 80 : 110;
  const travelSeconds = (distanceKm / averageSpeedKmh) * 3600;
  const stopSeconds = distanceKm > 220 ? 20 * 60 : 0;
  return { durationSeconds: travelSeconds + stopSeconds, averageSpeedKmh, stopMinutes: stopSeconds / 60 };
}

module.exports = { estimateDurationSeconds };