// Popup script

// Format duration for display
function formatDuration(ms, short = true) {
  if (ms < 1000) return short ? '0s' : '0 seconds';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;

  if (short) {
    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${seconds}s`;
    }
  } else {
    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

// Extract domain from URL
function extractDomain(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Truncate domain for display
function truncateDomain(domain, maxLength = 30) {
  if (!domain) return '';
  if (domain.length <= maxLength) return domain;
  return domain.substring(0, maxLength - 3) + '...';
}

// Get top domains from data
function getTopDomains(data, n = 5) {
  return Object.entries(data)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n);
}

// Get today's date key
function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Current domain being viewed
let currentDomain = null;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentDomain = extractDomain(tab?.url);

  // Display current domain
  const domainEl = document.getElementById('current-domain');
  if (currentDomain) {
    domainEl.textContent = truncateDomain(currentDomain);
    domainEl.title = currentDomain;
  } else {
    domainEl.textContent = 'Not trackable';
  }

  // Load and display stats
  await loadStats();

  // Load limit status
  await loadLimitStatus();

  // Set up event listeners
  document.getElementById('set-limit').addEventListener('click', setLimit);
  document.getElementById('remove-limit').addEventListener('click', removeLimit);
  document.getElementById('open-dashboard').addEventListener('click', openDashboard);

  // Refresh stats periodically
  setInterval(loadStats, 5000);
});

// Load and display stats
async function loadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATS', days: 7 });

    if (!response || !response.dailyData) return;

    const todayKey = getTodayKey();
    const todayData = response.dailyData[todayKey] || {};

    // Current site time
    if (currentDomain) {
      const currentSiteTime = todayData[currentDomain] || 0;
      document.getElementById('current-time').textContent = formatDuration(currentSiteTime);
    }

    // Today's total
    const todayTotal = Object.values(todayData).reduce((sum, time) => sum + time, 0);
    document.getElementById('today-total').textContent = formatDuration(todayTotal);

    // Week total
    const weekTotal = Object.values(response.dailyData).reduce((sum, dayData) => {
      return sum + Object.values(dayData).reduce((s, t) => s + t, 0);
    }, 0);
    document.getElementById('week-total').textContent = formatDuration(weekTotal);

    // Top sites
    displayTopSites(todayData);

  } catch (e) {
    console.error('Error loading stats:', e);
  }
}

// Display top sites list
function displayTopSites(data) {
  const list = document.getElementById('top-sites-list');
  const topSites = getTopDomains(data, 5);

  if (topSites.length === 0) {
    list.innerHTML = '<li class="empty-state">No activity yet</li>';
    return;
  }

  list.innerHTML = topSites.map(([domain, time]) => `
    <li>
      <span class="site-domain" title="${domain}">${truncateDomain(domain, 25)}</span>
      <span class="site-time">${formatDuration(time)}</span>
    </li>
  `).join('');
}

// Format period label
function formatPeriod(period) {
  switch (period) {
    case 'day': return 'today';
    case 'week': return 'this week';
    case 'month': return 'this month';
    default: return 'today';
  }
}

// Load limit status for current domain
async function loadLimitStatus() {
  if (!currentDomain) {
    document.querySelector('.limit-section').style.display = 'none';
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_DOMAIN_STATUS',
      domain: currentDomain
    });

    const statusEl = document.getElementById('limit-status');
    const removeBtn = document.getElementById('remove-limit');
    const inputEl = document.getElementById('limit-input');
    const periodEl = document.getElementById('limit-period');

    if (response && response.hasLimit) {
      const limitMinutes = Math.round(response.limit / 60000);
      inputEl.value = limitMinutes;
      periodEl.value = response.period || 'day';

      const periodLabel = formatPeriod(response.period);

      if (response.limitExceeded) {
        statusEl.textContent = `Limit: ${limitMinutes}m/${response.period} (exceeded by ${formatDuration(response.exceededBy)})`;
        statusEl.className = 'limit-status exceeded';
      } else {
        statusEl.textContent = `${formatDuration(response.periodTime)} of ${limitMinutes}m ${periodLabel}`;
        statusEl.className = 'limit-status';
      }

      removeBtn.style.display = 'block';
    } else {
      statusEl.textContent = 'No limit set';
      statusEl.className = 'limit-status';
      removeBtn.style.display = 'none';
      inputEl.value = '';
      periodEl.value = 'day';
    }

  } catch (e) {
    console.error('Error loading limit status:', e);
  }
}

// Set limit for current domain
async function setLimit() {
  if (!currentDomain) return;

  const input = document.getElementById('limit-input');
  const periodEl = document.getElementById('limit-period');
  const minutes = parseInt(input.value, 10);
  const period = periodEl.value;

  if (isNaN(minutes) || minutes < 1) {
    input.focus();
    input.style.borderColor = '#dc3545';
    setTimeout(() => {
      input.style.borderColor = '';
    }, 2000);
    return;
  }

  const milliseconds = minutes * 60 * 1000;

  try {
    await chrome.runtime.sendMessage({
      type: 'SET_LIMIT',
      domain: currentDomain,
      limit: milliseconds,
      period: period
    });

    await loadLimitStatus();

  } catch (e) {
    console.error('Error setting limit:', e);
  }
}

// Remove limit for current domain
async function removeLimit() {
  if (!currentDomain) return;

  try {
    await chrome.runtime.sendMessage({
      type: 'REMOVE_LIMIT',
      domain: currentDomain
    });

    document.getElementById('limit-input').value = '';
    await loadLimitStatus();

  } catch (e) {
    console.error('Error removing limit:', e);
  }
}

// Open dashboard in new tab
function openDashboard() {
  chrome.tabs.create({
    url: chrome.runtime.getURL('src/dashboard/dashboard.html')
  });
}
