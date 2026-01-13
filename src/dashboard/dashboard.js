// Dashboard script

// Check if Chart.js is loaded
if (typeof Chart === 'undefined') {
  console.error('[Dashboard] Chart.js is not loaded!');
} else {
  console.log('[Dashboard] Chart.js loaded successfully, version:', Chart.version);
}

// State
let currentPeriod = 'day';
let statsData = null;
let limitsData = {};
let timeChart = null;
let sitesChart = null;

// Utility functions
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

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDateRange(period) {
  const end = new Date();
  const start = new Date();

  if (period === 'day') {
    // Just today
  } else if (period === 'week') {
    start.setDate(start.getDate() - 6);
  } else if (period === 'month') {
    start.setDate(start.getDate() - 29);
  }

  return { start, end };
}

function formatDateLabel(dateKey, period) {
  const date = new Date(dateKey);
  if (period === 'day') {
    return 'Today';
  } else if (period === 'week') {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Set up period buttons
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector('.period-btn.active').classList.remove('active');
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      updateDashboard();
    });
  });

  // Set up search
  document.getElementById('search-input').addEventListener('input', (e) => {
    filterTable(e.target.value);
  });

  // Set up modal
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', saveLimit);

  // Load initial data
  await loadData();
  updateDashboard();

  // Refresh periodically
  setInterval(async () => {
    await loadData();
    updateDashboard();
  }, 30000);
});

// Load data from background
async function loadData() {
  try {
    const days = currentPeriod === 'day' ? 1 : currentPeriod === 'week' ? 7 : 30;
    statsData = await chrome.runtime.sendMessage({ type: 'GET_STATS', days });
    limitsData = await chrome.runtime.sendMessage({ type: 'GET_LIMITS' });
    console.log('[Dashboard] Loaded stats:', statsData);
    console.log('[Dashboard] Loaded limits:', limitsData);
  } catch (e) {
    console.error('Error loading data:', e);
  }
}

// Update entire dashboard
function updateDashboard() {
  if (!statsData) {
    console.log('[Dashboard] No stats data');
    return;
  }

  const { start, end } = getDateRange(currentPeriod);
  const filteredData = filterDataByPeriod(statsData.dailyData, start, end);

  console.log('[Dashboard] Period:', currentPeriod);
  console.log('[Dashboard] Date range:', start, 'to', end);
  console.log('[Dashboard] Filtered data:', filteredData);

  updateSummaryCards(filteredData);
  updateTimeChart(filteredData);
  updateSitesChart(filteredData);
  updateTable(filteredData);
}

// Filter data by period
function filterDataByPeriod(dailyData, start, end) {
  const filtered = {};
  const startKey = formatDateKey(start);
  const endKey = formatDateKey(end);

  Object.entries(dailyData).forEach(([dateKey, data]) => {
    if (dateKey >= startKey && dateKey <= endKey) {
      filtered[dateKey] = data;
    }
  });

  return filtered;
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Aggregate data across days
function aggregateData(filteredData) {
  const totals = {};
  Object.values(filteredData).forEach(dayData => {
    Object.entries(dayData).forEach(([domain, time]) => {
      totals[domain] = (totals[domain] || 0) + time;
    });
  });
  return totals;
}

// Update summary cards
function updateSummaryCards(filteredData) {
  const aggregated = aggregateData(filteredData);
  const days = Object.keys(filteredData).length || 1;

  // Total time
  const totalTime = Object.values(aggregated).reduce((sum, t) => sum + t, 0);
  document.getElementById('total-time').textContent = formatDuration(totalTime);

  // Sites visited
  const sitesVisited = Object.keys(aggregated).length;
  document.getElementById('sites-visited').textContent = sitesVisited;

  // Daily average
  const avgDaily = totalTime / days;
  document.getElementById('avg-daily').textContent = formatDuration(avgDaily);

  // Limits exceeded
  let exceeded = 0;
  Object.entries(aggregated).forEach(([domain, time]) => {
    if (limitsData[domain] && time > limitsData[domain]) {
      exceeded++;
    }
  });
  document.getElementById('limits-exceeded').textContent = exceeded;
}

// Update time over days chart
function updateTimeChart(filteredData) {
  const canvas = document.getElementById('time-chart');
  if (!canvas) {
    console.error('[Dashboard] time-chart canvas not found');
    return;
  }

  const ctx = canvas.getContext('2d');

  // Sort dates
  const sortedDates = Object.keys(filteredData).sort();
  console.log('[Dashboard] Time chart dates:', sortedDates);

  if (sortedDates.length === 0) {
    console.log('[Dashboard] No dates for time chart');
    if (timeChart) {
      timeChart.destroy();
      timeChart = null;
    }
    return;
  }

  const labels = sortedDates.map(d => formatDateLabel(d, currentPeriod));
  const data = sortedDates.map(d => {
    return Object.values(filteredData[d] || {}).reduce((sum, t) => sum + t, 0) / 60000; // Convert to minutes
  });

  console.log('[Dashboard] Time chart labels:', labels);
  console.log('[Dashboard] Time chart data:', data);

  if (timeChart) {
    timeChart.destroy();
  }

  try {
    timeChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Time (minutes)',
          data,
          borderColor: '#0d6efd',
          backgroundColor: 'rgba(13, 110, 253, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 6,
          pointBackgroundColor: '#0d6efd',
          pointHoverRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: (context) => formatDuration(context.raw * 60000)
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => `${Math.round(value)}m`
            }
          }
        }
      }
    });
    console.log('[Dashboard] Time chart created successfully');
  } catch (e) {
    console.error('[Dashboard] Error creating time chart:', e);
  }
}

// Update top sites chart
function updateSitesChart(filteredData) {
  const canvas = document.getElementById('sites-chart');
  if (!canvas) {
    console.error('[Dashboard] sites-chart canvas not found');
    return;
  }

  const ctx = canvas.getContext('2d');
  const aggregated = aggregateData(filteredData);

  // Get top 10 sites
  const sorted = Object.entries(aggregated)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  console.log('[Dashboard] Top sites:', sorted);

  if (sorted.length === 0) {
    console.log('[Dashboard] No sites for chart');
    if (sitesChart) {
      sitesChart.destroy();
      sitesChart = null;
    }
    return;
  }

  // Store full domain names for tooltips
  const fullDomains = sorted.map(([domain]) => domain);
  const labels = sorted.map(([domain]) => truncateDomain(domain, 20));
  const data = sorted.map(([, time]) => time / 60000);

  // Generate gradient colors
  const colors = [
    '#0d6efd', '#6610f2', '#6f42c1', '#d63384',
    '#dc3545', '#fd7e14', '#ffc107', '#198754',
    '#20c997', '#17a2b8'
  ];

  if (sitesChart) {
    sitesChart.destroy();
  }

  try {
    sitesChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Time',
          data,
          backgroundColor: colors.slice(0, sorted.length),
          borderRadius: 6,
          barThickness: 24
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              title: (context) => fullDomains[context[0].dataIndex],
              label: (context) => formatDuration(context.raw * 60000)
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              callback: (value) => `${Math.round(value)}m`
            }
          },
          y: {
            ticks: {
              font: {
                size: 12
              }
            }
          }
        }
      }
    });
    console.log('[Dashboard] Sites chart created successfully');
  } catch (e) {
    console.error('[Dashboard] Error creating sites chart:', e);
  }
}

function truncateDomain(domain, maxLength = 25) {
  if (!domain) return '';
  if (domain.length <= maxLength) return domain;
  return domain.substring(0, maxLength - 3) + '...';
}

// Format period for display
function formatPeriodShort(period) {
  switch (period) {
    case 'day': return '/day';
    case 'week': return '/week';
    case 'month': return '/month';
    default: return '/day';
  }
}

// Update table
function updateTable(filteredData) {
  const aggregated = aggregateData(filteredData);
  const tbody = document.getElementById('sites-table-body');

  console.log('[Dashboard] Table aggregated data:', aggregated);

  const sorted = Object.entries(aggregated).sort(([, a], [, b]) => b - a);

  console.log('[Dashboard] Table sorted entries:', sorted.length);

  if (sorted.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">No data for this period</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = sorted.map(([domain, time]) => {
    const limitConfig = limitsData[domain];
    const limit = limitConfig?.limit;
    const period = limitConfig?.period || 'day';
    const exceeded = limit && time > limit;

    let limitCell;
    if (limit) {
      const limitMinutes = Math.round(limit / 60000);
      if (exceeded) {
        limitCell = `<span class="limit-exceeded">${limitMinutes}m${formatPeriodShort(period)} (exceeded)</span>`;
      } else {
        limitCell = `<span class="limit-value">${limitMinutes}m${formatPeriodShort(period)}</span>`;
      }
    } else {
      limitCell = `<span class="limit-value">-</span>`;
    }

    return `
      <tr data-domain="${domain}">
        <td class="site-name" title="${domain}">${truncateDomain(domain, 40)}</td>
        <td class="time-value">${formatDuration(time)}</td>
        <td>${limitCell}</td>
        <td>
          <button class="action-btn set-limit" onclick="openLimitModal('${domain}')">
            ${limit ? 'Edit' : 'Set'} Limit
          </button>
          ${limit ? `<button class="action-btn remove-limit" onclick="removeLimitForDomain('${domain}')">Remove</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

// Filter table by search
function filterTable(query) {
  const rows = document.querySelectorAll('#sites-table-body tr');
  const lowerQuery = query.toLowerCase();

  rows.forEach(row => {
    const domain = row.dataset.domain || '';
    if (domain.toLowerCase().includes(lowerQuery)) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

// Modal functions
let modalDomain = null;

function openLimitModal(domain) {
  modalDomain = domain;
  document.getElementById('modal-domain').textContent = domain;

  const existingLimit = limitsData[domain];
  if (existingLimit) {
    document.getElementById('modal-limit-input').value = Math.round(existingLimit.limit / 60000);
    document.getElementById('modal-limit-period').value = existingLimit.period || 'day';
  } else {
    document.getElementById('modal-limit-input').value = '';
    document.getElementById('modal-limit-period').value = 'day';
  }

  document.getElementById('limit-modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('limit-modal').style.display = 'none';
  modalDomain = null;
}

async function saveLimit() {
  if (!modalDomain) return;

  const minutes = parseInt(document.getElementById('modal-limit-input').value, 10);
  const period = document.getElementById('modal-limit-period').value;

  if (isNaN(minutes) || minutes < 1) {
    document.getElementById('modal-limit-input').style.borderColor = '#dc3545';
    return;
  }

  const milliseconds = minutes * 60 * 1000;

  try {
    await chrome.runtime.sendMessage({
      type: 'SET_LIMIT',
      domain: modalDomain,
      limit: milliseconds,
      period: period
    });

    limitsData[modalDomain] = { limit: milliseconds, period };
    closeModal();
    updateDashboard();
  } catch (e) {
    console.error('Error setting limit:', e);
  }
}

async function removeLimitForDomain(domain) {
  try {
    await chrome.runtime.sendMessage({
      type: 'REMOVE_LIMIT',
      domain
    });

    delete limitsData[domain];
    updateDashboard();
  } catch (e) {
    console.error('Error removing limit:', e);
  }
}

// Make functions globally available for onclick handlers
window.openLimitModal = openLimitModal;
window.removeLimitForDomain = removeLimitForDomain;
