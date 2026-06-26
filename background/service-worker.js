/**
 * background/service-worker.js
 * MV3 service worker. Handles cross-tab messaging, badge text updates,
 * and coordinates export requests from content scripts/popup.
 */
let notifyCount = 0;
let warningCount = 0;
let violationCount = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case 'MCM_NOTIFY':
      notifyCount += 1;
      updateBadge();
      break;

    case 'MCM_WARNING':
      warningCount += 1;
      updateBadge();
      break;

    case 'MCM_VIOLATION':
      violationCount += 1;
      updateBadge();
      console.log('[MCM background] Violation flagged for manual host review:', message.payload?.name);
      break;

    case 'MCM_EXPORT_REQUEST':
      handleExport(message.payload);
      break;

    case 'MCM_RESET_BADGE':
      notifyCount = 0;
      warningCount = 0;
      violationCount = 0;
      updateBadge();
      break;

    default:
      break;
  }
  // Indicate we may respond asynchronously where relevant.
  return true;
});

function updateBadge() {
  const total = notifyCount + warningCount + violationCount;
  chrome.action.setBadgeText({ text: total > 0 ? String(total) : '' });
  chrome.action.setBadgeBackgroundColor({
    color: violationCount > 0 ? '#ea4335' : (warningCount > 0 ? '#fbbc04' : '#4dabf7')
  });
}

async function handleExport(payload) {
  // Export is actually performed in the popup (has DOM access for
  // triggering downloads cleanly); here we just log/acknowledge.
  console.log('[MCM background] Export requested for session', payload?.sessionId);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[MCM background] Meet Camera Monitor installed.');
  chrome.action.setBadgeText({ text: '' });
});
