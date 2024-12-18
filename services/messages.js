import { ChannelType, Events, GuildChannel, GuildMember, Message, User } from "discord.js";
import { Logger } from "./logger.js";
import { Utilities } from "./utilities.js";
import fs from "fs-extra";
import Listener from "../entities/Listener.js";

const logger = new Logger(import.meta.filename);

const { enable_message_fetch } = fs.readJsonSync("config.json");

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region EMITTER.JS LISTENERS                                              //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * The event listeners handled by this script. The key is a Discord event or an
 * interaction property from the `Interactions<object>` variable. The value is
 * a `Listener` object and requires a function to be set. Listeners that only
 * set a function can use the function as the value and it will be wrapped in
 * a Listener by the framework for you automatically. When the key is emitted
 * by Discord then the value will be executed. You may use an array to define
 * multiple Listeners for a single key.
 */
export const Listeners = Object.freeze({
  [Events.ClientReady]: new Listener()
    .setEnabled(enable_message_fetch)
    .setFunction(initializeMessages)
    .setRunOrder(-100), // Run before all plugins and services!
  [Events.MessageCreate]: new Listener()
    .setFunction(({ message }) => Messages.add(message))
    .setRunOrder(-100), // Run before all plugins and services!
  [Events.MessageDelete]: new Listener()
    .setFunction(({ message }) => Messages.get(message).isDeleted = true)
    .setRunOrder(-100), // Run before all plugins and services!
  [Events.ThreadCreate]: new Listener()
    .setFunction(async ({ threadChannel }) => await threadChannel.fetchStarterMessage().then(Messages.add))
    .setRunOrder(-100), // Run before all plugins and services!
});

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS LISTENERS                                           //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region SERVICE LOGIC                                                     //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * The `Messages` service maintains a collection of Discord messages visible to the client.
 */
export class Messages {
  static _messages = new Map();

  /**
   * Add or update the message collection.
   * @param {Message} message
   * @returns {Messages}
   */
  static async add(message) {
    message.isDeleted ??= false;
    Messages._messages.set(message.id, message);
    return Messages;
  }

  /**
   * Get messages filtered by one or more parameters provided. For example, providing the channel
   * and member will return every message sent to that channel by that member. Providing only the
   * channel returns all channel messages. Providing only the user returns every message from the
   * user across channels and servers available to the bot. Will always return an array except if
   * the message or message ID was provided to pull the single record from history. 📫
   * @param {object} param
   * @param {string} param.attachmentUrl The `attachment url` to get. `Returns Message`
   * @param {GuildChannel} param.channel The `channel` to get messages from. `Returns Message[]`
   * @param {string} param.channelId The `channel id` to get messages from. `Returns Message[]`
   * @param {Message} param.message The `message` to get. `Returns Message`
   * @param {string} param.messageId The `message id` to get. `Returns Message`
   * @param {string} param.messageUrl The `message url` to get. `Returns Message`
   * @param {GuildMember} param.member The `member` to get messages from. `Returns Message[]`
   * @param {string} param.memberId The `member id` to get messages from. `Returns Message[]`
   * @param {string} param.referenceId The `message id` to get referencing messages from. `Returns Message[]`
   * @param {User} param.user The `user` to get messages from. `Returns Message[]`
   * @param {string} param.userId The `user id` to get messages from. `Returns Message[]`
   * @param {boolean} [param.includeDeleted=false] Includes messages that have been deleted.
   * @returns {Message|Message[]}
   */
  static get({ attachmentUrl, channel, channelId, message, messageId, messageUrl, member, memberId, referenceId, user, userId, includeDeleted = false }) {
    // Return a single message that contains the message id.
    if (message instanceof Message) {
      const result = Messages._messages.get(message.id);
      if (!includeDeleted || result.isDeleted) return result;
      return undefined;
    }

    // Return a single message that contains the message id.
    if (typeof messageId === "string") {
      const result = Messages._messages.get(messageId);
      if (!includeDeleted || result.isDeleted) return result;
      return undefined;
    }

    // Return a single message that contains the attachment url.
    if (typeof attachmentUrl === "string") {
      const getAttachments = message => message.attachments.size ? Array.from(message.attachments.values()) : [];
      return Messages.find(message => getAttachments(message).some(attachment => attachment.url === attachmentUrl));
    }

    // Return a single message that contains the message url.
    if (typeof messageUrl === "string") {
      return Messages.find(message => message.url === messageUrl);
    }

    // Return an array of messages based on param criteria.
    return [...Messages._messages.values()].filter(item => {
      if (channel instanceof GuildChannel) channelId ??= channel.id;
      if (member instanceof GuildMember) memberId ??= member.id;
      if (user instanceof User) userId ??= user.id;
      const isChannel = channelId ? (item.channelId === channelId) || (item.channel.type === ChannelType.DM && item.channel.recipientId === channelId) : true;
      const isDeleted = includeDeleted ? true : !item.isDeleted;
      const isMember = memberId ? item.author.id === memberId : true;
      const isReference = referenceId ? item.reference?.messageId === referenceId : true;
      const isUser = userId ? item.author.id === userId : true;
      return isChannel && isDeleted && isMember && isReference && isUser;
    }).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Find an item in the map values.
   * @param {Function} predicate
   * @returns {Message}
   */
  static find(predicate) {
    return Array.from(Messages._messages.values()).find(predicate);
  }

  /**
   * Filter items in the map values.
   * @param {Function} predicate
   * @returns {Message[]}
   */
  static filter(predicate) {
    return Array.from(Messages._messages.values()).filter(predicate);
  }

  /**
   * Some items in the map values.
   * @param {Function} predicate
   * @returns {boolean}
   */
  static some(predicate) {
    return Boolean(Messages.find(predicate));
  }

  /**
   * Get if the Message service has been initialized.
   * @returns {boolean}
   */
  static get isInitialized() {
    return enable_message_fetch;
  }

  /**
   * Get the count of the message collection.
   * @returns {number}
   */
  static get size() {
    return Messages._messages.size;
  }
}

/**
 * Fetch all channel messages visible by the client.
 * @param {object} param
 * @param {Client} param.client
 * @param {Listener} param.listener
 */
export async function initializeMessages({ client, listener }) {
  const channels = [];
  const members = new Map();

  for(const guild of client.guilds.cache.values()) {
    // fetch the channels so they include message data
    const fetchedChannels = await guild.channels.fetch();
    // filter channels that do not have message properties
    const messageChannels = Array.from(fetchedChannels.values()).filter(({ messages }) => messages);
    channels.push(...messageChannels);

    // map users by id (one user may be in many guilds)
    for (const pair of await guild.members.fetch()) {
      const member = pair[1]; // Why's this an array?
      if (member.id === client.user.id) continue;
      members.set(member.id, member);
    }
  }

  for (const member of Array.from(members.values())) {
    await member.user
      .createDM()
      .then(item => channels.push(item))
      .catch(() => logger.error(`Couldn't create DM for ${member.displayName}`));
  }

  for(const channel of channels) {
    let fetchedMessages = await channel.messages
      .fetch({ cache: true, limit: 1 })
      .catch(() => []);

    if (!fetchedMessages.size) continue;

    fetchedMessages.forEach(Messages.add);

    do {
      const before = fetchedMessages.last().id;

      fetchedMessages = await channel.messages
        .fetch({ before, cache: true, limit: 100 })
        .catch(logger.error);

      fetchedMessages.forEach(Messages.add);

      if (fetchedMessages.size < 100) {
        fetchedMessages = null;
      }
    } while (fetchedMessages);
  }

  const directMessageCount = getPopulatedChannelsSize(ChannelType.DM);
  const guildTextCount = getPopulatedChannelsSize(ChannelType.GuildText);

  logger.info(
    `Collected ${Messages.size} ${Utilities.getPluralizedString("message", Messages.size)} ` +
    `in ${directMessageCount} DM ${Utilities.getPluralizedString("channel", directMessageCount)} ` +
    `and ${guildTextCount} guild ${Utilities.getPluralizedString("channel", guildTextCount)}.`
  , listener);
}

/**
 *
 */
function getPopulatedChannelsSize(channelType) {
  return new Set(Array
    .from(Messages._messages.values())
    .filter(item => item.channel.type === channelType)
    .map(item => item.channel.id)
  ).size;
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion SERVICE LOGIC                                                  //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

//////////////////////////////////////////////////////////////////////////////////////////
// delete test data in dms                                                              //
//////////////////////////////////////////////////////////////////////////////////////////
// for(const guild of client.guilds.cache.values()) {                                   //
//   for (const pair of await guild.members.fetch()) {                                  //
//     const member = pair[1]; // Why's this an array?                                  //
//     const messages = Messages.get({ channelId: member.id, userId: client.user.id }); //
//     for (const m of messages) {                                                      //
//       await m.delete().catch(() => {})                                               //
//     }                                                                                //
//   }                                                                                  //
// }                                                                                    //
//////////////////////////////////////////////////////////////////////////////////////////
