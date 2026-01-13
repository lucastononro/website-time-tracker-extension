// Time tracking constants
export const INACTIVITY_TIMEOUT_MS = 15000; // 15 seconds
export const ACTIVITY_THROTTLE_MS = 1000; // Report activity at most once per second
export const PERSIST_INTERVAL_MINUTES = 1; // Save data every minute
export const DATA_RETENTION_DAYS = 90; // Keep 3 months of data

// Storage keys
export const STORAGE_KEYS = {
  LIMITS: 'limits',
  DAILY_PREFIX: 'daily:',
  META: 'meta'
};

// Message types for communication between scripts
export const MESSAGE_TYPES = {
  ACTIVITY_DETECTED: 'ACTIVITY_DETECTED',
  GET_DOMAIN_STATUS: 'GET_DOMAIN_STATUS',
  GET_STATS: 'GET_STATS',
  GET_TODAY_STATS: 'GET_TODAY_STATS',
  SET_LIMIT: 'SET_LIMIT',
  REMOVE_LIMIT: 'REMOVE_LIMIT',
  GET_LIMITS: 'GET_LIMITS'
};

// Alarm names
export const ALARMS = {
  PERSIST_DATA: 'persist-data',
  CLEANUP_DATA: 'cleanup-data',
  INACTIVITY_CHECK: 'inactivity-check'
};

// URLs to skip tracking
export const SKIP_PROTOCOLS = [
  'chrome:',
  'chrome-extension:',
  'about:',
  'file:',
  'devtools:',
  'edge:',
  'brave:'
];
