import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType, DMChannel, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { Cron } from "croner";
import { findChannelMessage, getChannelMessages } from "../index.js";
import { Logger } from "../logger.js";
import { resolve } from "path";
import * as oembed from "@extractus/oembed-extractor";
import AFHConvert from 'ascii-fullwidth-halfwidth-convert';
import date from "date-and-time";
import fs from "fs-extra";
import sanitize from "sanitize-filename";
import youtubedl from "youtube-dl-exec";

const asciiWidthConverter = new AFHConvert();

const {
  plex_channel_id, plex_directory, plex_emoji, plex_user_role_id,
  plex_section_id, plex_server_ip, plex_x_token, temp_directory
} = fs.readJsonSync("components/plex_music_downloader_config.json");

// ------------------------------------------------------------------------- //
// >> INTERACTION DEFINITIONS                                             << //
// ------------------------------------------------------------------------- //

/**
 * Define what interactions are busy so multiple clicks do not make multiple invocations
 */
const BUSY_INTERACTIONS = new Set();
const addBusyInteraction = ({ componentCustomId, messageId, userId }) => BUSY_INTERACTIONS.add(`${componentCustomId}${messageId}${userId}`);
const endBusyInteraction = ({ componentCustomId, messageId, userId }) => BUSY_INTERACTIONS.delete(`${componentCustomId}${messageId}${userId}`);
const hasBusyInteraction = ({ componentCustomId, messageId, userId }) => BUSY_INTERACTIONS.has(`${componentCustomId}${messageId}${userId}`);

/**
 * Define what functions and restrictions are invoked when a discord interaction is made
 */
export const COMPONENT_INTERACTIONS = [
  {
    customId: "DOWNLOAD_MP3_BUTTON",
    onInteractionCreate: ({ interaction }) => showMetadataModal({ interaction, modalCustomId: "DOWNLOAD_MP3_MODAL", modalTitle: "Download MP3" })
  },
  {
    customId: "DOWNLOAD_MP3_MODAL",
    onInteractionCreate: ({ interaction }) => uploadMp3ToThread(interaction)
  },
  {
    customId: "IMPORT_INTO_PLEX_BUTTON",
    onInteractionCreate: ({ interaction }) => showMetadataModal({ interaction, modalCustomId: "IMPORT_INTO_PLEX_MODAL", modalTitle: "Import into Plex" }),
    requiredRoleIds: [plex_user_role_id]
  },
  {
    customId: "IMPORT_INTO_PLEX_MODAL",
    onInteractionCreate: ({ interaction }) => importLinkIntoPlex(interaction),
    requiredRoleIds: [plex_user_role_id]
  },
  {
    customId: "DELETE_FROM_PLEX_BUTTON",
    onInteractionCreate: ({ interaction }) => showDeletionModal({ interaction, modalCustomId: "DELETE_FROM_PLEX_MODAL", modalTitle: "Delete from Plex" }),
    requiredRoleIds: [plex_user_role_id]
  },
  {
    customId: "DELETE_FROM_PLEX_MODAL",
    onInteractionCreate: ({ interaction }) => deleteLinkFromPlex(interaction),
    requiredRoleIds: [plex_user_role_id]
  }
]

// ------------------------------------------------------------------------- //
// >> DISCORD EVENT HANDLERS                                              << //
// ------------------------------------------------------------------------- //

/**
 * Delete the associated thread when a message gets deleted
 * @param {{ client: Client }} client The Discord.js client
 * @param {{ message: Message }} message The deleted message
 */
export const onMessageDelete = async ({ client, message }) => {
  try {
    const isMessageChannelValid = getIsMessageChannelValid(message);
    if (!isMessageChannelValid) return;

    const channelMessage = await findChannelMessage(message.channel.id, ({ id }) => message.id === id);
    const isClientOwnedThread = message.hasThread && message.thread.ownerId === client.user.id;
    if (!isClientOwnedThread) return;

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

    for (const channelMessage of await getChannelMessages(plex_channel_id)) {
      let threadChannel = channelMessage.hasThread && channelMessage.thread;

      // get and validate the link from the channel message

      const link = getLinkFromMessage(channelMessage);
      const isLinkSupported = await getIsLinkSupported(link);

      // delete threads with unsupported links and continue
      // (these are typically deleted / unavailable videos)

      if (!isLinkSupported) {
        if (!threadChannel) continue;
        await threadChannel.delete();
        Logger.Info(`Deleted thread for message id "${channelMessage.id}" with invalid link`);
        continue;
      }

      // delete threads with obsolete metadata and recreate them
      // (these are typically links edited for different videos)

      if (threadChannel && threadChannel.name !== await getThreadChannelName(link)) {
        threadChannel = await threadChannel.delete().then(() => false);
        Logger.Info(`Deleted thread for message id "${channelMessage.id}" with obsolete info`);
      }

      if (!threadChannel) {
        // this function runs validatePlexButton() after creating the thread
        await createThreadChannel({ link, starterMessage: channelMessage });
      }
      else {
        const messageWithButtons = await findChannelMessage(threadChannel.id, getIsMessageWithButtons);
        await validatePlexButton(messageWithButtons);
      }
    }

    Logger.Info(`Scheduled next job on "${date.format(job.nextRun(), "YYYY-MM-DDTHH:mm")}"`);
  }).trigger();
};

export const onMessageCreate = async ({ client, message }) => {
  try {
    const isMessageChannelValid = getIsMessageChannelValid(message);
    if (!isMessageChannelValid) return;

    const reaction = await message.react('⌛');
    const link = getLinkFromMessage(message);
    const isLinkSupported = await getIsLinkSupported(link);
    await reaction.remove();

    if (!isLinkSupported) return;
    await createThreadChannel({ client, link, starterMessage: message });
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

// ------------------------------------------------------------------------- //
// >> DISCORD EVENT HANDLERS                                              << //
// ------------------------------------------------------------------------- //

async function createThreadChannel({ link, starterMessage }) {
  const name = await getThreadChannelName(link);
  const thread = await starterMessage.startThread({ name });
  await thread.members.remove(starterMessage.author.id);

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("DOWNLOAD_MP3_BUTTON")
        .setEmoji("📲")
        .setLabel("Download as MP3")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("NULL")
        .setDisabled(true)
        .setEmoji("⏳")
        .setLabel("Searching in Plex")
        .setStyle(ButtonStyle.Secondary)
    )
  ];

  const content = "Click here to download this music to your device.";
  const threadMessage = await thread.send({ components, content });
  await validatePlexButton(threadMessage);
  return threadMessage;
}

async function deleteLinkFromPlex(interaction) {
  const interactionProperties = {
    componentCustomId: "DELETE_FROM_PLEX_MODAL",
    messageId: interaction.message.id,
    userId: interaction.user.id
  };

  if (hasBusyInteraction(interactionProperties)) return;
  else addBusyInteraction(interactionProperties);

  try {
    await interaction.deferReply({ ephemeral: true });

    const starterMessage = await interaction.channel.fetchStarterMessage();
    const link = getLinkFromMessage(starterMessage);
    const existingPlexFilename = await getExistingPlexFilename(link);

    if (!existingPlexFilename) {
      await interaction.editReply(`Your file wasn't found in Plex.`);
      Logger.Warn(`Plex filename does not exist`);
    }
    else {
      await fs.remove(`${plex_directory}/${existingPlexFilename}`);
      Logger.Info(`Deleted file from Plex: "${existingPlexFilename}"`);
      await interaction.editReply("Your file was successfully deleted from Plex.");
      await startPlexLibraryScan();
    }

    await validatePlexButton(interaction.message);
  }
  catch(error) {
    Logger.Error(error.stack);
    await validatePlexButton(interaction.message);
    await interaction.editReply({ content: formatErrorMessage(error) });
  }
  finally {
    endBusyInteraction(interactionProperties);
  }
}

function formatErrorMessage(error) {
  return `Sorry! I caught an error when fetching this URL:\n\`\`\`${error}\`\`\``;
}

const getCleanMetadataArtist = (author_name = "") => {
  let result = author_name;
  if (result.endsWith(" - Topic")) result = result.slice(0, -" - Topic".length)
  return asciiWidthConverter.toHalfWidth(result.trim());
}

const getCleanMetadataTitle = (author_name = "", title = "") => {
  let result = title;
  if (result.startsWith(`${author_name.replace(" Official", "")} - `)) result = result.slice(`${author_name.replace(" Official", "")} - `.length);
  if (result.endsWith(` by ${author_name}`)) result = result.slice(0, -` by ${author_name}`.length);
  return asciiWidthConverter.toHalfWidth(result.trim());
}

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

function getLinkFromMessage({ content }) {
  const match = content.match(/(https?:\/\/[^&\s]+)/);
  return match ? match[1] : null;
}

const getIsLinkSupported = async (link) =>
  link && await getIsLinkSupportedOembed(link) && await getIsLinkSupportedYoutubeDl(link);

const getIsLinkSupportedOembed = async (link) =>
  link && await oembed.extract(link).then(() => true).catch(() => false);

const getIsLinkSupportedYoutubeDl = async (link) =>
  link && await youtubedl(link, { simulate: true }).then(() => true).catch(() => false);

const getIsMessageChannelValid = (message) => message.channel.id === plex_channel_id;

const getIsMessageWithButtons = message => {
  const componentType1 = message.components?.[0]?.components?.[0]?.type;
  const componentType2 = message.components?.[0]?.components?.[1]?.type;
  return ComponentType.Button === componentType1 && componentType1 === componentType2;
}

const getThreadChannelName = async (link) => {
  const { author_name: oembedAuthorName, title: oembedTitle } = await oembed.extract(link);
  let result = `📲 ${getCleanMetadataTitle(oembedAuthorName, oembedTitle)}`;
  if (result.length > 100) result = result.slice(0, 97) + "...";
  return result;
}

async function importLinkIntoPlex(interaction) {
  const interactionProperties = {
    componentCustomId: "IMPORT_INTO_PLEX_MODAL",
    messageId: interaction.message.id,
    userId: interaction.user.id
  };

  if (hasBusyInteraction(interactionProperties)) return;
  else addBusyInteraction(interactionProperties);

  try {
    await interaction.deferReply({ ephemeral: true });

    const starterMessage = await interaction.message.channel.fetchStarterMessage();
    const link = getLinkFromMessage(starterMessage);
    const existingPlexFilename = await getExistingPlexFilename(link);

    if (!await getIsLinkSupported(link)) {
      // todo: not valid link, reply formatted error
      return;
    }

    if (existingPlexFilename) {
      await interaction.editReply(`Your file was already imported into Plex!`);
      Logger.Warn(`Plex filename already exists: "${existingPlexFilename}"`);
    }
    else {
      const metadata = {
        artist: interaction.fields.getTextInputValue("artist"),
        genre: interaction.fields.getTextInputValue("genre"),
        title: interaction.fields.getTextInputValue("title")
      };

      const tempDirectory = `${temp_directory}/`
        + `${interaction.customId}_${interaction.message.id}_${interaction.user.id}`;

      const outputFilename = sanitizeFilename(metadata.artist + metadata.title
        ? `${metadata.artist} - ${metadata.title}`
        : "%(uploader)s - %(title)s"
      );

      await youtubedl(link, {
        audioQuality: 0,
        embedMetadata: true,
        extractAudio: true,
        format: "bestaudio/best",
        output: `${tempDirectory}/${outputFilename} - %(id)s.%(ext)s`,
        postprocessorArgs: "ffmpeg:"
          + " -metadata album='Downloads'"
          + " -metadata album_artist='Various Artists'"
          + " -metadata date=''"
          + " -metadata track=''"
          + (metadata?.artist ? ` -metadata artist='${sanitizeFfmpeg(metadata.artist)}'` : "")
          + (metadata?.genre ? ` -metadata genre='${sanitizeFfmpeg(metadata.genre)}'` : "")
          + (metadata?.title ? ` -metadata title='${sanitizeFfmpeg(metadata.title)}'` : "")
      });

      const tempFilename = fs.readdirSync(tempDirectory)[0];
      const tempFilepath = resolve(`${tempDirectory}/${tempFilename}`);
      const plexFilepath = resolve(`${plex_directory}/${sanitizeFilename(tempFilename)}`);

      await fs.move(tempFilepath, plexFilepath);
      await fs.remove(tempDirectory);
      await startPlexLibraryScan();
      await interaction.editReply("Success! Your file was imported into Plex.");
    }

    await validatePlexButton(interaction.message);
  }
  catch(error) {
    Logger.Error(error.stack);
    await validatePlexButton(interaction.message);
    await interaction.editReply({ content: formatErrorMessage(error) });
  }
  finally {
    endBusyInteraction(interactionProperties);
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
 * Sanitize a string for use in the command line version of ffmpeg
 * @param {string} str
 */
const sanitizeFfmpeg = str => str.trim().replaceAll("'", "'\\''");

/**
 * Sanitize a string for use as a filename in Windows or Linux
 * @param {str} str
 */
const sanitizeFilename = str => sanitize(str.replace(/[\/\\]/g, " ").replace(/  +/g, " "));

async function showDeletionModal({ interaction, modalCustomId, modalTitle }) {
  try {
    const interactionProperties = {
      componentCustomId: modalCustomId,
      messageId: interaction.message.id,
      userId: interaction.user.id
    };

    if (hasBusyInteraction(interactionProperties)) {
      await interaction.deferUpdate();
      return;
    }

    interaction.showModal(
      new ModalBuilder()
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("reason")
              .setLabel("Reason for deletion")
              .setRequired(true)
              .setStyle(TextInputStyle.Paragraph)
          )
        )
        .setCustomId(modalCustomId)
        .setTitle(modalTitle)
    );
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function showMetadataModal({ interaction, modalCustomId, modalTitle }) {
  try {
    const interactionProperties = {
      componentCustomId: modalCustomId,
      messageId: interaction.message.id,
      userId: interaction.user.id
    };

    if (hasBusyInteraction(interactionProperties)) {
      await interaction.deferUpdate();
      return;
    }

    const starterMessage = await interaction.channel.fetchStarterMessage();
    const link = await getLinkFromMessage(starterMessage);
    if (!link) return;

    const { author_name, title } = await oembed.extract(link).catch(async error => {
      Logger.Error(`Couldn't fetch oembed data: ${error}`);
      const content = formatErrorMessage(error);
      await interaction.reply({ content, ephemeral: true });
      endBusyInteraction(interactionProperties);
      return { author_name: null, title: null };
    });

    if (author_name === null && title === null) return;

    await interaction.showModal(
      new ModalBuilder()
        .addComponents(
          ...[
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("title")
                .setLabel("Track Title")
                .setRequired(true)
                .setStyle(TextInputStyle.Short)
                .setValue(getCleanMetadataTitle(author_name, title))
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("artist")
                .setLabel("Track Artist")
                .setRequired(true)
                .setStyle(TextInputStyle.Short)
                .setValue(getCleanMetadataArtist(author_name))
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("genre")
                .setLabel("Track Genre")
                .setPlaceholder("Genre (Optional)")
                .setRequired(false)
                .setStyle(TextInputStyle.Short)
            )
          ]
        )
        .setCustomId(modalCustomId)
        .setTitle(modalTitle)
    );
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

/**
 * Download the link from the interaction threads starter message and upload it to the thread as a MP3 file
 * @param {ButtonInteraction} interaction
 */
async function uploadMp3ToThread(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const interactionProperties = {
      componentCustomId: "DOWNLOAD_MP3_MODAL",
      messageId: interaction.message.id,
      userId: interaction.user.id
    };

    if (hasBusyInteraction(interactionProperties)) return;
    else addBusyInteraction(interactionProperties);

    const starterMessage = await interaction.message.channel.fetchStarterMessage();
    const link = await getLinkFromMessage(starterMessage);

    if (!await getIsLinkSupported(link)) {
      // log error
      return;
    }

    const metadata = {
      artist: interaction.fields.getTextInputValue("artist"),
      genre: interaction.fields.getTextInputValue("genre"),
      title: interaction.fields.getTextInputValue("title")
    }

    const onReject = async error => {
      Logger.Error(`Couldn't upload file to Discord: ${error}`);
      const content = `Sorry! I caught an error when uploading your file:\n\`\`\`${error}\`\`\``;
      await interaction.editReply(content);
      endBusyInteraction(interactionProperties);
    };

    const tempDirectory = `${temp_directory}/`
      + `${interaction.customId}_${interaction.message.id}_${interaction.user.id}`;

    const outputFilename = sanitizeFilename(metadata.artist || metadata.title
      ? `${metadata.artist} - ${metadata.title}`
      : "%(uploader)s - %(title)s"
    );

    await youtubedl(link, {
      audioFormat: "mp3",
      audioQuality: 0,
      embedMetadata: true,
      extractAudio: true,
      format: "bestaudio/best",
      output: `${tempDirectory}/${outputFilename}.%(ext)s`,
      postprocessorArgs: "ffmpeg:"
        + " -metadata album='Downloads'"
        + " -metadata album_artist='Various Artists'"
        + " -metadata date=''"
        + " -metadata track=''"
        + (metadata?.artist ? ` -metadata artist='${sanitizeFfmpeg(metadata.artist)}'` : "")
        + (metadata?.genre ? ` -metadata genre='${sanitizeFfmpeg(metadata.genre)}'` : "")
        + (metadata?.title ? ` -metadata title='${sanitizeFfmpeg(metadata.title)}'` : "")
    });

    const tempFilename = fs.readdirSync(tempDirectory)[0];
    const tempFilepath = resolve(`${tempDirectory}/${tempFilename}`);

    const files = [new AttachmentBuilder(tempFilepath, { name: tempFilename })];
    const reply = await interaction.editReply({ files }).catch(onReject);
    await fs.remove(tempDirectory);

    Logger.Info(`Uploaded "${reply.attachments.first().name}"`);
    endBusyInteraction(interactionProperties);
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

/**
 * Fetch the download filename and update the Plex button with the status of its existence in the Plex folder
 * @param {Message} message
 */
async function validatePlexButton(message) {
  if (!message.components?.length) {
    Logger.Warn("Tried to validate Plex button for thread message with no buttons");
    return;
  }

  const starterMessage = await message.channel.fetchStarterMessage();
  const link = await getLinkFromMessage(starterMessage);

  if (!link) {
    Logger.Warn("Tried to validate Plex button for starter message with no link");
    Logger.Warn(starterMessage);
    return;
  }

  const components = [ActionRowBuilder.from(message.components[0])];

  components[0].components[1]
    .setCustomId("NULL")
    .setDisabled(true)
    .setEmoji("⌛")
    .setLabel("Searching in Plex");

  const isArchived = message.channel.archived;
  if (isArchived) await message.channel.setArchived(false);
  await message.edit({ components });

  const isExistingPlexFile = await getExistingPlexFilename(link);

  components[0].components[1]
    .setCustomId(isExistingPlexFile ? "DELETE_FROM_PLEX_BUTTON" : "IMPORT_INTO_PLEX_BUTTON")
    .setDisabled(false)
    .setEmoji(plex_emoji)
    .setLabel(isExistingPlexFile ? "Delete from Plex" : "Import into Plex")

  await message.edit({ components });

  if (isArchived) await message.channel.setArchived(true);
}

// ------------------------------------------------------------------------- //
// >> DEAD CODE GRAVEYARD                                                 << //
// ------------------------------------------------------------------------- //

/* -------------------------------------------------------------------------- *
 * Separate code path for DMs because Discord does not support threads in DMs *
 * (it also doesn't support removing reactions the bot made, such a good API) *
 * -------------------------------------------------------------------------- */

  // const getIsMessageChannelValid = ({ client, message }) =>
  //   message.channel instanceof DMChannel && message.author.id !== client.user.id || message.channel.id === plex_channel_id;

  // await message.reactions.cache.get('⌛').remove();

  // const getIsLinkSupported = async () => {
  //   if (message.channel instanceof DMChannel) {
  //     // DMs do NOT allow removing reactions so send it as a message
  //     // (thanks discord - this design decision makes so much sense)
  //     const response = await message.reply('⌛');
  //     const isLinkSupported = await getIsLinkSupported(link);
  //     return await response.delete() && isLinkSupported;
  //   }
  //   else {
  //     // send busy indicator because reactions work like they should
  //     const reaction = await message.react('⌛');
  //     const isLinkSupported = await getIsLinkSupported(link);
  //     return await reaction.remove() && isLinkSupported;
  //   }
  // }

/* -------------------------------------------------------------------------- *
 * Query for all messages containing a specific link to keep them all in sync *
 * (this is already maintained through the CRON batch job so priority is low) *
 * -------------------------------------------------------------------------- */

  // find all channel messages with this link in case it was posted multiple times to keep all plex buttons in sync

  // const allChannelMessagesForLink =
  //   await filterChannelMessages(plex_channel_id, message => message.hasThread && getLinkFromMessage(message) === link);

  // const allMessagesWithButtonsForLink =
  //   allChannelMessagesForLink.map(async ({ thread }) => await findChannelMessage(thread.id, message => getIsMessageWithButtons(message)));

  // for await (const messageWithButtonsForLink of allMessagesWithButtonsForLink) {
  //   await validatePlexButton(messageWithButtonsForLink);
  // }