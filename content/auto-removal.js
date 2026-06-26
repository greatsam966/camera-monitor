/**
 * content/auto-removal.js
 *
 * NOTE ON SCOPE: This file is intentionally named to match the requested
 * architecture, but it does NOT perform any automated participant
 * removal, individually or in bulk. Google Meet has no API for a
 * participant's browser extension to forcibly remove another
 * participant, and even with host configuration and prior notice,
 * ejecting someone with no human judgment in the loop at the moment of
 * action is not something this extension does.
 *
 * What this module DOES do:
 *  - Runs a 3-stage escalation per participant based on camera-off
 *    duration and frequency: Notify -> Warning -> Violation.
 *  - Any stage can be disabled (set to null / "N/A" in settings) and is
 *    then skipped entirely.
 *  - Raises "flaggedForReview" at the Violation stage, surfaced in the
 *    overlay as a red badge with an "Assist" action that opens/scrolls
 *    Meet's own Participants panel to that person. The host still has
 *    to click Meet's real remove control themselves.
 *  - Supports flagging/clearing in bulk for the dashboard's "manage all
 *    camera-off" controls, but this is purely a UI/tracking operation
 *    (acknowledging the flags), never a call into Meet's removal UI.
 */
class FlaggingEngine {
  constructor({ getSettings, onNotify, onWarning, onViolation }) {
    this.getSettings = getSettings;
    this.onNotify = onNotify || (() => {});
    this.onWarning = onWarning || (() => {});
    this.onViolation = onViolation || (() => {});
    this.log = window.MCM_Logger?.log || console.log;
    this._notifiedIds = new Set();
    this._warnedIds = new Set();
    this._violatedIds = new Set();
  }

  /**
   * Evaluate a single participant record (from AttendanceTracker.getSnapshot())
   * against current settings and emit notify/warning/violation events as
   * needed. Called on every tick by main.js.
   */
  async evaluate(record) {
    const settings = await this.getSettings();
    if (!settings.monitoringEnabled) return record;

    if (record.cameraOn) {
      // Camera back on resets all stage flags so a future off-period
      // can re-trigger the full escalation from the top.
      this._notifiedIds.delete(record.id);
      this._warnedIds.delete(record.id);
      this._violatedIds.delete(record.id);
      record.flagLevel = 'compliant';
      return record;
    }

    const offSec = record.currentOffDurationMs / 1000;

    const notifyEnabled = isEnabled(settings.notifyAfterSeconds);
    const warningTimeEnabled = isEnabled(settings.warningAfterSeconds);
    const warningCountEnabled = isEnabled(settings.warningAfterOccurrences);
    const violationEnabled = isEnabled(settings.violationAfterSeconds);

    const hitsNotify = notifyEnabled && offSec >= settings.notifyAfterSeconds;
    const hitsOccurrenceWarning = warningCountEnabled && record.cameraOffCount >= settings.warningAfterOccurrences;
    const hitsTimeWarning = warningTimeEnabled && offSec >= settings.warningAfterSeconds;
    const hitsViolation = violationEnabled && offSec >= settings.violationAfterSeconds;

    let flagLevel = 'compliant';

    if (hitsViolation) {
      flagLevel = 'violation';
      if (!this._violatedIds.has(record.id)) {
        this._violatedIds.add(record.id);
        record.flaggedForReview = true;
        this.log('VIOLATION flagged for manual review:', record.name, `${offSec.toFixed(0)}s off`);
        this.onViolation(record);
      }
    } else if (hitsTimeWarning || hitsOccurrenceWarning) {
      flagLevel = 'warning';
      if (!this._warnedIds.has(record.id)) {
        this._warnedIds.add(record.id);
        this.log('Warning issued:', record.name, `${offSec.toFixed(0)}s off, count=${record.cameraOffCount}`);
        this.onWarning(record);
      }
    } else if (hitsNotify) {
      flagLevel = 'notice';
      if (!this._notifiedIds.has(record.id)) {
        this._notifiedIds.add(record.id);
        this.log('Notice issued:', record.name, `${offSec.toFixed(0)}s off`);
        this.onNotify(record);
      }
    }

    record.flagLevel = flagLevel;
    return record;
  }

  async evaluateAll(records) {
    const out = [];
    for (const r of records) {
      out.push(await this.evaluate(r));
    }
    return out;
  }

  /**
   * Mark a flag as acknowledged/cleared in the tracker's eyes (UI/state
   * only). Does not touch Meet in any way.
   */
  clearFlag(id) {
    this._notifiedIds.delete(id);
    this._warnedIds.delete(id);
    this._violatedIds.delete(id);
  }

  clearAllFlags(ids) {
    ids.forEach(id => this.clearFlag(id));
  }
}

function isEnabled(value) {
  return value !== null && value !== undefined && value !== '' && !Number.isNaN(Number(value));
}

window.MCM_FlaggingEngine = FlaggingEngine;
