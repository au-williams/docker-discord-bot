import { ActionRowBuilder, ButtonBuilder, ButtonStyle, TextInputBuilder, TextInputStyle, ModalBuilder, MessageType } from "discord.js";
import { filterChannelMessages, findChannelMessage } from "../index.js";
import { getIsEqualArrays, splitJsonStringByLength } from "./helpers/array.js";
import { getUniqueFilename } from "./helpers/string.js";
import { tryDeleteThread } from "./helpers/discord.js";
import { tryParseJsonObject } from "./helpers/object.js";
import fs from "fs-extra";
import Logger from "./logger.js";

const { discord_config_channel_id } = fs.readJsonSync("./config.json");

const CONFIG_INSTANCES = {};

const logger = new Logger("config.js");

// todo: updating config from plugin, reload config thread

// ------------------------------------------------------------------------- //
// >> INTERACTION DEFINITIONS                                             << //
// ------------------------------------------------------------------------- //

export const COMPONENT_CUSTOM_IDS = {
  CONFIG_EDIT_CONFIG_BUTTON: "CONFIG_EDIT_CONFIG_BUTTON",
  CONFIG_EDIT_CONFIG_MODAL: "CONFIG_EDIT_CONFIG_MODAL",
  CONFIG_EDIT_CONFIG_VALUE: "CONFIG_EDIT_CONFIG_VALUE",
  CONFIG_LOCK_CHANGES_BUTTON: "CONFIG_LOCK_CHANGES_BUTTON",
  CONFIG_UNLOCK_CHANGES_BUTTON: "CONFIG_UNLOCK_CHANGES_BUTTON"
}

export const COMPONENT_INTERACTIONS = [
  {
    customId: COMPONENT_CUSTOM_IDS.CONFIG_EDIT_CONFIG_BUTTON,
    onInteractionCreate: ({ interaction }) => onEditConfigButton({ interaction })
  },
  {
    customId: COMPONENT_CUSTOM_IDS.CONFIG_EDIT_CONFIG_MODAL,
    onInteractionCreate: ({ client, interaction }) => onEditConfigModal({ client, interaction })
  },
  {
    customId: COMPONENT_CUSTOM_IDS.CONFIG_LOCK_CHANGES_BUTTON,
    onInteractionCreate: ({ interaction }) => onLockChangesButton({ interaction })
  },
  {
    customId: COMPONENT_CUSTOM_IDS.CONFIG_UNLOCK_CHANGES_BUTTON,
    onInteractionCreate: ({ interaction }) => onUnlockChangesButton({ interaction })
  },
]

export const onMessageDelete = ({ message }) => tryDeleteThread({
  allowedChannelIds: [discord_config_channel_id],
  logger, starterMessage: message
});

export default class Config {
  constructor(configFilename) {
    this.filename = configFilename;
    this.filepath = `./plugins/${configFilename}`;

    this.jsonData = {};
    this.starterMessage = null;
    this.threadChannel = null;

    this.getIsEditable = () => this.toString().length <= 4000;
    this.getIsLocked = () => this.starterMessage?.content.includes("🔒");
    this.toString = () => getJsonFormattedString(this.jsonData);
  }

  /**
   * @param {Client} client
   */
  async initialize(client) {
    try {
      // ---------------------------------------------------- //
      // assign unchanging references on first initialization //
      // ---------------------------------------------------- //

      CONFIG_INSTANCES[this.filename] ??= this;
      this.starterMessage ??= await findChannelMessage(discord_config_channel_id, ({ thread }) => thread?.name === this.filename);
      this.threadChannel ??= this.starterMessage?.thread;

      // ---------------------------------------------------- //
      // reassign JSON data from the host on reinitialization //
      // ---------------------------------------------------- //

      this.jsonData = fs.readJsonSync(this.filepath);
      Object.assign(this, this.jsonData);

      if (!this.starterMessage) {
        // create the starter message on the first run of a new plugin
        const channel = await client.channels.fetch(discord_config_channel_id);
        this.starterMessage = await channel.send({ content: "🟥🔓 **Changes Unlocked**" });
      }

      /**
       * Format the local JSON file contents into a string[] for sending as Discord messages
       * @type {string[]}
       */
      const messageContentFromJsonObject = (() => {
        const maxLength = 1986; // 1986 = 2000 (max message chars) - 14 (number of formatted chars)
        return splitJsonStringByLength(`${this}`, maxLength).map(str => `\`\`\`json\n${str}\n\`\`\``);
      })();

      /**
       * Send the message content to thread channel with button components attached to the last message
       * @param {string[]} messageContent
       */
      const sendMessageContentToThreadChannel = async messageContent => {
        const editButton = getEditButtonComponent({ isDisabled: false });
        const lockButton = getLockButtonComponent();
        const components = [new ActionRowBuilder().addComponents(editButton, lockButton)];

        for(let i = 0; i < messageContent.length; i++) {
          await this.threadChannel.send(i === messageContent.length - 1
            ? { content: messageContent[i], components }
            : { content: messageContent[i] }
          );
        }
      }

      if (!this.threadChannel) {
        // create the thread channel on the first run of a new plugin (or in an error state)
        this.threadChannel = await this.starterMessage.startThread({ name: this.filename });
        await sendMessageContentToThreadChannel(messageContentFromJsonObject);
        logger.info(`Sent config to Discord for "${this.filename}"`);
      }

      // ------------------------------------------------------------- //
      // check for obsolete data and perform a refresh if any is found //
      // ------------------------------------------------------------- //

      /**
       * Extract the thread channel contents into a string[] to compare with the JSON message content
       * @type {string[]}
       */
      const messageContentFromThreadChannel = await (async () => {
        const filter = ({ content }) => content.startsWith("```json");
        const threadMessages = await filterChannelMessages(this.threadChannel.id, filter);
        return threadMessages.map(({ content }) => content).reverse();
      })();

      const isConfigLocked = this.getIsLocked();
      const isEqualContent = getIsEqualArrays(messageContentFromJsonObject, messageContentFromThreadChannel);

      if (isConfigLocked && !isEqualContent) {
        // restore the JSON file from the thread channel
        const newFileContent = getJoinedMessageContent(messageContentFromThreadChannel);
        await backupAndUpdateJsonFile(this, newFileContent);
        this.jsonData = fs.readJsonSync(this.filepath);
        Object.assign(this, this.jsonData);
      }

      else if (!isConfigLocked && !isEqualContent) {
        // update the thread channel with the JSON file
        const threadMessages = await filterChannelMessages(this.threadChannel.id, ({ type }) => type === MessageType.Default);
        for(const threadMessage of threadMessages) await threadMessage.delete();
        logger.info(`Deleted config from Discord for "${this.filename}"`);
        await sendMessageContentToThreadChannel(messageContentFromJsonObject);
        logger.info(`Sent config to Discord for "${this.filename}"`);
      }

      return this;
    }
    catch({ stack }) {
      logger.error(stack);
    }
  }
}

/**
 * Create a backup of the existing JSON file before saving new content to the file
 * @param {Config} config
 * @param {string} newFileContent
 */
async function backupAndUpdateJsonFile(config, newFileContent) {
  const backupFilename = getUniqueFilename(config.filepath);
  const backupFilepath = config.filepath.replace(config.filename, backupFilename);
  // back up the obsolete JSON file
  await fs.rename(config.filepath, backupFilepath);
  logger.info(`Renamed "${config.filename}" to "${backupFilename}"`);
  // save the channel contents to the JSON file
  await fs.writeFile(config.filepath, newFileContent);
  logger.info(`Restored locked config values from Discord for "${config.filename}"`);
}

function getEditButtonComponent({ isDisabled }) {
  const button = new ButtonBuilder();
  button.setCustomId(COMPONENT_CUSTOM_IDS.CONFIG_EDIT_CONFIG_BUTTON);
  button.setDisabled(isDisabled);
  button.setEmoji("📝");
  button.setLabel("Edit Config");
  button.setStyle(isDisabled ? ButtonStyle.Secondary : ButtonStyle.Primary);
  return button;
}

function getJoinedMessageContent(messageContent) {
  return messageContent
    .join("").replaceAll("```json", "")
    .replaceAll("\n```", "").trim();
}

function getJsonFormattedString(jsonData) {
  return JSON.stringify(jsonData, null, 2)
}

function getLockButtonComponent() {
  const button = new ButtonBuilder();
  button.setCustomId(COMPONENT_CUSTOM_IDS.CONFIG_LOCK_CHANGES_BUTTON);
  button.setEmoji("🔒");
  button.setLabel("Lock Changes");
  button.setStyle(ButtonStyle.Success);
  return button;
}

function getUnlockButtonComponent() {
  const button = new ButtonBuilder();
  button.setCustomId(COMPONENT_CUSTOM_IDS.CONFIG_UNLOCK_CHANGES_BUTTON);
  button.setEmoji("🔓");
  button.setLabel("Unlock Changes");
  button.setStyle(ButtonStyle.Danger);
  return button;
}

async function onEditConfigButton({ interaction }) {
  try {
    const config = CONFIG_INSTANCES[interaction.channel.name];

    if (!fs.existsSync(config.filepath)) {
      const content = `\`${config.filename}\` does not exist on the remote server!`;
      await interaction.reply({ content, ephemeral: true });
      return;
    }

    if (!config.getIsEditable()) {
      const content = `This config can't be edited because it exceeds Discord's size limit.`;
      await interaction.reply({ content, ephemeral: true });
      return;
    }

    const textInput = new TextInputBuilder();
    textInput.setCustomId(COMPONENT_CUSTOM_IDS.CONFIG_EDIT_CONFIG_VALUE);
    textInput.setLabel(interaction.channel.name);
    textInput.setRequired(true);
    textInput.setStyle(TextInputStyle.Paragraph);
    textInput.setValue(`${config}`);

    await interaction.showModal(new ModalBuilder()
      .addComponents(new ActionRowBuilder().addComponents(textInput))
      .setCustomId(COMPONENT_CUSTOM_IDS.CONFIG_EDIT_CONFIG_MODAL)
      .setTitle("Edit JSON")
    );
  }
  catch({ stack }) {
    logger.error(stack);
  }
}

/**
 * If the user input is valid JSON then backup the JSON file, save the input, reload the config in memory
 * @param {Object} param
 * @param {Client} param.client
 * @param {ModalSubmitInteraction} param.interaction
 */
async function onEditConfigModal({ client, interaction }) {
  await interaction.deferReply({ ephemeral: true });

  const { fields } = interaction;
  const { CONFIG_EDIT_CONFIG_VALUE } = COMPONENT_CUSTOM_IDS;
  const textInputValue = fields.getTextInputValue(CONFIG_EDIT_CONFIG_VALUE);
  const textInputValueAsJson = tryParseJsonObject(textInputValue);

  if (!textInputValueAsJson) {
    await interaction.editReply("Your input was not valid JSON. Try again.");
    return;
  }

  const config = CONFIG_INSTANCES[interaction.channel.name];
  const newFileContent = getJsonFormattedString(textInputValueAsJson);
  await backupAndUpdateJsonFile(config, newFileContent);
  await config.initialize(client); // reload file update

  await interaction.deleteReply();
  await interaction.followUp({ content: "Success! The config has been updated.", ephemeral: true });
}

/**
 * Update the starter message content with the lock status; disable the edit button and display the unlock button
 * @param {Object} param
 * @param {ButtonInteraction} param.interaction
 */
async function onLockChangesButton({ interaction }) {
  await interaction.deferUpdate();

  const starterMessage = await interaction.channel.fetchStarterMessage();
  await starterMessage.edit("🟩🔒 **Changes Locked**");

  const editButton = getEditButtonComponent({ isDisabled: true });
  const unlockButton = getUnlockButtonComponent();

  const components = [new ActionRowBuilder().addComponents(editButton, unlockButton)];
  await interaction.message.edit({ components });
}

/**
 * Update the starter message content with the unlock status; enable the edit button and display the lock button
 * @param {Object} param
 * @param {ButtonInteraction} param.interaction
 */
async function onUnlockChangesButton({ interaction }) {
  await interaction.deferUpdate();

  const starterMessage = await interaction.channel.fetchStarterMessage();
  await starterMessage.edit("🟥🔓 **Changes Unlocked**");

  const editButton = getEditButtonComponent({ isDisabled: false });
  const lockButton = getLockButtonComponent();

  const components = [new ActionRowBuilder().addComponents(editButton, lockButton)];
  await interaction.message.edit({ components });
}
