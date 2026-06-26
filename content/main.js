/**
 * content/main.js
 * Entry point: wires MeetObserver -> CameraDetector -> AttendanceTracker
 * -> FlaggingEngine -> UiOverlay together, and handles messaging with
 * the background service worker / popup.
 */
(function () {
  const log = window.MCM_Logger?.log || console.log;

  let sessionId = `session_${Date.now()}`;
  let tracker = null;
  let flaggingEngine = null;
  let overlay = null;
  let observer = null;
  let tickInterval = null;

  async function init() {
    const settings = await window.MCM_StorageManager.getSettings();
    if (!settings.monitoringEnabled) {
      log('Monitoring disabled in settings, not starting.');
      return;
    }

    overlay = new window.MCM_UiOverlay();
    overlay.mount();

    tracker = new window.MCM_AttendanceTracker({
      sessionId,
      onUpdate: () => renderTick()
    });
    tracker.start();

    flaggingEngine = new window.MCM_FlaggingEngine({
      getSettings: () => window.MCM_StorageManager.getSettings(),
      onNotify: record => {
        overlay.setStatus(`🔵 Notice: ${record.name} camera off`);
        notifyBackground('notify', record);
      },
      onWarning: record => {
        overlay.setStatus(`⚠ Warning: ${record.name} camera off`);
        notifyBackground('warning', record);
      },
      onViolation: record => {
        overlay.setStatus(`🔴 Flagged for review: ${record.name} (host action required)`);
        notifyBackground('violation', record);
      }
    });

    observer = new window.MCM_MeetObserver({
      onChange: () => refreshSnapshot(),
      debounceMs: 400
    });
    observer.start();

    // Initial pass immediately, then continuous polling as a safety net
    // in case mutations are missed (Meet sometimes mutates video frames
    // without triggering attribute/childList mutations, e.g. canvas-based
    // rendering paths).
    refreshSnapshot();
    tickInterval = setInterval(refreshSnapshot, 1000);

    window.addEventListener('mcm-export-requested', handleExportRequest);
    window.addEventListener('mcm-locate-requested', handleLocateRequest);
    window.addEventListener('mcm-dismiss-requested', handleDismissRequest);
    window.addEventListener('mcm-flag-all-requested', handleFlagAllRequest);
    window.addEventListener('mcm-clear-all-requested', handleClearAllRequest);

    log('Meet Camera Monitor initialized for session', sessionId);
  }

  function refreshSnapshot() {
    if (!tracker) return;
    try {
      const snap = window.MCM_CameraDetector.snapshot();
      tracker.applySnapshot(snap);
    } catch (e) {
      (window.MCM_Logger?.error || console.error)('refreshSnapshot failed', e);
    }
  }

  async function renderTick() {
    if (!tracker || !overlay || !flaggingEngine) return;
    const records = tracker.getSnapshot();
    const evaluated = await flaggingEngine.evaluateAll(records);
    overlay.render(evaluated);
  }

  function notifyBackground(type, record) {
    try {
      chrome.runtime.sendMessage({
        type: `MCM_${type.toUpperCase()}`,
        payload: { name: record.name, id: record.id, sessionId }
      });
    } catch (e) {
      // Service worker may be asleep; non-fatal.
    }
  }

  async function handleExportRequest() {
    const session = await window.MCM_StorageManager.getSession(sessionId);
    chrome.runtime.sendMessage({ type: 'MCM_EXPORT_REQUEST', payload: { sessionId, session } });
  }

  function handleLocateRequest(e) {
    // ASSIST ONLY: opens/scrolls Meet's own participants panel to this
    // person. Never clicks Remove and never calls a removal API — the
    // host does that themselves via Meet's real UI if they choose to.
    const { id, name } = e.detail || {};
    log('Locate requested for participant', id, name, '- opening Meet panel, no automated removal.');
    overlay.setStatus(`Locating ${name} in Meet's participant panel for host review`);
    try {
      window.MCM_DomUtils.assistLocateParticipant(name);
    } catch (err) {
      (window.MCM_Logger?.error || console.error)('assistLocateParticipant failed', err);
    }
  }

  function handleDismissRequest(e) {
    const id = e.detail?.id;
    if (!id || !flaggingEngine) return;
    flaggingEngine.clearFlag(id);
    log('Flag dismissed by host for participant', id);
    renderTick();
  }

  function handleFlagAllRequest() {
    // Forces every currently camera-off participant straight to the
    // "warning" stage in the UI so the host can see/act on the full
    // list at once. This is a tracking/visibility action only - it
    // does not touch Meet or remove anyone.
    if (!tracker) return;
    const offIds = tracker.getSnapshot().filter(r => !r.cameraOn).map(r => r.id);
    offIds.forEach(id => flaggingEngine._warnedIds.add(id));
    log('Flagged all camera-off participants for review:', offIds.length);
    overlay.setStatus(`Flagged ${offIds.length} camera-off participant(s) for review`);
    renderTick();
  }

  function handleClearAllRequest() {
    if (!tracker || !flaggingEngine) return;
    const allIds = tracker.getSnapshot().map(r => r.id);
    flaggingEngine.clearAllFlags(allIds);
    log('Cleared all flags');
    overlay.setStatus('All flags cleared');
    renderTick();
  }

  // Re-render once per second even without DOM changes so timers tick smoothly.
  setInterval(renderTick, 1000);

  if (document.readyState === 'complete') {
    setTimeout(init, 1500); // give Meet's SPA a moment to render the call UI
  } else {
    window.addEventListener('load', () => setTimeout(init, 1500));
  }
})();
