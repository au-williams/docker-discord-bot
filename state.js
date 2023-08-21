import { getChannelMessages } from "./index.js";
import { Logger } from "./logger.js";
import fs from "fs-extra";

const { state_channel_id } = fs.readJsonSync("./config.json");
let stateChannel;

const getStateThread = async key => {
  try {
    const stateMessages = await getChannelMessages(stateChannel.id);
    let starterMessage = stateMessages.find(({ content, hasThread }) => content === key && hasThread);

    if (!starterMessage) {
      starterMessage = await stateChannel.send({ content: key });
      await starterMessage.startThread({ name: `⚙ ${key} data` });
    }

    return starterMessage.thread;
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

export class State {
  static async initialize(client) {
    stateChannel = await client.channels.fetch(state_channel_id);
  }

  static async get(key) {
    try {
      const { id } = await getStateThread(key);
      return await getChannelMessages(id);
    }
    catch({ stack }) {
      Logger.Error(stack);
      return [];
    }
  }

  static async add(key, message) {
    try {
      const stateThread = await getStateThread(key);
      return await stateThread.send(message).then(() => true).catch(() => false);
    }
    catch({ stack }) {
      Logger.Error(stack);
      return false;
    }
  }

  static async filter(key, filter) {
    try {
      const stateMessages = await this.get(key);
      return stateMessages.filter(filter);
    }
    catch({ stack }) {
      Logger.Error(stack);
      return [];
    }
  }

  static async find(key, find) {
    try {
      const stateMessages = await this.get(key);
      return stateMessages.find(find);
    }
    catch({ stack }) {
      Logger.Error(stack);
      return null;
    }
  }

  static async remove(key, filter) {
    try {
      const filteredStateMessages = await this.filter(key, filter);
      if (!filteredStateMessages.length) return false;

      for await(const message of filteredStateMessages) await message.delete();
      return true;
    }
    catch({ stack }) {
      Logger.Error(stack);
      return false;
    }
  }
}
