/**
 * GPISSI - Tracking Lifecycle Status Enum
 * Representa os estados formais do rastreamento GPS
 */
const TrackingStatus = Object.freeze({
  IDLE: 'IDLE',
  STARTING: 'STARTING',
  TRACKING: 'TRACKING',
  PAUSED: 'PAUSED',
  SYNC_PENDING: 'SYNC_PENDING',
  STOPPING: 'STOPPING',
  STOPPED: 'STOPPED',
  ERROR: 'ERROR'
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TrackingStatus;
}
if (typeof window !== 'undefined') {
  window.TrackingStatus = TrackingStatus;
}
