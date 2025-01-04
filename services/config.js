import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Events } from "discord.js";
import { Emitter } from "./emitter.js";
import { Logger } from "./logger.js";
import { Messages } from "./messages.js";
import { nanoid } from "nanoid";
import { Utilities } from "../services/utilities.js";
import date from "date-and-time";
import Downloader from "nodejs-file-downloader";
import fs from "fs-extra";
import Listener from "../entities/Listener.js";
import path from "path";
import { stringify } from "querystring";

const { discord_bot_admin_user_ids, discord_config_channel_id, temp_directory } = fs.readJsonSync("config.json");

const logger = new Logger(import.meta.filename);

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region EMITTER.JS LISTENERS                                              //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * The interactions created by this script. We use these unique IDs to define
 * buttons, commands, and components and so Discord can emit the interactions
 * that we handle in the `Listeners<object>` variable.
 */
export const Interactions = Object.freeze({
  ButtonComponentBackup: "CONFIG_BUTTON_COMPONENT_BACKUP",
  ButtonComponentDelete: "CONFIG_BUTTON_COMPONENT_DELETE",
  ButtonComponentRestore: "CONFIG_BUTTON_COMPONENT_RESTORE",
  ModalSubmitBackup: "CONFIG_MODAL_SUBMIT_BACKUP",
  ModalSubmitDelete: "CONFIG_MODAL_SUBMIT_DELETE",
  ModalSubmitRestore: "CONFIG_MODAL_SUBMIT_RESTORE"
});

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
    .setEnabled(discord_config_channel_id && Messages.isServiceEnabled)
    .setFunction(async params => await validateBackups(params))
    .setRunOrder(-99), // run after Message.js service is complete
  [Interactions.ButtonComponentBackup]: new Listener()
    .setEnabled(discord_config_channel_id && Messages.isServiceEnabled)
    .setDescription("Uploads the client file as a new backup file.")
    .setFunction(showModalBackup)
    .setRequiredUsers(discord_bot_admin_user_ids),
  [Interactions.ButtonComponentDelete]: new Listener()
    .setEnabled(discord_config_channel_id && Messages.isServiceEnabled)
    .setDescription("Deletes the backup file from the backup history.")
    .setFunction(showModalDelete)
    .setRequiredUsers(discord_bot_admin_user_ids),
  [Interactions.ButtonComponentRestore]: new Listener()
    .setEnabled(discord_config_channel_id && Messages.isServiceEnabled)
    .setDescription("Overwrites the client file with the backup file.")
    .setFunction(showModalRestore)
    .setRequiredUsers(discord_bot_admin_user_ids),
  [Interactions.ModalSubmitBackup]: new Listener()
    .setFunction(uploadBackupFile),
  [Interactions.ModalSubmitDelete]: new Listener()
    .setFunction(deleteBackupFile),
  [Interactions.ModalSubmitRestore]: new Listener()
    .setFunction(restoreBackupFile)
});

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS LISTENERS                                           //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region SERVICE COMPONENTS                                                //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

const deleteBackupButton = new ButtonBuilder()
  .setCustomId(Interactions.ButtonComponentDelete)
  .setEmoji({ name: "🚮" })
  .setLabel("Delete")
  .setStyle(ButtonStyle.Secondary);

const restoreBackupButton = new ButtonBuilder()
  .setCustomId(Interactions.ButtonComponentRestore)
  .setEmoji({ name: "⬇️" })
  .setLabel("Restore")
  .setStyle(ButtonStyle.Secondary);

const updateBackupButton = new ButtonBuilder()
  .setCustomId(Interactions.ButtonComponentBackup)
  .setEmoji({ name: "⬆️" })
  .setLabel("Backup")
  .setStyle(ButtonStyle.Secondary);

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion SERVICE COMPONENTS                                             //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region SERVICE LOGIC                                                     //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

let _rootConfig;

/**
 * The Config service backs up plugin config files to Discord. Obsolete plugins
 * will be logged as a warning during startup.
 */
export class Config {
  /**
   * The paths to the loaded `.json` files for the event listeners to consume.
   * @type {Set<string>}
   */
  static filepaths = new Set();

  /**
   * Get the config object. No parameter will only return the root config data. Providing the
   * filepath to the plugins `.json` (or filepath to the plugins `.js` if they share the same
   * name) will merge and return the contents of that file along with the root config data.
   * @param {string?} filepath `"./plugins/example.js"` or `"./plugins/example.json"`
   */
  constructor(filepath = null) {
    if (!_rootConfig) {
      if (!fs.existsSync("config.json")) {
        throw new Error("Could not find the root \"config.json\" file.");
      }
      _rootConfig = fs.readJsonSync("config.json");
      validateContents(_rootConfig, "config.json", "./config.json");
    }

    // map the root config.json to the config object
    Object.assign(this, _rootConfig);

    if (typeof filepath === "string") {
      // infer the config filename by the filepath
      const parsed = path.parse(filepath.filename || filepath);
      this.configFilename = `${parsed.name}.json`;
      this.configFilepath = `${path.join(parsed.dir, this.configFilename)}`;

      if (!fs.existsSync(this.configFilepath)) {
        throw new Error(`Could not find "${this.configFilepath}" file.`);
      }

      const contents = fs.readJsonSync(this.configFilepath);
      validateContents(contents, this.configFilename, this.configFilepath);
      Config.filepaths.add(this.configFilepath);
      Object.assign(this, contents);
    }
  }

  /**
   *
   */
  save() {
    if (!this.configFilepath || !fs.existsSync(this.configFilepath)) {
      throw new Error(`Could not find "${this.configFilepath}" file.`);
    }

    const data = {};
    const keys = Object.keys(fs.readJsonSync(this.configFilepath));
    keys.forEach(item => data[item] = this[item]);

    fs.writeFileSync(this.configFilepath, JSON.stringify(data, null, 2));
    logger.debug(`Saved changes for "${this.configFilename}" file.`);
  }
}

/**
 * Deletes the config file from Discord.
 * @param {object} param
 * @param {ModalSubmitInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function deleteBackupFile({ interaction, listener }) {
  await interaction.deferUpdate();
  await interaction.message.delete();
  logger.info(`Deleted backup file uploaded on ${getAttachmentDate(interaction)}.`, listener);
}

/**
 * Get the filename that was sent in the starter message content.
 * @async
 * @param {ButtonInteraction} interaction
 * @returns {string}
 */
export async function getFilenameFromInteraction(interaction) {
  const { content } = interaction.channel.isThread()
    ? (await interaction.channel.fetchStarterMessage())
    : interaction.message;

  return content.replaceAll("`", "");
}

/**
 * Get the filepath of the filename that has been loaded.
 * @throws Will throw if the filepath was not found.
 * @param {string} filename
 * @returns {string}
 */
export function getFilepathFromFilename(filename) {
  const filepath = [...Config.filepaths.keys()].find(filepath => filepath.endsWith(filename));
  if (!filepath) throw new Error(`Filepath for "${filename}" not found in loaded filepaths.`);
  return filepath;
}

/**
 * Get the message date from an interaction in the "MM/DD/YYYY at hh:mm A" format.
 * @param {ButtonInteraction} interaction
 * @returns {string}
 */
export function getAttachmentDate(interaction) {
  const formatString = "MM/DD/YYYY at hh:mm A";
  const { createdAt, editedAt } = interaction.message;
  return date.format(editedAt || createdAt, formatString);
}

/**
 * Get the starter message or create one if it doesn't exist.
 * @param {string} filepath The config filepath.
 * @param {GuildChannel} channel The config channel.
 * @param {Listener} listener
 * @returns {Promise<Message>}
 */
export async function getOrCreateStarterMessage(filepath, channel, listener) {
  const filename = path.basename(filepath);

  let starterMessage =
    Messages.get({ channel }).find(({ content }) => content === `\`${filename}\``);

  if (!starterMessage) {
    // create the starter message on the first run of a new plugin (or if it was deleted)
    starterMessage = await channel.send({
      files: [new AttachmentBuilder(filepath)],
      components: [new ActionRowBuilder().addComponents(updateBackupButton, restoreBackupButton, Emitter.moreInfoButton)],
      content: `\`${filename}\``,
    });
    logger.debug(`Sent "${filename}" starter message to ${Utilities.getFormattedGuildAndChannelString(starterMessage)}.`, listener)
  }

  if (!starterMessage.hasThread) {
    // create the thread channel on the first run of a new plugin (or if it was deleted)
    const thread = await starterMessage.startThread({ name: `${filename} history` });
    await thread.send({
      files: [new AttachmentBuilder(filepath)],
      components: [new ActionRowBuilder().addComponents(deleteBackupButton, restoreBackupButton, Emitter.moreInfoButton)],
    })
    logger.debug(`Created "${filename}" thread channel in ${Utilities.getFormattedGuildAndChannelString(starterMessage)}.`, listener);
  }

  return starterMessage;
}

/**
 * Restores the config file from Discord to the client.
 * @param {object} param
 * @param {ModalSubmitInteraction} param.interaction
 */
export async function restoreBackupFile({ interaction }) {
  await interaction.deferUpdate();

  const filename = await getFilenameFromInteraction(interaction);
  const filepath = getFilepathFromFilename(filename);

  if (!filepath) {
    throw new Error(`Filepath for "${filename}" was not found in loaded filepaths.`);
  }

  if (fs.existsSync(filepath)) {
    const renamedFilename = Utilities.getAvailableFilename(filepath);
    const renamedFilepath = filepath.replace(filename, renamedFilename);
    fs.renameSync(filepath, renamedFilepath);
  }

  const attachments = Array
    .from(interaction.message.attachments.values())
    .filter(({ contentType }) => contentType.includes("application/json"));

  if (!attachments.length) {
    throw new Error("Invalid message attachments. Received zero but expected one or many.");
  }

  const interactionDownloadDirectory = `${temp_directory}/${nanoid()}`;
  const downloader = new Downloader({ url: attachments[0].url, directory: interactionDownloadDirectory });
  const { filePath: interactionDownloadFilepath } = await downloader.download();
  fs.renameSync(interactionDownloadFilepath, filepath);

  const date = getAttachmentDate(interaction);
  logger.info(`Restored "${filename}" from backup made on ${date}.`)
}

/**
 * Shows the backup confirmation modal.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export function showModalBackup({ interaction, listener }) {
  Utilities.showParagraphModal({
    inputLabel: "Warning!",
    interaction,
    modalCustomId: Interactions.ModalSubmitBackup,
    modalTitle: "Create backup",
    inputValue: "This will upload the latest client file as a new backup file. If you're sure you want to continue, click Submit."
  });
  // TODO: logs should be in the caller, not the definition (utilities)
  logger.info("Showed confirmation modal for creating a backup.", listener);
}

/**
 * Shows the delete confirmation modal.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export function showModalDelete({ interaction, listener }) {
  Utilities.showParagraphModal({
    inputLabel: "Warning!",
    interaction,
    modalCustomId: Interactions.ModalSubmitDelete,
    modalTitle: "Delete backup",
    inputValue: `This will delete the backup file made on ${getAttachmentDate(interaction)} from the backup history. If you're sure you want to continue, click Submit.`
  });
  logger.info("Showed confirmation modal for deleting a backup.", listener);
}

/**
 * Shows the restore confirmation modal.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export function showModalRestore({ interaction, listener }) {
  Utilities.showParagraphModal({
    inputLabel: "Warning!",
    interaction,
    modalCustomId: Interactions.ModalSubmitRestore,
    modalTitle: "Restore backup",
    inputValue: `This will overwrite the client file with the backup file made on ${getAttachmentDate(interaction)}. If you're sure you want to continue, click Submit.`
  });
  logger.info("Showed confirmation modal for restoring a backup.", listener);
}

/**
 * Uploads the config file from the client to Discord.
 * @param {object} param
 * @param {ModalSubmitInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function uploadBackupFile({ interaction, listener }) {
  await interaction.deferUpdate();

  const filename = await getFilenameFromInteraction(interaction);
  const filepath = getFilepathFromFilename(filename);

  const files = [new AttachmentBuilder(filepath)];

  await interaction.message.edit({ files });

  await interaction.message.thread?.send({
    files, components: [new ActionRowBuilder().addComponents(
      deleteBackupButton,
      restoreBackupButton,
      Emitter.moreInfoButton
    )],
  });

  logger.info("Uploaded a new backup file.", listener);
}

/**
 * Check if any config files are missing their backup message and sends one if
 * it doesn't exist. Then check backup messages are up to date or warns if any
 * are mismatched and should be updated.
 * @param {object} param
 * @param {Client} param.client
 * @param {Listener} param.listener
 */
export async function validateBackups({ client, listener }) {
  if (!discord_config_channel_id) {
    logger.warn("No value found for \"discord_config_channel_id\" key. Skipping backup validation.", listener);
    return;
  }

  const channel = client.channels.cache.get(discord_config_channel_id);

  if (!channel) {
    logger.warn("Invalid value found for \"discord_config_channel_id\" key. Skipping backup validation.", listener);
    return;
  }

  for(const configFilepath of Config.filepaths) {
    const starterMessage =
      await getOrCreateStarterMessage(configFilepath, channel, listener);

    const attachments = Array
      .from(starterMessage.attachments.values())
      .filter(({ contentType }) => contentType.includes("application/json"));

    const name = starterMessage.content.replaceAll("`", "\"");

    if (!attachments.length) {
      logger.error(`Invalid ${name} message attachment.`);
      continue;
    }

    const tempDownloadDirectory = `${temp_directory}/${nanoid()}`;
    const downloader = new Downloader({ url: attachments[0].url, directory: tempDownloadDirectory });
    const { filePath: tempDownloadFilepath } = await downloader.download();

    const interactionFile = fs.readFileSync(tempDownloadFilepath);
    const localFile = fs.readFileSync(configFilepath);

    if (!interactionFile.equals(localFile)) {
      logger.warn(`Obsolete ${name} backup should be updated.`, listener);
    }
    else {
      logger.debug(`Validated ${name} backup.`, listener);
    }

    if (fs.readJsonSync("config.json").delete_temporary_files) {
      fs
        .remove(tempDownloadDirectory)
        .then(() => null) // TODO: log this
        .catch(error => logger.error(error))
    }
  }
}

/**
 *
 */
function validateContents(contents, filename, filepath) {
  const count = Object.keys(contents).length;
  const size = Utilities.getSizeInKilobytes(filepath);
  const text = `Read ${count} key-value ${Utilities.getPluralizedString("pair", count)} from "${filename}" file. (${size})`;
  logger.debug(`${text}\n${JSON.stringify(contents, null, 2)}`);
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion SERVICE LOGIC                                                  //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
