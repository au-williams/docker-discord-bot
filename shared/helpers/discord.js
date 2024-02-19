import { ButtonBuilder, ButtonStyle } from "discord.js";
import { getTruncatedString } from "./utilities.js";

/**
 * Get the "Delete from Plex" button component
 * @param {string} componentCustomId
 * @param {string} emojiId
 * @returns {ButtonComponent}
 */
export function getDeleteFromPlexButton(componentCustomId, emojiId) {
  const button = new ButtonBuilder();
  button.setCustomId(componentCustomId);
  button.setDisabled(false);
  button.setEmoji(emojiId);
  button.setLabel("Delete from Plex");
  button.setStyle(ButtonStyle.Secondary);
  return button;
}

/**
 * Get the "Import into Plex" button component
 * @param {string} componentCustomId
 * @param {string} emojiId
 * @returns {ButtonComponent}
 */
export function getImportIntoPlexButton(componentCustomId, emojiId) {
  const button = new ButtonBuilder();
  button.setCustomId(componentCustomId);
  button.setDisabled(false);
  button.setEmoji(emojiId);
  button.setLabel("Import into Plex");
  button.setStyle(ButtonStyle.Secondary);
  return button;
}

/**
 * Get the existing thread or create one if it doesn't exist
 * @param {Object} param
 * @param {Message} param.starterMessage
 * @param {Object} param.clientOptions
 * @param {Object} param.threadOptions
 * @returns {ThreadChannel}
 */
export async function getOrCreateThreadChannel({ starterMessage, clientOptions, threadOptions }) {
  if (starterMessage.hasThread) return starterMessage.thread;

  threadOptions.name = getTruncatedString(threadOptions.name, 100); // maximum thread name size
  const threadChannel = await starterMessage.startThread(threadOptions);

  if (clientOptions.removeMembers) {
    const fetchedMembers = await threadChannel.members.fetch();
    const removedMemberIds = fetchedMembers.filter(({ user }) => !user.bot).map(({ id }) => id);
    for(const id of removedMemberIds) await threadChannel.members.remove(id);
  }

  return threadChannel;
}

/**
 * Get the "Searching in Plex" button component
 * @param {string} componentCustomId
 * @returns {ButtonComponent}
 */
export function getSearchingPlexButton(componentCustomId) {
  const button = new ButtonBuilder();
  button.setCustomId(componentCustomId);
  button.setDisabled(true);
  button.setEmoji("⏳");
  button.setLabel("Searching in Plex");
  button.setStyle(ButtonStyle.Secondary);
  return button;
}

/**
 * Try deleting a child thread if one exists when a starter message is deleted
 * @param {Object} param
 * @param {string[]} param.allowedChannelIds
 * @param {Logger} param.logger
 * @param {Message} param.starterMessage
 * @returns {bool}
 */
export async function tryDeleteMessageThread({ allowedChannelIds, logger, starterMessage }) {
  try {
    const isAllowedChannel = allowedChannelIds.includes(starterMessage.channel.id);
    const isValidOperation = isAllowedChannel && starterMessage.thread;
    if (isValidOperation) await starterMessage.thread.delete();
    if (isValidOperation) logger.info(`Deleted thread with starter message "${starterMessage.id}"`);
    return isValidOperation;
  }
  catch(e) {
    logger.error(e);
    return false;
  }
}
