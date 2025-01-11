import { BaseChannel, ButtonBuilder, ButtonStyle, ButtonComponent, BaseSelectMenuComponent, ComponentType, ChannelType, Events, User } from "discord.js";
import { Logger } from "./logger.js";
import { Utilities } from "./utilities.js";
import Cron from "croner";
import fs from "fs-extra";
import Listener from "../entities/Listener.js";
import path from "path";

const { discord_bot_admin_user_ids } = fs.readJsonSync("config.json");

const logger = new Logger(import.meta.filename);

// TODO: ///////////////////////////////////////////
// - Allow multiple SetFunctions with ChannelType //
// - Require unique listener ids on initialize    //
// - Clean up more info button rendering          //
// - .setDismountOnError()                        //
// - [Event ☉] [Interaction ☇] [Command ☄]       //
////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region EMITTER.JS IMPORTS                                                //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

export const Interactions = Object.freeze({
  ButtonComponentInfo: "EMITTER_BUTTON_COMPONENT_INFO"
});

export const Listeners = Object.freeze({
  [Interactions.ButtonComponentInfo]: sendButtonInfoReply
});

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS IMPORTS                                             //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region SERVICE LOGIC                                                     //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * The service responsible for emitting commands, events, and interactions to plugins and services.
 * Discord events should be emitted from `index.js`, but custom events can be emitted from anywhere
 * as their actions (such as an interaction ending) operate on a plugin level.
 */
export class Emitter {
  /**
   * The Discord.js interactions being monitored.
   * @type {Map<string, BaseInteraction>}
   */
  static _busyInteractions = new Map();

  /**
   * The listeners imported from all plugins and services.
   */
  static _importedListeners = new Map();

  /**
   * The context menu and slash command builders sent with the deployment POST request.
   * @returns {object[]} Array<ContextMenuCommandBuilder|SlashCommandBuilder>
   */
  static get builders() {
    return Emitter.listeners.reduce((total, current) => {
      if (current.deploymentType != null) {
        const { builder } = current;
        if (builder) total.push(builder);
        else throw new Error("Unexpected deployment type.");
      }
      return total;
    }, []);
  }

  /**
   * The listeners imported from all plugins and services.
   * @returns {Listener[]}
   */
  static get listeners() {
    return Array.from(Emitter._importedListeners.values()).flat();
  }

  /**
   * The Button that displays information about adjacent buttons when its clicked.
   * Importing scripts just add `Emitter.moreInfoButton` to their components row
   * and then everything else from getting button data to updating the interaction
   * is handled by Emitter - no additional work is needed by the importing script.
   * @type {ButtonBuilder}
   */
  static get moreInfoButton() {
    return new ButtonBuilder()
      .setCustomId(Interactions.ButtonComponentInfo)
      .setEmoji({ name: "🔖" })
      .setLabel("More info")
      .setStyle(ButtonStyle.Primary);
  }

  /**
   * Emit an event and invoke all of its defined listeners.
   * @param {object} param
   * @param {Events?} param.event The event (if one was emitted).
   * @param {BaseInteraction?} param.interaction The interaction (if one was emitted).
   * @param {object} param.params The parameters provided to the listener function.
   */
  static async emit({ event, interaction, params }) {
    const key = interaction?.customId || interaction?.commandName || event;
    Utilities.throwType("string", event);

    if (!Emitter._importedListeners.has(key)) {
      // debug log
      return;
    }

    const listeners = Emitter._importedListeners.get(key);

    if (interaction) {
      const { displayName } = interaction.member || interaction.user;
      const listenersLabel = Utilities.getPluralizedString("listener", listeners);
      logger.info(`${displayName} emitted to ${listeners.length} ${listenersLabel}.`, { id: key });
    }

    for (const listener of listeners) {
      await executeListener({ listener, ...params });
    }
  }

  /**
   * Initialize Emitter by importing listeners from "plugin" and "service" scripts.
   * @param {Client} client The Discord.js client
   * @returns {Promise<Emitter>}
   */
  static async initialize(client) {
    Emitter.client = client;

    for(const filepath of getImportableFilepaths("./plugins")) {
      const instance = await import(filepath);
      if (instance.CronJobs) instance.CronJobs.forEach(cronJob => importCronJob(cronJob, filepath, false));
      if (instance.Listeners) Object.entries(instance.Listeners).forEach(([key, value]) => importListener(value, key, filepath, false));
    }

    for(const filepath of getImportableFilepaths("./services")) {
      const instance = await import(filepath);
      if (instance.CronJobs) instance.CronJobs.forEach(cronJob => importCronJob(cronJob, filepath, true));
      if (instance.Listeners) Object.entries(instance.Listeners).forEach(([key, value]) => importListener(value, key, filepath, true));
    }

    Array.from(Emitter._importedListeners.keys()).forEach(key => {
      const sorted = Emitter._importedListeners.get(key).sort((a, b) => (a.runOrder) - (b.runOrder));
      Emitter._importedListeners.set(key, sorted);
    });

    return Emitter;
  }

  /**
   * Check if the interaction is busy and still in progress.
   * @param {BaseInteraction} interaction
   * @returns {boolean}
   */
  static isBusy(interaction) {
    const compositeKey = getBusyInteractionCompositeKey(interaction);
    return Emitter._busyInteractions.has(compositeKey) && Emitter._busyInteractions.get(compositeKey);
  }

  /**
   * Set the busy status of an interaction.
   * @param {BaseInteraction} interaction
   * @param {boolean} value
   */
  static setBusy(interaction, value) {
    if (interaction) {
      const compositeKey = getBusyInteractionCompositeKey(interaction);
      Emitter._busyInteractions.set(compositeKey, value);
      const loggerLabel = value ? "busy" : "not busy";
      logger.debug(`Set ${compositeKey} as ${loggerLabel} (${value}).`);
    }
    else {
      const loggerLabel = value ? "busy" : "not busy";
      logger.warn(`No interaction to set as ${loggerLabel} (${value})`);
    }
  }

  /**
   * @throws Expects CronJob
   * @param {object} params
   */
  static async scheduleCronJob(params) {
    const { cronJob, listener } = params;

    const cronOptions = {
      name: cronJob.func.name,
      paused: true,
      protect: true
    };

    cronOptions.catch = listener.isService
      ? error => { throw new Error(error) }
      : error => { logger.error(error, listener) };

    // Update the listener include "cron" for display in the logs.
    params = { ...params, listener: { ...listener, id: "cron" } };
    const cron = Cron(cronJob.expression, cronOptions, () => cronJob.func(params));
    const isEnabled = await Utilities.evalAsBoolean(cronJob.isEnabled);
    const isTriggered = await Utilities.evalAsBoolean(cronJob.isTriggered);

    if (!isEnabled) {
      logger.warn(`CronJob "${cronJob.func.name}" is not enabled. Skipping scheduling.`, listener);
      cron.stop();
    }
    else if (isTriggered) {
      // TODO: parse Cron date, not supported by the library... must do manually using private fields... yikes
      logger.debug(`CronJob "${cronOptions.name}" triggered for "${cron.getPattern()}" expression.`, listener);
      cron.trigger().then(() => cron.resume());
    }
    else {
      // TODO: parse Cron date, not supported by the library... must do manually using private fields... yikes
      logger.debug(`CronJob "${cronJob.func.name}" scheduled for "${cron.getPattern()}" expression.`, listener);
      cron.resume();
    }
  }

  /**
   * @static
   * @async
   * @param {*} functionOrName
   * @returns {*}
   */
  static async stopCronJobs(functionOrName) {
    functionOrName = functionOrName.name || functionOrName;
    const scheduledJobs = Cron.scheduledJobs.filter(item => item.name === functionOrName && !item.isStopped());
    scheduledJobs.forEach(item => item.stop());
    logger.debug(`Stopped ${scheduledJobs.length} scheduled ${Utilities.getPluralizedString("job", scheduledJobs)} named ${functionOrName}`);
  }
}

/**
 * Check if the listener is allowed for the channel.
 * @throws On unexpected type of channel.
 * @param {Listener} listener
 * @param {GuildChannel} channel
 * @returns {Promise<boolean>}
 */
export async function checkAllowedChannel(listener, channel) {
  if (!listener.requiredChannelIds?.length) {
    return true;
  }

  const isThreadChannel =
    channel.type === ChannelType.PublicThread
    || channel.type === ChannelType.PrivateThread;

  if (isThreadChannel) {
    channel = await channel.fetchStarterMessage().then(result => result.channel);
  }

  if (!Utilities.checkJestTest()) {
    Utilities.throwType(BaseChannel, channel);
  }

  return listener.requiredChannelIds.some(id => id === channel.id);
}

/**
 * Check if the listener is allowed for the channel type.
 * @throws On unexpected type of channel.
 * @param {Listener} listener
 * @param {GuildChannel} channel
 * @returns {Promise<boolean>}
 */
export function checkAllowedChannelType(listener, channel) {
  if (!channel) return true;
  if (!Array.isArray(listener.requiredChannelTypes)) return true;
  return listener.requiredChannelTypes.some(type => type === channel.type);
}

/**
 * Check if the listener is locked for the user. Listeners may be invoked
 * within or outside of a Guild, so check if the user has the required role
 * within the available guilds.
 * @param {Listener} listener
 * @param {User} user
 * @returns {Promise<boolean>}
 */
export async function checkAllowedUser(listener, user) {
  if (!Utilities.checkJestTest()) {
    Utilities.throwType(User, user);
  }

  const isAnyUserId = !listener.requiredUserIds.length;
  const isAnyRoleId = !listener.requiredRoleIds.length;
  if (isAnyUserId && isAnyRoleId) return true;

  if (listener.requiredUserIds.length) {
    const some = listener.requiredUserIds.includes(user.id);
    if (some) return true;
  }

  if (listener.requiredRoleIds.length) {
    for (const guild of user.client.guilds.cache.values()) {
      const roleIds = listener.requiredRoleIds;
      const member = await guild.members.fetch({ user });
      const some = roleIds.some(id => member.roles.cache.has(id));
      if (some) return true;
    }
  }

  return false;
}

/**
 * Executes the listener. Will run the locked locked when a listener is locked
 * for a user and the busy listener when the listener is busy.
 * @param {object} params
 */
async function executeListener(params) {
  const { interaction, listener, message, newMessage, oldMessage } = params;
  const instance = message || newMessage || oldMessage || interaction || {};
  const { channel, user } = instance;

  // ----------------------------------- //
  // End if the listener is not enabled. //
  // ----------------------------------- //

  const isListenerEnabled = listener.isEnabled;
  if (!isListenerEnabled) {
    logger.warn(`Listener "${listener.id}" is not enabled. Skipping scheduling.`, listener);
    return;
  }

  // --------------------------------------------------- //
  // End if the channel is not allowed for the listener. //
  // --------------------------------------------------- //

  const isAllowedChannel = checkAllowedChannel(listener, channel);
  if (!isAllowedChannel) return;

  const isAllowedChannelType = checkAllowedChannelType(listener, channel);
  if (!isAllowedChannelType) return;

  // ------------------------------------------------ //
  // End if the user is not allowed for the listener. //
  // ------------------------------------------------ //

  const isAllowedUser = user
    ? await checkAllowedUser(listener, user)
    : true; // ClientReady has no user, etc.

  if (!isAllowedUser) {
    try {
      logger.warn("Listener is locked for user. Executing locked user function.", listener);
      await listener.lockedFunc(params);
      return;
    }
    catch(error) {
      if (listener.isService) throw error;
      await handleListenerError({ ...params, error });
      return;
    }
  }

  // ------------------------------------------ //
  // End if the interaction's listener is busy. //
  // (Events can't be busy. Only interactions!) //
  // ------------------------------------------ //

  const isBusyInteraction = interaction
    ? Emitter.isBusy(interaction)
    : false;

  if (isBusyInteraction) {
    try {
      logger.warn("Interaction is busy. Executing busy function.", listener);
      await listener.busyFunc(params);
      return;
    }
    catch(error) {
      if (listener.isService) throw error;
      await handleListenerError({ ...params, error });
      return;
    }
  }

  // ------------------------------ //
  // Execute the listener function. //
  // ------------------------------ //

  try {
    await listener.func(params);
  }
  catch(error) {
    if (listener.isService) throw error;
    await handleListenerError({ ...params, error });
  }
}

/**
 * Get a composite key to identify an interaction by its unique property values.
 * @param {BaseInteraction} interaction
 * @returns {string}
 */
export function getBusyInteractionCompositeKey(interaction) {
  return interaction.customId
    + ("|" + interaction.message?.id || "")
    + ("|" + interaction.user?.id || "");
}

/**
 * Get the absolute filepaths of any importable scripts in the directory.
 * Filepaths are prepend with "file://" to appease NPM in Windows! 💩
 * @param {string} directory `"./plugins"`
 * @returns {string[]}
 */
export function getImportableFilepaths(directory) {
  return fs
    .readdirSync(directory)
    .filter(Utilities.checkExecutableFilename)
    .map(filename => {
      const relativePath = `${directory}/${filename}`;
      const absolutePath = path.resolve(relativePath).replaceAll("/", "/");
      return `file://${absolutePath}`; // https://github.com/nodejs/node/issues/31710
    });
}

/**
 * Handle the error caught by a listener. Replies to the user when possible.
 * @param {object} param
 * @param {BaseInteraction} param.interaction
 * @param {Listener} param.listener
 * @param {Error} param.error
 */
export async function handleListenerError({ interaction, listener, error }) {
  try {
    logger.error(error, listener);

    // ---------------------------------- //
    // End if there is nothing to update. //
    // ---------------------------------- //

    if (!interaction) return;

    // ---------------------------------- //
    // Defer so it can be followed up to. //
    // ---------------------------------- //

    if (!interaction.deferred) {
      await interaction.deferUpdate();
    }

    // ------------------------------------ //
    // Reset busy so it can be tried again. //
    // ------------------------------------ //

    if (Emitter.isBusy(interaction)) {
      Emitter.setBusy(interaction, false);
    }

    // ---------------------------------- //
    // Send follow up message with error. //
    // ---------------------------------- //

    if (error.toString().includes("DiscordAPIError[40005]")) {
      const content = `I'm not able to upload your file because the size exceeds the limit set by Discord. Please try again with a smaller file.\n\`\`\`${error}\`\`\``;
      const reply = await interaction.followUp({ content, ephemeral: true }).catch(e => logger.error(e, listener));
      if (reply) Utilities.LogPresets.SentReply(reply, listener);
    }
    else {
      const joinedAdmins = Utilities.getJoinedArrayWithOr(discord_bot_admin_user_ids.map(item => `<@${item}>`));
      const content = `I had an error with your request. Please contact ${joinedAdmins} if it keeps happening. 🧑‍🔧\n\`\`\`${error}\`\`\``;
      const reply = await interaction.followUp({ content, ephemeral: true }).catch(e => logger.error(e, listener));
      if (reply) Utilities.LogPresets.SentReply(reply, listener);
    }
  }
  catch(e) {
    // just in case!
    logger.error(e, listener);
  }
}

/**
 * Wrap the CronJob in an Listener before pushing to the listener stack.
 * This is executed for each CronJob at Emitter initialization.
 * @param {CronJob} cronJob
 * @param {string} filepath
 * @param {boolean} isService
 */
export function importCronJob(cronJob, filepath, isService) {
  const listener = new Listener()
    .setFunction(params => Emitter.scheduleCronJob({ cronJob, ...params }));

  listener.filename = path.basename(filepath);
  listener.filepath = filepath;
  listener.id = Events.ClientReady;
  listener.isEnabled = cronJob.isEnabled;
  listener.isService = isService;
  listener.runOrder = cronJob.runOrder;

  Emitter._importedListeners.has(Events.ClientReady)
    ? Emitter._importedListeners.get(Events.ClientReady).push(listener)
    : Emitter._importedListeners.set(Events.ClientReady, [listener]);
}

/**
 * Wrap the listener function in a Listener (if it was not already wrapped)
 * before pushing to the listener stack. This is executed for each Listener at
 * Emitter initialization.
 * @param {Listener} value The item value from the Emitter.Listener map.
 * @param {string} key The item key value from the Emitter.Listener map.
 * @param {string} filepath The filepath where the item was imported.
 * @param {boolean} isService If the item belongs to a service.
 */
export function importListener(value, key, filepath, isService) {
  if (!Emitter._importedListeners.has(key)) {
    Emitter._importedListeners.set(key, []);
  }

  const iterator = Array.isArray(value) ? value : [value];

  for (const item of iterator) {
    let listener = item;

    if (typeof listener === "function") {
      listener = new Listener().setFunction(item);
    }

    // Create auditing fields.
    listener.filename = path.basename(filepath);
    listener.filepath = filepath;
    listener.id = key;
    listener.isService = isService;
    // todo: this would be cool to have
    // listener.config = new Config(filepath);
    // listener.logger = new Logger(filepath);

    Emitter._importedListeners.get(key).push(listener);
  }
}

/**
 * Send a reply with internal information for the displayed buttons.
 * @param {object} param
 * @param {Listener} param.listener
 * @param {ButtonInteraction} param.interaction
 */
export async function sendButtonInfoReply({ listener, interaction }) {
  await interaction.deferReply({ ephemeral: true });

  const components = [...interaction.message.components]
    .map(item => item.components)
    .flat()
    .filter(item =>
      item.data.custom_id !== Interactions.ButtonComponentInfo
      && (item instanceof ButtonComponent || item instanceof BaseSelectMenuComponent)
    );

  const response = [];

  let isAnyLocked = false;
  let isAnyUnlocked = false;

  let unnamedButtonCount = 0;
  let unnamedSelectMenuCount = 0;

  for (const { data } of components) {
    if (!Emitter._importedListeners.has(data.custom_id)) {
      logger.error(`Couldn't find more info for "${data.custom_id}" listener.`);
      continue;
    }

    const listener = Emitter._importedListeners.get(data.custom_id)?.[0];

    const description = listener.description || "No description is set for this component.";

    let emoji = data.emoji?.id
      ? `<:${data.emoji.name}:${data.emoji.id}>`
      : data.emoji?.name;

    let label = data.label;

    switch(data.type) {
      case ComponentType.Button: {
        if (!label) unnamedButtonCount += 1;
        label ??= `Button #${unnamedButtonCount}`;
        emoji ??= "◽";
        break;
      }
      case ComponentType.StringSelect: {
        if (!label) unnamedSelectMenuCount += 1;
        label ??= `Select menu #${unnamedSelectMenuCount}`;
        emoji ??= "🪧"; //"🔲"//"🧩"//"🪧";
        break;
      }
    }

    const isAllowedUser = await checkAllowedUser(listener, interaction.user);
    let roles = listener.getRequiredRoleLinksForGuild(interaction);

    if (isAllowedUser) {
      isAnyUnlocked = true;
      roles = "`🔓 Unlocked` " + roles;
    }
    else {
      isAnyLocked = true;
      roles = "`🔐 Locked` " + roles;
    }

    response.push(`${emoji} **${label}** ${roles}\n\`\`\`${description}\`\`\``);
  }

  let responseFooter = "";

  if (isAnyLocked && isAnyUnlocked) {
    const joinedAdmins = Utilities.getJoinedArrayWithOr(discord_bot_admin_user_ids.map(item => `<@${item}>`));
    responseFooter = `You can only use some of these components. Please contact ${joinedAdmins} if you think this was in error. 🧑‍🔧`;
  }
  else if (isAnyUnlocked) {
    responseFooter = "You can use all of these components. Go ahead and give some a try! 🧑‍🔬";
  }
  else if (isAnyLocked) {
    const joinedAdmins = Utilities.getJoinedArrayWithOr(discord_bot_admin_user_ids.map(item => `<@${item}>`));
    responseFooter = `You can't use these components. Please contact ${joinedAdmins} if you think this was in error. 🧑‍🔧`;
  }
  else {
    throw new Error("Unexpected value was processed.");
  }

  const reply = await interaction.editReply({ content:
    "Here's what I know about this form. 📚 You're allowed to use unlocked " +
    "components, but locked components may need you to have more permissions " +
    "before their usage.\n\n" + `${response.join("\n")}\n${responseFooter}`
  });

  Utilities.LogPresets.SentReply(reply, listener);
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion SERVICE LOGIC                                                  //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
