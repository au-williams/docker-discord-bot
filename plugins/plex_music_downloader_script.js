import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { Cron } from "croner";
import { extname, resolve } from "path";
import { filterChannelMessages, findChannelMessage, getChannelMessages } from "../index.js";
import { getCronOptions, getLinkWithoutParametersFromString, getTimestampAsTotalSeconds } from "../shared/helpers/utilities.js";
import { getOrCreateThreadChannel, tryDeleteMessageThread } from "../shared/helpers/discord.js";
import { nanoid } from "nanoid";
import { setTimeout } from "timers/promises";
import * as oembed from "@extractus/oembed-extractor";
import AFHConvert from "ascii-fullwidth-halfwidth-convert";
import CachedLinkData from "../shared/models/CachedLinkData.js"
import ComponentOperation from "../shared/models/ComponentOperation.js"
import Config from "../shared/config.js";
import fs from "fs-extra";
import Logger from "../shared/logger.js";
import sanitize from "sanitize-filename";
import youtubedl from "youtube-dl-exec";

const config = new Config("plex_music_downloader_config.json");
const logger = new Logger("plex_music_downloader_script.js");

// todo: fetch cache on startup, loop cache in cron instead of channel messages

// ------------------------------------------------------------------------- //
// >> INTERACTION DEFINITIONS                                             << //
// ------------------------------------------------------------------------- //

export const PLUGIN_CUSTOM_IDS = {
  DELETE_FROM_PLEX_BUTTON: "DELETE_FROM_PLEX_BUTTON",
  DELETE_FROM_PLEX_MODAL: "DELETE_FROM_PLEX_MODAL",
  DOWNLOAD_MP3_BUTTON: "DOWNLOAD_MP3_BUTTON",
  DOWNLOAD_MP3_MODAL: "DOWNLOAD_MP3_MODAL",
  IMPORT_MUSIC_INTO_PLEX_BUTTON: "IMPORT_MUSIC_INTO_PLEX_BUTTON",
  IMPORT_MUSIC_INTO_PLEX_MODAL: "IMPORT_MUSIC_INTO_PLEX_MODAL",
  SEARCHING_PLEX_BUTTON: "SEARCHING_PLEX_BUTTON",
  SHOW_BUTTON_DOCUMENTATION: "SHOW_BUTTON_DOCUMENTATION", // todo: move this to global
}

export const PLUGIN_INTERACTIONS = [
  {
    customId: PLUGIN_CUSTOM_IDS.DOWNLOAD_MP3_BUTTON,
    description: "Extracts the audio from a link and uploads it to Discord as an MP3 file for users to stream or download.",
    onInteractionCreate: ({ interaction }) => showMetadataModal(interaction, PLUGIN_CUSTOM_IDS.DOWNLOAD_MP3_MODAL, "Download MP3")
  },
  {
    customId: PLUGIN_CUSTOM_IDS.DOWNLOAD_MP3_MODAL,
    onInteractionCreate: ({ interaction }) => downloadLinkAndExecute(interaction, PLUGIN_CUSTOM_IDS.DOWNLOAD_MP3_MODAL, callbackUploadDiscordFile, "mp3")
  },
  {
    customId: PLUGIN_CUSTOM_IDS.IMPORT_MUSIC_INTO_PLEX_BUTTON,
    description: "Extracts the audio from a link and imports it into the bot's Plex library for secured long-term storage.",
    onInteractionCreate: ({ interaction }) => showMetadataModal(interaction, PLUGIN_CUSTOM_IDS.IMPORT_MUSIC_INTO_PLEX_MODAL, "Import into Plex"),
    requiredUserRoleIds: () => config.discord_admin_role_id
  },
  {
    customId: PLUGIN_CUSTOM_IDS.IMPORT_MUSIC_INTO_PLEX_MODAL,
    onInteractionCreate: ({ interaction }) => downloadLinkAndExecute(interaction, PLUGIN_CUSTOM_IDS.IMPORT_MUSIC_INTO_PLEX_MODAL, callbackImportPlexFile),
    requiredUserRoleIds: () => config.discord_admin_role_id
  },
  {
    customId: PLUGIN_CUSTOM_IDS.DELETE_FROM_PLEX_BUTTON,
    description: "Removes the previously imported audio file from the bot's Plex library and deletes it from the filesystem.",
    onInteractionCreate: ({ interaction }) => showDeletionModal(interaction, PLUGIN_CUSTOM_IDS.DELETE_FROM_PLEX_MODAL, "Delete from Plex"),
    requiredUserRoleIds: () => config.discord_admin_role_id
  },
  {
    customId: PLUGIN_CUSTOM_IDS.DELETE_FROM_PLEX_MODAL,
    onInteractionCreate: ({ interaction }) => deleteLinkFromPlex(interaction),
    requiredUserRoleIds: () => config.discord_admin_role_id
  },
  {
    customId: PLUGIN_CUSTOM_IDS.SHOW_BUTTON_DOCUMENTATION,
    onInteractionCreate: ({ interaction }) => showButtonDocumentation(interaction)
  }
]

// ------------------------------------------------------------------------- //
// >> DISCORD EVENT HANDLERS                                              << //
// ------------------------------------------------------------------------- //

/**
 * Discord, in their infinite wisdom and investment money, requires
 *   modals to resolve in <= 3 seconds which obviously causes a lot
 *   of issues with external dependencies with unknown fetch times.
 *   Work around this dumpster API design by caching these outbound
 *   requests before the client requests them. Yay, waste! Remember
 *   to thank a Discord developer for their high quality API if you
 *   see one inside its zoo exhibit or leaving their moms basement.
 */
const CACHED_LINK_DATA = {};

/**
 * Starts a cron job that creates missing threads and validates them
 * @param {Object} param
 * @param {Client} param.client
 */
export const onClientReady = async ({ client }) => {
  await config.initialize(client);
  await logger.initialize(client);

  const cronJob = async () => {
    const channelMessages =
      await filterChannelMessages(config.discord_allowed_channel_id, ({ system }) => !system);

    for (const message of channelMessages) {
      const cachedLinkData = await getOrCreateCachedLinkData(message);
      if (!cachedLinkData) continue; // message contents not supported

      const threadChannel = message.hasThread
        ? message.thread : await createThreadChannel(cachedLinkData, message);

      await validateThreadChannel(cachedLinkData, threadChannel);
    }
  }

  Cron(config.cron_job_announcement_pattern, getCronOptions(logger), cronJob).trigger();
  logger.info(`Queued Cron job with pattern "${config.cron_job_announcement_pattern}"`);
};

/**
 * Create the thread channel for the message with a music link and verify their status in the Plex library
 * @param {Object} param
 * @param {string} param.message
 */
export const onMessageCreate = async ({ message }) => {
  try {
    const isAllowedDiscordChannel = message.channel.id === config.discord_allowed_channel_id;
    if (!isAllowedDiscordChannel) return;

    const linkWithoutParameters = getLinkWithoutParametersFromString(message.content);
    if (!linkWithoutParameters) return;

    await message.react("⌛");
    const cachedLinkData = await getOrCreateCachedLinkData(message);
    await message.reactions.cache.get("⌛").remove();

    if (!cachedLinkData) {
      await message.react("❌");
      await setTimeout(2500);
      await message.reactions.cache.get("❌").remove();
      return;
    }

    const threadChannel = await createThreadChannel(cachedLinkData, message);
    await validateThreadChannel(cachedLinkData, threadChannel);
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Delete the child thread when its message parent is deleted
 * @param {Object} param
 * @param {Client} param.client The Discord.js client
 * @param {Message} param.message The deleted message
 */
export const onMessageDelete = ({ message: starterMessage }) => tryDeleteMessageThread({
  allowedChannelIds: [config.discord_allowed_channel_id],
  logger,
  starterMessage
});

// ------------------------------------------------------------------------- //
// >> PLUGIN FUNCTIONS                                                    << //
// ------------------------------------------------------------------------- //

/**
 * Import the link into the Plex library after it was downloaded
 * @param {CachedLinkData} cachedLinkData
 * @param {Interaction} interaction
 * @param {string} outputFilename
 * @param {string} outputFilepath
 */
async function callbackImportPlexFile(cachedLinkData, interaction, outputFilename, outputFilepath) {
  try {
    const destinationFilePath = resolve(`${config.plex_download_directory}/${outputFilename}`);
    await fs.move(outputFilepath, destinationFilePath);
    await interaction.editReply("Success! Your file was imported into Plex.");
    await validateThreadChannel(cachedLinkData, interaction.channel);
    await startPlexLibraryScan();
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Upload the link to the Discord thread after it was downloaded
 * @param {CachedLinkData} cachedLinkData
 * @param {Interaction} interaction
 * @param {string} outputFilename
 * @param {string} outputFilepath
 */
async function callbackUploadDiscordFile(cachedLinkData, interaction, outputFilename, outputFilepath) {
  try {
    const filenameWithoutId = outputFilename.split(" - ").slice(0, -1).join(" - ");
    // todo: if reference is a reference, update the reference? improves usability
    const name = filenameWithoutId + extname(outputFilename);
    const files = [new AttachmentBuilder(outputFilepath, { name })];
    const reply = await interaction.editReply({ files });
    logger.info(`Uploaded "${reply.attachments.first().name}"`);
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Create the thread channel for the message with a music link
 * @param {string} link
 * @param {Message} starterMessage
 * @param {Function} callback
 */
async function createThreadChannel(cachedLinkData, starterMessage) {
  try {
    const threadChannel = await getOrCreateThreadChannel({
      starterMessage,
      clientOptions: { removeMembers: true },
      threadOptions: { name: cachedLinkData.threadChannelName }
    });

    // --------------------------------------------------- //
    // send buttons to download the message link in thread //
    // --------------------------------------------------- //

    const downloadMp3Button = new ButtonBuilder();
    downloadMp3Button.setCustomId(PLUGIN_CUSTOM_IDS.DOWNLOAD_MP3_BUTTON);
    downloadMp3Button.setEmoji("📲");
    downloadMp3Button.setLabel("Download MP3");
    downloadMp3Button.setStyle(ButtonStyle.Secondary);

    const searchingPlexButton = new ButtonBuilder();
    searchingPlexButton.setCustomId(PLUGIN_CUSTOM_IDS.SEARCHING_PLEX_BUTTON);
    searchingPlexButton.setDisabled(true);
    searchingPlexButton.setEmoji("⏳");
    searchingPlexButton.setLabel("Searching in Plex");
    searchingPlexButton.setStyle(ButtonStyle.Secondary);

    await threadChannel.send({
      components: [new ActionRowBuilder().addComponents(downloadMp3Button, searchingPlexButton)],
      content: "Use these to download this music from Discord:"
    });

    // ----------------------------------------------------- //
    // send button to get documentation for previous buttons //
    // ----------------------------------------------------- //

    const showDocumentationButton = new ButtonBuilder();
    showDocumentationButton.setCustomId(PLUGIN_CUSTOM_IDS.SHOW_BUTTON_DOCUMENTATION);
    showDocumentationButton.setEmoji("🔖");
    showDocumentationButton.setLabel("Show documentation");
    showDocumentationButton.setStyle(ButtonStyle.Primary);

    await threadChannel.send({
      components: [new ActionRowBuilder().addComponents(showDocumentationButton)],
      content: "Use this for help with these buttons:"
    });

    return threadChannel;
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Delete the link from the Plex music library
 * @param {Interaction} interaction
 */
async function deleteLinkFromPlex(interaction) {
  const operation = new ComponentOperation({
    interactionId: PLUGIN_CUSTOM_IDS.DELETE_FROM_PLEX_MODAL,
    messageId: interaction.message.id,
    userId: interaction.user.id
  });

  if (operation.isBusy) return;
  else operation.setBusy(true);

  try {
    await interaction.deferReply({ ephemeral: true });

    const cachedLinkData = await getOrCreateCachedLinkData(interaction.message);

    if (!cachedLinkData) {
      logger.error("Attempted to import Plex file without cached data");
      return;
    }

    const existingPlexFilename = await getExistingPlexFilename(cachedLinkData);

    if (existingPlexFilename) {
      await fs.remove(`${config.plex_download_directory}/${existingPlexFilename}`);
      logger.info(`Deleted file from Plex: "${existingPlexFilename}"`);
      await interaction.editReply("Your file was successfully deleted from Plex.");
      await startPlexLibraryScan();
    }
    else {
      await interaction.editReply(`Sorry! Your file wasn't found in Plex.`);
      logger.warn(`Plex filename does not exist`);
    }

    await validateThreadChannel(cachedLinkData, interaction.channel);
  }
  catch(e) {
    logger.error(e);
    await interaction.editReply({ content: getFormattedErrorMessage(e) });
  }
  finally {
    operation.setBusy(false);
  }
}

async function downloadLinkAndExecute(interaction, modalCustomId, callback, audioFormat) {
  const operation = new ComponentOperation({
    interactionId: modalCustomId,
    messageId: interaction.message.id,
    userId: interaction.user.id
  });

  if (operation.isBusy) return;
  else operation.setBusy(true);

  try {
    await interaction.deferReply({ ephemeral: true });

    const cachedLinkData = await getOrCreateCachedLinkData(interaction.message);
    const endTimeTotalSeconds = getTimestampAsTotalSeconds(cachedLinkData.endTime);

    const inputArtist = interaction.fields.getTextInputValue("artist");
    const inputTitle = interaction.fields.getTextInputValue("title");
    const inputStartTime = interaction.fields.getTextInputValue("start");
    const inputStartTimeTotalSeconds = getTimestampAsTotalSeconds(inputStartTime);
    const inputEndTime = interaction.fields.getTextInputValue("end");
    const inputEndTimeTotalSeconds = getTimestampAsTotalSeconds(inputEndTime);

    // -------------------------------------------- //
    // validate the user inputted timestamp strings //
    // -------------------------------------------- //

    if (!/^(\d{1,3}:)?\d{2}:\d{2}:\d{2}$/.test(inputStartTime)) {
      const content = `\`${inputStartTime}\` is not a valid timestamp. Please try again.`;
      await interaction.editReply({ content });
      return;
    }

    if (!/^(\d{1,3}:)?\d{2}:\d{2}:\d{2}$/.test(inputEndTime)) {
      const content = `\`${inputEndTime}\` is not a valid timestamp. Please try again.`;
      await interaction.editReply({ content });
      return;
    }

    if (inputEndTimeTotalSeconds > endTimeTotalSeconds) {
      const content = `End time can't exceed \`${cachedLinkData.endTime}\`. Please try again.`;
      await interaction.editReply({ content });
      return;
    }

    if (inputStartTimeTotalSeconds >= inputEndTimeTotalSeconds) {
      const content = `Start time can't be after end time. Please try again.`;
      await interaction.editReply({ content });
      return;
    }

    // ------------------------------------------------------------------ //
    // compile the options consumed by YoutubeDL with optional parameters //
    // ------------------------------------------------------------------ //

    /**
     * Sanitize a string for use in the command line version of ffmpeg
     * @param {string} str
     */
    const sanitizeFfmpeg = str => str.trim().replaceAll("'", "'\\''");

    /**
     * Sanitize a string for use as a filename in Windows and/or Linux
     * @param {string} str
     */
    const sanitizeFilename = str => sanitize(str.replace(/[/\\]/g, " ").replace(/  +/g, " "));

    const tempDownloadDirectory = `${config.temp_directory}\\${nanoid()}`;

    const options = {
      audioQuality: 0,
      embedMetadata: true,
      extractAudio: true,
      format: "bestaudio/best",
      noPlaylist: true,
      output: `${tempDownloadDirectory}/${sanitizeFilename(`${inputArtist} - ${inputTitle}`)} - %(id)s.%(ext)s`,
      postprocessorArgs: "ffmpeg:"
        + " -metadata album='Downloads'"
        + " -metadata album_artist='Various Artists'"
        + ` -metadata artist='${sanitizeFfmpeg(inputArtist)}'`
        + " -metadata date=''" // remove unwanted ID3 tag
        + ` -metadata title='${sanitizeFfmpeg(inputTitle)}'`
        + " -metadata track=''" // remove unwanted ID3 tag
    }

    if (audioFormat) options["audioFormat"] = audioFormat;

    // ----------------------------------------------------------------- //
    // compile the post-processor if post-processing should be performed //
    // ----------------------------------------------------------------- //

    const isStartTimeUpdate = inputStartTimeTotalSeconds > 0 && inputStartTimeTotalSeconds < inputEndTimeTotalSeconds;
    const isEndTimeUpdate = endTimeTotalSeconds > inputEndTimeTotalSeconds;

    if (isStartTimeUpdate) {
      options["externalDownloader"] ??= "ffmpeg";
      options["externalDownloaderArgs"] ??= "";
      options["externalDownloaderArgs"] += ` -ss ${inputStartTime}.00`;
    }

    if (isEndTimeUpdate) {
      options["externalDownloader"] ??= "ffmpeg";
      options["externalDownloaderArgs"] ??= "";
      options["externalDownloaderArgs"] += ` -to ${inputEndTime}.00`;
    }

    const postProcessor = (() => {
      const outputTotalSeconds = inputEndTimeTotalSeconds - inputStartTimeTotalSeconds;
      const fadeTotalSeconds = outputTotalSeconds >= 20 ? 5 : outputTotalSeconds / 4;
      const execAudioFilters = []; // exec command sourced from https://redd.it/whqfl6/
      if (isStartTimeUpdate) execAudioFilters.push(`afade=t=in:st=0:d=${fadeTotalSeconds}`);
      if (isEndTimeUpdate) execAudioFilters.push(`afade=t=out:st=${outputTotalSeconds - fadeTotalSeconds}:d=${fadeTotalSeconds}`);
      if (execAudioFilters.length) return `move {} tempfile & ffmpeg -i tempfile -af "${execAudioFilters.join(",")}" {} & del tempfile`;
      return false;
    })();

    if (postProcessor) options["exec"] = postProcessor;

    // -------------------------------------------------------------- //
    // download, execute the callback function, remove temporary file //
    // -------------------------------------------------------------- //

    await youtubedl(cachedLinkData.linkWithoutParameters, options);
    const tempDownloadFilename = fs.readdirSync(tempDownloadDirectory)[0];
    const tempDownloadFilepath = resolve(`${tempDownloadDirectory}/${tempDownloadFilename}`);

    await callback(cachedLinkData, interaction, tempDownloadFilename, tempDownloadFilepath);
    await fs.remove(tempDownloadDirectory);
  }
  catch(e) {
    logger.error(e);
  }
  finally {
    operation.setBusy(false);
  }
}

/**
 * Get the filename of the link in the Plex library if it was previously added
 * (this is done by saving the links unique id in the music download filename)
 * @param {string} link
 */
async function getExistingPlexFilename(cachedLinkData) {
  return fs
    .readdirSync(config.plex_download_directory)
    .find(filename => cachedLinkData.id == filename.split(' - ').slice(-1)[0].split('.')[0]);
}

/**
 * Stringify an error and encapsulate it within the content of a Discord message
 * @param {Error} error
 */
function getFormattedErrorMessage(error) {
  return `I caught an error processing this link:\n\`\`\`${error}\`\`\``;
}

/**
 * Verify the link is not going to cause funky behavior (typically the root of a playlist with no track selected)
 * @param {string} linkWithoutParameters
 * @returns {boolean}
 */
function getIsLinkSupported(linkWithoutParameters) {
  const isYoutubeListWithoutItem =
    linkWithoutParameters.includes("youtube.com")
    && !linkWithoutParameters.includes("?v=");
  if (isYoutubeListWithoutItem) return false;

  const isSoundCloudListWithoutItem =
    linkWithoutParameters.includes("soundcloud.com")
    && linkWithoutParameters.includes("/sets/")
    && !linkWithoutParameters.includes("?in=");
  if (isSoundCloudListWithoutItem) return false;

  return true;
}

/**
 * Create a cache of potential fetches that we probably won't use because Discord's amazing API can't wait >3 seconds without erroring.
 * There is no way of improving this code smell without Discord's staff taking a shower and taking an intro to comp-sci college course.
 * Unsupported links will return undefined to reduce the number of outbound connections per operation (increasing the operating speed).
 * @param {string} link
 */
async function getOrCreateCachedLinkData(message) {
  try {
    const { content } =
      message.channel.type === ChannelType.PublicThread || message.channel.type === ChannelType.PrivateThread
        ? await message.channel.fetchStarterMessage()
        : message;

    const linkWithoutParameters = getLinkWithoutParametersFromString(content);
    if (!linkWithoutParameters) return undefined;

    const isLinkSupported = getIsLinkSupported(linkWithoutParameters);
    if (!isLinkSupported) return undefined;

    let cachedLinkData = CACHED_LINK_DATA[linkWithoutParameters];
    if (cachedLinkData) return cachedLinkData;

    // -------------------- //
    // fetch youtubedl data //
    // -------------------- //

    const youtubedlOptions = {
      output: "%(duration>%H:%M:%S)s,%(id)s",
      print: "%(duration>%H:%M:%S)s,%(id)s",
      simulate: true,
      skipDownload: true
    }

    let youtubedlError; // this library may return undefined with no error thrown ... nice, right?
    const youtubedlPayload = await youtubedl(linkWithoutParameters, youtubedlOptions).catch(e => {
      youtubedlError = e.message || "Couldn't get youtubedl payload";
      if (youtubedlError.includes(linkWithoutParameters)) return;
      youtubedlError += ` "${linkWithoutParameters}"`;
    });

    if (!youtubedlPayload) {
      logger.warn(youtubedlError)
      return;
    }

    const endTime = youtubedlPayload.split(",")[0];
    const id = youtubedlPayload.split(",")[1];

    // ----------------- //
    // fetch oembed data //
    // ----------------- //

    let oembedError;
    const oembedPayload = await oembed.extract(linkWithoutParameters).catch(e => {
      oembedError = e.message || "Couldn't get oembed payload";
      if (oembedError.includes(linkWithoutParameters)) return;
      oembedError += ` "${linkWithoutParameters}"`;
    });

    if (!oembedPayload) {
      logger.warn(oembedError);
      return;
    }

    const { author_name: originalAuthorName, title: originalTitle } = oembedPayload;
    const asciiWidthConverter = new AFHConvert();

    // if titles are in "${author} - ${title}" format
    const splitTitle = originalTitle.split(" - ");
    const isSplitTitle = splitTitle.length == 2;

    let authorName = isSplitTitle ? splitTitle[0] : originalAuthorName;
    let title = isSplitTitle ? splitTitle[1] : originalTitle;

    // format author name
    if (authorName.endsWith(" - Topic")) authorName = authorName.slice(0, -" - Topic".length);
    authorName = asciiWidthConverter.toHalfWidth(authorName.trim());

    // format title
    if (title.startsWith(`${originalAuthorName} - `)) title = title.slice(`${originalAuthorName} - `.length);
    if (title.endsWith(` by ${originalAuthorName}`)) title = title.slice(0, -` by ${originalAuthorName}`.length);
    if (title.toLowerCase().endsWith(` [official music video]`)) title = title.slice(0, -` [official music video]`.length);
    if (title.toLowerCase().endsWith(` (official music video)`)) title = title.slice(0, -` (official music video)`.length);
    if (title.toLowerCase().endsWith(` [official visualizer]`)) title = title.slice(0, -` [official visualizer]`.length);
    if (title.toLowerCase().endsWith(` (official visualizer)`)) title = title.slice(0, -` (official visualizer)`.length);
    if (title.toLowerCase().endsWith(` [official audio]`)) title = title.slice(0, -` [official audio]`.length);
    if (title.toLowerCase().endsWith(` (official audio)`)) title = title.slice(0, -` (official audio)`.length);
    if (title.toLowerCase().endsWith(` [official]`)) title = title.slice(0, -` [official]`.length);
    if (title.toLowerCase().endsWith(` (official)`)) title = title.slice(0, -` (official)`.length);
    if (title.toLowerCase().endsWith(` [lyrics]`)) title = title.slice(0, -` [lyrics]`.length);
    if (title.toLowerCase().endsWith(` (lyrics)`)) title = title.slice(0, -` (lyrics)`.length);
    title = asciiWidthConverter.toHalfWidth(title.trim());

    // ----------------------- //
    // save link data to cache //
    // ----------------------- //

    CACHED_LINK_DATA[linkWithoutParameters] = new CachedLinkData({ authorName, endTime, title, id, linkWithoutParameters, });
    return CACHED_LINK_DATA[linkWithoutParameters];
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Show the popup modal to confirm file deletion from Plex
 * @param {Interaction} interaction
 * @param {string} modalCustomId
 * @param {string} modalTitle
 */
async function showDeletionModal(interaction, modalCustomId, modalTitle) {
  const operation = new ComponentOperation({
    interactionId: modalCustomId,
    messageId: interaction.message.id,
    userId: interaction.user.id
  });

  if (operation.isBusy) {
    await interaction.deferUpdate();
    return;
  }

  const reasonTextInput = new TextInputBuilder();
  reasonTextInput.setCustomId("reason");
  reasonTextInput.setLabel("Reason for deletion");
  reasonTextInput.setRequired(true);
  reasonTextInput.setStyle(TextInputStyle.Paragraph);

  const actionRow = new ActionRowBuilder().addComponents(reasonTextInput);

  try {
    interaction.showModal(new ModalBuilder()
      .addComponents(actionRow)
      .setCustomId(modalCustomId)
      .setTitle(modalTitle)
    );
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Show the popup modal to input a links metadata information
 * @param {Interaction} interaction
 * @param {string} modalCustomId
 * @param {string} modalTitle
 */
async function showMetadataModal(interaction, modalCustomId, modalTitle) {
  const operation = new ComponentOperation({
    interactionId: modalCustomId,
    messageId: interaction.message.id,
    userId: interaction.user.id
  });

  if (operation.isBusy) {
    await interaction.deferUpdate();
    return;
  }

  try {
    const cachedLinkData = await getOrCreateCachedLinkData(interaction.message);

    if (!cachedLinkData) {
      logger.warn("Attempted to show metadata modal without cached data");
      return;
    }

    const titleTextInput = new TextInputBuilder();
    titleTextInput.setCustomId("title");
    titleTextInput.setLabel("Track Title");
    titleTextInput.setRequired(true);
    titleTextInput.setStyle(TextInputStyle.Short);
    titleTextInput.setValue(cachedLinkData.title);

    const artistTextInput = new TextInputBuilder();
    artistTextInput.setCustomId("artist");
    artistTextInput.setLabel("Track Artist");
    artistTextInput.setRequired(true);
    artistTextInput.setStyle(TextInputStyle.Short);
    artistTextInput.setValue(cachedLinkData.authorName);

    const startTextInput = new TextInputBuilder();
    startTextInput.setCustomId("start");
    startTextInput.setLabel("Track Start");
    startTextInput.setPlaceholder("00:00:00");
    startTextInput.setStyle(TextInputStyle.Short);
    startTextInput.setValue("00:00:00");

    const endTextInput = new TextInputBuilder()
    endTextInput.setCustomId("end");
    endTextInput.setLabel("Track End");
    endTextInput.setPlaceholder(cachedLinkData.endTime);
    endTextInput.setStyle(TextInputStyle.Short);
    endTextInput.setValue(cachedLinkData.endTime);

    const actionRows = [];
    actionRows.push(new ActionRowBuilder().addComponents(titleTextInput));
    actionRows.push(new ActionRowBuilder().addComponents(artistTextInput));
    actionRows.push(new ActionRowBuilder().addComponents(startTextInput));
    actionRows.push(new ActionRowBuilder().addComponents(endTextInput));

    await interaction.showModal(new ModalBuilder()
      .addComponents(...actionRows)
      .setCustomId(modalCustomId)
      .setTitle(modalTitle)
    );
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Fetch the Plex API and request the media library scans for file changes
 */
async function startPlexLibraryScan() {
  try {
    const address = `http://${config.plex_server_ip_address}:32400/library/sections/${config.plex_library_section_id}/refresh`;
    const options = { headers: { "X-Plex-Token": config.plex_authentication_token }, method: "GET" };
    await fetch(address, options);
    logger.info(`Plex library scan started`);
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Validate the thread channel information and repair any inconsistencies
 * @param {CachedLinkData} cachedLinkData
 * @param {ThreadChannel} threadChannel
 */
async function validateThreadChannel(cachedLinkData, threadChannel) {
  // ----------------------------------------------------------------------- //
  // validate the thread channel name in case the attached link was modified //
  // ----------------------------------------------------------------------- //

  const isThreadChannelNameObsolete =
    threadChannel?.name !== cachedLinkData.threadChannelName;

  if (isThreadChannelNameObsolete) {
    const obsoleteThreadChannelName = threadChannel.name;
    await threadChannel.setName(cachedLinkData.threadChannelName);
    logger.info(`Updated thread name "${obsoleteThreadChannelName}" -> "${cachedLinkData.threadChannelName}"`);
  }

  // ----------------------------------------------------------------------- //
  // validate the thread channel plex button shows the local files existence //
  // ----------------------------------------------------------------------- //

  const { DELETE_FROM_PLEX_BUTTON, IMPORT_MUSIC_INTO_PLEX_BUTTON, SEARCHING_PLEX_BUTTON } = PLUGIN_CUSTOM_IDS;
  const plexComponentIds = [DELETE_FROM_PLEX_BUTTON, IMPORT_MUSIC_INTO_PLEX_BUTTON, SEARCHING_PLEX_BUTTON];

  const find = ({ components }) => components?.[0]?.components.some(some);
  const some = ({ customId, type }) => plexComponentIds.includes(customId) && type === ComponentType.Button;

  const messageWithPlexButton = await findChannelMessage(threadChannel.id, find);

  if (messageWithPlexButton) {
    const isArchived = messageWithPlexButton.channel.archived;
    if (isArchived) await messageWithPlexButton.channel.setArchived(false);

    const components = [ActionRowBuilder.from(messageWithPlexButton.components[0])];
    const buttonIndex = messageWithPlexButton.components[0].components.findIndex(some);

    components[0].components[buttonIndex].setCustomId(PLUGIN_CUSTOM_IDS.SEARCHING_PLEX_BUTTON);
    components[0].components[buttonIndex].setDisabled(true);
    components[0].components[buttonIndex].setEmoji("⏳");
    components[0].components[buttonIndex].setLabel("Searching in Plex");

    await messageWithPlexButton.edit({ components });

    const isPlexFile = await getExistingPlexFilename(cachedLinkData);
    const customId = isPlexFile ? PLUGIN_CUSTOM_IDS.DELETE_FROM_PLEX_BUTTON : PLUGIN_CUSTOM_IDS.IMPORT_MUSIC_INTO_PLEX_BUTTON;
    const label = isPlexFile ? "Delete from Plex" : "Import into Plex";

    components[0].components[buttonIndex].setCustomId(customId);
    components[0].components[buttonIndex].setDisabled(false)
    components[0].components[buttonIndex].setEmoji(config.discord_plex_emoji)
    components[0].components[buttonIndex].setLabel(label);

    await messageWithPlexButton.edit({ components });
  }
}

// ------------------------------------------------------------------------- //
// >> NEEDS TO BE MOVE                                                    << //
// ------------------------------------------------------------------------- //

// todo: move to index.js
async function showButtonDocumentation(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const channelMessages = await getChannelMessages(interaction.channel.id);
    const getIsDocumentationButton = ({ data: custom_id }) => custom_id === PLUGIN_CUSTOM_IDS.SHOW_BUTTON_DOCUMENTATION;
    const documentationButtonIndex = channelMessages.findIndex(m => m.components?.[0]?.components.some(getIsDocumentationButton));
    const documentedButtonMessages = channelMessages.slice(0, documentationButtonIndex - 1);

    const result = [];

    for(const message of documentedButtonMessages) {
      const components = message.components?.[0]?.components;
      if (!components) continue;

      const buttonData = components.map(c => c.data).reverse(); // reverse row items so they're upserted in order
      const interactionData = buttonData.map(b => PLUGIN_INTERACTIONS.find(c => c.customId === b.custom_id));

      for(const { custom_id, emoji, label} of buttonData) {
        const id = interactionData.filter(x => x).find(x => x.customId === custom_id);
        if (!id || custom_id === PLUGIN_CUSTOM_IDS.SHOW_BUTTON_DOCUMENTATION) continue;

        const { description, requiredRoleIds } = id;
        const formattedEmoji = emoji.id ? `<:${emoji.name}:${emoji.id}>` : emoji.name;
        const formattedRoles = requiredRoleIds ? ` \`🔒Locked\` ${requiredRoleIds.map(r => `<@&${r}>`).join(" ")}` : "";
        const stringResult = `${formattedEmoji} **${label}**${formattedRoles}\n\`\`\`${description}\`\`\``;

        if (!result.includes(stringResult)) result.unshift(stringResult);
      }
    }

    await interaction.editReply({ content: `Here's what I know about these buttons:\n\n${result.join("\n")}` });
  }
  catch(e) {
    logger.error(e);
  }
}

// ------------------------------------------------------------------------- //
// >> CODE GRAVEYARD                                                      << //
// ------------------------------------------------------------------------- //

// /**
//  * Get if the link is a playlist on YouTube
//  * @param {string} link
//  */
// function getIsLinkYouTubePlaylist(link) {
//   return (link.includes("youtu.be") || link.includes("youtube.com")) && link.includes("list=");
// }

/**
 * Update the Plex button with the status of the links existence in the Plex library download folder
 * @param {Message} message
 */
// async function validateMessageWithPlexButton({ cachedLinkData, interaction, messageWithPlexButton }) {
//   try {
//     const isArchived = messageWithPlexButton.channel.archived;
//     if (isArchived) await messageWithPlexButton.channel.setArchived(false);

//     const referenceMessage = messageWithPlexButton.reference
//       && !getIsMessageWithPlexButtonComponent(messageWithPlexButton)
//       && await findChannelMessage(messageWithPlexButton.reference.channelId, ({ id }) => id === messageWithPlexButton.reference.messageId);

//     const actualMessageWithPlexButton = referenceMessage || messageWithPlexButton;
//     const buttonIndex = actualMessageWithPlexButton.components[0].components.findIndex(getIsPlexButtonComponent);
//     const components = [ActionRowBuilder.from(actualMessageWithPlexButton.components[0])];

//     components[0].components[buttonIndex].setCustomId(PLUGIN_CUSTOM_IDS.SEARCHING_PLEX_BUTTON);
//     components[0].components[buttonIndex].setDisabled(true);
//     components[0].components[buttonIndex].setEmoji("⏳");
//     components[0].components[buttonIndex].setLabel("Searching in Plex");

//     actualMessageWithPlexButton.type === MessageType.Reply
//       ? await interaction.editReply({ message: actualMessageWithPlexButton, components })
//       : await actualMessageWithPlexButton.edit({ components });

//     const isPlexFile = await getExistingPlexFilename(cachedLinkData);
//     const customId = isPlexFile ? PLUGIN_CUSTOM_IDS.DELETE_FROM_PLEX_BUTTON : PLUGIN_CUSTOM_IDS.IMPORT_MUSIC_INTO_PLEX_BUTTON;
//     const label = isPlexFile ? "Delete from Plex" : "Import into Plex";

//     components[0].components[buttonIndex].setCustomId(customId);
//     components[0].components[buttonIndex].setDisabled(false)
//     components[0].components[buttonIndex].setEmoji(config.discord_plex_emoji)
//     components[0].components[buttonIndex].setLabel(label);

//     actualMessageWithPlexButton.type === MessageType.Reply
//       ? await interaction.editReply({ message: actualMessageWithPlexButton, components })
//       : await actualMessageWithPlexButton.edit({ components });
//   }
//   catch(e) {
//     logger.error(e);
//   }
// }
  // ----------------------------------------------------- //
  // send buttons to manage the YouTube playlist in thread //
  // ----------------------------------------------------- //

  // if (isLinkYouTubePlaylist) {
  //   const showAllSongsButton = new ButtonBuilder();
  //   showAllSongsButton.setCustomId(PLUGIN_CUSTOM_IDS.SHOW_ALL_YOUTUBE_SONGS);
  //   showAllSongsButton.setEmoji(config.discord_youtube_emoji);
  //   showAllSongsButton.setLabel("Show all videos");
  //   showAllSongsButton.setStyle(ButtonStyle.Secondary);

  //   const followInChannelButton = new ButtonBuilder();
  //   followInChannelButton.setCustomId(PLUGIN_CUSTOM_IDS.FOLLOW_UPDATES_BUTTON);
  //   followInChannelButton.setEmoji("🔔");
  //   followInChannelButton.setLabel("Follow updates");
  //   followInChannelButton.setStyle(ButtonStyle.Secondary);

  //   await thread.send({
  //     components: [new ActionRowBuilder().addComponents(showAllSongsButton, followInChannelButton)],
  //     content: "Use these to manage this YouTube playlist:"
  //   });
  // }


  // const isLinkYouTubePlaylist = getIsLinkYouTubePlaylist(cachedLinkData.link);
  // const isLinkYouTubePlaylistWithoutVideo = isLinkYouTubePlaylist && !cachedLinkData.link.includes("v=");


// {
//   customId: PLUGIN_CUSTOM_IDS.SHOW_ALL_YOUTUBE_SONGS,
//   description: "Privately sends every video in the YouTube playlist to the Discord thread for easier downloading.",
//   onInteractionCreate: ({ interaction }) => showAllYouTubePlaylistSongs(interaction)
// },

/**
 * Get all songs within a YouTube playlist and post them as interaction replies
 * @param {Interaction} interaction
 */
// async function showAllYouTubePlaylistSongs(interaction) {
//   try {
//     await interaction.deferReply({ ephemeral: true });

//     const link = await getLinkFromMessageHierarchy(interaction.message);
//     const cachedLinkData = await getOrCreateCachedLinkData(message);
//     const playlist = await ytpl(cachedLinkData.link);

//     const downloadMp3Button = new ButtonBuilder();
//     downloadMp3Button.setCustomId(PLUGIN_CUSTOM_IDS.DOWNLOAD_MP3_BUTTON);
//     downloadMp3Button.setEmoji("📲");
//     downloadMp3Button.setLabel("Download MP3");
//     downloadMp3Button.setStyle(ButtonStyle.Secondary);

//     const searchingPlexButton = new ButtonBuilder();
//     searchingPlexButton.setCustomId(PLUGIN_CUSTOM_IDS.SEARCHING_PLEX_BUTTON);
//     searchingPlexButton.setDisabled(true);
//     searchingPlexButton.setEmoji("⏳");
//     searchingPlexButton.setLabel("Searching in Plex");
//     searchingPlexButton.setStyle(ButtonStyle.Secondary);

//     const components = [new ActionRowBuilder().addComponents(downloadMp3Button, searchingPlexButton)];

//     for(let i = 0; i < playlist.items.length; i++) {
//       const cleanTitle = playlist.title.replaceAll("`", "").replaceAll("*", "").replaceAll(" _", "").replaceAll("_ ", "");
//       const content = `${config.discord_youtube_emoji} \`${i + 1}/${playlist.items.length}\` **${cleanTitle}**\n${playlist.items[i].shortUrl}`;
//       const messageWithPlexButton = await interaction.followUp({ components, content, ephemeral: true });
//       validateMessageWithPlexButton({ interaction, messageWithPlexButton });
//       await new Promise(resolve => setTimeout(resolve, 250));
//     }
//   }
//   catch(e) {
//     logger.error(e);
//   }
// }
