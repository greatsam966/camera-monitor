/**
 * popup/popup.js
 * Drives the popup UI: tab switching, session selection, dashboard
 * rendering, settings persistence, and CSV/JSON export generation.
 */
document.addEventListener('DOMContentLoaded', async () => {
  wireTabs();
  await loadSettingsIntoForm();
  await populateSessionPicker();
  wireSettingsSave();
  wireExportButtons();
  wireClearData();
});

function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

async function loadSettingsIntoForm() {
  const settings = await window.MCM_StorageManager.getSettings();
  document.getElementById('setting-monitoring-enabled').checked = settings.monitoringEnabled;

  setFieldWithNA('setting-notify-seconds', 'setting-notify-na', settings.notifyAfterSeconds);
  setFieldWithNA('setting-warning-seconds', 'setting-warning-seconds-na', settings.warningAfterSeconds);
  setFieldWithNA('setting-warning-occurrences', 'setting-warning-occurrences-na', settings.warningAfterOccurrences);
  setFieldWithNA('setting-violation-seconds', 'setting-violation-na', settings.violationAfterSeconds);

  wireNAToggle('setting-notify-seconds', 'setting-notify-na');
  wireNAToggle('setting-warning-seconds', 'setting-warning-seconds-na');
  wireNAToggle('setting-warning-occurrences', 'setting-warning-occurrences-na');
  wireNAToggle('setting-violation-seconds', 'setting-violation-na');
}

function setFieldWithNA(inputId, naId, value) {
  const input = document.getElementById(inputId);
  const na = document.getElementById(naId);
  const isNA = value === null || value === undefined;
  na.checked = isNA;
  input.disabled = isNA;
  input.value = isNA ? '' : value;
}

function wireNAToggle(inputId, naId) {
  const input = document.getElementById(inputId);
  const na = document.getElementById(naId);
  na.addEventListener('change', () => {
    input.disabled = na.checked;
    if (na.checked) input.value = '';
  });
}

function readFieldWithNA(inputId, naId, fallback) {
  const input = document.getElementById(inputId);
  const na = document.getElementById(naId);
  if (na.checked) return null;
  const num = Number(input.value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function wireSettingsSave() {
  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const partial = {
      monitoringEnabled: document.getElementById('setting-monitoring-enabled').checked,
      notifyAfterSeconds: readFieldWithNA('setting-notify-seconds', 'setting-notify-na', 15),
      warningAfterSeconds: readFieldWithNA('setting-warning-seconds', 'setting-warning-seconds-na', 30),
      warningAfterOccurrences: readFieldWithNA('setting-warning-occurrences', 'setting-warning-occurrences-na', 3),
      violationAfterSeconds: readFieldWithNA('setting-violation-seconds', 'setting-violation-na', 90)
    };
    await window.MCM_StorageManager.saveSettings(partial);
    const msg = document.getElementById('settings-saved-msg');
    msg.textContent = 'Saved ✓';
    setTimeout(() => (msg.textContent = ''), 2000);
  });
}

async function populateSessionPicker() {
  const sessions = await window.MCM_StorageManager.getAllSessions();
  const select = document.getElementById('session-select');
  select.innerHTML = '';

  const ids = Object.keys(sessions);
  if (ids.length === 0) {
    document.getElementById('no-session-msg').style.display = 'block';
    return;
  }
  document.getElementById('no-session-msg').style.display = 'none';

  ids
    .sort((a, b) => (sessions[b].startedAt || 0) - (sessions[a].startedAt || 0))
    .forEach(id => {
      const opt = document.createElement('option');
      opt.value = id;
      const date = sessions[id].startedAt ? new Date(sessions[id].startedAt).toLocaleString() : id;
      opt.textContent = `${sessions[id].meetingCode || 'Meeting'} — ${date}`;
      select.appendChild(opt);
    });

  select.addEventListener('change', () => renderTable(sessions[select.value]));
  renderTable(sessions[select.value]);
}

function renderTable(session) {
  const tbody = document.getElementById('participant-table-body');
  tbody.innerHTML = '';
  if (!session) return;

  const participants = Object.values(session.participants || {});
  participants.forEach(p => {
    const attendedMs = (p.leaveTime || Date.now()) - p.joinTime;
    const totalOff = p.totalOffDurationMs + (p.cameraOn ? 0 : (p.offSince ? Date.now() - p.offSince : 0));
    const percentOff = attendedMs > 0 ? Math.min(100, (totalOff / attendedMs) * 100) : 0;
    const compliance = Math.max(0, Math.round((100 - percentOff * 0.7 - Math.min(30, p.cameraOffCount * 3)) * 10) / 10);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td class="${p.cameraOn ? 'status-on' : 'status-off'}">${p.cameraOn ? 'ON' : 'OFF'}</td>
      <td>${window.MCM_TimeUtils.formatDuration(totalOff)}</td>
      <td>${p.cameraOffCount}</td>
      <td>${window.MCM_TimeUtils.formatClock(p.joinTime)}</td>
      <td>${p.leaveTime ? window.MCM_TimeUtils.formatClock(p.leaveTime) : '—'}</td>
      <td>${compliance}%</td>
    `;
    tbody.appendChild(tr);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function wireExportButtons() {
  document.getElementById('export-csv-btn').addEventListener('click', () => exportCurrent('csv'));
  document.getElementById('export-json-btn').addEventListener('click', () => exportCurrent('json'));
}

async function exportCurrent(format) {
  const select = document.getElementById('session-select');
  const sessions = await window.MCM_StorageManager.getAllSessions();
  const session = sessions[select.value];
  if (!session) return;

  const rows = Object.values(session.participants || {}).map(p => {
    const attendedMs = (p.leaveTime || Date.now()) - p.joinTime;
    const totalOff = p.totalOffDurationMs;
    const percentOff = attendedMs > 0 ? Math.min(100, Math.round((totalOff / attendedMs) * 1000) / 10) : 0;
    return {
      name: p.name,
      joinTime: new Date(p.joinTime).toISOString(),
      leaveTime: p.leaveTime ? new Date(p.leaveTime).toISOString() : '',
      cameraOffCount: p.cameraOffCount,
      totalCameraOffDurationSec: Math.round(p.totalOffDurationMs / 1000),
      longestOffDurationSec: Math.round(p.longestOffDurationMs / 1000),
      compliancePercent: Math.max(0, Math.round((100 - percentOff * 0.7 - Math.min(30, p.cameraOffCount * 3)) * 10) / 10)
    };
  });

  const filenameBase = `meet-camera-monitor_${select.value}`;

  if (format === 'json') {
    downloadFile(`${filenameBase}.json`, JSON.stringify(rows, null, 2), 'application/json');
  } else {
    const headers = Object.keys(rows[0] || {
      name: '', joinTime: '', leaveTime: '', cameraOffCount: '',
      totalCameraOffDurationSec: '', longestOffDurationSec: '', compliancePercent: ''
    });
    const csvLines = [headers.join(',')];
    rows.forEach(r => {
      csvLines.push(headers.map(h => csvEscape(r[h])).join(','));
    });
    downloadFile(`${filenameBase}.csv`, csvLines.join('\n'), 'text/csv');
  }
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function wireClearData() {
  document.getElementById('clear-data-btn').addEventListener('click', async () => {
    if (!confirm('Clear all stored session data? This cannot be undone.')) return;
    await window.MCM_StorageManager.clearAllSessions();
    await populateSessionPicker();
  });
}
