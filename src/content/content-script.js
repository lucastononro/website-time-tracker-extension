// Content script for activity detection and overlay injection
// Note: Cannot use ES modules in content scripts, so constants are inline

const ACTIVITY_THROTTLE_MS = 1000;
const INACTIVITY_CHECK_MS = 5000;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

// State
let lastReportTime = 0;
let isLimitExceeded = false;
let overlayElement = null;
let currentDomain = null;
let activityCheckInterval = null;

// Extract domain from URL
function extractDomain(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Format duration for display
function formatDuration(ms) {
  if (ms < 1000) return '0s';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
}

// Initialize
function init() {
  currentDomain = extractDomain(window.location.href);

  if (!currentDomain) {
    console.log('[TimeTracker] No valid domain, skipping');
    return;
  }

  // Attach activity listeners
  ACTIVITY_EVENTS.forEach(event => {
    document.addEventListener(event, handleActivity, { passive: true, capture: true });
  });

  // Handle visibility changes
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Check domain status on load
  checkDomainStatus();

  // Set up periodic status check
  activityCheckInterval = setInterval(checkDomainStatus, INACTIVITY_CHECK_MS);

  console.log('[TimeTracker] Content script initialized for:', currentDomain);
}

// Handle user activity
function handleActivity() {
  const now = Date.now();

  // Throttle reports
  if (now - lastReportTime < ACTIVITY_THROTTLE_MS) {
    return;
  }

  lastReportTime = now;
  console.log('[TimeTracker] Sending activity for:', currentDomain);

  // Report activity to background
  chrome.runtime.sendMessage({
    type: 'ACTIVITY_DETECTED',
    domain: currentDomain,
    timestamp: now
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[TimeTracker] Message error:', chrome.runtime.lastError);
      cleanup();
      return;
    }

    console.log('[TimeTracker] Activity response:', response);

    if (response && response.limitExceeded && !isLimitExceeded) {
      showLimitExceededOverlay(response.exceededBy);
      isLimitExceeded = true;
    }
  });
}

// Handle visibility change
function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    handleActivity();
    checkDomainStatus();
  }
}

// Check domain status
function checkDomainStatus() {
  chrome.runtime.sendMessage({
    type: 'GET_DOMAIN_STATUS',
    domain: currentDomain
  }, (response) => {
    if (chrome.runtime.lastError) {
      cleanup();
      return;
    }

    if (response) {
      if (response.limitExceeded && !isLimitExceeded) {
        showLimitExceededOverlay(response.exceededBy);
        isLimitExceeded = true;
      } else if (!response.limitExceeded && isLimitExceeded) {
        // Limit was removed or reset
        hideLimitExceededOverlay();
        isLimitExceeded = false;
      } else if (response.limitExceeded && isLimitExceeded && overlayElement) {
        // Update exceeded time
        updateExceededTime(response.exceededBy);
      }
    }
  });
}

// Show limit exceeded overlay
function showLimitExceededOverlay(exceededByMs) {
  if (overlayElement) return;

  overlayElement = document.createElement('div');
  overlayElement.id = 'wtt-limit-overlay';
  overlayElement.innerHTML = `
    <div class="wtt-overlay-content">
      <div class="wtt-warning-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </div>
      <h2>Time Limit Exceeded</h2>
      <p>You've exceeded your limit for <strong>${currentDomain}</strong></p>
      <p class="wtt-exceeded-time">Over by: ${formatDuration(exceededByMs)}</p>
      <button id="wtt-dismiss-btn">Dismiss (continue anyway)</button>
    </div>
  `;

  document.body.appendChild(overlayElement);
  document.body.classList.add('wtt-greyed-out');

  // Dismiss button handler
  const dismissBtn = document.getElementById('wtt-dismiss-btn');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      hideLimitExceededOverlay();
      // Keep isLimitExceeded true so overlay doesn't reappear immediately
    });
  }
}

// Update exceeded time display
function updateExceededTime(exceededByMs) {
  const el = overlayElement?.querySelector('.wtt-exceeded-time');
  if (el) {
    el.textContent = `Over by: ${formatDuration(exceededByMs)}`;
  }
}

// Hide limit exceeded overlay
function hideLimitExceededOverlay() {
  if (overlayElement) {
    overlayElement.remove();
    overlayElement = null;
  }
  document.body.classList.remove('wtt-greyed-out');
}

// Cleanup
function cleanup() {
  ACTIVITY_EVENTS.forEach(event => {
    document.removeEventListener(event, handleActivity, { passive: true, capture: true });
  });
  document.removeEventListener('visibilitychange', handleVisibilityChange);

  if (activityCheckInterval) {
    clearInterval(activityCheckInterval);
    activityCheckInterval = null;
  }

  hideLimitExceededOverlay();
}

// Start
init();
