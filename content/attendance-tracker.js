/**
 * content/attendance-tracker.js
 * Owns the in-memory state for the current session: participant list,
 * join/leave times, camera on/off durations, counts, and compliance
 * scoring. Persists periodically to chrome.storage via StorageManager.
 *
 * Compliance score formula (0-100):
 *   100 - (percentTimeOff * 0.7) - (offCountPenalty)
 *   where offCountPenalty = min(30, offCount * 3)
 * This rewards both "camera mostly on" and "didn't toggle constantly".
 */
class AttendanceTracker {
  constructor({ sessionId, onUpdate }) {
    this.sessionId = sessionId;
    this.onUpdate = onUpdate || (() => {});
    this.participants = new Map(); // id -> record
    this.startedAt = Date.now();
    this.log = window.MCM_Logger?.log || console.log;
    this.persistTimer = null;
  }

  start() {
    this.persistTimer = setInterval(() => this._persist(), 10000);
  }

  stop() {
    if (this.persistTimer) clearInterval(this.persistTimer);
    this._persist();
  }

  /**
   * Called with the latest CameraDetector.snapshot() output.
   * Diffs against known state to detect joins, leaves, and camera
   * toggles, updating all derived metrics.
   */
  applySnapshot(snapshotList) {
    const seenIds = new Set();
    const now = Date.now();

    snapshotList.forEach(({ id, name, cameraOn }) => {
      seenIds.add(id);

      if (!this.participants.has(id)) {
        this._onJoin(id, name, cameraOn, now);
      } else {
        this._onUpdateExisting(id, name, cameraOn, now);
      }
    });

    // Anyone previously tracked but not in this snapshot has left.
    for (const [id, record] of this.participants.entries()) {
      if (!seenIds.has(id) && !record.leaveTime) {
        this._onLeave(id, now);
      }
    }

    this.onUpdate(this.getSnapshot());
  }

  _onJoin(id, name, cameraOn, now) {
    const record = {
      id,
      name,
      joinTime: now,
      leaveTime: null,
      cameraOn,
      offSince: cameraOn ? null : now,
      cameraOffCount: cameraOn ? 0 : 1,
      totalOffDurationMs: 0,
      longestOffDurationMs: 0,
      warningsIssued: [],
      flaggedForReview: false
    };
    this.participants.set(id, record);
    this.log('Participant joined', name, id);
  }

  _onUpdateExisting(id, name, cameraOn, now) {
    const record = this.participants.get(id);
    if (!record) return;

    // Name can change (rare) or resolve from "Unknown" once Meet renders.
    if (name && name !== 'Unknown Participant') record.name = name;

    // Rejoined after being marked left
    if (record.leaveTime) {
      record.leaveTime = null;
      this.log('Participant rejoined', name, id);
    }

    if (record.cameraOn && !cameraOn) {
      // Camera just turned OFF
      record.cameraOn = false;
      record.offSince = now;
      record.cameraOffCount += 1;
      this.log('Camera OFF', name, `count=${record.cameraOffCount}`);
    } else if (!record.cameraOn && cameraOn) {
      // Camera just turned ON
      const offDuration = record.offSince ? now - record.offSince : 0;
      record.totalOffDurationMs += offDuration;
      record.longestOffDurationMs = Math.max(record.longestOffDurationMs, offDuration);
      record.cameraOn = true;
      record.offSince = null;
      record.flaggedForReview = false;
      this.log('Camera ON', name, `offDuration=${offDuration}ms`);
    }
    // else: state unchanged, nothing to do
  }

  _onLeave(id, now) {
    const record = this.participants.get(id);
    if (!record) return;
    record.leaveTime = now;

    // If they left while camera was off, count that final stretch.
    if (!record.cameraOn && record.offSince) {
      const offDuration = now - record.offSince;
      record.totalOffDurationMs += offDuration;
      record.longestOffDurationMs = Math.max(record.longestOffDurationMs, offDuration);
      record.offSince = null;
    }
    this.log('Participant left', record.name, id);
  }

  /**
   * Compute live (real-time) off duration for a participant currently
   * off-camera, without mutating stored totals.
   */
  getCurrentOffDuration(record, now = Date.now()) {
    if (record.cameraOn || !record.offSince) return 0;
    return now - record.offSince;
  }

  getComplianceScore(record, meetingDurationMs) {
    const attendedMs = Math.max(1, (record.leaveTime || Date.now()) - record.joinTime);
    const liveOff = this.getCurrentOffDuration(record);
    const totalOff = record.totalOffDurationMs + liveOff;
    const percentOff = Math.min(100, (totalOff / attendedMs) * 100);
    const offCountPenalty = Math.min(30, record.cameraOffCount * 3);
    const score = Math.max(0, 100 - percentOff * 0.7 - offCountPenalty);
    return Math.round(score * 10) / 10;
  }

  getPercentOff(record) {
    const attendedMs = Math.max(1, (record.leaveTime || Date.now()) - record.joinTime);
    const liveOff = this.getCurrentOffDuration(record);
    const totalOff = record.totalOffDurationMs + liveOff;
    return Math.min(100, Math.round((totalOff / attendedMs) * 1000) / 10);
  }

  getSnapshot() {
    return Array.from(this.participants.values()).map(r => ({
      ...r,
      currentOffDurationMs: this.getCurrentOffDuration(r),
      complianceScore: this.getComplianceScore(r),
      percentOff: this.getPercentOff(r)
    }));
  }

  async _persist() {
    try {
      const sessionData = {
        meetingCode: location.pathname.replace('/', ''),
        startedAt: this.startedAt,
        endedAt: null,
        participants: Object.fromEntries(
          Array.from(this.participants.entries()).map(([id, r]) => [id, r])
        )
      };
      await window.MCM_StorageManager.saveSession(this.sessionId, sessionData);
    } catch (e) {
      (window.MCM_Logger?.error || console.error)('Failed to persist session', e);
    }
  }
}

window.MCM_AttendanceTracker = AttendanceTracker;
