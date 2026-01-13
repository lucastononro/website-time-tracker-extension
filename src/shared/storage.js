import { STORAGE_KEYS, DATA_RETENTION_DAYS } from './constants.js';
import { formatDateKey, getTodayKey } from './utils.js';

/**
 * Get daily time data for a specific date
 * @param {Date|string} date - Date or date key string
 * @returns {Promise<Object>} - Object mapping domains to time in ms
 */
export async function getDailyData(date) {
  const key = typeof date === 'string'
    ? `${STORAGE_KEYS.DAILY_PREFIX}${date}`
    : `${STORAGE_KEYS.DAILY_PREFIX}${formatDateKey(date)}`;

  const result = await chrome.storage.local.get(key);
  return result[key] || {};
}

/**
 * Save daily time data for a specific date
 * @param {Date|string} date - Date or date key string
 * @param {Object} data - Object mapping domains to time in ms
 */
export async function saveDailyData(date, data) {
  const key = typeof date === 'string'
    ? `${STORAGE_KEYS.DAILY_PREFIX}${date}`
    : `${STORAGE_KEYS.DAILY_PREFIX}${formatDateKey(date)}`;

  await chrome.storage.local.set({ [key]: data });
}

/**
 * Add time for a domain to today's data
 * @param {string} domain - The domain
 * @param {number} milliseconds - Time to add in ms
 * @returns {Promise<number>} - New total time for the domain today
 */
export async function addTimeForDomain(domain, milliseconds) {
  const todayKey = getTodayKey();
  const data = await getDailyData(todayKey);
  data[domain] = (data[domain] || 0) + milliseconds;
  await saveDailyData(todayKey, data);
  return data[domain];
}

/**
 * Get time data for a date range
 * @param {Date} startDate - Start date (inclusive)
 * @param {Date} endDate - End date (inclusive)
 * @returns {Promise<Object>} - Object mapping date keys to daily data
 */
export async function getTimeRange(startDate, endDate) {
  const keys = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    keys.push(`${STORAGE_KEYS.DAILY_PREFIX}${formatDateKey(current)}`);
    current.setDate(current.getDate() + 1);
  }

  const result = await chrome.storage.local.get(keys);

  return keys.reduce((acc, key) => {
    const dateKey = key.replace(STORAGE_KEYS.DAILY_PREFIX, '');
    acc[dateKey] = result[key] || {};
    return acc;
  }, {});
}

/**
 * Get all stored limits
 * @returns {Promise<Object>} - Object mapping domains to limit config { limit: ms, period: 'day'|'week'|'month' }
 */
export async function getLimits() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LIMITS);
  const limits = result[STORAGE_KEYS.LIMITS] || {};

  // Migrate old format (just ms) to new format (object with limit and period)
  const migrated = {};
  for (const [domain, value] of Object.entries(limits)) {
    if (typeof value === 'number') {
      // Old format - migrate to daily limit
      migrated[domain] = { limit: value, period: 'day' };
    } else {
      migrated[domain] = value;
    }
  }

  return migrated;
}

/**
 * Set a time limit for a domain
 * @param {string} domain - The domain
 * @param {number} milliseconds - Limit in ms
 * @param {string} period - 'day', 'week', or 'month'
 */
export async function setLimit(domain, milliseconds, period = 'day') {
  const limits = await getLimits();
  limits[domain] = { limit: milliseconds, period };
  await chrome.storage.local.set({ [STORAGE_KEYS.LIMITS]: limits });
}

/**
 * Remove a time limit for a domain
 * @param {string} domain - The domain
 */
export async function removeLimit(domain) {
  const limits = await getLimits();
  delete limits[domain];
  await chrome.storage.local.set({ [STORAGE_KEYS.LIMITS]: limits });
}

/**
 * Get limit for a specific domain
 * @param {string} domain - The domain
 * @returns {Promise<Object|null>} - { limit: ms, period: string } or null if no limit
 */
export async function getLimit(domain) {
  const limits = await getLimits();
  return limits[domain] || null;
}

/**
 * Clean up data older than retention period
 */
export async function cleanupOldData() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DATA_RETENTION_DAYS);

  const allData = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(allData).filter(key => {
    if (!key.startsWith(STORAGE_KEYS.DAILY_PREFIX)) return false;
    const dateStr = key.replace(STORAGE_KEYS.DAILY_PREFIX, '');
    return new Date(dateStr) < cutoffDate;
  });

  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
    console.log(`[TimeTracker] Cleaned up ${keysToRemove.length} old data entries`);
  }
}

/**
 * Aggregate daily data by domain
 * @param {Array<Object>} dataArray - Array of daily data objects
 * @returns {Object} - Aggregated object mapping domains to total time
 */
export function aggregateDomains(dataArray) {
  return dataArray.reduce((acc, dayData) => {
    Object.entries(dayData).forEach(([domain, time]) => {
      acc[domain] = (acc[domain] || 0) + time;
    });
    return acc;
  }, {});
}

/**
 * Get aggregated data for the last N days
 * @param {number} days - Number of days
 * @returns {Promise<Object>} - Aggregated domain data
 */
export async function getAggregatedData(days) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);

  const rangeData = await getTimeRange(startDate, endDate);
  return aggregateDomains(Object.values(rangeData));
}
