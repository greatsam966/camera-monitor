/**
 * content/camera-detector.js
 * Given the current set of participant tiles in the DOM, produces a
 * normalized snapshot of { participantId, name, cameraOn } for every
 * visible participant. Pure function-ish module: no state of its own,
 * state lives in attendance-tracker.js.
 */
const CameraDetector = (() => {
  const log = window.MCM_Logger?.log || console.log;

  function snapshot() {
    const tiles = window.MCM_DomUtils.findParticipantTiles(document);
    const results = [];

    tiles.forEach(tile => {
      try {
        const id = window.MCM_DomUtils.getParticipantId(tile);
        const name = window.MCM_DomUtils.getParticipantName(tile) || 'Unknown Participant';
        const cameraOn = window.MCM_DomUtils.isCameraOn(tile);
        results.push({ id, name, cameraOn });
      } catch (e) {
        (window.MCM_Logger?.error || console.error)('Error reading tile', e);
      }
    });

    return results;
  }

  return { snapshot };
})();

window.MCM_CameraDetector = CameraDetector;
