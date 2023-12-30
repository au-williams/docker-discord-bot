import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { Cron } from "croner";
import { findChannelMessage, getChannelMessages } from "../index.js";
import { Logger } from "../logger.js";
import { parse, resolve } from "path";
import * as oembed from "@extractus/oembed-extractor";
import date from "date-and-time";
import fs from "fs-extra";
import sanitize from "sanitize-filename";
import youtubedl from "youtube-dl-exec";

const {
  plex_channel_id, plex_directory, plex_emoji, plex_user_role_id,
  plex_section_id, plex_server_ip, plex_x_token, temp_directory
} = fs.readJsonSync("components/plex_music_downloader_config.json");

// ----------------------- //
// Interaction definitions //
// ----------------------- //

const BUSY_INTERACTIONS = new Set();
const addBusyInteraction = ({ componentCustomId, messageId, userId }) => BUSY_INTERACTIONS.add(`${componentCustomId}${messageId}${userId}`);
const endBusyInteraction = ({ componentCustomId, messageId, userId }) => BUSY_INTERACTIONS.delete(`${componentCustomId}${messageId}${userId}`);
const hasBusyInteraction = ({ componentCustomId, messageId, userId }) => BUSY_INTERACTIONS.has(`${componentCustomId}${messageId}${userId}`);

export const COMPONENT_INTERACTIONS = [
  {
    customId: "DOWNLOAD_MP3_BUTTON",
    onInteractionCreate: ({ interaction }) => showMetadataModal({ interaction, modalCustomId: "DOWNLOAD_MP3_MODAL", modalTitle: "Download MP3" })
  },
  {
    customId: "DOWNLOAD_MP3_MODAL",
    onInteractionCreate: ({ interaction }) => uploadMp3ToThread({ interaction })
  },
  {
    customId: "IMPORT_INTO_PLEX_BUTTON",
    onInteractionCreate: ({ interaction }) => showMetadataModal({ interaction, modalCustomId: "IMPORT_INTO_PLEX_MODAL", modalTitle: "Import into Plex" }),
    requiredRoleIds: [plex_user_role_id]
  },
  {
    customId: "IMPORT_INTO_PLEX_MODAL",
    onInteractionCreate: ({ interaction }) => importLinkIntoPlex({ interaction }),
    requiredRoleIds: [plex_user_role_id]
  },
  {
    customId: "DELETE_FROM_PLEX_BUTTON",
    onInteractionCreate: ({ interaction }) => showDeletionModal({ interaction, modalCustomId: "DELETE_FROM_PLEX_MODAL", modalTitle: "Delete from Plex" }),
    requiredRoleIds: [plex_user_role_id]
  },
  {
    customId: "DELETE_FROM_PLEX_MODAL",
    onInteractionCreate: ({ interaction }) => deleteLinkFromPlex({ interaction }),
    requiredRoleIds: [plex_user_role_id]
  }
]

// ---------------------- //
// Discord event handlers //
// ---------------------- //

export const onClientReady = async () => {
  const onError = ({ stack }) => Logger.Error(stack, "plex_music_downloader_script.js");
  Cron("0 * * * *", { catch: onError }, async job => {
    Logger.Info(`Triggered job pattern "${job.getPattern()}"`);
    const channelMessages = await getChannelMessages(plex_channel_id);

    for (let i = channelMessages.length - 1; i >= 0; i--) {
      const starterMessage = channelMessages[i];
      let threadChannel = starterMessage.hasThread && starterMessage.thread;

      const link = getLinkFromMessage(starterMessage);
      const isLinkSupported = await getIsLinkSupported(link);
      if (!isLinkSupported && threadChannel) await threadChannel.delete();
      if (!isLinkSupported) continue;

      const isThreadObsolete = threadChannel && threadChannel.name !== await getThreadChannelName(link);
      if (isThreadObsolete) threadChannel = await threadChannel.delete().then(() => null);

      if (!threadChannel)
        await createThreadChannel({ link, starterMessage });
      else
        await validatePlexButton(await findChannelMessage(threadChannel.id, message => {
          const componentType1 = message.components?.[0]?.components?.[0]?.type;
          const componentType2 = message.components?.[0]?.components?.[1]?.type;
          return ComponentType.Button === componentType1 && componentType1 === componentType2;
        }));
    }
    Logger.Info(`Scheduled next job on "${date.format(job.nextRun(), "YYYY-MM-DDTHH:mm")}"`);
  }).trigger();
};

export const onMessageCreate = async ({ client, message }) => {
  try {
    if (message.channel.id !== plex_channel_id) return;
    const link = getLinkFromMessage(message);
    const isLinkSupported = await getIsLinkSupported(link);
    if (isLinkSupported) await createThreadChannel({ client, link, starterMessage: message });
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

// ------------------- //
// Component functions //
// ------------------- //

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

async function deleteLinkFromPlex({ interaction }) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const interactionProperties = {
      componentCustomId: "DELETE_FROM_PLEX_MODAL",
      messageId: interaction.message.id,
      userId: interaction.user.id
    };

    if (hasBusyInteraction(interactionProperties)) return;
    else addBusyInteraction(interactionProperties);

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
    endBusyInteraction(interactionProperties);
  }
  catch(error) {
    Logger.Error(error.stack);
    await validatePlexButton(interaction.message);
    await interaction.editReply({ content: formatErrorMessage(error) });
  }
}

function formatErrorMessage(error) {
  return `Sorry! I caught an error while fetching this link:\n\`\`\`${error}\`\`\``;
}

const getCleanArtist = ({ author_name } = { author_name: "", title: "" }) => {
  let result = author_name;
  if (result.endsWith(" - Topic")) result = result.slice(0, -" - Topic".length)
  return result.trim();
}

const getCleanTitle = ({ author_name, title } = { author_name: "", title: "" }) => {
  let result = title;
  if (result.startsWith(`${author_name} - `)) result = result.slice(`${author_name} - `.length);
  if (result.endsWith(` by ${author_name}`)) result = result.slice(0, -` by ${author_name}`.length);
  return result.trim();
}

async function getExistingPlexFilename(link) {
  const filenameWithoutExtension = await youtubedl(link, {
    output: "%(uploader)s - %(title)s",
    print: "filename",
    skipDownload: true
  });

  return fs
    .readdirSync(plex_directory)
    .find(fn => parse(fn).name === sanitize(filenameWithoutExtension));
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

const getThreadChannelName = async (link) => {
  let title = "📲 " + getCleanTitle(await oembed.extract(link));
  if (title.length > 100) title = title.slice(0, 97) + "...";
  return title;
}

async function importLinkIntoPlex({ interaction }) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const interactionProperties = {
      componentCustomId: "IMPORT_INTO_PLEX_MODAL",
      messageId: interaction.message.id,
      userId: interaction.user.id
    };

    if (hasBusyInteraction(interactionProperties)) return;
    else addBusyInteraction(interactionProperties);

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
      const { customId, fields, user } = interaction;
      const tempDirectory = `${temp_directory}/${customId}${starterMessage.id}${user.id}`;
      const format = str => str.trim().replaceAll("'", "'\\''"); // escaped single quotes for ffmpeg

      const metadata = {
        artist: fields.getTextInputValue("artist"),
        genre: fields.getTextInputValue("genre"),
        title: fields.getTextInputValue("title")
      };

      await youtubedl(link, {
        audioQuality: 0,
        embedMetadata: true,
        extractAudio: true,
        format: "bestaudio/best",
        output: `${tempDirectory}/%(uploader)s - %(title)s.%(ext)s`,
        postprocessorArgs: "ffmpeg:"
          + " -metadata album='Downloads'"
          + " -metadata album_artist='Various Artists'"
          + " -metadata date=''"
          + " -metadata track=''"
          + (metadata?.artist && ` -metadata artist='${format(metadata.artist)}'`)
          + (metadata?.genre && ` -metadata genre='${format(metadata.genre)}'`)
          + (metadata?.title && ` -metadata title='${format(metadata.title)}'`)
      });

      const tempFilename = fs.readdirSync(tempDirectory)[0];
      const tempFilepath = resolve(`${tempDirectory}/${tempFilename}`);
      const plexFilepath = resolve(`${plex_directory}/${sanitize(tempFilename)}`);

      await fs.move(tempFilepath, plexFilepath);
      await fs.remove(tempDirectory).then(() => startPlexLibraryScan());
      await interaction.editReply("Success! Your file was imported into Plex.");
    }

    await validatePlexButton(interaction.message);
    endBusyInteraction(interactionProperties);
  }
  catch(error) {
    Logger.Error(error.stack);
    await validatePlexButton(interaction.message);
    await interaction.editReply({ content: formatErrorMessage(error) });
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

async function uploadMp3ToThread({ interaction }) {
  try {
    await interaction.deferReply({ ephemeral: true });
    const { customId, fields, message, user } = interaction;

    const interactionProperties = {
      componentCustomId: "DOWNLOAD_MP3_MODAL",
      messageId: message.id,
      userId: user.id
    };

    if (hasBusyInteraction(interactionProperties)) return;
    else addBusyInteraction(interactionProperties);

    const starterMessage = await message.channel.fetchStarterMessage();
    const link = await getLinkFromMessage(starterMessage);

    if (!await getIsLinkSupported(link)) {
      // log error
      return;
    }

    const metadata = {
      artist: fields.getTextInputValue("artist"),
      genre: fields.getTextInputValue("genre"),
      title: fields.getTextInputValue("title")
    }

    const onReject = async error => {
      Logger.Error(`Couldn't upload file to Discord: ${error}`);
      const content = `Sorry! I caught an error when uploading your file:\n\`\`\`${error}\`\`\``;
      await interaction.editReply(content);
    };

    const tempDirectory = `${temp_directory}/${customId}${message.id}${user.id}`;
    const ffmpegFormat = str => str.trim().replaceAll("'", "'\\''");

    const outputFilename = metadata.artist || metadata.title
      ? `${metadata.artist} - ${metadata.title}`
      : "%(uploader)s - %(title)s.%(ext)s";

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
        + (metadata?.artist && ` -metadata artist='${ffmpegFormat(metadata.artist)}'`)
        + (metadata?.genre && ` -metadata genre='${ffmpegFormat(metadata.genre)}'`)
        + (metadata?.title && ` -metadata title='${ffmpegFormat(metadata.title)}'`)
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
                .setValue(getCleanTitle({ author_name, title }))
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("artist")
                .setLabel("Track Artist")
                .setRequired(true)
                .setStyle(TextInputStyle.Short)
                .setValue(getCleanArtist({ author_name, title }))
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
