import { ActionRowBuilder, ButtonBuilder, ButtonStyle, TextInputBuilder, TextInputStyle, ModalBuilder } from "discord.js";
import { basename } from "path";
import { filterChannelMessages, findChannelMessage } from "../index.js";
import { getAvailableFilepath, splitJsonStringByLength, tryParseStringToObject } from "./helpers/utilities.js";
import { tryDeleteMessageThread } from "./helpers/discord.js";
import fs from "fs-extra";
import Logger from "./logger.js";

const { discord_config_channel_id } = fs.readJsonSync("./config.json");

const logger = new Logger("config.js");

const CONFIG_INSTANCES = new Map();

// ------------------------------------------------------------------------- //
// >> INTERACTION DEFINITIONS                                             << //
// ------------------------------------------------------------------------- //

/**
 * Custom IDs used by components within this plugin
 */
export const COMPONENT_CUSTOM_IDS = {
  CONFIG_BUTTON_EDIT_CONFIG: "CONFIG_BUTTON_EDIT_CONFIG",
  CONFIG_BUTTON_SHOW_HELP: "CONFIG_BUTTON_SHOW_HELP",
  CONFIG_BUTTON_USE_CLOUD_HOST: "CONFIG_BUTTON_USE_CLOUD_HOST",
  CONFIG_BUTTON_USE_LOCAL_HOST: "CONFIG_BUTTON_USE_LOCAL_HOST",
  CONFIG_MODAL_EDIT_CONFIG: "CONFIG_MODAL_EDIT_CONFIG",
  CONFIG_VALUE_EDIT_CONFIG: "CONFIG_VALUE_EDIT_CONFIG",
}

/**
 * Component interactions handled within this plugin
 */
export const COMPONENT_INTERACTIONS = [
  {
    customId: COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_EDIT_CONFIG,
    onInteractionCreate: ({ interaction }) => onButtonComponentEditConfig({ interaction })
  },
  {
    customId: COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_SHOW_HELP,
    onInteractionCreate: ({ interaction }) => onButtonComponentShowHelp({ interaction })
  },
  {
    customId: COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_USE_CLOUD_HOST,
    onInteractionCreate: ({ interaction }) => onButtonComponentUseCloudHost({ interaction })
  },
  {
    customId: COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_USE_LOCAL_HOST,
    onInteractionCreate: ({ interaction }) => onButtonComponentUseLocalHost({ interaction })
  },
  {
    customId: COMPONENT_CUSTOM_IDS.CONFIG_MODAL_EDIT_CONFIG,
    onInteractionCreate: ({ client, interaction }) => onModalEditConfig({ client, interaction })
  }
]

/**
 * Event handler for the `MessageDelete` event
 * @param {Object} param
 * @param {Message} param.message
 */
export const onMessageDelete = ({ message: starterMessage }) => tryDeleteMessageThread({
  allowedChannelIds: [discord_config_channel_id],
  logger,
  starterMessage
});

export default class Config {
  constructor(configFilename) {
    // store the config in memory so it can be updated without reloading
    CONFIG_INSTANCES.set(configFilename, this);

    this.getIsCloudHosted = () => this.starterMessage?.content.includes("🟩");
    this.toString = () => getObjectAsJsonString(this.fileContents);

    // map the root config.json to the config object
    const rootConfig = fs.readJsonSync("config.json");
    Object.assign(this, rootConfig);

    // map the file information to the config object
    this.filename = configFilename;
    this.filepath = `./plugins/${configFilename}`;

    // instantiate the to-be initialized properties
    this.fileContents = {};
    this.starterMessage = null;
    this.threadChannel = null;
  }

  /**
   * Populate the config data
   * @param {Client} client
   */
  async initialize(client) {
    try {
      const find = ({ thread }) => thread?.name === this.filename;
      this.starterMessage = await findChannelMessage(discord_config_channel_id, find);
      this.threadChannel = this.starterMessage?.thread;

      if (!this.starterMessage) {
        // create the starter message on the first run of a new plugin
        const channel = await client.channels.fetch(discord_config_channel_id);
        this.starterMessage = await channel.send({ content: "🟥 `Using local host`" });
      }

      if (!this.threadChannel) {
        // create the thread channel on the first run of a new plugin (or if it was deleted)
        this.threadChannel = await this.starterMessage.startThread({ name: this.filename });
        await this.threadChannel.send(`**${this.filename}**`);
      }

      const threadChannelFilter = ({ author, content }) =>
        author.id === client.user.id && content.startsWith("```json");

      const threadContentsAsString = (await filterChannelMessages(this.threadChannel.id, threadChannelFilter))
        .map(message => message?.content?.replaceAll("```json", "").replaceAll("\n```", ""))
        .reverse().join("").trim();

      if (!fs.existsSync(this.filepath)) {
        await fs.writeFile(this.filepath, threadContentsAsString || "{}");
        logger.info(`Created new config for "${this.filename}"`);
        this.fileContents = fs.readJsonSync(this.filepath);
        Object.assign(this, this.fileContents);
        return this;
      }

      const fileContentsAsObject = fs.readJsonSync(this.filepath, { throws: false }) ?? {};
      const fileContentsAsString = getObjectAsJsonString(fileContentsAsObject);

      const backupFilepath = getAvailableFilepath(this.filepath);
      const backupFilename = basename(backupFilepath);

      if (fileContentsAsString === threadContentsAsString) {
        this.fileContents = fileContentsAsObject;
      }

      else if (this.getIsCloudHosted()) {
        this.fileContents = tryParseStringToObject(threadContentsAsString);
        // save cloud contents to local file
        await fs.rename(this.filepath, backupFilepath);
        logger.info(`Renamed "${this.filename}" to "${backupFilename}"`);
        await fs.writeFile(this.filepath, threadContentsAsString);
        logger.info(`Restored cloud config for "${this.filename}"`);
      }

      else {
        this.fileContents = fileContentsAsObject;
        // save local file contents to cloud
        // only back up the thread channel if it has string contents to save!
        if (threadContentsAsString) await fs.writeFile(backupFilepath, threadContentsAsString);
        if (threadContentsAsString) logger.info(`Saved obsolete cloud config "${backupFilename}"`);
        await dropCreateThreadMessages(this);
      }

      return Object.assign(this, this.fileContents);
    }
    catch(e) {
      logger.error(e);
    }
  }

  /**
   * Write changes to JSON properties to the file and update the Discord thread
   */
  async saveChanges() {
    try {
      // validate the file changes

      if (!this.fileContents) {
        logger.error("Config was not initialized");
        return;
      }

      const oldFileContentsAsObject = fs.readJsonSync(this.filepath, { throws: false }) ?? {};
      const oldFileContentsAsString = getObjectAsJsonString(oldFileContentsAsObject);

      const newFileContentsAsObject = this.fileContents;
      const newFileContentsAsString = getObjectAsJsonString(newFileContentsAsObject);

      if (oldFileContentsAsString === newFileContentsAsString) return;

      // back up the existing file and write the file changes

      const backupFilepath = getAvailableFilepath(this.filepath);
      const backupFilename = basename(backupFilepath);

      await fs.rename(this.filepath, backupFilepath);
      logger.info(`Renamed obsolete "${this.filename}" to "${backupFilename}"`);

      await fs.writeFile(this.filepath, newFileContentsAsString);
      logger.info(`Saved changed config for "${this.filename}"`);

      // update the file contents in the Discord thread channel

      await dropCreateThreadMessages(this);
    }
    catch(e) {
      logger.error(e);
    }
  }
}

/**
 * Delete the existing thread messages then send updated messages
 * (don't update because that adds a badge that ruins formatting)
 * @param {Config} config
 */
async function dropCreateThreadMessages(config) {
  try {
    await config.threadChannel.setArchived(false);

    // split JSON into chunks of up to 1986 chars to fit within the 2000 char limit
    let contents = splitJsonStringByLength(config.toString(), 1986);
    if (!contents.length) contents.push(`{}`);
    contents = contents.map(str => `\`\`\`json\n${str}\n\`\`\``);

    const button1 = getButtonComponent(COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_EDIT_CONFIG);
    const button2 = getButtonComponent(config.getIsCloudHosted() ? COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_USE_LOCAL_HOST : COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_USE_CLOUD_HOST);
    const button3 = getButtonComponent(COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_SHOW_HELP);
    const components = [new ActionRowBuilder().addComponents(button1, button2, button3)];

    const filter = ({ content }) => content.startsWith("```json");
    const threadMessages = await filterChannelMessages(config.threadChannel.id, filter);
    for(const threadMessage of threadMessages) await threadMessage.delete();

    for(let i = 0; i < contents.length; i++) {
      const options = { content: contents[i] };
      // attach button components to the last message sent to thread
      if (i === contents.length - 1) options.components = components;
      await config.threadChannel.send(options);
    }

    logger.info(`Saved updated cloud config for "${config.filename}"`);

    await config.threadChannel.setArchived(true);
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Get the preformatted ButtonComponents based on its customId
 * @param {String} component_custom_id
 * @returns {ButtonBuilder}
 */
function getButtonComponent(component_custom_id) {
  switch(component_custom_id) {
    case COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_EDIT_CONFIG:
      return new ButtonBuilder()
        .setCustomId(COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_EDIT_CONFIG)
        .setEmoji("📝")
        .setLabel("Edit Config")
        .setStyle(ButtonStyle.Primary);

    case COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_SHOW_HELP:
      return new ButtonBuilder()
        .setCustomId(COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_SHOW_HELP)
        .setEmoji("❔")
        .setLabel("Show Help")
        .setStyle(ButtonStyle.Secondary);

    case COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_USE_CLOUD_HOST:
      return new ButtonBuilder()
        .setCustomId(COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_USE_CLOUD_HOST)
        .setEmoji("☁️")
        .setLabel("Use Cloud Host")
        .setStyle(ButtonStyle.Success);

    case COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_USE_LOCAL_HOST:
      return new ButtonBuilder()
        .setCustomId(COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_USE_LOCAL_HOST)
        .setEmoji("🖥️")
        .setLabel("Use Local Host")
        .setStyle(ButtonStyle.Danger);

    default:
      throw "";
  }
}

/**
 * Stringify an object in a standard format
 * @param {Object} jsonObject
 * @returns {String}
 */
function getObjectAsJsonString(jsonObject) {
  return JSON.stringify(jsonObject, null, 2)
}

/**
 * On press of `Edit Config` ButtonComponent
 * @param {Object} param
 * @param {ButtonInteraction} param.interaction
 */
async function onButtonComponentEditConfig({ interaction }) {
  try {
    const filepath = `./plugins/${interaction.channel.name}`;

    if (!fs.existsSync(filepath)) {
      const content = `This config can't be edited because it doesn't exist on the host.`;
      await interaction.reply({ content, ephemeral: true });
      await interaction.channel.setArchived(true);
      return;
    }

    const fileContentsAsObject = fs.readJsonSync(filepath, { throws: false }) || {};
    const fileContentsAsString = getObjectAsJsonString(fileContentsAsObject);

    if (fileContentsAsString.length > 4000) {
      const content = `This config can't be edited because it exceeds Discord's size limit.`;
      await interaction.reply({ content, ephemeral: true });
      await interaction.channel.setArchived(true);
      return;
    }

    const textInput = new TextInputBuilder()
      .setCustomId(COMPONENT_CUSTOM_IDS.CONFIG_VALUE_EDIT_CONFIG)
      .setLabel(interaction.channel.name)
      .setRequired(true)
      .setStyle(TextInputStyle.Paragraph)
      .setValue(fileContentsAsString);

    const modal = new ModalBuilder()
      .addComponents(new ActionRowBuilder().addComponents(textInput))
      .setCustomId(COMPONENT_CUSTOM_IDS.CONFIG_MODAL_EDIT_CONFIG)
      .setTitle("Edit Config");

    await interaction.channel.setArchived(true);
    await interaction.showModal(modal);
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Update the starter message content with the lock status; disable the edit button and display the unlock button
 * @param {Object} param
 * @param {ButtonInteraction} param.interaction
 */
async function onButtonComponentShowHelp({ interaction }) {
  try {
    await interaction.deferReply({ ephemeral: true });
    await interaction.channel.setArchived(false);

    const content = "TODO";
      // "`🟦 Edit Config` edits the local and cloud copies of the config."
      // + "`🟥 Local Host` config files upload their content to Discord as a backup copy."
      // + " `🟩 Cloud Host` config files overwrite local files for portability."
      // + " Any config changes to local or cloud will create a local backup.";

    await interaction.editReply({ content })
    await interaction.channel.setArchived(true);
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Update the starter message content with the lock status; disable the edit button and display the unlock button
 * @param {Object} param
 * @param {ButtonInteraction} param.interaction
 */
async function onButtonComponentUseCloudHost({ interaction }) {
  try {
    await interaction.deferUpdate();
    await interaction.channel.setArchived(false);
    const starterMessage = await interaction.channel.fetchStarterMessage();
    await starterMessage.edit("🟩 `Using cloud host`");
    const button1 = getButtonComponent(COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_EDIT_CONFIG);
    const button2 = getButtonComponent(COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_USE_LOCAL_HOST);
    const button3 = getButtonComponent(COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_SHOW_HELP);
    const components = [new ActionRowBuilder().addComponents(button1, button2, button3)];
    await interaction.message.edit({ components });
    await interaction.channel.setArchived(true);
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Update the starter message content with the unlock status; enable the edit button and display the lock button
 * @param {Object} param
 * @param {ButtonInteraction} param.interaction
 */
async function onButtonComponentUseLocalHost({ interaction }) {
  try {
    await interaction.deferUpdate();
    await interaction.channel.setArchived(false);
    const starterMessage = await interaction.channel.fetchStarterMessage();
    await starterMessage.edit("🟥 `Using local host`");
    const button1 = getButtonComponent(COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_EDIT_CONFIG);
    const button2 = getButtonComponent(COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_USE_CLOUD_HOST);
    const button3 = getButtonComponent(COMPONENT_CUSTOM_IDS.CONFIG_BUTTON_SHOW_HELP);
    const components = [new ActionRowBuilder().addComponents(button1, button2, button3)];
    await interaction.message.edit({ components });
    await interaction.channel.setArchived(true);
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * On submission of `Edit Config` Modal
 * @param {Object} param
 * @param {ButtonInteraction} param.interaction
 */
async function onModalEditConfig({ interaction }) {
  try {
    await interaction.channel.setArchived(false);
    await interaction.deferReply({ ephemeral: true });

    // validate the user inputted text

    const { fields } = interaction;
    const { CONFIG_VALUE_EDIT_CONFIG } = COMPONENT_CUSTOM_IDS;

    const textInputAsString = fields.getTextInputValue(CONFIG_VALUE_EDIT_CONFIG);
    const textInputAsObject = tryParseStringToObject(textInputAsString);

    if (!textInputAsObject) {
      await interaction.editReply("Your input was not a valid JSON. Please try again.");
      await interaction.channel.setArchived(true);
      return;
    }

    // back up the existing file and write the inputted file changes

    const filepath = `./plugins/${interaction.channel.name}`;
    const filename = basename(filepath);

    const backupFilepath = getAvailableFilepath(filepath);
    const backupFilename = basename(backupFilepath);

    await fs.rename(filepath, backupFilepath);
    logger.info(`Renamed obsolete "${filename}" to "${backupFilename}"`);

    await fs.writeFile(filepath, getObjectAsJsonString(textInputAsObject));
    logger.info(`Saved edited config for "${filename}"`);

    // update the config in memory so changes are applied to plugins without relaunch

    const config = CONFIG_INSTANCES.get(interaction.channel.name);

    if (config) {
      config.fileContents = textInputAsObject;
      Object.assign(config, config.fileContents);
    }

    // update the file contents in the Discord thread channel

    await interaction.deleteReply();
    await dropCreateThreadMessages(config);
    await interaction.followUp({ content: "Success! The config has been updated.", ephemeral: true });
    await interaction.channel.setArchived(true);
  }
  catch(e) {
    logger.error(e);
  }
}

// ------------------------------------------------------------------------- //
// >> CODE GRAVEYARD                                                      << //
// ------------------------------------------------------------------------- //

/**
 * This code's used to edit thread channel messages instead of lazily deleting them.
 *   Too bad Discord forces the (Edited) tag below each message which creates a huge
 *   gap between messages displaying JSON content that's intended to be seamless ...
 *   To the code graveyard you go! Maybe you'll be useful one day like the old phone
 *   chargers I've had in my closet for over a decade just in case their time comes.
 */

// if (updatedMessageContents.length >= threadChannelMessages.length) {
//   // update all thread channel messages
//   for(let i = 0; i < threadChannelMessages.length; i++) {
//     const options = { components: [], content: updatedMessageContents[i] };
//     if (i === updatedMessageContents.length - 1) options.components = components;
//     await threadChannelMessages[i].edit(options);
//   }

//   // create new thread channel messages
//   for(let i = threadChannelMessages.length; i < updatedMessageContents.length; i++) {
//     const options = { components: [], content: updatedMessageContents[i] };
//     if (i === updatedMessageContents.length - 1) options.components = components;
//     await config.threadChannel.send(options);
//   }
// }

// else {
//   // update first n channel messages
//   for(let i = 0; i < updatedMessageContents.length; i++) {
//     const options = { components: [], content: updatedMessageContents[i] };
//     if (i === updatedMessageContents.length - 1) options.components = components;
//     await config.threadChannel.edit(options);
//   }

//   // delete remaining channel messages
//   for (let i = updatedMessageContents.length; i < threadChannelMessages.length; i++) {
//     const message = threadChannelMessages[i];
//     await message.delete();
//   }
// }
