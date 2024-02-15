/**
 * Try deleting a child thread if one exists when a starter message is deleted
 * TODO: change pluginFilename to logger instance
 * @param {Object} param
 * @param {string[]} param.allowedChannelIds
 * @param {Logger} param.logger
 * @param {Message} param.starterMessage
 * @returns {bool}
 */
export async function tryDeleteThread({ allowedChannelIds, logger, starterMessage }) {
  try {
    const isAllowedChannel = allowedChannelIds.includes(starterMessage.channel.id);
    const isValidOperation = isAllowedChannel && starterMessage.thread;
    if (isValidOperation) await starterMessage.thread.delete();
    if (isValidOperation) logger.info(`Deleted thread with starter message "${starterMessage.id}"`);
    return isValidOperation;
  }
  catch({ stack }) {
    logger.error(stack);
    return false;
  }
}
