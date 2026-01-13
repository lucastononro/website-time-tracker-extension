import { SKIP_PROTOCOLS } from './constants.js';

/**
 * Extract domain from a URL
 * @param {string} url - The URL to extract domain from
 * @returns {string|null} - The domain or null if invalid
 */
export function extractDomain(url) {
  if (!url) return null;

  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

/**
 * Check if a URL should be tracked
 * @param {string} url - The URL to check
 * @returns {boolean} - Whether the URL should be tracked
 */
export function shouldTrackUrl(url) {
  if (!url) return false;
  return !SKIP_PROTOCOLS.some(protocol => url.startsWith(protocol));
}

/**
 * Format milliseconds as human-readable duration
 * @param {number} ms - Milliseconds to format
 * @param {boolean} short - Use short format (1h 30m vs 1 hour 30 minutes)
 * @returns {string} - Formatted duration string
 */
export function formatDuration(ms, short = true) {
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
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${seconds}s`;
    }
  } else {
    const parts = [];
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    if (remainingMinutes > 0) parts.push(`${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`);
    if (parts.length === 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
    return parts.join(' ');
  }
}

/**
 * Format a date as a storage key (YYYY-MM-DD)
 * @param {Date} date - The date to format
 * @returns {string} - Formatted date string
 */
export function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get today's date key
 * @returns {string} - Today's date as YYYY-MM-DD
 */
export function getTodayKey() {
  return formatDateKey(new Date());
}

/**
 * Get the start of a week (Monday)
 * @param {Date} date - Reference date
 * @returns {Date} - Start of the week
 */
export function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the end of a week (Sunday)
 * @param {Date} weekStart - Start of the week
 * @returns {Date} - End of the week
 */
export function getWeekEnd(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Truncate a domain for display
 * @param {string} domain - Domain to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} - Truncated domain
 */
export function truncateDomain(domain, maxLength = 25) {
  if (!domain) return '';
  if (domain.length <= maxLength) return domain;
  return domain.substring(0, maxLength - 3) + '...';
}

/**
 * Get top N domains from a time data object
 * @param {Object} data - Object mapping domains to time in ms
 * @param {number} n - Number of top domains to return
 * @returns {Array} - Array of [domain, time] pairs
 */
export function getTopDomains(data, n = 5) {
  return Object.entries(data)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n);
}

/**
 * Get an array of date keys for the last N days
 * @param {number} days - Number of days
 * @returns {Array<string>} - Array of date keys
 */
export function getLastNDaysKeys(days) {
  const keys = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    keys.push(formatDateKey(date));
  }

  return keys;
}
