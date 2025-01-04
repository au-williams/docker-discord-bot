import { ApplicationCommandType, BaseChannel, ChannelType, ContextMenuCommandBuilder, InteractionContextType, SlashCommandBuilder, User } from "discord.js";
import { client as Client } from "../index.js";
import { DeploymentTypes, IsDeploymentType } from "./DeploymentTypes.js";
import { Utilities } from "../services/utilities.js"
import fs from "fs-extra";

const { discord_bot_admin_user_ids } = fs.readJsonSync("config.json");

/**
 *
 */
export default class Listener {
  /**
   *
   */
  constructor() {
    this.commandName = "";
    this.contexts = null;
    this.customId = "";
    this.description = "";
    this.deploymentType = null;
    this.event = "";
    this.filename = "";
    this.filepath = "";
    this.id = null;
    this.isBusy = false;
    this.isEnabled = true;
    this.isService = false;
    this.requiredChannelIds = [];
    this.requiredChannelType = null;
    this.requiredRoleIds = [];
    this.requiredUserIds = [];
    this.runOrder = 0;

    this.func = async () => {
      throw new Error("Function is not implemented.");
    };

    this.busyInteractionFunc = async ({ interaction, listener }) => {
      const content = "I'm busy with your request. Please wait for me to finish.";
      const reply = await interaction.reply({ content, ephemeral: true, fetchReply: true });
      Utilities.LogPresets.SentReply(reply, listener);
    };

    this.lockedChannelFunc = async ({ interaction, listener }) => {
      const joinedAdmins = Utilities.getJoinedArrayWithOr(discord_bot_admin_user_ids.map(item => `<@${item}>`));
      const channelLabel = Utilities.getPluralizedString("channel", listener.requiredChannelLinks.length);
      const channelValue = Utilities.getJoinedArrayWithOr(listener.requiredChannelLinks);
      const content = `\`🔐 Locked\` Sorry but you need to be in the ${channelValue} ${channelLabel} to use this! Please contact ${joinedAdmins} if you think this was in error. 🧑‍🔧`;
      const reply = await interaction.reply({ content, ephemeral: true, fetchReply: true });
      Utilities.LogPresets.SentReply(reply, listener);
    };

    this.lockedUserFunc = async ({ interaction, listener }) => {
      const joinedAdmins = Utilities.getJoinedArrayWithOr(discord_bot_admin_user_ids.map(item => `<@${item}>`));
      const content = `\`🔐 Locked\` Sorry but you're not allowed to use this! Please contact ${joinedAdmins} if you think this was in error. 🧑‍🔧`;
      const reply = await interaction.reply({ content, ephemeral: true, fetchReply: true });
      Utilities.LogPresets.SentReply(reply, listener);
    };
  }

  // ----------------------------------------------------------------------- //
  // >> HANDLER GETTERS                                                   << //
  // ----------------------------------------------------------------------- //

  /**
   *
   */
  get builder() {
    if (IsDeploymentType(this.deploymentType)) {
      this.contexts ??= [
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel
      ]
    }

    switch(this.deploymentType) {
      case DeploymentTypes.ChatInputCommand:
        return new SlashCommandBuilder()
          .setContexts(...this.contexts)
          .setDescription(this.description)
          .setName(this.id)
          .setNSFW(false);
      case DeploymentTypes.UserContextMenuCommand:
        return new ContextMenuCommandBuilder()
          .setContexts(...this.contexts)
          .setName(this.id)
          .setType(ApplicationCommandType.User); // TODO: https://discordjs.guide/interactions/context-menus.html#registering-context-menu-commands
      default:
        return null;
    }
  }

  /**
   * Get the RequiredChannelIds formatted as clickable channels in Discord.
   * @type {string[]}
   */
  get requiredChannelLinks() {
    return this.requiredChannelIds.map(id => `<#${id}>`);
  }

  /**
   * Check if the listener is locked for the channel.
   * @throws On unexpected type of interaction or channel.
   * @param {(BaseInteraction|BaseChannel)} interactionOrChannel
   * @returns {boolean}
   */
  async checkLockedChannel(interactionOrChannel) {
    if (!this.requiredChannelIds.length || !interactionOrChannel) return false;
    let channel = interactionOrChannel.channel || interactionOrChannel;
    const isThreadChannel = channel.type === ChannelType.PublicThread || channel.type === ChannelType.PrivateThread;
    if (isThreadChannel) channel = await channel.fetchStarterMessage().then(result => result.channel);
    Utilities.throwType(BaseChannel, channel);
    return !this.requiredChannelIds.some(id => id === channel.id);
  }

  /**
   * Check if the listener is locked for the user. Listeners may be
   * invoked within or outside of a Guild, so check if the user has
   * the required role within each guild.
   * @param {(BaseInteraction|User)} interactionOrUser
   * @returns {boolean}
   */
  async checkLockedUser(interactionOrUser) {
    const user = interactionOrUser.user || interactionOrUser;
    Utilities.throwType(User, user);

    let isRequiredUser = !this.requiredUserIds.length;
    let isRequiredRole = !this.requiredRoleIds.length;

    if (isRequiredUser && isRequiredRole) {
      return false;
    }

    if (this.requiredRoleIds.length) {
      for (const guild of Client.guilds.cache.values()) {
        const member = await guild.members.fetch({ user });
        const some = this.requiredRoleIds.some(id => member.roles.cache.has(id));
        if (some) isRequiredRole = true;
        if (some) break;
      }
    }

    if (this.requiredUserIds.length) {
      isRequiredUser = this.requiredUserIds.includes(user.id);
    }

    return !isRequiredRole || !isRequiredUser;
  }

  /**
   *
   */
  checkInvalidChannelType(interactionOrChannel) {
    if (!Number.isInteger(this.requiredChannelType) || !interactionOrChannel) return false;
    let channel = interactionOrChannel.channel || interactionOrChannel;
    return channel.type !== this.requiredChannelType;
  }

  /**
   * Get the RequiredRoleIds for the guild the interaction happened in. This
   * is required because the Discord API is questionable at best and doesn't
   * allow linking roles outside of the guild owning them. Wow - so amazing!
   * @param {BaseInteraction} interaction
   * @returns {string[]}
   */
  getRequiredRoleIdsForGuild(interaction) {
    return this.requiredRoleIds.filter(item => interaction.guild?.roles.cache.has(item));//.map(item => `<@&${item}>`);
  }

  /**
   * Get the RequiredRoleIds for the guild mapped as clickable roles. This
   * only works for roles owned by the interaction guild. Roles outside of
   * the interaction guild display as @unknown-role because of limitations
   * in the Discord API (shocking, I know).
   * @param {BaseInteraction} interaction
   * @returns {string[]}
   */
  getRequiredRoleLinksForGuild(interaction) {
    const requiredRoleIds = this.getRequiredRoleIdsForGuild(interaction);
    const requiredRoleLinks = Utilities.getRoleIdsAsLinks(requiredRoleIds);
    return Utilities.getJoinedArrayWithOr(requiredRoleLinks);
  }

  // ----------------------------------------------------------------------- //
  // >> HANDLER SETTERS                                                   << //
  // ----------------------------------------------------------------------- //

  /**
   * Set the action to perform when the listener is executed while busy.
   * @param {Function|Promise} busyFunc
   * @returns {Listener}
   */
  setBusyFunction(busyFunc) {
    Utilities.throwTypes(["Function", "AsyncFunction"], busyFunc);
    this.busyFunc = busyFunc;
    return this;
  }

  /**
   * Set the command name to be deployed via POST to the Discord API.
   * @param {string} commandName
   * @returns {Listener}
   */
  setCommandName(commandName) {
    Utilities.throwType("string", commandName);
    this.commandName = commandName;
    return this;
  }

  /**
   *
   */
  setContexts(...contexts) {
    const isType = item => Object.values(InteractionContextType).includes(item);
    contexts.forEach(item => { if(!isType(item)) { throw new Error("Unexpected context type."); }});
    this.contexts = contexts;
    return this;
  }

  /**
   *
   */
  setDeploymentType(deploymentType) {
    if (!IsDeploymentType(deploymentType)) throw new Error("Unexpected deployment type.");
    this.deploymentType = deploymentType;
    return this;
  }

  /**
   * Set the description (commands deployed via POST to the Discord API).
   * TODO: set char limit https://github.com/discord/discord-api-docs/discussions/4070
   * @param {string} description
   * @returns {Listener}
   */
  setDescription(description) {
    Utilities.throwType("string", description);
    this.description = description;
    return this;
  }

  /**
   * Set if the CronJob should be enabled. This is typically for debug / dependency purposes.
   * @param {boolean|Function|Promise<boolean>} isEnabled
   * @returns {Listener}
   */
  setEnabled(isEnabled) {
    Utilities.throwTypes(["boolean", "Function", "AsyncFunction"], isEnabled);
    this.isEnabled = isEnabled;
    return this;
  }

  /**
   * Set the action to perform when the listener is executed.
   * @param {Function|Promise} func
   * @returns {Listener}
   */
  setFunction(func) {
    Utilities.throwTypes(["Function", "AsyncFunction"], func);
    this.func = func;
    return this;
  }

  /**
   * Set the action to perform when the listener is executed while locked.
   * @param {Function} lockedUserFunc
   * @returns {Listener}
   */
  setLockedUserFunction(lockedUserFunc) {
    Utilities.throwTypes(["Function", "AsyncFunction"], lockedUserFunc);
    this.lockedUserFunc = lockedUserFunc;
    return this;
  }

  /**
   * Set Discord channels required for the listener to execute.
   * @param {string[]|string|Function} requiredChannelIds Channel ids as a string or string array
   * @returns {Listener}
   */
  setRequiredChannels(requiredChannelIds) {
    let resolvedChannelIds = requiredChannelIds;

    // Unpack the parameter
    if (Utilities.checkType("function", resolvedChannelIds)) {
      resolvedChannelIds = resolvedChannelIds();
    }
    if (Utilities.checkType("string", resolvedChannelIds)) {
      resolvedChannelIds = [resolvedChannelIds];
    }

    // Validate the result
    if (!Array.isArray(resolvedChannelIds)) {
      throw new Error(`Expected type string[]. Received ${typeof resolvedChannelIds}.`)
    }
    else if (resolvedChannelIds.some(item => !item || !Utilities.checkType("string", item))) {
      const channelId = resolvedChannelIds.find(item => !Utilities.checkType("string", item));
      throw new Error(`Expected type string. Received ${typeof channelId}.`);
    }

    this.requiredChannelIds = resolvedChannelIds;
    return this;
  }

  /**
   *
   */
  setRequiredChannelType(channelType) {
    if (!Object.values(ChannelType).includes(channelType)) throw new Error("Unexpected channel type.");
    this.requiredChannelType = channelType;
    return this;
  }

  /**
   * Set Discord roles a member must possess at least one of to be authorized for the listener
   * @param {string[]|string|Function} requiredRoleIds Role ids as a string or string array
   * @returns {Listener}
   */
  setRequiredRoles(requiredRoleIds) {
    let resolvedRoleIds = requiredRoleIds;

    // Unpack the parameter
    if (Utilities.checkType("function", resolvedRoleIds)) {
      resolvedRoleIds = resolvedRoleIds();
    }
    if (Utilities.checkType("string", resolvedRoleIds)) {
      resolvedRoleIds = [resolvedRoleIds];
    }

    // Validate the result
    if (!Array.isArray(resolvedRoleIds)) {
      throw new Error(`Expected type string[]. Received ${typeof resolvedChannelIds}.`)
    }
    else if (resolvedRoleIds.some(item => !item || !Utilities.checkType("string", item))) {
      const channelId = resolvedRoleIds.find(item => !Utilities.checkType("string", item));
      throw new Error(`Expected type string. Received ${typeof channelId}.`);
    }

    this.requiredRoleIds = resolvedRoleIds;
    return this;
  }

  /**
   */
    setRequiredUsers(requiredUserIds) {
      let resolvedUserIds = requiredUserIds;

      // Unpack the parameter
      if (Utilities.checkType("function", resolvedUserIds)) {
        resolvedUserIds = resolvedUserIds();
      }
      if (Utilities.checkType("string", resolvedUserIds)) {
        resolvedUserIds = [resolvedUserIds];
      }

      // Validate the result
      if (!Array.isArray(resolvedUserIds)) {
        throw new Error(`Expected type string[]. Received ${typeof resolvedChannelIds}.`)
      }
      else if (resolvedUserIds.some(item => !item || !Utilities.checkType("string", item))) {
        const channelId = resolvedUserIds.find(item => !Utilities.checkType("string", item));
        throw new Error(`Expected type string. Received ${typeof channelId}.`);
      }

      this.requiredUserIds = resolvedUserIds;
      return this;
    }

  /**
   * Set the order in which this listener sorts alongside other listeners of its kind.
   * This is typically only used for events (more specifically service events that are
   * dependencies for the bot. Such as loading config data or maintaining the messages
   * cache). A lower value will invoke sooner than most listeners. A higher value will
   * invoke later than most listeners.
   * @param {number} runOrder
   * @returns {Listener}
   */
  setRunOrder(runOrder) {
    Utilities.throwType("number", runOrder);
    this.runOrder = runOrder;
    return this;
  }
}
