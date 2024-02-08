import Logger from "../logger.js";

/**
 * Try deleting a child thread if one exists when a starter message is deleted
 * @param {Object} param
 * @param {string[]} param.allowedChannelIds
 * @param {string} param.pluginFilename
 * @param {Message} param.starterMessage
 * @returns {bool}
 */
export async function tryDeleteThread({ allowedChannelIds, pluginFilename, starterMessage }) {
  try {
    const isAllowedChannel = allowedChannelIds.includes(starterMessage.channel.id);
    const isValidOperation = isAllowedChannel && starterMessage.thread;
    if (isValidOperation) await starterMessage.thread.delete();
    if (isValidOperation) Logger.info(`Deleted thread with starter message "${starterMessage.id}"`, pluginFilename);
    return isValidOperation;
  }
  catch({ stack }) {
    Logger.error(stack, pluginFilename);
    return false;
  }
}
