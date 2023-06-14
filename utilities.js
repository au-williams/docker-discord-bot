import fs from "fs";

export const getBaseTextChannel = channel => channel.thread ? channel.parent : channel;

/**
 * Get the URL from a string regardless of its position therein.
 * @param {string} input
 * @returns {string|null}
 */
export function getUrlFromString(input) {
  const urlRegex = /(https?:\/\/[^\s]+)/;
  const match = input.match(urlRegex);
  return (match && match[1]) || null;
}

/**
 * Get the size of a file in megabytes rounded to two decimal places.
 * @param {string} filepath
 * @returns {number}
 */
export function getFileSizeFromPath(filepath) {
  return Math.round((fs.statSync(filepath).size / (1024 * 1024) + Number.EPSILON) * 100) / 100;
}

/**
 * Fetch the message by id to check for existence and delete it.
 */
export async function tryDeleteDiscordMessages(...cachedMessages) {
  for (const cachedMessage of cachedMessages) {
    await cachedMessage.channel.messages
      .fetch(cachedMessage.id)
      .then(fetchedMessage => fetchedMessage.delete())
      .catch(() => null);
  }
}
