import { findChannelMessage, getChannelMessages } from "../index.js";
import Logger from "./logger.js";
import fs from "fs-extra";

const { discord_state_channel_id } = fs.readJsonSync("./config.json");

// todo: Should we store configs in the JSON file, and backup its raw content in the cloud?
//   If JSON is empty or lacks value, restore it?

/**
 * State is stored as messages in a hidden Discord channel to allow the bot to
 *   be ran from any machine without needing to be reconfigured. If a database
 *   table is just a spreadsheet, and a spreadsheet is just groups of rows and
 *   columns, then why not take advantage of Discord as "free cloud hosting"?
 */

/**
 * Within the state channel, the script that uses state (for example, caturday)
 *   will have a thread to contain its state data using the scripts name as the
 *   starter message content. Within that thread, each thread message will be a
 *   payload made from the executing script. Because they are saved as messages
 *   there is no hard requirement for data formatting. Every script using state
 *   must define reading / writing of state data based on its own requirements.
 */

let stateChannel;

export default class State {
  /**
   * Initializes the State class so it can be used by any importing script
   * @param {Client} client
   */
  static async initialize(client) {
    stateChannel = await client.channels.fetch(discord_state_channel_id);
  }

  /**
   * Gets all state data for the script
   * @param {string} scriptFilename
   * @returns {Promise<Message[]>}
   */
  static async get(scriptFilename) {
    try {
      const { id } = await getOrCreateStateThread(scriptFilename);
      return await getChannelMessages(id);
    }
    catch({ stack }) {
      Logger.error(stack);
      return [];
    }
  }

  /**
   * Adds a state data message for the script
   * @param {string} scriptFilename
   * @param {Message} message
   * @returns {Promise<Message>}
   */
  static async add(scriptFilename, message) {
    try {
      const stateThread = await getOrCreateStateThread(scriptFilename);
      return await stateThread.send(message);
    }
    catch({ stack }) {
      Logger.error(stack);
    }
  }

  /**
   * Gets filtered state data for the script
   * @param {string} scriptFilename
   * @param {Function} filter
   * @returns {Promise<Message[]>}
   */
  static async filter(scriptFilename, filter) {
    try {
      const stateMessages = await this.get(scriptFilename);
      return stateMessages.filter(filter);
    }
    catch({ stack }) {
      Logger.error(stack);
      return [];
    }
  }

  /**
   * Finds state data for the script
   * @param {string} scriptFilename
   * @param {Function} find
   * @returns {Promise<Message[]>}
   */
  static async find(scriptFilename, find) {
    try {
      const stateMessages = await this.get(scriptFilename);
      return stateMessages.find(find);
    }
    catch({ stack }) {
      Logger.error(stack);
    }
  }

  /**
   * Deletes state data for the script that is found by the filter
   * @param {string} scriptFilename
   * @param {Function} filter
   */
  static async delete(scriptFilename, filter) {
    try {
      const filteredStateMessages = await this.filter(scriptFilename, filter);
      if (!filteredStateMessages.length) return;
      for (const message of filteredStateMessages) await message.delete();
    }
    catch({ stack }) {
      Logger.error(stack);
    }
  }
}

/**
 * Gets or creates the thread of state data for the script (based on the starter message content containing the script filename)
 * @param {string} scriptFilename
 * @returns {Promise<ThreadChannel>}
 */
async function getOrCreateStateThread(scriptFilename) {
  try {
    let starterMessage =
      await findChannelMessage(stateChannel.id, ({ content, hasThread }) => hasThread && content === scriptFilename);

    if (!starterMessage) {
      starterMessage = await stateChannel.send({ content: scriptFilename });
      await starterMessage.startThread({ name: scriptFilename });
    }

    return starterMessage.thread;
  }
  catch({ stack }) {
    Logger.error(stack);
  }
}
