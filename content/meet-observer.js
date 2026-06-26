/**
 * content/meet-observer.js
 * Owns the MutationObserver lifecycle. Google Meet frequently re-renders
 * large chunks of its DOM (e.g. switching layouts, screen share toggling,
 * grid view changes). Naive observers attached once will silently stop
 * working when their target node gets replaced.
 *
 * Strategy:
 *  - Observe document.body at a coarse level (childList + subtree) so we
 *    always see when the call root appears/disappears/gets replaced.
 *  - Debounce callbacks so rapid bursts of mutations (common in Meet)
 *    don't cause thrashing.
 *  - Periodically verify our "call root" reference is still attached to
 *    the document; if not, re-discover it and re-bind.
 */
class MeetObserver {
  constructor({ onChange, debounceMs = 400, healthCheckMs = 5000 }) {
    this.onChange = onChange;
    this.debounceMs = debounceMs;
    this.healthCheckMs = healthCheckMs;
    this.observer = null;
    this.debounceTimer = null;
    this.healthTimer = null;
    this.callRoot = null;
    this.log = window.MCM_Logger?.log || console.log;
    this.warn = window.MCM_Logger?.warn || console.warn;
  }

  start() {
    this._bind();
    this.healthTimer = setInterval(() => this._healthCheck(), this.healthCheckMs);
    this.log('MeetObserver started');
  }

  stop() {
    if (this.observer) this.observer.disconnect();
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.log('MeetObserver stopped');
  }

  _bind() {
    try {
      if (this.observer) this.observer.disconnect();

      this.callRoot = window.MCM_DomUtils.findCallRoot();
      this.observer = new MutationObserver(mutations => this._handleMutations(mutations));
      this.observer.observe(this.callRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-label', 'data-self-name', 'class']
      });
      this.log('Observer bound to call root', this.callRoot);
    } catch (e) {
      this.warn('Failed to bind observer, will retry on next health check', e);
    }
  }

  _handleMutations(mutations) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      try {
        this.onChange(mutations);
      } catch (e) {
        (window.MCM_Logger?.error || console.error)('onChange handler threw', e);
      }
    }, this.debounceMs);
  }

  _healthCheck() {
    // If the call root we observed got detached from the DOM (Meet
    // sometimes replaces the entire call container on layout changes),
    // re-discover and re-bind.
    if (!this.callRoot || !document.body.contains(this.callRoot)) {
      this.warn('Call root detached, rebinding observer');
      this._bind();
      // Force an immediate refresh too, since we may have missed changes.
      try {
        this.onChange([]);
      } catch (e) {
        (window.MCM_Logger?.error || console.error)('onChange handler threw during rebind', e);
      }
    }
  }
}

window.MCM_MeetObserver = MeetObserver;
