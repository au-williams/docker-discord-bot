import { ContextMenuCommandBuilder, SlashCommandBuilder } from "discord.js";

/**
 * Gets an identifier for the interaction to determine its busy status.
 * @param {string} pluginHandlerName `this.name`
 * @param {Interaction} interaction
 * @returns {string}
 */
const getInteractionCompositeKey = (pluginHandlerName, interaction) =>
  pluginHandlerName
  + (interaction.message?.id || "")
  + (interaction.user?.id || "");

export class PluginHandler {
  constructor(params) {
    this.onInteractionCreate = params.onInteractionCreate;
    this._busyPlugins = new Set();
    this._requiredRoleIds = params.requiredRoleIds;
  }

  /**
   * The Discord.JS command builder. This is used to deploy extending handlers
   * to the Discord API which may be required for certain command types.
   */
  get builder() {
    return null;
  }

  /**
   * The displayed name so we know who we're working with. Inheriting
   * classes may extend this value to better suit their schema.
   */
  get name() {
    return this.customId || this.commandName;
  }

  /**
   * Some plugin handlers are asynchronous and may have work complete in the
   * background. We need to set when it's busy so duplicate actions can't be
   * invoked by the user waiting for their previous invocation to complete.
   */
  isInteractionBusy(interaction) {
    const key = getInteractionCompositeKey(this.name, interaction);
    return this._busyPlugins.has(key);
  }

  setInteractionBusy(interaction, value) {
    const key = getInteractionCompositeKey(this.name, interaction);
    if (value && !this._busyPlugins.has(key)) this._busyPlugins.add(key);
    if (!value && this._busyPlugins.has(key)) this._busyPlugins.delete(key);
  }

  /**
   * Required role ids may be defined after plugin initialization, requiring
   * the use of a getter instead of the object itself. Resolve the getter if
   * one was provided by the plugin.
   */
  get requiredRoleIds() {
    const resolve = typeof this._requiredRoleIds === "function"
      ? this._requiredRoleIds()
      : this._requiredRoleIds;

    if (Array.isArray(resolve)) return resolve;
    else return [];
  }

  /**
   * Checks if the handler is responsible for the interaction
   * @param {Interaction} interaction
   * @returns {bool}
   */
  isInteraction(interaction) {
    const isCustomId = this.customId && this.customId === interaction.customId;
    const isCommandName = this.commandName && this.commandName === interaction.commandName;
    return isCustomId || isCommandName;
  }

  /**
   * Checks if the handler should be denied access for the member
   * @param {GuildMember} member
   * @returns {bool}
   */
  isLocked(member) {
    // todo: isAuthorized
    return !this.requiredRoleIds.length
      ? false // no required role ids were defined in the plugin
      : !this.requiredRoleIds.some(id => member.roles.cache.has(id));
  }
}

export class PluginInteraction extends PluginHandler {
  constructor(params) {
    super(params);
    this.customId = params.customId;
    this.description = params.description;
  }
}

export class PluginSlashCommand extends PluginHandler {
  constructor(params) {
    super(params);
    this.commandName = params.commandName;
    this.description = params.description;
  }

  get name() {
    const name = super.name;
    return `/${name}`;
  }

  get builder() {
    return new SlashCommandBuilder()
      .setDescription(this.description)
      .setDMPermission(false)
      .setName(this.commandName)
      .setNSFW(false);
  }
}

export class PluginContextMenuItem extends PluginHandler {
  constructor(params) {
    super(params);
    this.commandName = params.commandName;
  }

  get builder() {
    return new ContextMenuCommandBuilder()
      .setDMPermission(false)
      .setName(this.commandName)
      .setType(this.type);
  }
}
