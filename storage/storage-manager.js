/**
 * storage/storage-manager.js
 * Thin wrapper around chrome.storage.local so the rest of the codebase
 * never touches the raw API directly. Makes it easy to swap storage
 * backends later and centralizes error handling.
 *
 * Data shape:
 * {
 *   settings: { ... },
 *   sessions: {
 *     [sessionId]: {
 *       meetingCode, startedAt, endedAt,
 *       participants: {
 *         [participantId]: {
 *           name, joinTime, leaveTime,
 *           cameraOffCount, totalOffDurationMs, longestOffDurationMs,
 *           currentlyOff, offSince, warnings: []
 *         }
 *       }
 *     }
 *   }
 * }
 */
const StorageManager = (() => {
  const log = window.MCM_Logger?.log || console.log;
  const err = window.MCM_Logger?.error || console.error;

  const DEFAULT_SETTINGS = {
    monitoringEnabled: true,
    // 3-stage escalation. Any stage can be disabled by setting it to
    // null (shown as "N/A" in settings UI), in which case that stage
    // is skipped entirely for every participant.
    notifyAfterSeconds: 15,
    warningAfterSeconds: 30,
    warningAfterOccurrences: 3,
    violationAfterSeconds: 90,
    // Auto-removal kept ONLY as a manual-review flag + assisted-locate
    // system. There is intentionally no automated removal action
    // anywhere in this extension. "Assist" only opens/scrolls Meet's
    // own participants panel to the flagged person so a host can take
    // action themselves with one real click.
    flagForManualReview: true
  };

  function get(keys) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(keys, result => {
          if (chrome.runtime.lastError) {
            err('storage.get error', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else {
            resolve(result);
          }
        });
      } catch (e) {
        err('storage.get threw', e);
        reject(e);
      }
    });
  }

  function set(obj) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(obj, () => {
          if (chrome.runtime.lastError) {
            err('storage.set error', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      } catch (e) {
        err('storage.set threw', e);
        reject(e);
      }
    });
  }

  async function getSettings() {
    const { settings } = await get('settings');
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  }

  async function saveSettings(partial) {
    const current = await getSettings();
    const merged = { ...current, ...partial };
    await set({ settings: merged });
    log('Settings saved', merged);
    return merged;
  }

  async function getSession(sessionId) {
    const { sessions } = await get('sessions');
    return (sessions || {})[sessionId] || null;
  }

  async function saveSession(sessionId, sessionData) {
    const { sessions } = await get('sessions');
    const updated = { ...(sessions || {}), [sessionId]: sessionData };
    await set({ sessions: updated });
  }

  async function getAllSessions() {
    const { sessions } = await get('sessions');
    return sessions || {};
  }

  async function clearAllSessions() {
    await set({ sessions: {} });
    log('All session data cleared');
  }

  return {
    DEFAULT_SETTINGS,
    getSettings,
    saveSettings,
    getSession,
    saveSession,
    getAllSessions,
    clearAllSessions
  };
})();

window.MCM_StorageManager = StorageManager;
