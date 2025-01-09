import { ApplicationCommandType, ChannelType, ContextMenuCommandBuilder, InteractionContextType, SlashCommandBuilder, User } from "discord.js";
import { DeploymentTypes, IsDeploymentType } from "./DeploymentTypes.js";
import { Utilities } from "../services/utilities.js"
import fs from "fs-extra";

const { discord_bot_admin_user_ids } = fs.readJsonSync("config.json");

/**
 * The Listener class. These are defined in plugins and services before they're
 * imported by the Emitter class to dispatch events and interactions.
 */
export default class Listener {
  /** */
  constructor() {
    this.commandName = "";
    this.contextTypes = null;
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
    this.requiredChannelTypes = null;
    this.requiredRoleIds = [];
    this.requiredUserIds = [];
    this.runOrder = 0;

    this.func = async () => {
      throw new Error("Function is not implemented.");
    };

    this.busyFunc = async ({ interaction, listener }) => {
      const content = "I'm busy with your request. Please wait for me to finish.";
      const reply = await interaction.reply({ content, ephemeral: true, fetchReply: true });
      Utilities.LogPresets.SentReply(reply, listener);
    };

    this.lockedFunc = async ({ interaction, listener }) => {
      const joinedAdmins = Utilities.getJoinedArrayWithOr(discord_bot_admin_user_ids.map(item => `<@${item}>`));
      const content = `\`🔐 Locked\` Sorry but you're not allowed to use this! Please contact ${joinedAdmins} if you think this was in error. 🧑‍🔧`;
      const reply = await interaction.reply({ content, ephemeral: true, fetchReply: true });
      Utilities.LogPresets.SentReply(reply, listener);
    };
  }

  /////////////////////////////////////////////////////////////////////////////
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  // #region LISTENER GETTERS                                                //
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  /////////////////////////////////////////////////////////////////////////////

  /**
   * The context menu or slash command builder to be included in the deployment
   * POST request to Discord.
   * @returns {ContextMenuCommandBuilder|SlashCommandBuilder|null}
   */
  get builder() {
    if (IsDeploymentType(this.deploymentType)) {
      this.contextTypes ??= [
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel
      ]
    }

    switch(this.deploymentType) {
      case DeploymentTypes.ChatInputCommand:
        return new SlashCommandBuilder()
          .setContexts(...this.contextTypes)
          .setDescription(this.description)
          .setName(this.id)
          .setNSFW(false);
      case DeploymentTypes.UserContextMenuCommand:
        return new ContextMenuCommandBuilder()
          .setContexts(...this.contextTypes)
          .setName(this.id)
          .setType(ApplicationCommandType.User);
      default:
        return null;
    }
  }

  /**
   * Get the requiredChannelIds text formatted as clickable channel links in
   * Discord. This should be inserted into a message's content.
   * @type {string[]}
   */
  get requiredChannelsAsLinks() {
    return this.requiredChannelIds.map(id => `<#${id}>`);
  }

  /**
   * Get the RequiredRoleIds for the guild the interaction happened in. This
   * is required because the Discord API is questionable at best and doesn't
   * allow linking roles outside of the guild owning them. Wow - so amazing!
   * In short, if the roles "A" "B" and "C" are required by the listener but
   * only "B" and "C" are in the guild then only "B" and "C" are returned.
   * @param {BaseInteraction} interaction
   * @returns {string[]}
   */
  getRequiredRoleIdsForGuild(interaction) {
    return this.requiredRoleIds.filter(item => interaction.guild?.roles.cache.has(item));
  }

  /**
   * Get the RequiredRoleIds for the guild mapped as clickable roles. This
   * only works for roles owned by the interaction guild. Roles outside of
   * the interaction guild display as @unknown-role because of limitations
   * created by the Discord API (shocking, I know).
   * @param {BaseInteraction} interaction
   * @returns {string[]}
   */
  getRequiredRoleLinksForGuild(interaction) {
    const requiredRoleIds = this.getRequiredRoleIdsForGuild(interaction);
    const requiredRoleLinks = Utilities.getRoleIdsAsLinks(requiredRoleIds);
    return Utilities.getJoinedArrayWithOr(requiredRoleLinks);
  }

  /////////////////////////////////////////////////////////////////////////////
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  // #endregion LISTENER GETTERS                                             //
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  /////////////////////////////////////////////////////////////////////////////

  /////////////////////////////////////////////////////////////////////////////
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  // #region LISTENER SETTERS                                                //
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  /////////////////////////////////////////////////////////////////////////////

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
   * Set the context types to be deployed via POST to the Discord API.
   * @throws On unexpected type of contextTypes
   * @param {...InteractionContextType} contextTypes
   * @returns {Listener}
   */
  setContextTypes(...contextTypes) {
    const isType = item => Object.values(InteractionContextType).includes(item);
    contextTypes.forEach(item => { if(!isType(item)) { throw new Error("Unexpected context type."); }});
    this.contextTypes = contextTypes;
    return this;
  }

  /**
   * Set the type of deployment to use when deploying to the Discord API.
   * @throws On unexpected type of deploymentType
   * @param {DeploymentTypes} deploymentType
   * @returns {Listener}
   */
  setDeploymentType(deploymentType) {
    if (!IsDeploymentType(deploymentType)) throw new Error("Unexpected deployment type.");
    this.deploymentType = deploymentType;
    return this;
  }

  /**
   * Set the description to use when deploying to the Discord API. This is also
   * displayed when pressing the "more info" button attached to component rows.
   * @param {string} description
   * @returns {Listener}
   */
  setDescription(description) {
    // TODO: set char limit
    // https://github.com/discord/discord-api-docs/discussions/4070
    Utilities.throwType("string", description);
    this.description = description;
    return this;
  }

  /**
   * Set if the Listener should be enabled. This is typically used for debug or
   * missing dependency purposes such as when the Messages service is disabled.
   * @param {boolean|Function|Promise<boolean>} isEnabled
   * @returns {Listener}
   */
  setEnabled(isEnabled) {
    Utilities.throwTypes(["boolean", "Function", "AsyncFunction"], isEnabled);
    this.isEnabled = isEnabled;
    return this;
  }

  /**
   * Set the function to invoke when the listener is executed.
   * @param {Function|Promise} func
   * @returns {Listener}
   */
  setFunction(func) {
    Utilities.throwTypes(["Function", "AsyncFunction"], func);
    this.func = func;
    return this;
  }

  /**
   * Set the function to invoke when the listener is executed while locked for
   * the user.
   * @param {Function} lockedFunc
   * @returns {Listener}
   */
  setLockedFunction(lockedFunc) {
    Utilities.throwTypes(["Function", "AsyncFunction"], lockedFunc);
    this.lockedFunc = lockedFunc;
    return this;
  }

  /**
   * Set Discord channels required for the listener to execute in. The listener
   * will silently ignore requests sent from non-required channels.
   * @throws On unexpected type of resolvedChannelIds
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
   * Set Discord channel types required for the listener to execute in. The
   * listener will silently ignore requests sent from non-required channel
   * types.
   * @throws On unexpected type of channelTypes
   * @param {...ChannelType} channelTypes
   * @returns {Listener}
   */
  setRequiredChannelTypes(...channelTypes) {
    if (Array.isArray(channelTypes[0])) channelTypes = channelTypes[0];
    const some = channelTypes.some(item => !Object.values(ChannelType).includes(item));
    if (some) throw new Error("Unexpected channel type.");
    this.requiredChannelTypes = channelTypes;
    return this;
  }

  /**
   * Set Discord guild roles a user must possess at least one of to be allowed
   * to execute the listener function. When the requiredRoleIds aren't met the
   * lockedFunc will be executed instead (overridable with setLockedFunction).
   * @throws On unexpected type of resolvedRoleIds
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
   * Set Discord users a user must be one of to be allowed to execute the
   * listener function. When the requiredUserIds aren't met the lockedFunc will
   * be executed instead (overridable with setLockedFunction).
   * @throws On unexpected type of resolvedUserIds
   * @param {string[]|string|Function} requiredUserIds User ids as a string or string array
   * @returns {Listener}
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

  /////////////////////////////////////////////////////////////////////////////
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  // #endregion LISTENER SETTERS                                             //
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  /////////////////////////////////////////////////////////////////////////////
}
