/**
 * utils/logger.js
 * Centralized, namespaced logging so debugging Meet DOM issues is easier.
 * Toggle DEBUG to false to silence verbose logs in production.
 */
const Logger = (() => {
  const DEBUG = true;
  const PREFIX = '[MeetCameraMonitor]';

  function ts() {
    return new Date().toISOString().split('T')[1].replace('Z', '');
  }

  function log(...args) {
    if (DEBUG) console.log(`${PREFIX} [${ts()}]`, ...args);
  }

  function warn(...args) {
    console.warn(`${PREFIX} [${ts()}]`, ...args);
  }

  function error(...args) {
    console.error(`${PREFIX} [${ts()}]`, ...args);
  }

  function group(label, fn) {
    if (!DEBUG) return fn();
    console.groupCollapsed(`${PREFIX} ${label}`);
    try {
      fn();
    } finally {
      console.groupEnd();
    }
  }

  return { log, warn, error, group };
})();

// Expose globally for non-module content scripts
if (typeof window !== 'undefined') window.MCM_Logger = Logger;
if (typeof self !== 'undefined' && typeof window === 'undefined') self.MCM_Logger = Logger;
