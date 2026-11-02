export function getApiErrorMessage(error) {
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return 'The API did not respond within 90 seconds. Render may be waking the free service or the database may be unavailable. No automatic retry was made. Refresh the dashboard and check whether your change succeeded before trying again.';
  }
  return error.response?.data?.error || error.message || 'The API request failed.';
}
