import Logger from "../logger.js"

/**
 * The retry policy for the `fetch-retry` NPM package
 */
export const fetchRetryPolicy = {
  retries: 10,
  retryDelay: 1000,
  retryOn: [501, 502, 503]
}

/**
 * The options for the `croner` NPM package
 * @param {string} pluginFilename
 */
export const getCronOptions = pluginFilename => ({
  catch: ({ stack }) => Logger.error(stack, pluginFilename),
  name: pluginFilename,
  protect: true
})
