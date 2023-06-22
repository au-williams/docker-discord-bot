import fs from "fs";

/**
 * Get the URL from a string regardless of its position therein.
 * @param {string} input
 * @returns {string|null}
 */
export function getUrlFromString(input) {
  const match = input.match(/(https?:\/\/[^&\s]+)/);
  return match ? match[1] : null;
}
