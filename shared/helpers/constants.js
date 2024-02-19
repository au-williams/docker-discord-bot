/**
 * The retry policy for the `fetch-retry` NPM package
 */
export const fetchRetryPolicy = Object.freeze({
  retries: 10,
  retryDelay: 1000,
  retryOn: [501, 502, 503]
})
