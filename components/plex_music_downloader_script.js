import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageType, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { Cron } from "croner";
import { findChannelMessage, getChannelMessages } from "../index.js";
import { Logger } from "../logger.js";
import { extname, resolve } from "path";
import * as oembed from "@extractus/oembed-extractor";
import AFHConvert from 'ascii-fullwidth-halfwidth-convert';
import date from "date-and-time";
import fs from "fs-extra";
import sanitize from "sanitize-filename";
import youtubedl from "youtube-dl-exec";
import ytpl from "@distube/ytpl";

const asciiWidthConverter = new AFHConvert();

const {
  plex_channel_id, plex_directory, plex_emoji, plex_user_role_id,
  plex_section_id, plex_server_ip, plex_x_token, temp_directory
} = fs.readJsonSync("components/plex_music_downloader_config.json");

// ------------------------------------------------------------------------- //
// >> INTERACTION DEFINITIONS                                             << //
// ------------------------------------------------------------------------- //

/**
 * Discord, in their infinite wisdom, requires modals to resolve in <= 3 seconds
 * This obviously causes an incredible amount of issue with fetched dependencies
 * Work around this dumpster API design by caching fetch requests modals may use
 * (Key: YouTubeDL ID, Value: Track Duration)
 */
const VALIDATED_TRACK_DURATIONS = {};

/**
 * Define what interactions are busy so multiple clicks do not make multiple invocations
 */
const BUSY_INTERACTIONS = new Set();

class InteractionOperation {
  constructor({ customId, messageId, userId }) {
    this.customId = customId;
    this.messageId = messageId;
    this.userId = userId;
  }

  get isBusy() {
    return BUSY_INTERACTIONS.has(`${this}`);
  }

  setBusy(bool) {
    if (bool) !this.isBusy && BUSY_INTERACTIONS.add(`${this}`);
    else this.isBusy && BUSY_INTERACTIONS.delete(`${this}`);
  }

  toString() {
    return this.customId + this.messageId + this.userId;
  }
}

const COMPONENT_CUSTOM_IDS = {
  DELETE_FROM_PLEX_BUTTON: "DELETE_FROM_PLEX_BUTTON",
  DELETE_FROM_PLEX_MODAL: "DELETE_FROM_PLEX_MODAL",
  DOWNLOAD_MP3_BUTTON: "DOWNLOAD_MP3_BUTTON",
  DOWNLOAD_MP3_MODAL: "DOWNLOAD_MP3_MODAL",
  FOLLOW_UPDATES_BUTTON: "FOLLOW_UPDATES_BUTTON",
  IMPORT_INTO_PLEX_BUTTON: "IMPORT_INTO_PLEX_BUTTON",
  IMPORT_INTO_PLEX_MODAL: "IMPORT_INTO_PLEX_MODAL",
  SEARCHING_PLEX_BUTTON: "SEARCHING_PLEX_BUTTON",
  SHOW_ALL_YOUTUBE_SONGS: "SHOW_ALL_YOUTUBE_SONGS",
  SHOW_BUTTON_DOCUMENTATION: "SHOW_BUTTON_DOCUMENTATION",
}

/**
 * Define what functions and restrictions are invoked when a discord interaction is made
 */
export const COMPONENT_INTERACTIONS = [
  {
    customId: COMPONENT_CUSTOM_IDS.DOWNLOAD_MP3_BUTTON,
    description: "Extracts the audio from a link and uploads it to Discord as an MP3 file for users to stream or download.",
    onInteractionCreate: ({ interaction }) => showMetadataModal(interaction, COMPONENT_CUSTOM_IDS.DOWNLOAD_MP3_MODAL, "Download MP3")
  },
  {
    customId: COMPONENT_CUSTOM_IDS.DOWNLOAD_MP3_MODAL,
    onInteractionCreate: ({ interaction }) => downloadLinkAndExecute(interaction, COMPONENT_CUSTOM_IDS.DOWNLOAD_MP3_MODAL, callbackUploadDiscordFile, "mp3")
  },
  {
    customId: COMPONENT_CUSTOM_IDS.FOLLOW_UPDATES_BUTTON,
    description: "Monitors the YouTube playlist for new videos and publicly posts those links to the Discord channel.",
    onInteractionCreate: ({ interaction }) => { interaction.deferUpdate() },//{ throw "Not implemented" },
    requiredRoleIds: [plex_user_role_id]
  },
  {
    customId: COMPONENT_CUSTOM_IDS.IMPORT_INTO_PLEX_BUTTON,
    description: "Extracts the audio from a link and imports it into the bot's Plex library for secured long-term storage.",
    onInteractionCreate: ({ interaction }) => showMetadataModal(interaction, COMPONENT_CUSTOM_IDS.IMPORT_INTO_PLEX_MODAL, "Import into Plex"),
    requiredRoleIds: [plex_user_role_id]
  },
  {
    customId: COMPONENT_CUSTOM_IDS.IMPORT_INTO_PLEX_MODAL,
    onInteractionCreate: ({ interaction }) => downloadLinkAndExecute(interaction, COMPONENT_CUSTOM_IDS.IMPORT_INTO_PLEX_MODAL, callbackImportPlexFile),
    requiredRoleIds: [plex_user_role_id]
  },
  {
    customId: COMPONENT_CUSTOM_IDS.DELETE_FROM_PLEX_BUTTON,
    description: "Removes the previously imported audio file from the bot's Plex library and deletes it from the filesystem.",
    onInteractionCreate: ({ interaction }) => showDeletionModal(interaction, COMPONENT_CUSTOM_IDS.DELETE_FROM_PLEX_MODAL, "Delete from Plex"),
    requiredRoleIds: [plex_user_role_id]
  },
  {
    customId: COMPONENT_CUSTOM_IDS.DELETE_FROM_PLEX_MODAL,
    onInteractionCreate: ({ interaction }) => deleteLinkFromPlex(interaction),
    requiredRoleIds: [plex_user_role_id]
  },
  {
    customId: COMPONENT_CUSTOM_IDS.SHOW_ALL_YOUTUBE_SONGS,
    description: "Privately sends every video in the YouTube playlist to the Discord thread for easier downloading.",
    onInteractionCreate: ({ interaction }) => showAllYouTubePlaylistSongs(interaction)
  },
  {
    customId: COMPONENT_CUSTOM_IDS.SHOW_BUTTON_DOCUMENTATION,
    onInteractionCreate: ({ interaction }) => showButtonDocumentation(interaction)
  }
]

// ------------------------------------------------------------------------- //
// >> DISCORD EVENT HANDLERS                                              << //
// ------------------------------------------------------------------------- //

/**
 * Delete the associated thread when a message gets deleted
 * @param {Object} param
 * @param {Client} param.client The Discord.js client
 * @param {Message} param.message The deleted message
 */
export const onMessageDelete = async ({ client, message }) => {
  try {
    // validate thread delete operation
    const isClientOwnedThread = message.hasThread && message.thread.ownerId === client.user.id;
    const isChannelValid = getIsChannelValid(message.channel);
    if (!isClientOwnedThread || !isChannelValid) return;
    // perform thread delete operation
    const channelMessage = await findChannelMessage(message.channel.id, ({ id }) => message.id === id);
    await channelMessage.thread.delete();
    Logger.Info(`Deleted thread for deleted message ${message.id}`);
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
};

/**
 * Start a cron job that validates and repairs channel messages
 * (Scan for Plex changes, restore error disabled buttons, etc)
 */
export const onClientReady = async () => {
  const onError = ({ stack }) => Logger.Error(stack, "plex_music_downloader_script.js");
  Cron("0 */8 * * *", { catch: onError }, async job => {
    Logger.Info(`Triggered job pattern "${job.getPattern()}"`);

    for (const message of await getChannelMessages(plex_channel_id)) {
      const link = getLinkFromMessage(message);
      const isLinkSupported = await getIsLinkSupported(link);
      if (!isLinkSupported) continue;

      let threadChannel = message.hasThread && message.thread;

      // ------------------------------------------------------- //
      // delete threads with obsolete metadata and recreate them //
      // (these are typically links edited for different videos) //
      // ------------------------------------------------------- //

      if (threadChannel && threadChannel.name !== await getThreadChannelName(link)) {
        threadChannel = await threadChannel.delete().then(() => false);
        Logger.Info(`Deleted thread for message id ${message.id}`);
      }

      // ----------------------------------------------------- //
      // create the thread if it doesn't exist and validate it //
      // ----------------------------------------------------- //

      if (!threadChannel) threadChannel = await createThreadChannel(link, message);
      const threadMessage = await findChannelMessage(threadChannel.id, getIsMessageWithPlexButtonComponents);
      if (threadMessage) await validateThreadChannelPlexButton({ message: threadMessage });
    }

    Logger.Info(`Scheduled next job on "${date.format(job.nextRun(), "YYYY-MM-DDTHH:mm")}"`);
  }).trigger();
};

/**
 * Create the thread channel for the message with a music link and verify their status in the Plex library
 * @param {Object} param
 * @param {string} param.message
 */
export const onMessageCreate = async ({ message }) => {
  try {
    const link = getIsChannelValid(message.channel) && getLinkFromMessage(message);
    if (!link) return;

    const reaction = await message.react("⌛");
    const isLinkSupported = await getIsLinkSupported(link);
    await reaction.remove(); // todo: reposition this for speed
    if (!isLinkSupported) return;

    const threadChannel = await createThreadChannel(link, message);
    const threadMessage = await findChannelMessage(threadChannel.id, getIsMessageWithPlexButtonComponents);
    await validateThreadChannelPlexButton({ message: threadMessage });
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

// ------------------------------------------------------------------------- //
// >> COMPONENT FUNCTIONS                                                 << //
// ------------------------------------------------------------------------- //

/**
 * Import the link related to the button interaction into the Plex library
 * @param {Interaction} interaction
 */
async function callbackImportPlexFile(interaction, outputFilename, outputFilepath) {
  const plexFilepath = resolve(`${plex_directory}/${outputFilename}`);
  await fs.move(outputFilepath, plexFilepath);
  await interaction.editReply("Success! Your file was imported into Plex.");
  await validateThreadChannelPlexButton({ interaction, message: interaction.message });
  await startPlexLibraryScan();
}

/**
 * Download the link from the interaction threads starter message and upload it to the thread as a MP3 file
 * @param {Interaction} interaction
 */
async function callbackUploadDiscordFile(interaction, outputFilename, outputFilepath) {
  const filenameWithoutId = outputFilename.split(" - ").slice(0, -1).join(" - ");
  // todo: if reference is a reference, update the reference? improves usability
  const name = filenameWithoutId + extname(outputFilename);
  const files = [new AttachmentBuilder(outputFilepath, { name })];
  const reply = await interaction.editReply({ files });
  Logger.Info(`Uploaded "${reply.attachments.first().name}"`);
}

/**
 * Create the thread channel for the message with a music link
 * @param {string} link
 * @param {Message} starterMessage
 * @returns {ThreadChannel}
 */
async function createThreadChannel(link, starterMessage) {
  const thread = await starterMessage.startThread({ name: await getThreadChannelName(link) });
  await thread.members.remove(starterMessage.author.id);

  // --------------------------------------------------- //
  // send buttons to download the message link in thread //
  // --------------------------------------------------- //

  const isLinkYouTubePlaylist = getIsLinkYouTubePlaylist(link);
  const isLinkYouTubePlaylistWithoutVideo = isLinkYouTubePlaylist && !link.includes("v=");

  if (!isLinkYouTubePlaylistWithoutVideo) {
    const downloadMp3Button = new ButtonBuilder();
    downloadMp3Button.setCustomId(COMPONENT_CUSTOM_IDS.DOWNLOAD_MP3_BUTTON);
    downloadMp3Button.setEmoji("📲");
    downloadMp3Button.setLabel("Download MP3");
    downloadMp3Button.setStyle(ButtonStyle.Secondary);

    const searchingPlexButton = new ButtonBuilder();
    searchingPlexButton.setCustomId(COMPONENT_CUSTOM_IDS.SEARCHING_PLEX_BUTTON);
    searchingPlexButton.setDisabled(true);
    searchingPlexButton.setEmoji("⏳");
    searchingPlexButton.setLabel("Searching in Plex");
    searchingPlexButton.setStyle(ButtonStyle.Secondary);

    await thread.send({
      components: [new ActionRowBuilder().addComponents(downloadMp3Button, searchingPlexButton)],
      content: "Use these to download this music from Discord:"
    });
  }

  // ----------------------------------------------------- //
  // send buttons to manage the YouTube playlist in thread //
  // ----------------------------------------------------- //

  if (isLinkYouTubePlaylist) {
    const showAllSongsButton = new ButtonBuilder();
    showAllSongsButton.setCustomId(COMPONENT_CUSTOM_IDS.SHOW_ALL_YOUTUBE_SONGS);
    showAllSongsButton.setEmoji("<:youtube:1196317298844242000>"); // todo: config
    showAllSongsButton.setLabel("Show all videos");
    showAllSongsButton.setStyle(ButtonStyle.Secondary);

    const followInChannelButton = new ButtonBuilder();
    followInChannelButton.setCustomId(COMPONENT_CUSTOM_IDS.FOLLOW_UPDATES_BUTTON); // todo: constant
    followInChannelButton.setEmoji("🔔");
    followInChannelButton.setLabel("Follow updates");
    followInChannelButton.setStyle(ButtonStyle.Secondary);

    await thread.send({
      components: [new ActionRowBuilder().addComponents(showAllSongsButton, followInChannelButton)],
      content: "Use these to manage this YouTube playlist:"
    });
  }

  // ----------------------------------------------------- //
  // send button to get documentation for previous buttons //
  // ----------------------------------------------------- //

  const showDocumentationButton = new ButtonBuilder();
  showDocumentationButton.setCustomId(COMPONENT_CUSTOM_IDS.SHOW_BUTTON_DOCUMENTATION);
  showDocumentationButton.setEmoji("🔖");
  showDocumentationButton.setLabel("Show documentation");
  showDocumentationButton.setStyle(ButtonStyle.Primary);

  await thread.send({
    components: [new ActionRowBuilder().addComponents(showDocumentationButton)],
    content: "Use this for help with these buttons:"
  });

  return thread;
}

/**
 * Delete the link from the Plex music library
 * @param {Interaction} interaction
 */
async function deleteLinkFromPlex(interaction) {
  const operation = new InteractionOperation({
    customId: COMPONENT_CUSTOM_IDS.DELETE_FROM_PLEX_MODAL,
    messageId: interaction.message.id,
    userId: interaction.user.id
  });

  if (operation.isBusy) return;
  else operation.setBusy(true);

  try {
    await interaction.deferReply({ ephemeral: true });

    const link = await getLinkFromMessageHierarchy(interaction.message);
    const existingPlexFilename = await getExistingPlexFilename(link);

    if (!existingPlexFilename) {
      await interaction.editReply(`Sorry! Your file wasn't found in Plex.`);
      Logger.Warn(`Plex filename does not exist`);
    }
    else {
      await fs.remove(`${plex_directory}/${existingPlexFilename}`);
      Logger.Info(`Deleted file from Plex: "${existingPlexFilename}"`);
      await interaction.editReply("Your file was successfully deleted from Plex.");
      await startPlexLibraryScan();
    }
  }
  catch(error) {
    Logger.Error(error.stack);
    await interaction.editReply({ content: getFormattedErrorMessage(error) });
  }
  finally {
    await validateThreadChannelPlexButton({ interaction, message: interaction.message });
    operation.setBusy(false);
  }
}

async function downloadLinkAndExecute(interaction, modalCustomId, callback, audioFormat) {
  const operation = new InteractionOperation({
    customId: modalCustomId,
    messageId: interaction.message.id,
    userId: interaction.user.id
  });

  if (operation.isBusy) return;
  else operation.setBusy(true);

  try {
    await interaction.deferReply({ ephemeral: true });
    const link = await getLinkFromMessageHierarchy(interaction.message);

    if (!await getIsLinkSupported(link)) {
      // todo: log error
      return;
    }

    const inputArtist = interaction.fields.getTextInputValue("artist");
    const inputTitle = interaction.fields.getTextInputValue("title");

    const inputStart = interaction.fields.getTextInputValue("start");
    const inputStartTotalSeconds = getTimestampAsTotalSeconds(inputStart);

    const inputEnd = interaction.fields.getTextInputValue("end");
    const inputEndTotalSeconds = getTimestampAsTotalSeconds(inputEnd);

    const linkWithoutParameters = getLinkWithParametersRemoved(link);
    const trackEnd = VALIDATED_TRACK_DURATIONS[linkWithoutParameters];
    const trackEndTotalSeconds = trackEnd && getTimestampAsTotalSeconds(trackEnd);

    // ------------------------------------------------------------------ //
    // validate the user inputted timestamp strings if they are available //
    // (availability depends on a cached API fetch and could be disabled) //
    // ... (thank a Discord developer for their questionable API designs) //
    // ------------------------------------------------------------------ //

    if (trackEnd && !/^(\d{1,3}:)?\d{2}:\d{2}:\d{2}$/.test(inputStart)) {
      const content = `Sorry! \`${inputStart}\` is not a valid timestamp. Please try again.`;
      await interaction.editReply({ content });
      return;
    }

    if (trackEnd && !/^(\d{1,3}:)?\d{2}:\d{2}:\d{2}$/.test(inputEnd)) {
      const content = `Sorry! \`${inputEnd}\` is not a valid timestamp. Please try again.`;
      await interaction.editReply({ content });
      return;
    }

    if (trackEnd && inputEndTotalSeconds > trackEndTotalSeconds) {
      const content = `Sorry! End time can't exceed \`${VALIDATED_TRACK_DURATIONS[linkWithoutParameters]}\`. Please try again.`;
      await interaction.editReply({ content });
      return;
    }

    if (trackEnd && inputStartTotalSeconds >= inputEndTotalSeconds) {
      const content = `Sorry! Start time can't be after end time. Please try again.`;
      await interaction.editReply({ content });
      return;
    }

    // ------------------------------------------------------------------ //
    // check if we're updating the track length so we can post-process it //
    // ------------------------------------------------------------------ //

    const isEndTimeUpdate = trackEnd && trackEndTotalSeconds > inputEndTotalSeconds;
    const isStartTimeUpdate = trackEnd && inputStartTotalSeconds > 0 && inputStartTotalSeconds < inputEndTotalSeconds;

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

    const outputDirectory =
      `${temp_directory}/${interaction.customId}${interaction.message.id}${interaction.user.id}`;

    const options = {
      audioQuality: 0,
      embedMetadata: true,
      externalDownloader: "ffmpeg",
      externalDownloaderArgs:
        " -metadata album='Downloads'"
        + " -metadata album_artist='Various Artists'"
        + ` -metadata artist='${sanitizeFfmpeg(inputArtist)}'`
        + " -metadata date=''" // remove unwanted ID3 tag
        + ` -metadata title='${sanitizeFfmpeg(inputTitle)}'`
        + " -metadata track=''", // remove unwanted ID3 tag
      extractAudio: true,
      format: "bestaudio/best",
      noPlaylist: true,
      output: `${outputDirectory}/${sanitizeFilename(`${inputArtist} - ${inputTitle}`)} - %(id)s.%(ext)s`,
    }

    if (audioFormat) options["audioFormat"] = audioFormat;

    // ------------------------------------------------------------ //
    // compile the post-processor if post-processing should be done //
    // (we want to add audio fade-in / fade-out for trimmed tracks) //
    // ------------------------------------------------------------ //

    const postProcessor = trackEnd && (() => {
      const outputTotalSeconds = inputEndTotalSeconds - inputStartTotalSeconds;
      const fadeTotalSeconds = outputTotalSeconds >= 20 ? 5 : outputTotalSeconds / 4;
      const execAudioFilters = []; // exec command sourced from https://redd.it/whqfl6/
      if (isStartTimeUpdate) execAudioFilters.push(`afade=t=in:st=0:d=${fadeTotalSeconds}`);
      if (isEndTimeUpdate) execAudioFilters.push(`afade=t=out:st=${outputTotalSeconds - fadeTotalSeconds}:d=${fadeTotalSeconds}`);
      if (execAudioFilters.length) return `move {} temp & ffmpeg -i temp -af "${execAudioFilters.join(",")}" {} & del temp`;
      return false; // throw? we should never reach this
    })();

    if (isStartTimeUpdate) options.externalDownloaderArgs += ` -ss ${inputStart}.00`;
    if (isEndTimeUpdate) options.externalDownloaderArgs += ` -to ${inputEnd}.00`;
    if (postProcessor) options["exec"] = postProcessor;
    await youtubedl(linkWithoutParameters, options);

    // ----------------------------------------------------------- //
    // get the result from the filesystem and upload it to Discord //
    // ----------------------------------------------------------- //

    const outputFilename = fs.readdirSync(outputDirectory)[0];
    const outputFilepath = resolve(`${outputDirectory}/${outputFilename}`);

    // perform extra tasks like importing the result into Plex
    await callback(interaction, outputFilename, outputFilepath);
    await fs.remove(outputDirectory);
  }
  catch(error) {
    await interaction.editReply(getFormattedErrorMessage(error));
    Logger.Error(error.stack);
  }
  finally {
    operation.setBusy(false);
  }
}

/**
 * Get the metadata artist with undesired substrings either sanitized or removed
 * @param {string} author_name
 * @returns {string}
 */
function getCleanMetadataArtist(author_name = "") {
  let result = author_name;
  if (result.endsWith(" - Topic")) result = result.slice(0, -" - Topic".length)
  return asciiWidthConverter.toHalfWidth(result.trim());
}

/**
 * Get the metadata title with undesired substrings either sanitized or removed
 * @param {string} author_name
 * @param {string} title
 * @returns {string}
 */
function getCleanMetadataTitle(author_name = "", title = "") {
  let result = title;
  if (result.startsWith(`${author_name.replace(" Official", "")} - `)) result = result.slice(`${author_name.replace(" Official", "")} - `.length);
  if (result.endsWith(` by ${author_name}`)) result = result.slice(0, -` by ${author_name}`.length);
  return asciiWidthConverter.toHalfWidth(result.trim());
}

/**
 * Get the filename of the link in the Plex library if it was previously added
 * (this is done by saving the links unique id in the music download filename)
 * @param {string} link
 */
async function getExistingPlexFilename(link) {
  const pendingVideoId = await youtubedl(link, {
    output: "%(id)s",
    print: "filename",
    simulate: true,
    skipDownload: true
  });

  return fs
    .readdirSync(plex_directory) // filename = "%(uploader)s - %(title)s - %(id)s.%(ext)s"
    .find(filename => pendingVideoId == filename.split(' - ').slice(-1)[0].split('.')[0]);
}

/**
 * Stringify an error and encapsulate it within the content of a Discord message
 * @param {Error} error
 */
function getFormattedErrorMessage(error) {
  return `Sorry! I caught an error for this link:\n\`\`\`${error}\`\`\``;
}

/**
 * Get if the channel is valid for this component
 * @param {GuildChannel} channel
 */
function getIsChannelValid(channel) {
  return channel.id === plex_channel_id;
}

/**
 * Get if the link is supported by all dependencies in the library stack
 * (unsupported links will cause operation errors and shouldn't be used)
 * @param {string} link
 */
async function getIsLinkSupported(link) {
  if (typeof link !== "string") return false;
  const linkWithoutParameters = getLinkWithParametersRemoved(link);
  return await getIsLinkSupportedOembed(linkWithoutParameters) && await getIsLinkSupportedYouTubeDl(linkWithoutParameters);
}

/**
 * Get if the link is supported by the oembed-extractor library
 * @param {string} link
 */
async function getIsLinkSupportedOembed(link) {
  return link && await oembed.extract(link).then(() => true).catch(() => false);
}

/**
 * Get if the link is supported by the youtube-dl-exec library
 * @param {string} link
 */
async function getIsLinkSupportedYouTubeDl(link) {
  return link && await youtubedl(link, { simulate: true }).then(() => true).catch(() => false);
}

/**
 * Get if the link is a playlist on YouTube
 * @param {string} link
 */
function getIsLinkYouTubePlaylist(link) {
  return (link.includes("youtu.be") || link.includes("youtube.com")) && link.includes("list=");
}

/**
 * Get if the message contains a button for managing the Plex library
 * (custom id: DELETE_FROM_PLEX_BUTTON, IMPORT_INTO_PLEX_BUTTON, etc)
 * @param {Message} message
 */
function getIsMessageWithPlexButtonComponents(message) {
  return message.components?.[0]?.components.some(getIsPlexButtonComponent);
}

/**
 * Get if the component is a button component for managing the Plex library
 * @param {Component} component
 */
function getIsPlexButtonComponent(component) {
  return component.customId.includes("_PLEX_")
    && component.type === ComponentType.Button;
}

/**
 * Get an embedded link from the message content property
 * @param {Message} message
 */
function getLinkFromMessage(message) {
  const match = message.content.match(/(https?:\/\/[^\s]+)/g);
  return match ? match[0] : null;
}

/**
 * Get an embedded link from the entire message hierarchy
 * (if the message has no link then check its parent too)
 * @param {Message} message The channel or thread message
 */
async function getLinkFromMessageHierarchy(message) {
  return await getLinkFromMessage(message) ?? await getLinkFromStarterMessage(message);
}

/**
 * Get an embedded link from the thread message parents content property
 * @param {Message} threadMessage
 */
async function getLinkFromStarterMessage(threadMessage) {
  const starterMessage = await threadMessage.channel.fetchStarterMessage();
  return await getLinkFromMessage(starterMessage);
}

/**
 * Remove any parameters from a link
 * @param {string} link
 * @returns {string}
 */
function getLinkWithParametersRemoved(link) {
  return link.match(/(https?:\/\/[^&\s]+)/)[1];
}

/**
 * Get the thread name determined by the type of content in the link
 * @param {string} link
 */
async function getThreadChannelName(link) {
  let title = (async () => {
    // try fetching the YouTube playlist title
    const isLinkYouTubePlaylistWithoutVideo = getIsLinkYouTubePlaylist(link) && !link.includes("v=");
    if (isLinkYouTubePlaylistWithoutVideo) return `📲 ${(await ytpl(link))?.title}`;
    // try fetching the video title
    const { author_name, title } = await oembed.extract(link).catch(() => ({ author_name: null, title: null }));
    if (author_name && title) return `📲 ${getCleanMetadataTitle(author_name, title)}`;
    // give up fetching
    return "⚠️ Unable to fetch title";
  })();

  if (title.length > 100) title = title.slice(0, 97) + "...";
  return title;
}

/**
 * Get the total seconds from a HH:MM:SS formatted timestamp
 * @param {string} timestamp HH:MM:SS timestamp
 */
function getTimestampAsTotalSeconds(timestamp) {
  const time = timestamp.split(":");
  return (+time[0]) * 60 * 60 + (+time[1]) * 60 + (+time[2]);
}

async function showButtonDocumentation(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const result = [];

  for(const message of await getChannelMessages(interaction.channel.id)) {
    const components = message.components?.[0]?.components;
    if (!components) continue;

    const buttonData = components.map(c => c.data).reverse(); // reverse row items so they're upserted in order
    const interactionData = buttonData.map(b => COMPONENT_INTERACTIONS.find(c => c.customId === b.custom_id));

    for(const { custom_id, emoji, label} of buttonData) {
      const id = interactionData.filter(x => x).find(x => x.customId === custom_id);
      if (!id || custom_id === COMPONENT_CUSTOM_IDS.SHOW_BUTTON_DOCUMENTATION) continue;

      const { description, requiredRoleIds } = id;
      const formattedEmoji = emoji.id ? `<:${emoji.name}:${emoji.id}>` : emoji.name;
      const formattedRoles = requiredRoleIds ? ` \`🔒Locked\` ${requiredRoleIds.map(r => `<@&${r}>`).join(" ")}` : "";
      result.unshift(`${formattedEmoji} **${label}**${formattedRoles}\n\`\`\`${description}\`\`\``);
    }
  }

  await interaction.editReply({ content: `Here's what I know about these buttons:\n\n${result.join("\n")}` });
}

/**
 * Get all songs within a YouTube playlist and post them as interaction replies
 * @param {Interaction} interaction
 */
async function showAllYouTubePlaylistSongs(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const link = await getLinkFromMessageHierarchy(interaction.message);
  const playlist = await ytpl(link);

  const downloadMp3Button = new ButtonBuilder();
  downloadMp3Button.setCustomId(COMPONENT_CUSTOM_IDS.DOWNLOAD_MP3_BUTTON);
  downloadMp3Button.setEmoji("📲");
  downloadMp3Button.setLabel("Download MP3");
  downloadMp3Button.setStyle(ButtonStyle.Secondary);

  const searchingPlexButton = new ButtonBuilder();
  searchingPlexButton.setCustomId(COMPONENT_CUSTOM_IDS.SEARCHING_PLEX_BUTTON);
  searchingPlexButton.setDisabled(true);
  searchingPlexButton.setEmoji("⏳");
  searchingPlexButton.setLabel("Searching in Plex");
  searchingPlexButton.setStyle(ButtonStyle.Secondary);

  const components = [new ActionRowBuilder().addComponents(downloadMp3Button, searchingPlexButton)];

  for(let i = 0; i < playlist.items.length; i++) {
    const cleanTitle = playlist.title.replaceAll("`", "").replaceAll("*", "").replaceAll(" _", "").replaceAll("_ ", "");
    const content = `<:youtube:1196317298844242000> \`${i + 1}/${playlist.items.length}\` **${cleanTitle}**\n${playlist.items[i].shortUrl}`;
    const message = await interaction.followUp({ components, content, ephemeral: true });
    validateThreadChannelPlexButton({ interaction, message }); // don't await or we'll be here all day!
    await new Promise(resolve => setTimeout(resolve, 250)); // reduce load on the Discord API
  }
}

/**
 * Show the popup modal to confirm file deletion from Plex
 * @param {Interaction} interaction
 * @param {string} modalCustomId
 * @param {string} modalTitle
 */
async function showDeletionModal(interaction, modalCustomId, modalTitle) {
  const operation = new InteractionOperation({
    customId: modalCustomId,
    messageId: interaction.message.id,
    userId: interaction.user.id
  });

  if (operation.isBusy) {
    await interaction.deferUpdate();
    return;
  }

  // we don't do anything with this data, we just want a confirmation
  //   before the file gets deleted (and Discord has no way besides a
  //   text input because it doesn't have other types of basic input)

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
  catch({ stack }) {
    Logger.Error(stack);
  }
}

/**
 * Show the popup modal to input a links metadata information
 * @param {Interaction} interaction
 * @param {string} modalCustomId
 * @param {string} modalTitle
 */
async function showMetadataModal(interaction, modalCustomId, modalTitle) {
  const operation = new InteractionOperation({
    customId: modalCustomId,
    messageId: interaction.message.id,
    userId: interaction.user.id
  });

  if (operation.isBusy) {
    await interaction.deferUpdate();
    return;
  }

  try {
    const link = await getLinkFromMessageHierarchy(interaction.message);
    if (!link) return;

    const { author_name, title } = await oembed.extract(link).catch(async error => {
      Logger.Warn(`Couldn't fetch oembed data for message id "${interaction.message.id}"`);
      await interaction.reply({ content: getFormattedErrorMessage(error), ephemeral: true });
      return { author_name: null, title: null };
    });

    if (!author_name && !title) return;

    const trackEnd = VALIDATED_TRACK_DURATIONS[link];
    // todo: sponsorblock api to get music start time

    const titleTextInput = new TextInputBuilder();
    titleTextInput.setCustomId("title");
    titleTextInput.setLabel("Track Title");
    titleTextInput.setRequired(true);
    titleTextInput.setStyle(TextInputStyle.Short);
    titleTextInput.setValue(getCleanMetadataTitle(author_name, title));

    const artistTextInput = new TextInputBuilder();
    artistTextInput.setCustomId("artist");
    artistTextInput.setLabel("Track Artist");
    artistTextInput.setRequired(true);
    artistTextInput.setStyle(TextInputStyle.Short);
    artistTextInput.setValue(getCleanMetadataArtist(author_name));

    const startTextInput = new TextInputBuilder();
    if (trackEnd) startTextInput.setCustomId("start");
    if (trackEnd) startTextInput.setLabel("Track Start");
    if (trackEnd) startTextInput.setPlaceholder("00:00:00");
    if (trackEnd) startTextInput.setStyle(TextInputStyle.Short);
    if (trackEnd) startTextInput.setValue("00:00:00");

    const endTextInput = new TextInputBuilder()
    if (trackEnd) endTextInput.setCustomId("end");
    if (trackEnd) endTextInput.setLabel("Track End");
    if (trackEnd) endTextInput.setPlaceholder(trackEnd);
    if (trackEnd) endTextInput.setStyle(TextInputStyle.Short);
    if (trackEnd) endTextInput.setValue(trackEnd);

    const actionRows = [];
    actionRows.push(new ActionRowBuilder().addComponents(titleTextInput));
    actionRows.push(new ActionRowBuilder().addComponents(artistTextInput));
    if (trackEnd) actionRows.push(new ActionRowBuilder().addComponents(startTextInput));
    if (trackEnd) actionRows.push(new ActionRowBuilder().addComponents(endTextInput));

    await interaction.showModal(new ModalBuilder()
      .addComponents(...actionRows)
      .setCustomId(modalCustomId)
      .setTitle(modalTitle)
    );
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

/**
 * Fetch the Plex API and request the media library scans for file changes
 */
async function startPlexLibraryScan() {
  try {
    const address = `http://${plex_server_ip}:32400/library/sections/${plex_section_id}/refresh`;
    const options = { method: "GET", headers: { "X-Plex-Token": plex_x_token } };
    await fetch(address, options);
    Logger.Info(`Plex library scan started`);
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

/**
 * Fetch the download filename and update the Plex button with the status of its existence in the Plex folder
 * @param {Message} message
 */
async function validateThreadChannelPlexButton({ interaction, message }) {
  try {
    const link = await getLinkFromMessageHierarchy(message);
    const linkWithoutParameters = getLinkWithParametersRemoved(link);

    // todo: amazing Discord API requires modules resolve in <= 3 seconds
    //   which is obviously not possible when dependant on fetch requests
    //   so now we get to fetch them in advance and cache for some reason
    //   (this inefficiency and code smell is brought to you by Discord!)
    VALIDATED_TRACK_DURATIONS[link] = await youtubedl(linkWithoutParameters, {
      output: "%(duration>%H:%M:%S)s",
      print: "%(duration>%H:%M:%S)s",
      simulate: true,
      skipDownload: true
    });

    const isArchived = message.channel.archived;
    if (isArchived) await message.channel.setArchived(false);

    const referenceMessage = message.reference
      && !getIsMessageWithPlexButtonComponents(message)
      && await findChannelMessage(message.reference.channelId, ({ id }) => id === message.reference.messageId);

    const actualMessage = referenceMessage || message;
    const buttonIndex = actualMessage.components[0].components.findIndex(getIsPlexButtonComponent);
    const components = [ActionRowBuilder.from(actualMessage.components[0])];

    components[0].components[buttonIndex].setCustomId(COMPONENT_CUSTOM_IDS.SEARCHING_PLEX_BUTTON);
    components[0].components[buttonIndex].setDisabled(true);
    components[0].components[buttonIndex].setEmoji("⏳");
    components[0].components[buttonIndex].setLabel("Searching in Plex");

    actualMessage.type === MessageType.Reply
      ? await interaction.editReply({ message: actualMessage, components })
      : await actualMessage.edit({ components });

    const isPlexFile = await getExistingPlexFilename(linkWithoutParameters);
    const customId = isPlexFile ? COMPONENT_CUSTOM_IDS.DELETE_FROM_PLEX_BUTTON : COMPONENT_CUSTOM_IDS.IMPORT_INTO_PLEX_BUTTON;
    const label = isPlexFile ? "Delete from Plex" : "Import into Plex";

    components[0].components[buttonIndex].setCustomId(customId);
    components[0].components[buttonIndex].setDisabled(false)
    components[0].components[buttonIndex].setEmoji(plex_emoji)
    components[0].components[buttonIndex].setLabel(label);

    actualMessage.type === MessageType.Reply
      ? await interaction.editReply({ message: actualMessage, components })
      : await actualMessage.edit({ components });
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}
