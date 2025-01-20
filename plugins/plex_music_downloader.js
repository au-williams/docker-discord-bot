import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, Events, Message, MessageFlags, ModalBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle, ThreadChannel } from "discord.js";
import { Config } from "../services/config.js";
import { Emitter } from "../services/emitter.js";
import { extname, resolve } from "path";
import { Logger } from "../services/logger.js";
import { nanoid } from "nanoid";
import { setTimeout } from "timers/promises";
import { Utilities } from "../services/utilities.js";
import * as oembed from "@extractus/oembed-extractor";
import date from "date-and-time";
import fs from "fs-extra";
import Listener from "../entities/Listener.js";
import MediaDownloadCache from "../entities/MediaDownloadCache.js"
import MediaDownloadConfig from "../entities/MediaDownloadConfig.js";
import meridiem from "date-and-time/plugin/meridiem";
import randomItem from "random-item";
import youtubedl from "youtube-dl-exec";
date.plugin(meridiem);

// TODO: ///////////////////////////////////////////////////////
// - Set manage plex button as busy on first download         //
// - Add logic for ButtonPlexDeleteFileAudio                  //
// - Add logic for ButtonPlexDeleteFileVideo                  //
// - Add logic for startPlexVideoLibraryScan()                //
// - Add support for X / Twitter                              //
// - Add support for Bandcamp                                 //
// - Add support for Reddit                                   //
// - Processing / Uploading button labels                     //
// https://www.youtube.com/watch?v=PaZXPx1kdtg                //
////////////////////////////////////////////////////////////////

const config = new Config(import.meta.filename);
const logger = new Logger(import.meta.filename);

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region EMITTER.JS IMPORTS                                                //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

export const Interactions = Object.freeze({
  ButtonContinueChaptersAudio: "PLEX_BUTTON_CONTINUE_CHAPTERS_AUDIO",
  ButtonContinueChaptersVideo: "PLEX_BUTTON_CONTINUE_CHAPTERS_VIDEO",
  ButtonDownloadAudio: "PLEX_BUTTON_DOWNLOAD_AUDIO",
  ButtonDownloadVideo: "PLEX_BUTTON_DOWNLOAD_VIDEO",
  ButtonManagePlexAudio: "PLEX_BUTTON_MANAGE_PLEX_AUDIO",
  ButtonManagePlexVideo: "PLEX_BUTTON_MANAGE_PLEX_VIDEO",
  ButtonPlexDeleteFileAudio: "PLEX_BUTTON_PLEX_DELETE_FILE_AUDIO",
  ButtonPlexDeleteFileVideo: "PLEX_BUTTON_PLEX_DELETE_FILE_VIDEO",
  ButtonPlexStartImportAudio: "PLEX_BUTTON_PLEX_START_IMPORT_AUDIO",
  ButtonPlexStartImportVideo: "PLEX_BUTTON_PLEX_START_IMPORT_VIDEO",
  ButtonSelectAllChapters: "PLEX_BUTTON_SELECT_ALL_CHAPTERS",
  ButtonStartDownloadAudio: "PLEX_BUTTON_START_DOWNLOAD_AUDIO",
  ButtonStartDownloadVideo: "PLEX_BUTTON_START_DOWNLOAD_VIDEO",
  ModalSubmitStartDownloadAudio: "PLEX_MODAL_SUBMIT_START_DOWNLOAD_AUDIO",
  ModalSubmitStartDownloadVideo: "PLEX_MODAL_SUBMIT_START_DOWNLOAD_VIDEO",
  ModalSubmitStartPlexImportAudio: "PLEX_MODAL_SUBMIT_START_PLEX_IMPORT_AUDIO",
  ModalSubmitStartPlexImportVideo: "PLEX_MODAL_SUBMIT_START_PLEX_IMPORT_VIDEO",
  SelectMenuFileFormatAudio: "PLEX_SELECT_MENU_FILE_FORMAT_AUDIO",
  SelectMenuFileFormatVideo: "PLEX_SELECT_MENU_FILE_FORMAT_VIDEO",
  SelectMenuPlexFilesAudio: "PLEX_SELECT_MENU_PLEX_FILES_AUDIO",
  SelectMenuPlexFilesVideo: "PLEX_SELECT_MENU_PLEX_FILES_VIDEO",
  SelectMenuSelectChapters: "PLEX_SELECT_MENU_SELECT_CHAPTERS",
  SelectMenuVideoResolution: "PLEX_SELECT_MENU_VIDEO_RESOLUTION",
  SelectMenuVolumeFade: "PLEX_SELECT_MENU_VOLUME_FADE",
});

export const Listeners = Object.freeze({
  [Events.MessageCreate]:
    onEventMessageCreate,
  [Interactions.ButtonContinueChaptersAudio]: new Listener()
    .setDescription("Shows a download message for each selected chapter, or one download message for the entire audio.")
    .setFunction(onButtonChaptersContinue),
  [Interactions.ButtonContinueChaptersVideo]: new Listener()
    .setDescription("Shows a download message for each selected chapter, or one download message for the entire video.")
    .setFunction(onButtonChaptersContinue),
  [Interactions.ButtonDownloadAudio]: new Listener()
    .setDescription("Uploads the audio from this link to Discord as a file that you can stream or download. Admins can import, delete, or modify the audio files from this link in the host's Plex library.")
    .setFunction(onButtonDownload),
  [Interactions.ButtonDownloadVideo]: new Listener()
    .setDescription("Uploads the video from this link to Discord as a file that you can stream or download. Admins can import, delete, or modify the video files from this link in the host's Plex library.")
    .setFunction(onButtonDownload),
  [Interactions.ButtonManagePlexAudio]: new Listener()
    .setDescription("Manages this media in the host's Plex server. New audio files can be imported in to the music library. Existing files can be deleted from the music library. Requires an admin role to use.")
    .setFunction(onButtonManagePlex)
    .setRequiredUsers(config.discord_bot_admin_user_ids),
  [Interactions.ButtonManagePlexVideo]: new Listener()
    .setDescription("Manages this media in the host's Plex server. New video files can be imported in to the video library. Existing files can be deleted from the video library. Requires an admin role to use.")
    .setFunction(onButtonManagePlex)
    .setRequiredUsers(config.discord_bot_admin_user_ids),
  [Interactions.ButtonPlexDeleteFileAudio]: new Listener()
    .setFunction(() => { throw new Error("Not implemented") })
    .setRequiredRoles(config.discord_bot_admin_user_ids),
  [Interactions.ButtonPlexDeleteFileVideo]: new Listener()
    .setFunction(() => { throw new Error("Not implemented") })
    .setRequiredRoles(config.discord_bot_admin_user_ids),
  [Interactions.ButtonPlexStartImportAudio]: new Listener()
    .setDescription("Starts the file import into Plex. The audio will be downloaded to the server host before being added to the Plex library. Your wait times will be influenced by the size of the source content.")
    .setFunction(params => showMetadataModal({ ...params, customId: Interactions.ModalSubmitStartPlexImportAudio, modalLabel: "Import" }))
    .setRequiredUsers(config.discord_bot_admin_user_ids),
  [Interactions.ButtonPlexStartImportVideo]: new Listener()
    .setDescription("Starts the file import into Plex. The video will be downloaded to the server host before being added to the Plex library. Your wait times will be influenced by the size of the source content.")
    .setFunction(params => showMetadataModal({ ...params, customId: Interactions.ModalSubmitStartPlexImportVideo, modalLabel: "Import" }))
    .setRequiredUsers(config.discord_bot_admin_user_ids),
  [Interactions.ButtonSelectAllChapters]: new Listener()
    .setDescription("Selects all chapters instead of selecting each chapter one by one. Pressing this again deselects them. Includes chapters not shown in the select menu when exceeding Discord's select menu item limit of 25 items.")
    .setFunction(onButtonChaptersSelectAll),
  [Interactions.ButtonStartDownloadAudio]: new Listener()
    .setDescription("Starts the audio download. It must be downloaded to the server host before being uploaded as a file to Discord. Your wait times will be influenced by the size of the source content.")
    .setFunction(params => showMetadataModal({ ...params, customId: Interactions.ModalSubmitStartDownloadAudio, modalLabel: "Download" })),
  [Interactions.ButtonStartDownloadVideo]: new Listener()
    .setDescription("Starts the video download. It must be downloaded to the server host before being uploaded as a file to Discord. Your wait times will be influenced by the size of the source content.")
    .setFunction(params => showMetadataModal({ ...params, customId: Interactions.ModalSubmitStartDownloadVideo, modalLabel: "Download" })),

  // TODO: uncleaned

  [Interactions.ModalSubmitStartDownloadAudio]: onModalSubmitStartDownload,
  [Interactions.ModalSubmitStartDownloadVideo]: onModalSubmitStartDownload,
  [Interactions.ModalSubmitStartPlexImportAudio]: onModalSubmitStartPlexImport,
  [Interactions.ModalSubmitStartPlexImportVideo]: onModalSubmitStartPlexImport,
  [Interactions.SelectMenuFileFormatAudio]: new Listener()
    .setDescription("Chooses the file type. OPUS is recommended because of the high audio quality and small file size. MP3 should be used if your device isn't compatible with OPUS.")
    .setFunction(async params => await onSelectMenuFileFormat({ ...params, contentType: contentTypes.audio })),
  [Interactions.SelectMenuFileFormatVideo]: new Listener()
    .setDescription("Chooses the file type. WEBM is recommended because of the high video quality and small file size. MP4 should be used if your device isn't compatible with WEBM.")
    .setFunction(async params => await onSelectMenuFileFormat({ ...params, contentType: contentTypes.video })),
  [Interactions.SelectMenuPlexFilesAudio]: new Listener()
    .setDescription("Chooses an imported audio file to edit or delete after pressing the modify file button.")
    .setFunction(onSelectMenuPlexFiles),
  [Interactions.SelectMenuPlexFilesVideo]: new Listener()
    .setDescription("Chooses an imported video file to edit or delete after pressing the modify file button.")
    .setFunction(onSelectMenuPlexFiles),
  [Interactions.SelectMenuSelectChapters]: new Listener()
    .setDescription("Chooses which chapters to download. This is optional and the entire audio is selected by default.")
    .setFunction(onSelectMenuSelectChapters),
  [Interactions.SelectMenuVideoResolution]: new Listener()
    .setDescription("Chooses the video resolution. Larger resolutions look better but can take substantially longer to process. File sizes are estimations and could vary greatly from the result.")
    .setFunction(onSelectMenuVideoResolution),
  [Interactions.SelectMenuVolumeFade]: new Listener()
    .setDescription("Chooses if the start volume is faded in and the end volume is faded out to smoothen its playback. This typically improves audio quality (unless gapless track playback is desired).")
    .setFunction(onSelectMenuVolumeFade)
});

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS IMPORTS                                             //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region PLUGIN COMPONENTS                                                 //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

const buttonContinueChaptersAudio = new ButtonBuilder()
  .setCustomId(Interactions.ButtonContinueChaptersAudio)
  .setEmoji("☑️")
  .setLabel("Continue")
  .setStyle(ButtonStyle.Secondary);

const buttonContinueChaptersVideo = new ButtonBuilder()
  .setCustomId(Interactions.ButtonContinueChaptersVideo)
  .setEmoji("☑️")
  .setLabel("Continue")
  .setStyle(ButtonStyle.Secondary);

const buttonDownloadAudio = new ButtonBuilder()
  .setCustomId(Interactions.ButtonDownloadAudio)
  .setEmoji("🎧")
  .setLabel("Download audio")
  .setStyle(ButtonStyle.Secondary);

const buttonDownloadVideo = new ButtonBuilder()
  .setCustomId(Interactions.ButtonDownloadVideo)
  .setEmoji("📺")
  .setLabel("Download video")
  .setStyle(ButtonStyle.Secondary);

const buttonDownloading = new ButtonBuilder()
  .setCustomId(Interactions.ButtonStartDownloadAudio)
  .setDisabled(true)
  .setEmoji("⌛")
  .setLabel("Downloading...")
  .setStyle(ButtonStyle.Success);

const buttonImportingFile = new ButtonBuilder()
  .setCustomId(Interactions.ButtonPlexStartImportAudio)
  .setDisabled(true)
  .setEmoji("⌛")
  .setLabel("Importing file...")
  .setStyle(ButtonStyle.Success);

const buttonManagePlexAudio = new ButtonBuilder()
  .setCustomId(Interactions.ButtonManagePlexAudio)
  .setEmoji(config.discord_plex_emoji)
  .setLabel("Manage Plex")
  .setStyle(ButtonStyle.Secondary);

const buttonManagePlexVideo = new ButtonBuilder()
  .setCustomId(Interactions.ButtonManagePlexVideo)
  .setEmoji(config.discord_plex_emoji)
  .setLabel("Manage Plex")
  .setStyle(ButtonStyle.Secondary);

const buttonPlexDeleteFileAudio = new ButtonBuilder()
  .setCustomId(Interactions.ButtonPlexDeleteFileAudio)
  .setDisabled(true)
  .setEmoji("🗑️")
  .setLabel("Delete file")
  .setStyle(ButtonStyle.Secondary);

const buttonPlexDeleteFileVideo = new ButtonBuilder()
  .setCustomId(Interactions.ButtonPlexDeleteFileVideo)
  .setDisabled(true)
  .setEmoji("🗑️")
  .setLabel("Delete file")
  .setStyle(ButtonStyle.Secondary);

const buttonPlexStartImportAudio = new ButtonBuilder()
  .setCustomId(Interactions.ButtonPlexStartImportAudio)
  .setEmoji("📦")
  .setLabel("Start file import")
  .setStyle(ButtonStyle.Success);

const buttonPlexStartImportVideo = new ButtonBuilder()
  .setCustomId(Interactions.ButtonPlexStartImportVideo)
  .setEmoji("📦")
  .setLabel("Start file import")
  .setStyle(ButtonStyle.Success);

const buttonSelectAllChapters = new ButtonBuilder()
  .setCustomId(Interactions.ButtonSelectAllChapters)
  .setEmoji("🗃️")
  .setLabel("Select all chapters")
  .setStyle(ButtonStyle.Secondary);

const buttonStartDownloadAudio = new ButtonBuilder()
  .setCustomId(Interactions.ButtonStartDownloadAudio)
  .setEmoji("🪄")
  .setLabel("Start download")
  .setStyle(ButtonStyle.Success);

const buttonStartDownloadVideo = new ButtonBuilder()
  .setCustomId(Interactions.ButtonStartDownloadVideo)
  .setEmoji("🪄")
  .setLabel("Start download")
  .setStyle(ButtonStyle.Success);

/**
 * Get the audio format select menu.
 * @param {string} selectedValue
 * @returns {StringSelectMenuBuilder}
 */
function getSelectMenuAudioFormat(selectedValue) {
  const options = [
    new StringSelectMenuOptionBuilder()
      .setDefault(selectedValue === "opus")
      .setLabel("🎧 Download as OPUS file (recommended)")
      .setValue("opus"),
    new StringSelectMenuOptionBuilder()
      .setDefault(selectedValue === "mp3")
      .setLabel("🎧 Download as MP3 file")
      .setValue("mp3")
  ];

  return new StringSelectMenuBuilder()
    .setCustomId(Interactions.SelectMenuFileFormatAudio)
    .addOptions(...options);
}

/**
 * Get the chapter select menu.
 * @param {string} contentType
 * @param {MediaDownloadCache} downloadCache
 * @param {string} selectedIndexes
 * @returns {StringSelectMenuBuilder}
 * TODO: does this need selected indexes?
 */
function getSelectMenuChapterSelect(downloadCache, selectedIndexes = []) {
  const options = downloadCache.chapters.slice(0, 25).map((item, index) => new StringSelectMenuOptionBuilder()
    .setDefault(selectedIndexes.includes(index))
    .setDescription(`${Utilities.getShortTimestamp(item.startTime)}-${Utilities.getShortTimestamp(item.endTime)}`)
    .setLabel(Utilities.getTruncatedStringTerminatedByChar(item.title, 100))
    .setValue(`${index}`)
  )

  return new StringSelectMenuBuilder()
    .setCustomId(Interactions.SelectMenuSelectChapters)
    .setMaxValues(Math.min(downloadCache.chapters.length, 25))
    .setMinValues(0)
    .addOptions(...options)
    .setPlaceholder("Download entire content as one file (recommended)");
}

/**
 * Get the volume fade select menu.
 * @param {string} selectedValue
 * @returns {StringSelectMenuBuilder}
 */
function getSelectMenuAudioFade(selectedValue) {
  const options = [
    new StringSelectMenuOptionBuilder()
      .setDefault(selectedValue === 5)
      .setLabel("🎧 Use 5 second volume fade")
      .setValue("5"),
    new StringSelectMenuOptionBuilder()
      .setDefault(selectedValue === 2.5)
      .setLabel("🎧 Use 2.5 second volume fade (recommended)")
      .setValue("2.5"),
    new StringSelectMenuOptionBuilder()
      .setDefault(selectedValue === 0)
      .setLabel("🎧 Do not fade start and end volume")
      .setValue("0")
  ]

  return new StringSelectMenuBuilder()
    .setCustomId(Interactions.SelectMenuVolumeFade)
    .addOptions(...options);
}

/**
 * Get the plex files select menu.
 * @throws `Unexpected contentType`
 * @param {string} contentType
 * @param {string} customId
 * @param {MediaDownloadCache} downloadCache
 * @param {string[]} filenames
 * @param {number} selectedPlexFileIndex
 * @returns {StringSelectMenuBuilder}
 */
function getSelectMenuPlexFiles(customId, downloadCache, filenames, listener, selectedPlexFileIndex) {
  let directory;
  let pluralLabel;
  let singularLabel;

  switch(listener.id) {
    case Interactions.ButtonManagePlexAudio:
    case Interactions.ModalSubmitStartPlexImportAudio:
    case Interactions.SelectMenuPlexFilesAudio: {
      directory = config.plex_download_directory_audio;
      pluralLabel = "audio files";
      singularLabel = "an audio file";
      break;
    }
    case Interactions.ButtonManagePlexVideo:
    case Interactions.ModalSubmitStartPlexImportVideo:
    case Interactions.SelectMenuPlexFilesVideo: {
      // todo: directory = `${config.plex_download_directory_video}/${downloadCache.uploader}`;
      directory = config.plex_download_directory_video;
      pluralLabel = "video files";
      singularLabel = "a video file";
      break;
    }
    default: {
      throw new Error(`Unexpected listener.id "${listener.id}"`);
    }
  }

  // Discord needs a value even if the menu is disabled - pass "null" to avoid throwing
  const options = (filenames.length ? filenames : ["_"]).slice(0, 25).map((item, index) => {
    const filepath = `${directory}/${item}`;
    let description = "NULL";

    if (fs.existsSync(filepath)) {
      const { ctime, size } = fs.statSync(filepath);
      const megabytes = (size / (1024*1024)).toFixed(2);
      description = `Imported ${date.format(ctime, "M/D/YYYY h:mm AA").replaceAll(".", "")} • ${megabytes} MB size`;
    }

    return new StringSelectMenuOptionBuilder()
      .setDefault(index === selectedPlexFileIndex)
      .setDescription(description)
      .setLabel(Utilities.getTruncatedFilenameWithExtension(item, 100))
      .setValue(`${index}`)
  })

  console.log(directory);

  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setDisabled(!filenames?.length)
    .addOptions(...options)
    .setPlaceholder(filenames?.length ? `Select ${singularLabel} to delete` : `No ${pluralLabel} are imported`);
}

/**
 * Get the video format select menu.
 * @param {string} selectedValue
 * @returns {StringSelectMenuBuilder}
 */
function getSelectMenuVideoFormat(selectedValue) {
  const options = [
    new StringSelectMenuOptionBuilder()
      .setDefault(selectedValue === "webm")
      .setLabel("📺 Download as WEBM file (recommended)")
      .setValue("webm"),
    new StringSelectMenuOptionBuilder()
      .setDefault(selectedValue === "mp4")
      .setLabel("📺 Download as MP4 file")
      .setValue("mp4")
  ];

  return new StringSelectMenuBuilder()
    .setCustomId(Interactions.SelectMenuFileFormatVideo)
    .addOptions(...options);
}

/**
 * Get the video resolution select menu.
 * @param {object[]} videoFormats
 * @param {string} selectedValue
 * @returns {StringSelectMenuBuilder}
 */
function getSelectMenuVideoResolution(videoFormats, selectedValue) {
  const options = videoFormats.map(item => {
    return new StringSelectMenuOptionBuilder()
      .setDefault(selectedValue === item.value)
      .setLabel(`📺 Use ${item.resolution} video resolution (${item.filesize})`)
      .setValue(item.value);
  });

  const isDefault = options.some(item => item.data.default);
  if (!isDefault) options[0].setDefault(true);

  return new StringSelectMenuBuilder()
    .setCustomId(Interactions.SelectMenuVideoResolution)
    .addOptions(...options);
}

/**
 * Get the artist text input.
 * @param {string} populatedValue
 * @returns {TextInputBuilder}
 */
function getTextInputArtist(populatedValue) {
  return new TextInputBuilder()
    .setCustomId("artist")
    .setLabel("Artist")
    .setPlaceholder(populatedValue)
    .setRequired(true)
    .setStyle(TextInputStyle.Short)
    .setValue(populatedValue);
}

/**
 * Get the end time text input.
 * @param {string} populatedValue
 * @returns {TextInputBuilder}
 */
function getTextInputEndTime(populatedValue) {
  return new TextInputBuilder()
    .setCustomId("end")
    .setLabel("End Time")
    .setPlaceholder(populatedValue)
    .setStyle(TextInputStyle.Short)
    .setValue(populatedValue)
}

/**
 * Get the genre text input.
 * @param {string} populatedValue
 * @param {boolean} isExample
 * @returns {TextInputBuilder}
 */
function getTextInputGenre(populatedValue, isExample) {
  const textInput = new TextInputBuilder()
    .setCustomId("genre")
    .setLabel("Genre")
    .setPlaceholder(`${populatedValue} (example)`)
    .setRequired(false)
    .setStyle(TextInputStyle.Short);

  if (!isExample) {
    textInput.setValue(populatedValue);
  }

  return textInput;
}

/**
 * Get the start time text input.
 * @param {string} populatedValue
 * @returns {TextInputBuilder}
 */
function getTextInputStartTime(populatedValue) {
  return new TextInputBuilder()
    .setCustomId("start")
    .setLabel("Start Time")
    .setPlaceholder(populatedValue)
    .setStyle(TextInputStyle.Short)
    .setValue(populatedValue)
}

/**
 * Get the title text input.
 * @param {string} populatedValue
 * @returns {TextInputBuilder}
 */
function getTextInputTitle(populatedValue) {
  return new TextInputBuilder()
    .setCustomId("title")
    .setLabel("Title")
    .setPlaceholder(populatedValue)
    .setRequired(true)
    .setStyle(TextInputStyle.Short)
    .setValue(populatedValue);
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN COMPONENTS                                              //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region PLUGIN LOGIC                                                      //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * The types of downloadable content. These are used to simplify shared funcs.
 * @type {object}
 */
const contentTypes = Object.freeze({ audio: "audio", video: "video" });

/**
 * The music genres suggested at random when a genre is not prepopulated.
 * @type {string[]}
 */
const exampleMusicGenres = [
  "Alternative",
  "Commentary",
  "Country",
  "Dubstep",
  "EDM",
  "Folk",
  "Hip-Hop",
  "House",
  "Lo-Fi",
  "Metal",
  "Phonk",
  "Rap",
  "Rock",
  "Soundtrack",
  "Synthwave",
  "Trance",
];

/**
 * A collection of media download caches. Key is the link without parameters.
 * @type {Map<string, MediaDownloadCache>}
 */
const mediaDownloadCaches = new Map();

/**
 * A collection of media data configs. Key is the message id of the ephemeral message.
 * @type {Map<string, MediaDownloadConfig>}
 */
const mediaDownloadConfigs = new Map();

/**
 * A collection of selected chapter indexes. Key is the message id of the ephemeral message.
 * @type {Map<string, number[]>}
 */
const selectedChapters = new Map();

/**
 * Import the audio file into Plex after it has been downloaded.
 * @param {MediaDownloadCache} downloadCache
 * @param {ModalSubmitInteraction} interaction
 * @param {Listener} listener
 * @param {string} outputFilename
 * @param {string} outputFilepath
 */
export async function callbackImportPlexFileAudio(downloadCache, interaction, listener, outputFilename, outputFilepath) {
  const destinationFilename = Utilities.getAvailableFilename(`${config.plex_download_directory_audio}/${outputFilename}`);
  const destinationFilepath = resolve(`${config.plex_download_directory_audio}/${destinationFilename}`);
  await fs.move(outputFilepath, destinationFilepath);
  logger.info(`Imported "${outputFilename}" into Plex`);
  startPlexAudioLibraryScan().catch(error => logger.error(error, listener));
}

/**
 * Import the video file into Plex after it has been downloaded.
 * @param {MediaDownloadCache} downloadCache
 * @param {ModalSubmitInteraction} interaction
 * @param {Listener} listener
 * @param {string} outputFilename
 * @param {string} outputFilepath
 */
export async function callbackImportPlexFileVideo(downloadCache, interaction, listener, outputFilename, outputFilepath) {
  const destinationFilename = Utilities.getAvailableFilename(`${config.plex_download_directory_video}/${outputFilename}`);
  const destinationFilepath = resolve(`${config.plex_download_directory_video}/${destinationFilename}`);
  await fs.move(outputFilepath, destinationFilepath);
  logger.info(`Imported "${outputFilename}" into Plex`);
  // TODO: startPlexVideoLibraryScan().catch(error => logger.error(error, listener));
}

/**
 * Upload the link to the Discord thread after it has been downloaded.
 * @param {MediaDownloadCache} downloadCache
 * @param {ModalSubmitInteraction} interaction
 * @param {Listener} listener
 * @param {string} outputFilename
 * @param {string} outputFilepath
 */
export async function callbackUploadDiscordFile(downloadCache, interaction, listener, outputFilename, outputFilepath) {
  const name = `${getArtistTitleFromFilename(outputFilename)}${extname(outputFilename)}`;
  const files = [new AttachmentBuilder(outputFilepath, { name })];
  const reply = await interaction.followUp({ ephemeral: true, fetchReply: true, files });
  Utilities.LogPresets.SentReplyFile(reply, reply.attachments.first().name, listener);
}

/**
 * Check if the link is valid for the plugin.
 * @param {Message} message
 * @returns {boolean}
 */
export function checkValidMessage(message) {
  if (!message || message.flags.has(MessageFlags.Ephemeral)) return false;
  const link = Utilities.getLinkWithoutParametersFromString(message.content, true);
  return link && (checkYoutubeLink(link) || link.includes("soundcloud.com") || link.includes("reddit.com"));
}

/**
 * Check if the link is for YouTube.
 * @param {string} link
 * @returns {boolean}
 */
export function checkYoutubeLink(link) {
  return link.includes("youtube.com") || link.includes("youtu.be");
}

/**
 * Download audio from the link and execute the callback function.
 * @param {object} param
 * @param {Function} param.callback
 * @param {BaseInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function downloadLinkAndExecuteCallback({ callback, interaction, listener }) {
  const downloadCache = await fetchDownloadCache(interaction);
  const downloadConfig = await fetchDownloadConfig(interaction);

  const inputArtist = interaction.fields.getTextInputValue("artist")?.trim();
  const inputEndTime = interaction.fields.getTextInputValue("end")?.trim();
  const inputGenre = interaction.fields.getTextInputValue("genre")?.trim();
  const inputStartTime = interaction.fields.getTextInputValue("start")?.trim();
  const inputTitle = interaction.fields.getTextInputValue("title")?.trim();

  const audioIds = [Interactions.ModalSubmitStartDownloadAudio, Interactions.ModalSubmitStartPlexImportAudio];
  const videoIds = [Interactions.ModalSubmitStartDownloadVideo, Interactions.ModalSubmitStartPlexImportVideo];
  const isAudioFile = audioIds.includes(listener.id);
  const isVideoFile = videoIds.includes(listener.id);

  // ------------------------------------------------------------------ //
  // compile the options consumed by YoutubeDL with optional parameters //
  // ------------------------------------------------------------------ //

  const tempDownloadDirectory = resolve(`${config.temp_directory_path}/${nanoid()}`);

  const outputArtistTitle = Utilities.getSanitizedFilename(`${inputArtist} - ${inputTitle}`);
  const outputId = " [%(id)s]";
  const outputResolution = ` (${downloadConfig.videoResolution}p)`
  const outputTimestamp = ` {${Utilities.getFilenameTimestamp(inputStartTime)}-${Utilities.getFilenameTimestamp(inputEndTime)}}`;
  const outputFilename = `${outputArtistTitle}${(isVideoFile ? outputResolution : "")}${outputId}${outputTimestamp}`;

  const options = {
    embedMetadata: true,
    // todo: web client https formats require a PO Token which was not provided
    // extractorArgs: "youtube:player_client=android,web",
    noPlaylist: true,
    output: `${tempDownloadDirectory}/${outputFilename}.%(ext)s`,
    postprocessorArgs: "ffmpeg:"
      + " -metadata album='Downloads'"
      + " -metadata album_artist='Various Artists'"
      + ` -metadata artist='${inputArtist.trim().replaceAll("'", "'\\''")}'`
      + ` -metadata comment='${downloadCache.cleanLink}'`
      + " -metadata date=''" // remove unwanted ID3 tag
      + ` -metadata genre='${inputGenre ? inputGenre : ""}'`
      + ` -metadata title='${inputTitle.trim().replaceAll("'", "'\\''")}'`
      + " -metadata track=''" // remove unwanted ID3 tag
  }

  if (isAudioFile) {
    options["audioFormat"] = downloadConfig.audioFileFormat;
    options["audioQuality"] = 0;
    options["extractAudio"] = true;
    options["format"] = "bestaudio/best";
  }

  if (isVideoFile) {
    options["formatSort"] = `height:${downloadConfig.videoResolution}`;
  }

  // ----------------------------------------------------------------- //
  // compile the post-processor if post-processing should be performed //
  // ----------------------------------------------------------------- //

  const cacheEndTimeTotalSeconds = Utilities.getTimestampAsTotalSeconds(downloadCache.endTime);
  const inputEndTimeTotalSeconds = Utilities.getTimestampAsTotalSeconds(inputEndTime);
  const inputStartTimeTotalSeconds = Utilities.getTimestampAsTotalSeconds(inputStartTime);

  const isStartTimeUpdate = inputStartTimeTotalSeconds > 0 && inputStartTimeTotalSeconds < inputEndTimeTotalSeconds;
  const isEndTimeUpdate = cacheEndTimeTotalSeconds > inputEndTimeTotalSeconds;

  if (isStartTimeUpdate || isEndTimeUpdate) {
    options["downloadSections"] = `*${Utilities.getShortTimestamp(inputStartTime)}-${Utilities.getShortTimestamp(inputEndTime)}`;
    options["forceKeyframesAtCuts"] = true;
  }

  if (isAudioFile && downloadConfig.audioFadeDuration) {
    const outputTotalSeconds = inputEndTimeTotalSeconds - inputStartTimeTotalSeconds;
    const outputMinimumSeconds = downloadConfig.audioFadeDuration * 4;
    const fadeTotalSeconds = outputTotalSeconds >= outputMinimumSeconds ? downloadConfig.audioFadeDuration : outputTotalSeconds / 4;
    const execAudioFilters = []; // exec command sourced from https://redd.it/whqfl6/
    if (isStartTimeUpdate) execAudioFilters.push(`afade=t=in:st=0:d=${fadeTotalSeconds}`);
    if (isEndTimeUpdate) execAudioFilters.push(`afade=t=out:st=${outputTotalSeconds - fadeTotalSeconds}:d=${fadeTotalSeconds}`);
    if (execAudioFilters.length) options["exec"] = `move {} "${tempDownloadDirectory}/tempfile" & ffmpeg -i "${tempDownloadDirectory}/tempfile" -af "${execAudioFilters.join(",")}" {} & del "${tempDownloadDirectory}/tempfile"`;
  }

  // -------------------------------------------------------------- //
  // download, execute the callback function, remove temporary file //
  // -------------------------------------------------------------- //

  logger.debug(tempDownloadDirectory);

  logger.debug(options);
  logger.debug(await youtubedl(downloadCache.cleanLink, options));

  const tempDownloadFilename = fs.readdirSync(tempDownloadDirectory)[0];
  const tempDownloadFilepath = resolve(`${tempDownloadDirectory}/${tempDownloadFilename}`);

  await callback(downloadCache, interaction, listener, tempDownloadFilename, tempDownloadFilepath);

  if (config.enable_temp_file_deletion) {
    // todo: make this async w/ then catch
    await fs.remove(tempDownloadDirectory);
  }
}

/**
 * Get the artist and title from the filename.
 * @param {string} filename
 * @returns {string?}
 */
export function getArtistTitleFromFilename(filename) {
  const match = filename.match(/^(.*)\s*\[.*$/);
  return match ? match[1].trim() : null;
}

/**
 * Get the filenames that have been imported into Plex.
 * @throws `Unexpected contentType`
 * @param {string} contentType
 * @param {MediaDownloadCache} downloadCache
 * @returns {string[]}
 */
export function getExistingPlexFilenames(directory, downloadCache) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(filename => getIdFromFilename(filename) === downloadCache.id);
}

/**
 * Get the youtubedl id from the filename.
 * @param {string} filename
 * @returns {string?}
 */
export function getIdFromFilename(filename) {
  // eslint-disable-next-line no-useless-escape
  const match = filename.match(/\[([^\[\]]+)\](?!.*\[[^\[\]]*\])/);
  return match ? match[1].trim() : null;
}

/**
 * Get the manage plex message content.
 * @param {string} label
 * @param {number} count
 * @returns {string}
 */
export function getManagePlexContent(label, count) {
  return (count ? `I found ${count}` : "I didn't find any") +
  ` ${label} ${Utilities.getPluralizedString("file", count)} imported into Plex from this link.` +
  " Your selections made in the referenced message will be applied to your file import too.";
}

/**
 * Get a mapped segment object from the sponsorblock API response.
 * @param {string} category
 * @param {object} segment
 * @returns {object}
 */
export function getMappedSegment(category, segment) {
  const [start, end] = segment.segment;

  return {
    title: category,
    startSeconds: Math.trunc(start),
    startTime: Utilities.getTimestampFromTotalSeconds(Math.trunc(start)),
    endSeconds: Math.trunc(end),
    endTime: Utilities.getTimestampFromTotalSeconds(Math.trunc(end)),
  }
}

/**
 * Get the start and end timestamps from the filename.
 * @param {string} filename
 * @returns {string[]} [startTime, endTime]
 */
export function getTimestampsFromFilename(filename) {
  const match = filename.match(/\{([^{}]+)\}(?!.*\{[^{}]*\})/);
  if (!match) return [null, null];

  const [startTime, endTime] = match[1]
    .replaceAll("T", "").trim().split("-")
    .map(item => Utilities.getLongTimestamp(item.match(/.{1,2}/g).join(":")));

  return [startTime.trim(), endTime.trim()];
}

/**
 * Get the video resolution and file sizes from the youtubeDl "listFormats" table.
 * @param {string} youtubedlFormats
 * @returns {object[]}
 */
export function getVideoFormatsFromList(youtubedlFormats) {
  const formatHeader = youtubedlFormats.split("\n").filter(item => !item.startsWith("["))[0];
  const fi = formatHeader.indexOf("FILESIZE")
  const ri = formatHeader.indexOf("RESOLUTION");

  return youtubedlFormats
    .split("\n")
    .filter(item => item.includes("webm") || item.includes("mp4"))
    .reduce((accumulator, item) => {
      const resolution = Utilities.getApproximateSubstring(item, ri);
      if (!resolution || !resolution.includes("x")) return accumulator;
      if (accumulator.some(a => a.resolution === resolution)) return accumulator;
      let filesize = Utilities.getApproximateSubstring(item, fi);
      if (!filesize.startsWith("~")) filesize = `~${filesize}`;
      const value = resolution.split("x")[1];
      accumulator.unshift({ filesize, resolution, value });
      return accumulator;
    }, [])
}

/**
 * Create a cache of potential fetches that we probably won't use because Discord's amazing API can't wait >3 seconds without erroring.
 * There is no way of improving this code smell without Discord's staff taking a shower and taking an intro to comp-sci college course.
 * Unsupported links will return undefined to reduce the number of outbound connections per operation (increasing the operating speed).
 * @param {BaseInteraction|Message} interactionOrMessage
 * @returns {Promise<MediaDownloadCache>}
 */
export async function fetchDownloadCache(interactionOrMessage) {
  interactionOrMessage = interactionOrMessage.message ?? interactionOrMessage;
  Utilities.throwType(Message, interactionOrMessage);

  // ------------------------------------------------------------ //
  // find message in the reference chain that has the source link //
  // ------------------------------------------------------------ //

  let message = interactionOrMessage.channel instanceof ThreadChannel
    ? await interactionOrMessage.channel.fetchStarterMessage()
    : interactionOrMessage;

  let linkWithoutParameters = Utilities.getLinkWithoutParametersFromString(message.content, true);

  let referenceMessageId = interactionOrMessage.reference?.messageId;

  while (!linkWithoutParameters && referenceMessageId) {
    const referenceMessage = interactionOrMessage.channel.messages.cache.get(referenceMessageId);
    //const referenceMessage = await interactionOrMessage.channel.messages.fetch(referenceMessageId);
    linkWithoutParameters = Utilities.getLinkWithoutParametersFromString(referenceMessage.content, true);
    if (linkWithoutParameters) message = referenceMessage;
    else referenceMessageId = referenceMessage?.reference?.messageId;
  }

  if (!linkWithoutParameters) {
    throw new Error("Expected string value but value was null or empty.");
  }

  let cache = mediaDownloadCaches[linkWithoutParameters];
  if (cache) return cache;

  // ------------------------------------------------------------- //
  // verify the link is not a YouTube playlist without a selection //
  // ------------------------------------------------------------- //

  const isYoutubePlaylistWithoutItem =
    linkWithoutParameters.includes("youtube.com") &&
    !linkWithoutParameters.includes("?v=");

  if (isYoutubePlaylistWithoutItem) return;

  // ---------------------------------------------------------------- //
  // verify the link is not a SoundCloud playlist without a selection //
  // ---------------------------------------------------------------- //

  const isSoundCloudPlaylistWithoutItem =
    linkWithoutParameters.includes("soundcloud.com") &&
    linkWithoutParameters.includes("/sets/") &&
    !linkWithoutParameters.includes("?in=");

  if (isSoundCloudPlaylistWithoutItem) return;

  // ------------------------ //
  // fetch the youtubedl data //
  // ------------------------ //

  let youtubedlErrorMessage;

  const youtubedlDescription = await youtubedl(linkWithoutParameters, {
    getDescription: true,
    skipDownload: true,
  }).catch(e => { youtubedlErrorMessage = e.message });

  const youtubedlFormats = await youtubedl(linkWithoutParameters, {
    listFormats: true,
    skipDownload: true,
  }).catch(e => { youtubedlErrorMessage = e.message });

  const youtubedlPayload = await youtubedl(linkWithoutParameters, {
    output: "%(duration>%H:%M:%S)s,%(id)s,%(view_count)s,%(like_count)s,%(upload_date)s, %(genre)s",
    print: "%(duration>%H:%M:%S)s,%(id)s,%(view_count)s,%(like_count)s,%(upload_date)s, %(genre)s",
    simulate: true,
    skipDownload: true
  }).catch(e => { youtubedlErrorMessage = e.message });

  if (!youtubedlPayload && youtubedlErrorMessage) {
    throw new Error(`${youtubedlErrorMessage} "${linkWithoutParameters}"`);
  }

  if (!youtubedlPayload) {
    // This library may return undefined with no error thrown! Awesome, right?
    throw new Error(`Failed to execute YouTubeDL "${linkWithoutParameters}"`);
  }

  const youtubedlEndTime = Utilities.getLongTimestamp(youtubedlPayload.split(",")[0]);
  const youtubedlGenre = youtubedlPayload.split(",")[5];
  const youtubedlId = youtubedlPayload.split(",")[1];
  const youtubedlLikes = youtubedlPayload.split(",")[3];
  const youtubedlUploadDate = youtubedlPayload.split(",")[4];
  const youtubedlViews = youtubedlPayload.split(",")[2];
  const youtubedlVideoFormats = getVideoFormatsFromList(youtubedlFormats);

  // --------------------- //
  // fetch the oembed data //
  // --------------------- //

  let oembedErrorMessage;

  const oembedPayload = await oembed.extract(linkWithoutParameters).catch(e => {
    oembedErrorMessage = e.message || "Couldn't extract oembed payload";
    if (oembedErrorMessage.includes(linkWithoutParameters)) return;
    oembedErrorMessage += ` "${linkWithoutParameters}"`;
  });

  if (!oembedPayload) {
    throw new Error(oembedErrorMessage);
  }

  // --------------------------- //
  // fetch the sponsorblock data //
  // --------------------------- //

  const sponsorblockSegments = [];

  if (checkYoutubeLink(linkWithoutParameters)) {
    await fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${youtubedlId}&category=music_offtopic`)
      .then(response => response.json())
      .then(response => response.forEach(item => {
        const [start, end] = item.segment;

        // Sometimes the SponsorBlock API returns '0' as the video duration - yikes! Round values to resolve ms inconsistencies.
        const contentEndTotalSeconds = Math.round(item.videoDuration || Utilities.getTimestampAsTotalSeconds(youtubedlEndTime));
        const segmentEndTotalSeconds = Math.round(end);

        if (start === 0) {
          // Segment starts at video start. Assume it's an intro we should skip.
          const segment = getMappedSegment("intro", item);
          sponsorblockSegments.push(segment);
        }
        else if (segmentEndTotalSeconds === contentEndTotalSeconds) {
          // Segment ends at video end. Assume it's an outro we should skip.
          const segment = getMappedSegment("outro", item);
          sponsorblockSegments.push(segment);
        }
      }))
      .catch(() => null); // Throws when no results are found. Awesome.
  }

  cache = new MediaDownloadCache({
    description: youtubedlDescription,
    endTime: youtubedlEndTime,
    genre: youtubedlGenre,
    id: youtubedlId,
    likes: youtubedlLikes,
    link: Utilities.getLinkFromString(message.content, true),
    messageId: message.id,
    segments: sponsorblockSegments.sort((a, b) => a.startSeconds - b.startSeconds),
    title: oembedPayload.title,
    uploadDate: youtubedlUploadDate,
    uploader: oembedPayload.author_name,
    videoFormats: youtubedlVideoFormats.sort((a, b) => b.value - a.value),
    views: youtubedlViews
  });

  mediaDownloadCaches[linkWithoutParameters] = cache;
  logger.debug(cache);
  return cache;
}

/**
 * Fetch the download config for the message. This stores session selections
 * such as the download file type. This is typically keyed using the message
 * id of the interaction, but in some cases (such as follow up messages), it
 * may need the be fetched using the reference message id.
 * @throws
 * @param {BaseInteraction|Message} interactionOrMessage
 * @returns {Promise<MediaDownloadConfig?>}
 */
export async function fetchDownloadConfig(interactionOrMessage) {
  interactionOrMessage = interactionOrMessage.message ?? interactionOrMessage;
  Utilities.throwType(Message, interactionOrMessage);

  if (mediaDownloadConfigs.has(interactionOrMessage.id)) {
    return mediaDownloadConfigs.get(interactionOrMessage.id);
  }

  let referenceMessageId = interactionOrMessage.reference?.messageId;

  while (referenceMessageId) {
    if (mediaDownloadConfigs.has(referenceMessageId)) return mediaDownloadConfigs.get(referenceMessageId);
    const referenceMessage = await interactionOrMessage.channel.messages.fetch(referenceMessageId);
    referenceMessageId = referenceMessage?.reference?.messageId;
  }

  throw new Error(`Couldn't find MediaDownloadConfig for ${interactionOrMessage.id}`);
}

/**
 * When pressing 'Continue' load the selected chapters from the indexes bound
 * to the ephemeral message and pass each one to 'sendStartDownloadMessage'.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonChaptersContinue({ interaction, listener }) {
  await interaction.deferUpdate();

  const downloadCache = await fetchDownloadCache(interaction);
  let chapters = selectedChapters.get(interaction.message.id)?.map(i => downloadCache.chapters[i]);
  if (!chapters || !chapters.length) chapters = [downloadCache];

  for(const chapter of chapters) {
    sendStartDownloadMessage(chapter, interaction, listener);
  }
}

/**
 * When pressing 'Select all' bind each chapter index to the ephemeral message
 * and resend the select menu with all items marked as default. If all indexes
 * were bound, deselect all indexes and resent the select menu with no default
 * items instead.
 * @param {object} param
 * @param {string} param.contentType
 * @param {BaseInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonChaptersSelectAll({ interaction, listener }) {
  await interaction.deferUpdate();

  const downloadCache = await fetchDownloadCache(interaction);
  let indexes = [];

  if (selectedChapters.get(interaction.message.id)?.length !== downloadCache.chapters.length) {
    indexes = [...Array(downloadCache.chapters.length).keys()].map(x => x++);
  }

  selectedChapters.set(interaction.message.id, indexes);
  Utilities.LogPresets.DebugSetValue("selectedChapters", indexes, listener);

  const selectMenu = getSelectMenuChapterSelect(downloadCache, indexes);
  const actionRow1 = new ActionRowBuilder().addComponents(selectMenu);
  const actionRow2 = ActionRowBuilder.from(interaction.message.components[1]);

  interaction
    .editReply({ components: [actionRow1, actionRow2] })
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));
}

/**
 * Fetch the download cache for the link and reply with the download or select chapters message.
 * @throws `Unexpected contentType`
 * @param {object} param
 * @param {BaseInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonDownload({ interaction, listener }) {
  Emitter.setBusy(interaction, true);

  await interaction.deferReply({ ephemeral: true });
  const downloadCache = await fetchDownloadCache(interaction);
  await interaction.deleteReply();

  downloadCache.chapters.length <= 1
    ? sendStartDownloadMessage(downloadCache, interaction, listener)
    : sendSelectChaptersMessage(downloadCache, interaction, listener);

  Emitter.setBusy(interaction, false);
}

/**
 * Send a reply with the manage plex message for the link.
 * @throws `Unexpected contentType`
 * @param {object} param
 * @param {BaseInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonManagePlex({ interaction, listener }) {
  const downloadCache = await fetchDownloadCache(interaction);
  const components = [];

  let filenames;

  switch(listener.id) {
    case Interactions.ButtonManagePlexAudio: {
      filenames = getExistingPlexFilenames(config.plex_download_directory_audio, downloadCache);
      break;
    }
    case Interactions.ButtonManagePlexVideo: {
      filenames = getExistingPlexFilenames(config.plex_download_directory_video, downloadCache);
      break;
    }
    default: {
      throw new Error("Unhandled listener id");
    }
  }

  if (filenames.length) {
    let content = null;

    switch(listener.id) {
      case Interactions.ButtonManagePlexAudio: {
        const customId = Interactions.SelectMenuPlexFilesAudio;
        components.push(new ActionRowBuilder().addComponents(getSelectMenuPlexFiles(customId, downloadCache, filenames, listener)));
        components.push(new ActionRowBuilder().addComponents(buttonPlexStartImportAudio, buttonPlexDeleteFileAudio, Emitter.moreInfoButton));
        content = getManagePlexContent("audio", filenames.length);
        break;
      }
      case Interactions.ButtonManagePlexVideo: {
        const customId = Interactions.SelectMenuPlexFilesVideo;
        components.push(new ActionRowBuilder().addComponents(getSelectMenuPlexFiles(customId, downloadCache, filenames, listener)));
        components.push(new ActionRowBuilder().addComponents(buttonPlexStartImportVideo, buttonPlexDeleteFileVideo, Emitter.moreInfoButton));
        content = getManagePlexContent("video", filenames.length);
        break;
      }
      default: {
        throw new Error("Unhandled listener id");
      }
    }

    interaction
      .reply({ components, content, ephemeral: true, fetchReply: true })
      .then(result => Utilities.LogPresets.SentReply(result, listener))
      .catch(error => logger.error(error, listener));
  }
  else {
    let customId = null;

    switch(listener.id) {
      case Interactions.ButtonManagePlexAudio: {
        customId = Interactions.ModalSubmitStartPlexImportAudio;
        break;
      }
      case Interactions.ButtonManagePlexVideo: {
        customId = Interactions.ModalSubmitStartPlexImportVideo;
        break;
      }
      default: {
        throw new Error("Unhandled listener id");
      }
    }

    showMetadataModal({ customId, interaction, listener, modalLabel: "Import" })
      .then(() => Utilities.LogPresets.ShowedModal(interaction, listener))
      .catch(error => logger.error(error, listener));
  }
}

/**
 * Send an embed reply containing link details and audio / video download components.
 * @param {object} param
 * @param {Listener} param.listener
 * @param {Message} param.message
 */
export async function onEventMessageCreate({ listener, message }) {
  if (!checkValidMessage(message)) return;

  const waitingReaction = await message.react("⌛");
  let downloadCache;

  try {
    downloadCache = await fetchDownloadCache(message);
    waitingReaction.users.remove().catch(error => logger.error(error, listener));
  }
  catch(e) {
    await waitingReaction.users.remove();
    const errorReaction = await message.react("❌");
    await setTimeout(2500);
    await errorReaction.users.remove();
    throw e;
  }

  // ---------------- //
  // create the embed //
  // ---------------- //

  const embeds = [new EmbedBuilder()];
  embeds[0].setAuthor({ name: downloadCache.uploader });
  embeds[0].setColor(message.embeds[0].data.color || 0);
  embeds[0].setThumbnail(message.embeds[0].data.thumbnail.url);
  embeds[0].setTitle(`${Utilities.getTruncatedStringTerminatedByWord(downloadCache.title, 42)} (${Utilities.getShortTimestamp(downloadCache.endTime)})`);
  embeds[0].setURL(downloadCache.cleanLink);

  if (downloadCache.description) {
    const value = `\`\`\`${downloadCache.cleanDescriptionPreview}\`\`\``;
    embeds[0].addFields({ name: "Description", value });
  }

  if (downloadCache.videoFormats.length) {
    const value = downloadCache.videoFormats.map(item => `\`${item.value}p\``).join(" ");
    embeds[0].addFields({ name: "Resolutions", value });
  }

  if (downloadCache.segments.length) {
    const value = `Skippable ${downloadCache.segments.map(item => item.title).join(" and ")} audio was found.`;
    embeds[0].addFields({ name: "Segments", value: value });
  }

  if (downloadCache.chapters.length) {
    const value = `${downloadCache.chapters.length} ${Utilities.getPluralizedString("timestamp", downloadCache.chapters)} were found in the description.`;
    embeds[0].addFields({ name: "Chapters", value });
  }

  // ---------------------- //
  // build the embed footer //
  // ---------------------- //

  if (downloadCache.uploadDate) {
    logger.debug(`downloadCache.uploadDate: ${downloadCache.uploadDate}`);
    const parse = date.parse(downloadCache.uploadDate.split("T")[0], "YYYYMMDD");
    embeds[0].setFooter({ text: `Uploaded ${date.format(parse, "MMMM DDD YYYY")}` });
  }

  if (downloadCache.views) {
    let footer = embeds[0].data.footer.text;
    if (footer) footer += " • ";
    const viewsLabel = Utilities.getPluralizedString("view", downloadCache.views);
    embeds[0].setFooter({ text: `${footer}${Utilities.getCompactNumber(downloadCache.views)} ${viewsLabel}` });
  }

  if (downloadCache.likes) {
    let footer = embeds[0].data.footer.text;
    if (footer) footer += " • ";
    const likesLabel = Utilities.getPluralizedString("like", downloadCache.likes);
    embeds[0].setFooter({ text: `${footer}${Utilities.getCompactNumber(downloadCache.likes)} ${likesLabel}` });
  }

  // -------------------- //
  // build the components //
  // -------------------- //

  const components = [new ActionRowBuilder()];
  components[0].addComponents(buttonDownloadAudio, buttonDownloadVideo, Emitter.moreInfoButton);
  components[0].components[1].setDisabled(!downloadCache.videoFormats.length);

  // ---------------------- //
  // send the embed message //
  // ---------------------- //

  if (Utilities.checkAllowedThreadCreate(message)) {
    const clientOptions = { removeMembers: true };
    const threadOptions = { name: Utilities.getTruncatedStringTerminatedByChar(`📲 Download • ${downloadCache.title}`, 100) };
    const threadChannel = await Utilities.getOrCreateThreadChannel({ message, clientOptions, threadOptions });

    threadChannel
      .send({ components, embeds })
      .then(result => Utilities.LogPresets.SentMessage(result, listener))
      .catch(error => logger.error(error, listener));
  }

  else {
    message
      .reply({ components, embeds })
      .then(result => Utilities.LogPresets.SentReply(result, listener))
      .catch(error => logger.error(error, listener));
  }
}

/**
 * On download modal submission, replace the 'Download' button with the 'Downloading...' button. Then invoke the download and file upload methods.
 * @throws `Unexpected contentType`
 * @param {object} param
 * @param {string} param.contentType
 * @param {ModalSubmitInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onModalSubmitStartDownload({ interaction, listener }) {
  await interaction.deferUpdate();

  const downloadCache = await fetchDownloadCache(interaction);
  const downloadConfig = await fetchDownloadConfig(interaction);

  const isInputValidated =
    await validateInputTimestamps({ downloadCache, interaction, listener });

  if (!isInputValidated) return;

  const components = [];
  let downloadButton;

  switch(listener.id) {
    case Interactions.ModalSubmitStartDownloadAudio:
    case Interactions.ModalSubmitStartPlexImportAudio: {
      components.push(new ActionRowBuilder().addComponents(getSelectMenuAudioFormat(downloadConfig.audioFileFormat).setDisabled(true)));
      components.push(new ActionRowBuilder().addComponents(getSelectMenuAudioFade(downloadConfig.audioFadeDuration).setDisabled(true)));
      components.push(new ActionRowBuilder().addComponents(buttonDownloading, buttonManagePlexAudio, Emitter.moreInfoButton));
      downloadButton = buttonStartDownloadAudio;
      break;
    }
    case Interactions.ModalSubmitStartDownloadVideo:
    case Interactions.ModalSubmitStartPlexImportVideo: {
      components.push(new ActionRowBuilder().addComponents(getSelectMenuVideoFormat(downloadConfig.videoFileFormat).setDisabled(true)));
      components.push(new ActionRowBuilder().addComponents(getSelectMenuVideoResolution(downloadCache.videoFormats, downloadConfig.videoResolution).setDisabled(true)));
      components.push(new ActionRowBuilder().addComponents(buttonDownloading, buttonManagePlexVideo, Emitter.moreInfoButton));
      downloadButton = buttonStartDownloadVideo;
      break;
    }
    default: {
      throw new Error(`Unexpected listener id "${listener.id}"`);
    }
  }

  const reply = await interaction.editReply({ components, fetchReply: true });
  Utilities.LogPresets.EditedReply(reply, listener);

  try {
    const callback = callbackUploadDiscordFile;
    await downloadLinkAndExecuteCallback({ callback, interaction, listener });
  }
  finally {
    components[0].components[0].setDisabled(false);
    components[1].components[0].setDisabled(false);
    components[2].components[0] = downloadButton;

    interaction
      .editReply({ components, fetchReply: true })
      .then(result => Utilities.LogPresets.EditedReply(result, listener))
      .catch(error => logger.error(error, listener));
  }
}

/**
 * On import modal submission, replace the 'Import' button with the 'Importing file...' button. Then invoke the download and import methods.
 * @throws `Unexpected contentType`
 * @param {object} param
 * @param {string} param.contentType
 * @param {ModalSubmitInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onModalSubmitStartPlexImport({ interaction, listener }) {
  const downloadCache = await fetchDownloadCache(interaction);
  const downloadConfig = await fetchDownloadConfig(interaction);

  const isValidInput = await validateInputTimestamps({ downloadCache, interaction, listener });
  if (!isValidInput) return;

  let directory;

  switch(listener.id) {
    case Interactions.ModalSubmitStartPlexImportAudio: {
      directory = config.plex_download_directory_audio;
      break;
    }
    case Interactions.ModalSubmitStartPlexImportVideo: {
      directory = config.plex_download_directory_video;
      break;
    }
    default: {
      throw new Error(`Unexpected listener id "${listener.id}"`);
    }
  }

  let filenames = getExistingPlexFilenames(directory, downloadCache);

  if (filenames.length) {
    // existing files, edit reply
    await interaction.deferUpdate();
  }
  else {
    // new reply, defer and dont edit
    await interaction.deferReply({ ephemeral: true });
  }

  const components = [];

  let isDisabled = filenames.length
    ? interaction.message.components[1]?.components[1].disabled : true;

  switch(listener.id) {
    case Interactions.ModalSubmitStartPlexImportAudio: {
      const customId = Interactions.SelectMenuPlexFilesAudio;
      const selectMenu = getSelectMenuPlexFiles(customId, downloadCache, filenames, listener, downloadConfig.plexFileIndex);
      components.push(new ActionRowBuilder().addComponents(selectMenu.setDisabled(true)));
      components.push(new ActionRowBuilder().addComponents(buttonImportingFile, buttonPlexDeleteFileAudio, Emitter.moreInfoButton));
      break;
    }
    case Interactions.ModalSubmitStartPlexImportVideo: {
      const customId = Interactions.SelectMenuPlexFilesVideo;
      const selectMenu = getSelectMenuPlexFiles(customId, downloadCache, filenames, listener, downloadConfig.plexFileIndex);
      components.push(new ActionRowBuilder().addComponents(selectMenu.setDisabled(true)));
      components.push(new ActionRowBuilder().addComponents(buttonImportingFile, buttonPlexDeleteFileVideo, Emitter.moreInfoButton));
      break;
    }
    default: {
      throw new Error(`Unexpected listener id "${listener.id}"`);
    }
  }

  if (filenames.length) {
    const reply = await interaction.editReply({ components, fetchReply: true });
    Utilities.LogPresets.EditedReply(reply, listener);
  }

  let content;

  try {
    switch(listener.id) {
      case Interactions.ModalSubmitStartPlexImportAudio: {
        const callback = callbackImportPlexFileAudio;
        await downloadLinkAndExecuteCallback({ callback, interaction, listener });
        break;
      }
      case Interactions.ModalSubmitStartPlexImportVideo: {
        const callback = callbackImportPlexFileVideo;
        await downloadLinkAndExecuteCallback({ callback, interaction, listener });
        break;
      }
    }
  }
  finally {
    switch(listener.id) {
      case Interactions.ModalSubmitStartPlexImportAudio: {
        const customId = Interactions.SelectMenuPlexFilesAudio;
        const directory = config.plex_download_directory_audio;
        const filenames = getExistingPlexFilenames(directory, downloadCache);
        content = getManagePlexContent("audio", filenames.length);
        components[0].components[0] = getSelectMenuPlexFiles(customId, downloadCache, filenames, listener, downloadConfig.plexFileIndex);
        components[1].components[0] = buttonPlexStartImportAudio;
        break;
      }
      case Interactions.ModalSubmitStartPlexImportVideo: {
        const customId = Interactions.SelectMenuPlexFilesVideo;
        const directory = config.plex_download_directory_video;
        const filenames = getExistingPlexFilenames(directory, downloadCache);
        content = getManagePlexContent("video", filenames.length);
        components[0].components[0] = getSelectMenuPlexFiles(customId, downloadCache, filenames, listener, downloadConfig.plexFileIndex);
        components[1].components[0] = buttonPlexStartImportVideo;
        break;
      }
    }

    components[1].components[1].setDisabled(isDisabled);
    components[1].components[1].setStyle(isDisabled ? ButtonStyle.Secondary : ButtonStyle.Danger);

    interaction
      .editReply({ components, content, fetchReply: true })
      .then(result => Utilities.LogPresets.EditedReply(result, listener))
      .catch(error => logger.error(error, listener));
  }
}

/**
 * Set the selected file format on the MediaDownloadConfig object.
 * @throws `Unexpected contentType`
 * @param {object} param
 * @param {string} param.contentType
 * @param {StringSelectMenuInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onSelectMenuFileFormat({ contentType, interaction, listener }) {
  let key;

  switch(contentType) {
    case contentTypes.audio: key = "audioFileFormat"; break;
    case contentTypes.video: key = "videoFileFormat"; break;
    default: throw new Error(`Unexpected contentType "${contentType}"`);
  }

  await interaction.deferUpdate();
  await fetchDownloadConfig(interaction).then(item => item[key] = interaction.values[0]);
  Utilities.LogPresets.DebugSetValue(key, interaction.values[0], listener);
}

/**
 * Set the selected Plex filename on the MediaDownloadConfig object.
 * @throws `Unexpected contentType`
 * @param {object} param
 * @param {string} param.contentType
 * @param {StringSelectMenuInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onSelectMenuPlexFiles({ interaction, listener }) {
  await interaction.deferUpdate();

  const downloadCache = await fetchDownloadCache(interaction);
  const downloadConfig = await fetchDownloadConfig(interaction);

  downloadConfig.plexFileIndex = Number(interaction.values[0]);
  Utilities.LogPresets.DebugSetValue("plexFileIndex", interaction.values[0], listener);

  let customId;
  let filenames;

  switch (listener.id) {
    case Interactions.SelectMenuPlexFilesAudio: {
      customId = Interactions.SelectMenuPlexFilesAudio;
      const directory = config.plex_download_directory_audio;
      filenames = getExistingPlexFilenames(directory, downloadCache);
      break;
    }
    case Interactions.SelectMenuPlexFilesVideo: {
      customId = Interactions.SelectMenuPlexFilesVideo;
      const directory = config.plex_download_directory_video;
      filenames = getExistingPlexFilenames(directory, downloadCache);
      break;
    }
    default: {
      throw new Error(`Unexpected listener.id "${listener.id}"`);
    }
  }

  const actionRow1 = new ActionRowBuilder().addComponents(getSelectMenuPlexFiles(customId, downloadCache, filenames, listener, downloadConfig.plexFileIndex));
  const actionRow2 = ActionRowBuilder.from(interaction.message.components[1]);

  actionRow2.components[1].setDisabled(!interaction.values.length);
  actionRow2.components[1].setStyle(interaction.values.length ? ButtonStyle.Danger : ButtonStyle.Secondary);

  interaction
    .editReply({ components: [actionRow1, actionRow2], fetchReply: true })
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));
}

/**
 * Store the selected chapter indexes.
 * @param {object} param
 * @param {BaseInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onSelectMenuSelectChapters({ interaction, listener }) {
  await interaction.deferUpdate();
  const values = interaction.values.map(i => Number(i)).sort();
  selectedChapters.set(interaction.message.id, values);
  Utilities.LogPresets.DebugSetValue("selectedChapters", values, listener);
}

/**
 * Set the video resolution on the MediaDownloadConfig object.
 * @param {object} param
 * @param {StringSelectMenuInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onSelectMenuVideoResolution({ interaction, listener }) {
  await interaction.deferUpdate();
  await fetchDownloadConfig(interaction).then(item => item.videoResolution = interaction.values[0]);
  Utilities.LogPresets.DebugSetValue("videoResolution", interaction.values[0], listener);
}

/**
 * Set the volume fade on the MediaDownloadConfig object.
 * @param {object} param
 * @param {StringSelectMenuInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onSelectMenuVolumeFade({ interaction, listener }) {
  await interaction.deferUpdate();
  await fetchDownloadConfig(interaction).then(item => item.audioFadeDuration = Number(interaction.values[0]));
  Utilities.LogPresets.DebugSetValue("audioFadeDuration", interaction.values[0], listener);
}

/**
 * Send the message with the 'Select Chapters' button. Includes a select menu
 * to select none or many chapters found within the contents description.
 * @param {MediaDownloadCache} downloadCache
 * @param {BaseInteraction} interaction
 * @param {Listener} listener
 */
export function sendSelectChaptersMessage(downloadCache, interaction, listener) {
  let buttons = [buttonSelectAllChapters, Emitter.moreInfoButton];

  switch(listener.id) {
    case Interactions.ButtonDownloadAudio: {
      buttons.unshift(buttonContinueChaptersAudio)
      break;
    }
    case Interactions.ButtonDownloadVideo: {
      buttons.unshift(buttonContinueChaptersVideo)
      break;
    }
    default: {
      throw new Error(`Unexpected listener.id "${listener.id}"`);
    }
  }

  const selectMenu = getSelectMenuChapterSelect(downloadCache);
  const actionRow1 = new ActionRowBuilder().addComponents(selectMenu);
  const actionRow2 = new ActionRowBuilder().addComponents(...buttons);

  const components = [actionRow1, actionRow2];
  let content = `I found ${downloadCache.chapters.length} chapters as timestamps in the description. You may select one or more chapters to download them as separate files. Selecting no chapters will download your entire content as one file.`;
  if (downloadCache.chapters.length > 25) content += ` Only the first 25 chapters are shown due to Discord limitations, but all ${downloadCache.chapters.length} chapters will be downloadable when selecting all chapters.`;
  content += " Press continue when you are ready.";

  interaction
    .followUp({ content, components, ephemeral: true, fetchReply: true })
    .then(result => Utilities.LogPresets.SentFollowUp(result, listener))
    .catch(error => logger.error(error, listener));
}

/**
 * Send the message with the 'Start Download' button. Includes select menus for the download options.
 * @param {MediaDownloadCache} downloadCache
 * @param {BaseInteraction} interaction
 * @param {Listener} listener
 */
export function sendStartDownloadMessage(downloadCache, interaction, listener) {
  const downloadConfig = new MediaDownloadConfig();
  downloadConfig.cacheKey = downloadCache.cleanLink;
  downloadConfig.chapterIndex = downloadCache.chapterIndex;

  let actionRow1;
  let actionRow2;
  let actionRow3;

  switch(listener.id) {
    case Interactions.ButtonContinueChaptersAudio:
    case Interactions.ButtonDownloadAudio: {
      actionRow1 = new ActionRowBuilder().addComponents(getSelectMenuAudioFormat(downloadConfig.audioFileFormat));
      actionRow2 = new ActionRowBuilder().addComponents(getSelectMenuAudioFade(downloadConfig.audioFadeDuration));
      actionRow3 = new ActionRowBuilder().addComponents(buttonStartDownloadAudio, buttonManagePlexAudio, Emitter.moreInfoButton);
      break;
    }
    case Interactions.ButtonContinueChaptersVideo:
    case Interactions.ButtonDownloadVideo: {
      actionRow1 = new ActionRowBuilder().addComponents(getSelectMenuVideoFormat(downloadConfig.videoFileFormat));
      actionRow2 = new ActionRowBuilder().addComponents(getSelectMenuVideoResolution(downloadCache.videoFormats, downloadConfig.videoResolution));
      actionRow3 = new ActionRowBuilder().addComponents(buttonStartDownloadVideo, buttonManagePlexVideo, Emitter.moreInfoButton);
      break;
    }
    default: {
      throw new Error(`Unexpected listener.id "${listener.id}"`);
    }
  }

  const contentEndTime = Utilities.getShortTimestamp(downloadCache.endTime);
  const contentStartTime = Utilities.getShortTimestamp(downloadCache.startTime);
  const contentTitle = Utilities.getTruncatedStringTerminatedByWord(downloadCache.title, 42);

  let contentLink = downloadCache.cleanLink;
  const startTimeAsSeconds = Utilities.getTimestampAsTotalSeconds(downloadCache.startTime);
  if (startTimeAsSeconds && checkYoutubeLink(downloadCache.cleanLink)) contentLink += `&t=${startTimeAsSeconds}s`;

  const components = [actionRow1, actionRow2, actionRow3];
  const content = `- [**${contentTitle}** (${contentStartTime}-${contentEndTime})](<${contentLink}>)`;

  interaction.followUp({ components, content, ephemeral: true, fetchReply: true })
    .then(result => {
      Utilities.LogPresets.SentReply(result, listener);
      mediaDownloadConfigs.set(result.id, downloadConfig);
    })
    .catch(error => logger.error(error, listener));
}

/**
 * Show the metadata modal for the media download or import.
 * @param {object} param
 * @param {string} param.customId
 * @param {BaseInteraction} param.interaction
 * @param {Listener} param.listener
 * @param {string} param.modalLabel
 */
export async function showMetadataModal({ customId, interaction, listener, modalLabel }) {
  const downloadConfig = await fetchDownloadConfig(interaction);

  let downloadCache = await fetchDownloadCache(interaction);
  downloadCache = downloadCache.chapters[downloadConfig.chapterIndex] ?? downloadCache;

  let fileFormat;
  let isAudioFormat;

  switch(listener.id) {
    case Interactions.ButtonManagePlexAudio:
    case Interactions.ButtonPlexStartImportAudio:
    case Interactions.ButtonStartDownloadAudio: {
      fileFormat = downloadConfig.audioFileFormat;
      isAudioFormat = true;
      break;
    }
    case Interactions.ButtonManagePlexVideo:
    case Interactions.ButtonPlexStartImportVideo:
    case Interactions.ButtonStartDownloadVideo: {
      fileFormat = downloadConfig.videoFileFormat;
      isAudioFormat = false;
      break;
    }
    default: {
      throw new Error(`Unexpected listener.id "${listener.id}"`);
    }
  }

  const startTime = isAudioFormat && downloadCache.chapterIndex === -1 && downloadCache.segments.some(item => item.title === "intro")
    ? Utilities.getShortTimestamp(downloadCache.segments.find(item => item.title === "intro").endTime)
    : Utilities.getShortTimestamp(downloadCache.startTime);

  const endTime = isAudioFormat && downloadCache.chapterIndex === -1 && downloadCache.segments.some(item => item.title === "outro")
    ? Utilities.getShortTimestamp(downloadCache.segments.find(item => item.title === "outro").startTime)
    : Utilities.getShortTimestamp(downloadCache.endTime);

  const [titleValue, artistValue] = downloadCache.trackTitleArtistValues;
  const genre = downloadCache.genre ?? randomItem(exampleMusicGenres);

  const components = [
    new ActionRowBuilder().addComponents(getTextInputTitle(titleValue)),
    new ActionRowBuilder().addComponents(getTextInputArtist(artistValue)),
    new ActionRowBuilder().addComponents(getTextInputStartTime(startTime)),
    new ActionRowBuilder().addComponents(getTextInputEndTime(endTime)),
    new ActionRowBuilder().addComponents(getTextInputGenre(genre, !downloadCache.genre)),
  ]

  const modal = new ModalBuilder()
    .addComponents(...components)
    .setCustomId(customId)
    .setTitle(`${modalLabel} ${fileFormat.toUpperCase()} file`);

  interaction
    .showModal(modal)
    .then(() => Utilities.LogPresets.ShowedModal(interaction, listener))
    .catch(error => logger.error(error, listener));
}

/**
 * Fetch the Plex API and request the media library scans for file changes.
 * TODO: Library is for audio, should add a video library too...
 */
async function startPlexAudioLibraryScan() {
  const address = `http://${config.plex_media_server_host_url}/library/sections/${config.plex_library_section_id_audio}/refresh`;
  const options = { headers: { "X-Plex-Token": config.plex_authentication_token }, method: "GET" };
  await fetch(address, options);
  logger.info("Started Plex library scan");
}

/**
 * Validate the inputted timestamps and reply to the interaction with any errors.
 * @param {object} param
 * @param {MediaDownloadCache} param.downloadCache
 * @param {BaseInteraction} param.interaction
 * @param {Listener} param.listener
 * @returns {Promise<boolean>}
 */
export async function validateInputTimestamps({ downloadCache, interaction, listener }) {
  const inputEndTime = interaction.fields.getTextInputValue("end")?.trim();
  const inputStartTime = interaction.fields.getTextInputValue("start")?.trim();

  if (!Utilities.checkValidTimestamp(inputStartTime)) {
    const content = `Start time \`${inputStartTime}\` isn't a valid timestamp. Please try again.`;
    interaction
      .followUp({ content, ephemeral: true, fetchReply: true })
      .then(result => Utilities.LogPresets.SentFollowUp(result, listener))
      .catch(error => logger.error(error, listener));
    return false;
  }

  if (!Utilities.checkValidTimestamp(inputEndTime)) {
    const content = `End time \`${inputEndTime}\` isn't a valid timestamp. Please try again.`;
    interaction
      .followUp({ content, ephemeral: true, fetchReply: true })
      .then(result => Utilities.LogPresets.SentFollowUp(result, listener))
      .catch(error => logger.error(error, listener));
    return false;
  }

  const cacheEndTimeTotalSeconds = Utilities.getTimestampAsTotalSeconds(downloadCache.endTime);
  const inputEndTimeTotalSeconds = Utilities.getTimestampAsTotalSeconds(inputEndTime);
  const inputStartTimeTotalSeconds = Utilities.getTimestampAsTotalSeconds(inputStartTime);

  if (inputEndTimeTotalSeconds > cacheEndTimeTotalSeconds) {
    const content = `End time \`${inputEndTime}\` exceeds \`${Utilities.getShortTimestamp(downloadCache.endTime)}\` duration. Please try again.`;
    interaction
      .followUp({ content, ephemeral: true, fetchReply: true })
      .then(result => Utilities.LogPresets.SentFollowUp(result, listener))
      .catch(error => logger.error(error, listener));
    return false;
  }

  if (inputStartTimeTotalSeconds >= inputEndTimeTotalSeconds) {
    const content = `Start time \`${inputStartTime}\` can't exceed end time \`${inputEndTime}\`. Please try again.`;
    interaction
      .followUp({ content, ephemeral: true, fetchReply: true })
      .then(result => Utilities.LogPresets.SentFollowUp(result, listener))
      .catch(error => logger.error(error, listener));
    return false;
  }

  return true;
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN LOGIC                                                   //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
