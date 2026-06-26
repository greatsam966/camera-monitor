/**
 * utils/time-utils.js
 * Formatting and duration math helpers shared across content scripts.
 */
const TimeUtils = (() => {
  function now() {
    return Date.now();
  }

  function formatDuration(ms) {
    if (ms < 0 || isNaN(ms)) return '00:00';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function formatClock(epochMs) {
    if (!epochMs) return '--:--';
    const d = new Date(epochMs);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatPercent(value) {
    return `${Math.round(value * 100) / 100}%`;
  }

  return { now, formatDuration, formatClock, formatPercent };
})();

window.MCM_TimeUtils = TimeUtils;
