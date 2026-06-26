# Meet Camera Monitor

A Manifest V3 Chrome extension that monitors participant camera activity
during Google Meet calls and maintains attendance/compliance records.

## ⚠️ Important scope note: no automated removal

This extension **does not and will not remove participants from a
meeting automatically** — not one at a time, and not in bulk, even if
the host configures thresholds and announces them to the meeting in
advance. Google Meet has no public API for a browser extension to
forcibly eject a participant, and scripting clicks on Meet's internal
"remove" controls would be both fragile (breaks on every Meet UI
update) and an inappropriate way to take action against a person with
no individual judgment exercised at the moment of removal.

Instead, the extension gives the host fast, low-friction tools to act
**themselves**:
- A 3-stage escalation per participant — **Notify → Warning →
  Violation** — each stage independently configurable, and each can be
  set to **N/A** to disable it entirely.
- **Bulk "Flag all camera-off"** and **"Clear all flags"** buttons in
  the overlay, for managing many participants' flags at once.
- A per-participant **"Locate"** button on violations, which opens (or
  scrolls) Meet's own Participants panel and highlights that person —
  this never clicks Remove and never calls any removal API. It just
  saves the host from hunting through a long list; the actual removal,
  if the host decides it's warranted, is one real click on Meet's own
  control.
- A per-participant **dismiss (✕)** button to clear an individual flag
  once reviewed.

## Folder structure

```
meet-monitor/
├── manifest.json
├── popup/
│   ├── popup.html       Dashboard + Settings UI
│   ├── popup.css
│   └── popup.js
├── background/
│   └── service-worker.js   Badge updates, cross-tab messaging
├── content/
│   ├── meet-observer.js     MutationObserver lifecycle, auto-reattach
│   ├── camera-detector.js   Per-tile camera ON/OFF detection
│   ├── attendance-tracker.js Join/leave + camera state machine
│   ├── auto-removal.js      Warning/violation flagging (NO auto-removal)
│   ├── ui-overlay.js        Floating in-meeting panel
│   ├── overlay.css
│   └── main.js               Wires everything together
├── utils/
│   ├── logger.js
│   ├── dom-utils.js          Resilient, selector-chain DOM discovery
│   └── time-utils.js
├── storage/
│   └── storage-manager.js    chrome.storage.local wrapper
└── assets/
    └── icon16/48/128.png
```

## Architecture

**Data flow (content script side), once per second / on DOM mutation:**

```
MeetObserver (MutationObserver, debounced)
        │ triggers
        ▼
CameraDetector.snapshot()
   - finds participant tiles via DomUtils selector chains
   - reads camera ON/OFF per tile
        │ produces [{id, name, cameraOn}, ...]
        ▼
AttendanceTracker.applySnapshot()
   - diffs against known state
   - detects joins / leaves / camera toggles
   - updates counts, durations, compliance score
        │ produces full participant records
        ▼
FlaggingEngine.evaluateAll()
   - compares live off-duration / off-count to settings thresholds
   - emits warning / violation events (flag only, never an action)
        │
        ▼
UiOverlay.render()
   - draws the floating panel
   - StorageManager persists snapshot every 10s for the popup/export
```

**Why a "selector chain" abstraction (`utils/dom-utils.js`)?**
Google Meet ships obfuscated, frequently-changing class names. Rather
than hard-coding `.XEazBc` style selectors that break on every Meet
deploy, each "concept" (participant tile, name, camera-off indicator)
has an ordered list of candidate selectors based on stable signals:
ARIA roles/labels, `data-*` attributes Meet uses for internal participant
identity, and structural heuristics (presence of `<video>` vs avatar
`<img>`). If Meet changes its markup, only this one file needs updates.

**Why a health-check timer in `MeetObserver`?**
Meet sometimes replaces its entire call-root container (e.g. switching
between grid/spotlight layouts), which silently detaches any
MutationObserver bound to the old node. A periodic health check
verifies the observed root is still in the document and re-binds if
not — this is what keeps monitoring alive "across Meet DOM refreshes".

**Why poll every 1s in addition to MutationObserver?**
Some Meet camera-off transitions update via canvas/video frame changes
that don't always fire DOM mutations Chrome's MutationObserver can see.
The 1s poll is a low-cost safety net so camera state is never silently
stale.

## Compliance score formula

```
percentOff   = (totalCameraOffMs / totalAttendedMs) * 100
offPenalty   = min(30, cameraOffCount * 3)
score        = max(0, 100 - percentOff * 0.7 - offPenalty)
```

This rewards both "camera was on most of the time" and "didn't toggle
the camera on/off repeatedly" (frequent toggling is itself disruptive
even if total off-time is short).

## Installation (unpacked, for development)

1. Download/clone this `meet-monitor/` folder.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `meet-monitor/` folder.
5. Join a Google Meet call. The floating panel should appear within ~1.5s.
6. Click the extension icon in the toolbar to open the dashboard,
   adjust settings, or export data.

## Settings

| Setting | Description |
|---|---|
| Enable Monitoring | Master on/off switch |
| Notify after (seconds) | Time camera can be off before a blue notice (1st stage). Set to N/A to disable. |
| Warning after (seconds) | Time camera can be off before a yellow warning (2nd stage). Set to N/A to disable. |
| Warning after (occurrences) | Number of off-toggles before a yellow warning. Set to N/A to disable. |
| Flag for review after (seconds) | Time camera off before a red "needs host review" flag (3rd stage). Set to N/A to disable. |

Disabling a stage (N/A) skips it entirely for every participant — e.g.
setting Notify to N/A means participants go straight from compliant to
Warning once they hit that threshold.

## Bulk and per-participant actions

- **Flag all camera-off** — instantly marks every currently camera-off
  participant as "Warning" so the host can see the full list at a
  glance, without waiting for each person's individual timer.
- **Clear all flags** — resets every participant's flag state back to
  compliant (does not turn anyone's camera on or affect the call).
- **Locate** (on violations) — opens/scrolls Meet's own Participants
  panel to that person. Assist only; no removal action is taken.
- **✕ Dismiss** (on notices/warnings) — clears that one person's flag
  after the host has reviewed it.

## Export

From the popup Dashboard tab, pick a session and click **Export CSV**
or **Export JSON**. Exported fields: Participant Name, Join Time, Leave
Time, Camera OFF Count, Total Camera OFF Duration, Longest OFF Duration,
Compliance %.

## Known limitations

- Participant identification relies on heuristics since Meet doesn't
  expose a guaranteed-stable participant ID to page scripts; in rare
  cases (e.g. two participants with identical display names and no
  other distinguishing DOM signal) records could merge. A name-hash
  fallback ID is used when no `data-participant-id` is present.
- Camera-off detection in screen-share / presentation layouts may need
  selector-chain updates if Meet changes that layout's markup — update
  `SELECTOR_CHAINS` in `utils/dom-utils.js`.
- This extension only observes the DOM of the tab it's running in; it
  has no way to detect camera state from participants on other calls,
  no way to access raw camera/mic hardware feeds, and (by design) no
  way to remove anyone from the call.
