import {
  INACTIVITY_TIMEOUT_MS,
  PERSIST_INTERVAL_MINUTES,
  MESSAGE_TYPES,
  ALARMS
} from '../shared/constants.js';
import {
  extractDomain,
  shouldTrackUrl,
  getTodayKey
} from '../shared/utils.js';
import {
  getDailyData,
  saveDailyData,
  getLimits,
  setLimit as storageSetLimit,
  removeLimit as storageRemoveLimit,
  cleanupOldData,
  getTimeRange,
  aggregateDomains
} from '../shared/storage.js';

// In-memory state
const state = {
  activeTabId: null,
  activeDomain: null,
  sessionStartTime: null,
  lastActivityTime: null,
  isTracking: false,
  pendingTime: {} // { domain: milliseconds }
};

// Initialize extension
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

async function initialize() {
  console.log('[TimeTracker] Initializing...');

  // Set up periodic persistence alarm
  await chrome.alarms.create(ALARMS.PERSIST_DATA, {
    periodInMinutes: PERSIST_INTERVAL_MINUTES
  });

  // Set up daily cleanup alarm
  await chrome.alarms.create(ALARMS.CLEANUP_DATA, {
    periodInMinutes: 60 * 24 // Once a day
  });

  // Set up inactivity check alarm (every 1 minute - Chrome's minimum)
  // Note: Real-time inactivity detection happens in handleActivityDetected
  await chrome.alarms.create(ALARMS.INACTIVITY_CHECK, {
    periodInMinutes: 1
  });

  // Initialize with current active tab
  await initializeActiveTab();

  console.log('[TimeTracker] Initialized');
}

// Initialize active tab state - runs on every service worker wake
async function initializeActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      console.log('[TimeTracker] Setting initial active tab:', tab.id, extractDomain(tab.url));
      await handleTabChange(tab.id);
    }
  } catch (e) {
    console.error('[TimeTracker] Error initializing active tab:', e);
  }
}

// Also initialize when service worker wakes up (module loads)
initializeActiveTab();

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARMS.PERSIST_DATA) {
    await persistPendingTime();
  } else if (alarm.name === ALARMS.CLEANUP_DATA) {
    await cleanupOldData();
  } else if (alarm.name === ALARMS.INACTIVITY_CHECK) {
    checkInactivityTimeout();
  }
});

// Handle tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await handleTabChange(activeInfo.tabId);
});

// Handle tab URL changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tabId === state.activeTabId) {
    await handleTabChange(tabId);
  }
});

// Handle window focus changes
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus - pause tracking
    await finalizeCurrentSession();
  } else {
    // Browser gained focus - check active tab
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab) {
        await handleTabChange(tab.id);
      }
    } catch (e) {
      console.error('[TimeTracker] Error getting active tab:', e);
    }
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[TimeTracker] Received message:', message.type, 'from tab:', sender.tab?.id);
  handleMessage(message, sender)
    .then(response => {
      console.log('[TimeTracker] Sending response for', message.type, ':', response);
      sendResponse(response);
    })
    .catch(err => {
      console.error('[TimeTracker] Message handler error:', err);
      sendResponse({ error: err.message });
    });
  return true; // Keep channel open for async response
});

/**
 * Handle incoming messages
 */
async function handleMessage(message, sender) {
  switch (message.type) {
    case MESSAGE_TYPES.ACTIVITY_DETECTED:
      return await handleActivityDetected(sender.tab?.id, message.domain);

    case MESSAGE_TYPES.GET_DOMAIN_STATUS:
      return await getDomainStatus(message.domain);

    case MESSAGE_TYPES.GET_TODAY_STATS:
      return await getTodayStats();

    case MESSAGE_TYPES.GET_STATS:
      return await getStats(message.days || 30);

    case MESSAGE_TYPES.SET_LIMIT:
      await storageSetLimit(message.domain, message.limit, message.period || 'day');
      return { success: true };

    case MESSAGE_TYPES.REMOVE_LIMIT:
      await storageRemoveLimit(message.domain);
      return { success: true };

    case MESSAGE_TYPES.GET_LIMITS:
      return await getLimits();

    default:
      console.warn('[TimeTracker] Unknown message type:', message.type);
      return { error: 'Unknown message type' };
  }
}

/**
 * Handle tab change
 */
async function handleTabChange(tabId) {
  // Finalize any current session
  await finalizeCurrentSession();

  try {
    const tab = await chrome.tabs.get(tabId);

    if (!shouldTrackUrl(tab.url)) {
      state.activeTabId = tabId;
      state.activeDomain = null;
      return;
    }

    const domain = extractDomain(tab.url);

    state.activeTabId = tabId;
    state.activeDomain = domain;
    state.sessionStartTime = null;
    state.lastActivityTime = null;
    state.isTracking = false;

  } catch (e) {
    console.error('[TimeTracker] Error handling tab change:', e);
  }
}

/**
 * Handle activity detected from content script
 */
async function handleActivityDetected(tabId, domain) {
  // If we don't have an active tab set, or if this is from a different tab,
  // check if this tab is actually the active one and update our state
  if (state.activeTabId === null || tabId !== state.activeTabId) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id === tabId) {
        // This tab IS the active tab, update our state
        console.log('[TimeTracker] Updating active tab from activity:', tabId, domain);
        state.activeTabId = tabId;
        state.activeDomain = domain;
      } else {
        // Activity from non-active tab, just return status
        return await getDomainStatus(domain);
      }
    } catch (e) {
      console.error('[TimeTracker] Error checking active tab:', e);
      return await getDomainStatus(domain);
    }
  }

  // Domain mismatch (URL changed?) - update domain
  if (domain !== state.activeDomain) {
    await finalizeCurrentSession();
    state.activeDomain = domain;
    state.isTracking = false;
  }

  const now = Date.now();

  // KEY FIX: Check if we were inactive for too long
  // If so, save the previous session and start a new one
  if (state.isTracking && state.lastActivityTime) {
    const timeSinceLastActivity = now - state.lastActivityTime;
    if (timeSinceLastActivity >= INACTIVITY_TIMEOUT_MS) {
      // We were inactive - save time up to last activity
      const activeTime = state.lastActivityTime - state.sessionStartTime;
      if (activeTime > 0 && state.activeDomain) {
        console.log('[TimeTracker] Saving interrupted session:', activeTime, 'ms for', state.activeDomain);
        addPendingTime(state.activeDomain, activeTime);
        // Persist immediately to avoid data loss
        await persistPendingTime();
      }
      // Start fresh session from now
      state.sessionStartTime = now;
    }
  }

  if (!state.isTracking) {
    // Start new tracking session
    state.isTracking = true;
    state.sessionStartTime = now;
    console.log('[TimeTracker] Started tracking:', domain);
  }

  state.lastActivityTime = now;

  // Persist every 30 seconds of active tracking to minimize data loss
  if (state.lastPersistTime === undefined || now - state.lastPersistTime > 30000) {
    state.lastPersistTime = now;
    // Don't await - do it in background
    persistPendingTime().catch(e => console.error('[TimeTracker] Persist error:', e));
  }

  return await getDomainStatus(domain);
}

/**
 * Check for inactivity timeout
 */
function checkInactivityTimeout() {
  if (!state.isTracking || !state.lastActivityTime) return;

  const now = Date.now();
  const timeSinceActivity = now - state.lastActivityTime;

  if (timeSinceActivity >= INACTIVITY_TIMEOUT_MS) {
    // Save accumulated time up to last activity
    const activeTime = state.lastActivityTime - state.sessionStartTime;

    if (activeTime > 0 && state.activeDomain) {
      addPendingTime(state.activeDomain, activeTime);
    }

    // Reset tracking
    state.isTracking = false;
    state.sessionStartTime = null;
    state.lastActivityTime = null;
  }
}

/**
 * Finalize current tracking session
 */
async function finalizeCurrentSession() {
  if (!state.isTracking || !state.sessionStartTime || !state.activeDomain) {
    return;
  }

  const now = Date.now();
  let elapsed;

  if (state.lastActivityTime) {
    // Use last activity time, capped at inactivity timeout
    const timeSinceActivity = now - state.lastActivityTime;
    if (timeSinceActivity >= INACTIVITY_TIMEOUT_MS) {
      elapsed = state.lastActivityTime - state.sessionStartTime;
    } else {
      elapsed = now - state.sessionStartTime;
    }
  } else {
    elapsed = now - state.sessionStartTime;
  }

  if (elapsed > 0) {
    addPendingTime(state.activeDomain, elapsed);
    // Persist immediately to avoid data loss on service worker termination
    await persistPendingTime();
  }

  state.isTracking = false;
  state.sessionStartTime = null;
  state.lastActivityTime = null;
}

/**
 * Add time to pending buffer
 */
function addPendingTime(domain, milliseconds) {
  if (!domain || milliseconds <= 0) return;
  state.pendingTime[domain] = (state.pendingTime[domain] || 0) + milliseconds;
}

/**
 * Persist pending time to storage
 */
async function persistPendingTime() {
  // First finalize any active session to get current time
  const wasTracking = state.isTracking;
  const savedDomain = state.activeDomain;

  if (wasTracking && state.sessionStartTime && state.activeDomain) {
    const now = Date.now();
    const elapsed = now - state.sessionStartTime;
    if (elapsed > 0) {
      addPendingTime(state.activeDomain, elapsed);
    }
    // Reset session start to now (don't lose track)
    state.sessionStartTime = now;
  }

  // Save all pending time
  if (Object.keys(state.pendingTime).length === 0) return;

  const todayKey = getTodayKey();
  const todayData = await getDailyData(todayKey);

  for (const [domain, time] of Object.entries(state.pendingTime)) {
    todayData[domain] = (todayData[domain] || 0) + time;
  }

  await saveDailyData(todayKey, todayData);

  // Clear pending
  state.pendingTime = {};

  console.log('[TimeTracker] Persisted time data');
}

/**
 * Get time for a domain over a specific period
 */
async function getTimeForPeriod(domain, period) {
  const now = new Date();
  let startDate;

  if (period === 'day') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === 'week') {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 29);
    startDate.setHours(0, 0, 0, 0);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const rangeData = await getTimeRange(startDate, now);
  const aggregated = aggregateDomains(Object.values(rangeData));

  let totalTime = aggregated[domain] || 0;

  // Add pending time
  totalTime += state.pendingTime[domain] || 0;

  // Add current session time if tracking this domain
  if (state.isTracking && state.activeDomain === domain && state.sessionStartTime) {
    totalTime += Date.now() - state.sessionStartTime;
  }

  return totalTime;
}

/**
 * Get domain status (time used, limit, exceeded)
 */
async function getDomainStatus(domain) {
  if (!domain) {
    return { hasLimit: false, limitExceeded: false };
  }

  const limits = await getLimits();
  const limitConfig = limits[domain];

  // Get today's time for display
  const todayKey = getTodayKey();
  const todayData = await getDailyData(todayKey);
  let todayTime = todayData[domain] || 0;
  todayTime += state.pendingTime[domain] || 0;
  if (state.isTracking && state.activeDomain === domain && state.sessionStartTime) {
    todayTime += Date.now() - state.sessionStartTime;
  }

  if (!limitConfig) {
    return {
      hasLimit: false,
      limitExceeded: false,
      totalTime: todayTime,
      domain
    };
  }

  // Get time for the limit's period
  const periodTime = await getTimeForPeriod(domain, limitConfig.period);
  const limitExceeded = periodTime > limitConfig.limit;

  return {
    hasLimit: true,
    limit: limitConfig.limit,
    period: limitConfig.period,
    totalTime: todayTime,
    periodTime,
    limitExceeded,
    exceededBy: limitExceeded ? periodTime - limitConfig.limit : 0,
    remainingTime: Math.max(0, limitConfig.limit - periodTime),
    domain
  };
}

/**
 * Get today's stats
 */
async function getTodayStats() {
  const todayKey = getTodayKey();
  const todayData = await getDailyData(todayKey);
  const limits = await getLimits();

  // Add pending time
  const combined = { ...todayData };
  for (const [domain, time] of Object.entries(state.pendingTime)) {
    combined[domain] = (combined[domain] || 0) + time;
  }

  // Add current session time
  if (state.isTracking && state.activeDomain && state.sessionStartTime) {
    const sessionTime = Date.now() - state.sessionStartTime;
    combined[state.activeDomain] = (combined[state.activeDomain] || 0) + sessionTime;
  }

  return {
    date: todayKey,
    data: combined,
    limits
  };
}

/**
 * Get stats for the last N days
 */
async function getStats(days) {
  const todayStats = await getTodayStats();
  const limits = await getLimits();

  // Get historical data
  const dailyData = {};
  dailyData[todayStats.date] = todayStats.data;

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);

  const current = new Date(startDate);
  while (current < endDate) {
    const dateKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
    if (dateKey !== todayStats.date) {
      dailyData[dateKey] = await getDailyData(dateKey);
    }
    current.setDate(current.getDate() + 1);
  }

  return {
    dailyData,
    limits
  };
}
