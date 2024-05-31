import { ContextMenuCommandBuilder, SlashCommandBuilder } from "discord.js";

export class PluginHandler {
  constructor(params) {
    this.onInteractionCreate = params.onInteractionCreate;
    this._requiredRoleIds = params.requiredRoleIds;
  }

  get identifier() {
    return this.customId || this.commandName;
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

  toString() {
    return this.customId
  }
}

export class PluginSlashCommand extends PluginHandler {
  constructor(params) {
    super(params);
    this.commandName = params.commandName;
    this.description = params.description;
  }

  get identifier() {
    const identifier = super.identifier;
    return `/${identifier}`;
  }

  get builder() {
    return new SlashCommandBuilder()
      .setDescription(this.description)
      .setDMPermission(false)
      .setName(this.commandName)
      .setNSFW(false);
  }

  toString() {
    return `/${this.commandName}`;
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

  toString() {
    return this.commandName;
  }
}
