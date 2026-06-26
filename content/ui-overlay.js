/**
 * content/ui-overlay.js
 * Renders and updates the floating panel inside the Meet tab.
 * Pure DOM manipulation, no framework dependency, to keep the content
 * script lightweight and avoid bundler requirements.
 */
class UiOverlay {
  constructor() {
    this.root = null;
    this.minimized = false;
    this.log = window.MCM_Logger?.log || console.log;
  }

  mount() {
    if (document.getElementById('mcm-overlay-root')) return;

    const root = document.createElement('div');
    root.id = 'mcm-overlay-root';
    root.innerHTML = `
      <div class="mcm-panel">
        <div class="mcm-header">
          <span class="mcm-title">📷 Camera Monitor</span>
          <div class="mcm-header-actions">
            <button class="mcm-icon-btn" id="mcm-export-btn" title="Export data">⬇</button>
            <button class="mcm-icon-btn" id="mcm-minimize-btn" title="Minimize">—</button>
          </div>
        </div>
        <div class="mcm-summary">
          <div class="mcm-stat"><span class="mcm-stat-value" id="mcm-total-count">0</span><span class="mcm-stat-label">Participants</span></div>
          <div class="mcm-stat"><span class="mcm-stat-value" id="mcm-off-count">0</span><span class="mcm-stat-label">Camera Off</span></div>
          <div class="mcm-stat"><span class="mcm-stat-value" id="mcm-warning-count">0</span><span class="mcm-stat-label">Flagged</span></div>
        </div>
        <div class="mcm-bulk-actions">
          <button class="mcm-bulk-btn" id="mcm-flag-all-btn">Flag all camera-off</button>
          <button class="mcm-bulk-btn" id="mcm-clear-all-btn">Clear all flags</button>
        </div>
        <div class="mcm-list" id="mcm-participant-list"></div>
        <div class="mcm-footer">
          <span id="mcm-status-text">Monitoring active</span>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;

    root.querySelector('#mcm-minimize-btn').addEventListener('click', () => this.toggleMinimize());
    root.querySelector('#mcm-export-btn').addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('mcm-export-requested'));
    });
    root.querySelector('#mcm-flag-all-btn').addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('mcm-flag-all-requested'));
    });
    root.querySelector('#mcm-clear-all-btn').addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('mcm-clear-all-requested'));
    });

    this._makeDraggable(root.querySelector('.mcm-header'), root);
    this.log('Overlay mounted');
  }

  toggleMinimize() {
    this.minimized = !this.minimized;
    this.root.classList.toggle('mcm-minimized', this.minimized);
  }

  _makeDraggable(handle, panelRoot) {
    let offsetX = 0, offsetY = 0, dragging = false;
    handle.addEventListener('mousedown', e => {
      dragging = true;
      const rect = panelRoot.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      panelRoot.style.left = `${e.clientX - offsetX}px`;
      panelRoot.style.top = `${e.clientY - offsetY}px`;
      panelRoot.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  /**
   * records: array from AttendanceTracker.getSnapshot() + FlaggingEngine.evaluate()
   */
  render(records) {
    if (!this.root) return;
    const offCount = records.filter(r => !r.cameraOn).length;
    const warningCount = records.filter(r => r.flagLevel === 'warning' || r.flagLevel === 'violation').length;

    this.root.querySelector('#mcm-total-count').textContent = records.length;
    this.root.querySelector('#mcm-off-count').textContent = offCount;
    this.root.querySelector('#mcm-warning-count').textContent = warningCount;

    const list = this.root.querySelector('#mcm-participant-list');
    list.innerHTML = '';

    records
      .slice()
      .sort((a, b) => flagRank(b.flagLevel) - flagRank(a.flagLevel))
      .forEach(r => {
        const row = document.createElement('div');
        row.className = `mcm-row mcm-flag-${r.flagLevel || 'compliant'}`;

        const timer = !r.cameraOn
          ? window.MCM_TimeUtils.formatDuration(r.currentOffDurationMs)
          : '—';

        const actionBtn = r.flagLevel === 'violation'
          ? `<button class="mcm-assist-btn" data-id="${r.id}" data-name="${escapeAttr(r.name)}" title="Open Meet's participant panel and locate them — host clicks Remove themselves">Locate</button>
             <button class="mcm-dismiss-btn" data-id="${r.id}" title="Clear this flag">✕</button>`
          : (r.flagLevel === 'warning' || r.flagLevel === 'notice')
            ? `<button class="mcm-dismiss-btn" data-id="${r.id}" title="Clear this flag">✕</button>`
            : '';

        row.innerHTML = `
          <span class="mcm-dot"></span>
          <span class="mcm-name" title="${escapeAttr(r.name)}">${escapeAttr(r.name)}</span>
          <span class="mcm-timer">${timer}</span>
          <span class="mcm-score">${r.complianceScore}%</span>
          ${actionBtn}
        `;
        list.appendChild(row);
      });

    // "Locate" assists the host in finding the person in Meet's own
    // participants panel; it never clicks Remove itself.
    list.querySelectorAll('.mcm-assist-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('mcm-locate-requested', {
          detail: { id: btn.dataset.id, name: btn.dataset.name }
        }));
      });
    });

    list.querySelectorAll('.mcm-dismiss-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('mcm-dismiss-requested', { detail: { id: btn.dataset.id } }));
      });
    });
  }

  setStatus(text) {
    if (!this.root) return;
    this.root.querySelector('#mcm-status-text').textContent = text;
  }

  unmount() {
    if (this.root) this.root.remove();
    this.root = null;
  }
}

window.MCM_UiOverlay = UiOverlay;

function flagRank(level) {
  return { violation: 3, warning: 2, notice: 1, compliant: 0 }[level] ?? 0;
}

function escapeAttr(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
