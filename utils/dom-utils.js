/**
 * utils/dom-utils.js
 * Google Meet's DOM/class names change frequently and are obfuscated
 * (e.g. randomly generated class names). Instead of hard-coding class
 * selectors, we discover elements using stable signals:
 *   - ARIA roles / aria-labels (Meet is accessibility-conscious, these
 *     tend to be far more stable than class names)
 *   - data-* attributes Meet uses internally for participant identity
 *   - structural heuristics (video tiles, mic/camera icon patterns)
 *
 * This file centralizes every "find X in the DOM" operation so that if
 * Meet changes its markup, we only need to update selectors in ONE place.
 */
const DomUtils = (() => {
  const log = window.MCM_Logger?.log || console.log;

  // Known stable-ish anchor points. We keep a LIST of candidate selectors
  // per concept and try them in order, falling back gracefully. This
  // "selector chain" approach is the key resilience strategy.
  const SELECTOR_CHAINS = {
    participantTile: [
      '[data-participant-id]',
      '[data-self-name]',
      'div[data-sort-value]',
      '[jsname][data-requested-participant-id]'
    ],
    participantsPanelList: [
      '[role="list"][aria-label*="articipant" i]',
      'div[aria-label*="Participants" i] [role="list"]'
    ],
    cameraOffIndicator: [
      // Avatar/placeholder shown when camera is off
      'div[data-self-name] img',
      '[aria-label*="camera is off" i]',
      '[aria-label*="no video" i]'
    ],
    micMutedIcon: [
      '[aria-label*="muted" i]'
    ],
    nameLabel: [
      '[data-self-name]',
      '[aria-label$=" presenting"]',
      'span[jsname]'
    ]
  };

  function queryFirst(root, selectors) {
    for (const sel of selectors) {
      try {
        const found = root.querySelectorAll(sel);
        if (found && found.length) return Array.from(found);
      } catch (e) {
        // Invalid/unsupported selector in this Meet version; skip.
      }
    }
    return [];
  }

  function queryAllChain(root, chainKey) {
    const chain = SELECTOR_CHAINS[chainKey];
    if (!chain) {
      log('warn: unknown selector chain', chainKey);
      return [];
    }
    return queryFirst(root, chain);
  }

  /**
   * Heuristic participant tile discovery.
   * A "tile" in Meet is generally a container that:
   *  - holds a <video> OR an avatar <img>/initial-circle for the user
   *  - has some stable data-* attribute identifying the participant
   *  - has an accessible name somewhere inside (aria-label or text)
   *
   * We scan broadly for elements with relevant data-* attributes,
   * then de-duplicate by best-guess participant id.
   */
  function findParticipantTiles(root = document) {
    const candidates = new Set();

    queryAllChain(root, 'participantTile').forEach(el => candidates.add(el));

    // Fallback: any element with a video or avatar img descendant AND
    // an aria-label that looks like a person's name container.
    if (candidates.size === 0) {
      root.querySelectorAll('div').forEach(div => {
        const hasMedia = div.querySelector('video, img[src*="googleusercontent"]');
        const hasNameAttr = div.getAttribute('data-self-name') ||
          div.querySelector('[data-self-name]');
        if (hasMedia && hasNameAttr) candidates.add(div);
      });
    }

    return Array.from(candidates);
  }

  /**
   * Extract a best-effort stable identifier for a participant element.
   * Falls back to a hash of the name if Meet doesn't expose a real id.
   */
  function getParticipantId(tileEl) {
    const directId =
      tileEl.getAttribute('data-participant-id') ||
      tileEl.getAttribute('data-requested-participant-id');
    if (directId) return directId;

    const name = getParticipantName(tileEl);
    if (name) return `name:${simpleHash(name)}`;

    // Last resort: positional id (unstable across reorders, used only
    // as a last-ditch fallback so we never crash).
    return `pos:${Array.from(tileEl.parentElement?.children || []).indexOf(tileEl)}`;
  }

  function getParticipantName(tileEl) {
    const direct = tileEl.getAttribute('data-self-name');
    if (direct) return direct.trim();

    const nameEl = tileEl.querySelector('[data-self-name]');
    if (nameEl) return nameEl.getAttribute('data-self-name')?.trim() || nameEl.textContent.trim();

    // Try aria-label on the tile itself or a child
    const ariaCandidate = tileEl.matches('[aria-label]')
      ? tileEl
      : tileEl.querySelector('[aria-label]');
    if (ariaCandidate) {
      const label = ariaCandidate.getAttribute('aria-label') || '';
      // Strip common suffixes like ", camera is off" if present
      const cleaned = label.split(',')[0].trim();
      if (cleaned && cleaned.length < 80) return cleaned;
    }

    return null;
  }

  /**
   * Determine whether a given participant tile currently has its
   * camera ON or OFF. Strategy:
   *  1. If a live <video> element with readyState > 0 and non-zero
   *     dimensions exists and is NOT hidden -> camera ON.
   *  2. Otherwise, if an avatar image / initials placeholder is visible
   *     -> camera OFF.
   *  3. Fall back to aria-label hints ("camera is off").
   */
  function isCameraOn(tileEl) {
    const video = tileEl.querySelector('video');
    if (video) {
      const rect = video.getBoundingClientRect();
      const visible = rect.width > 2 && rect.height > 2 &&
        getComputedStyle(video).visibility !== 'hidden' &&
        getComputedStyle(video).display !== 'none';
      if (visible && video.readyState >= 2 && !video.paused) {
        return true;
      }
    }

    const offIndicator = tileEl.querySelector(
      '[aria-label*="camera is off" i], [aria-label*="no video" i]'
    );
    if (offIndicator) return false;

    // If we found a video tag but it failed the visibility test, assume off.
    if (video) return false;

    // Unknown -> assume off conservatively (so it gets flagged for human
    // review rather than silently passing).
    return false;
  }

  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Try to find the main "call area" container so we can scope our
   * MutationObserver narrowly instead of observing the whole document
   * (better performance, fewer false triggers).
   */
  function findCallRoot() {
    return (
      document.querySelector('[data-meeting-title]') ||
      document.querySelector('div[jsname][role="main"]') ||
      document.body
    );
  }

  /**
   * ASSIST ONLY: opens Meet's own "People"/Participants panel (if not
   * already open) and scrolls to + briefly highlights the row matching
   * the given name, so a host can find someone in a long participant
   * list in one click. This never clicks Meet's "Remove" control and
   * never calls any removal API — the host still does that themselves.
   */
  function assistLocateParticipant(name) {
    const peopleButton = document.querySelector(
      '[aria-label*="Show everyone" i], [aria-label*="People" i][role="button"]'
    );
    if (peopleButton && !document.querySelector('[role="list"][aria-label*="articipant" i]')) {
      peopleButton.click();
    }

    setTimeout(() => {
      const rows = queryAllChain(document, 'participantsPanelList')
        .flatMap(list => Array.from(list.querySelectorAll('[role="listitem"], li, div')));

      const match = rows.find(row => {
        const text = row.getAttribute('aria-label') || row.textContent || '';
        return text.toLowerCase().includes(name.toLowerCase());
      });

      if (match) {
        match.scrollIntoView({ behavior: 'smooth', block: 'center' });
        match.style.outline = '3px solid #ea4335';
        match.style.outlineOffset = '2px';
        setTimeout(() => { match.style.outline = ''; }, 4000);
      } else {
        log('assistLocateParticipant: could not find row for', name);
      }
    }, 350);
  }

  return {
    findParticipantTiles,
    getParticipantId,
    getParticipantName,
    isCameraOn,
    findCallRoot,
    queryAllChain,
    assistLocateParticipant
  };
})();

window.MCM_DomUtils = DomUtils;
