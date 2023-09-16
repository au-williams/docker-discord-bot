import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { basename, parse, resolve } from "path";
import { Logger } from "../logger.js";
import * as oembed from "@extractus/oembed-extractor";
import fs from "fs-extra";
import youtubedl from "youtube-dl-exec";

const {
  plex_channel_ids, plex_directory, plex_user_role_id,
  plex_section_id, plex_server_ip, plex_x_token, temp_directory
} = fs.readJsonSync("components/plex_music_downloader_config.json");

const BUSY_INTERACTIONS = new Set();
const addBusyInteraction = ({ componentCustomId, messageId, userId }) => BUSY_INTERACTIONS.add(`${componentCustomId}${messageId}${userId}`);
const hasBusyInteraction = ({ componentCustomId, messageId, userId }) => BUSY_INTERACTIONS.has(`${componentCustomId}${messageId}${userId}`);
const deleteBusyInteraction = ({ componentCustomId, messageId, userId }) => BUSY_INTERACTIONS.delete(`${componentCustomId}${messageId}${userId}`);

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
    onInteractionCreate: ({ interaction }) => importUrlIntoPlex({ interaction }),
    requiredRoleIds: [plex_user_role_id]
  },
  {
    customId: "REMOVE_FROM_PLEX_BUTTON",
    onInteractionCreate: ({ interaction }) => showRemovalModal({ interaction, customId: "REMOVE_FROM_PLEX_MODAL", modalTitle: "Remove from Plex" }),
    requiredRoleIds: [plex_user_role_id]
  },
  {
    customId: "REMOVE_FROM_PLEX_MODAL",
    onInteractionCreate: ({ interaction }) => removeUrlFromPlex({ interaction }),
    requiredRoleIds: [plex_user_role_id]
  }
]

export const onMessageCreate = async ({ message }) => {
  try {
    const isPlexChannel = plex_channel_ids.includes(message.channel.id);
    const url = isPlexChannel && getUrlFromString(message.content);
    if (!url) return;

    let name = "📲 " + getCleanTitle(await oembed.extract(url));
    if (name.length > 100) name = name.slice(0, 97) + "...";
    const { members } = await message.startThread({ name });
    await members.remove(message.author.id);

    const components = [getDownloadMessageRow()];
    const content = "Click here to download this music to your device.";
    const threadMessage = await message.thread.send({ components, content });

    // check if the file exists in plex and update the plex button to reflect the result
    // (we run this check last so the thread reply is instant and not waiting on yt-dlp)

    const { directory, filename } = await downloadUrl({ messageId: message.id, userId: message.author.id, url }).catch(() => {});
    const isPlexFile = filename && fs.existsSync(`${plex_directory}/${filename}`);
    components[0].components[1].setCustomId(isPlexFile ? "REMOVE_FROM_PLEX_BUTTON" : "IMPORT_INTO_PLEX_BUTTON");
    components[0].components[1].setDisabled(false);
    components[0].components[1].setEmoji("<:plex:1093751472522543214>");
    components[0].components[1].setLabel(isPlexFile ? "Remove from Plex" : "Import into Plex")
    threadMessage.edit({ components });
    fs.remove(directory);
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function importUrlIntoPlex({ interaction }) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const { customId, fields, message, user } = interaction;
    const components = [ActionRowBuilder.from(message.components[0])];
    components[0].components[1].setDisabled(true);
    message.edit({ components });

    const starterMessage = await message.channel.fetchStarterMessage();
    const url = getUrlFromString(starterMessage.content);

    const metadata = {
      artist: fields.getTextInputValue("artist"),
      genre: fields.getTextInputValue("genre"),
      title: fields.getTextInputValue("title")
    };

    const { directory, filename, filepath } = await downloadUrl({ messageId: starterMessage.id, customId, userId: user.id, metadata, url });
    const plexFilepath = `${plex_directory}/${filename}`;
    const isPlexFile = fs.existsSync(plexFilepath);

    if (isPlexFile) {
      fs.remove(directory);
      interaction.editReply(`Your file couldn't be imported into Plex because it already exists.`);
      Logger.Warn(`Couldn't import existing file into Plex\n⬛ "${filename}"`);
    }
    else {
      await fs.move(filepath, plexFilepath);
      fs.remove(directory).then(() => startPlexLibraryScan());
      interaction.editReply("Success! Your file was imported into Plex.");
      Logger.Info(`Successfully imported file into Plex\n⬛ "${filename}"`);
    }

    components[0].components[1].setDisabled(false);
    components[0].components[1].setCustomId("REMOVE_FROM_PLEX_BUTTON")
    components[0].components[1].setLabel("Remove from Plex");
    await message.edit({ components });
  }
  catch(error) {
    Logger.Error(error.stack);
    const { message } = interaction;
    const components = [ActionRowBuilder.from(message.components[0])];
    components[0].components[1].setDisabled(false);
    await message.edit({ components });
    await interaction.editReply({ content: getErrorMessage(error) });
  }
}

async function removeUrlFromPlex({ interaction }) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const { customId, fields, message, user } = interaction;
    const components = [ActionRowBuilder.from(message.components[0])];
    components[0].components[1].setDisabled(true);
    message.edit({ components });

    // --get-filename returns the pre-processed filename, which is NOT the resulting filename
    // download the file again for an exact value and silently weep over our performance loss

    const starterMessage = await message.channel.fetchStarterMessage();
    const url = getUrlFromString(starterMessage.content);

    const { directory, filename } = await downloadUrl({ customId, messageId: message.id, userId: user.id, url });
    const plexFilepath = `${plex_directory}/${filename}`;
    const isPlexFile = fs.existsSync(plexFilepath);
    fs.remove(directory);

    if (isPlexFile) {
      fs.removeSync(plexFilepath);
      startPlexLibraryScan();
      interaction.editReply("Your file was successfully removed from Plex.");
      Logger.Info(`Successfully removed file from Plex\n⬛ "${filename}"\n⬛ ${fields.getTextInputValue("reason")}`);
    }
    else {
      interaction.editReply(`Your file couldn't be removed from Plex because it wasn't found.`);
      Logger.Warn(`Couldn't remove non-existing file from Plex\n⬛ "${filename}"`);
    }

    components[0].components[1].setCustomId("IMPORT_INTO_PLEX_BUTTON");
    components[0].components[1].setDisabled(false);
    components[0].components[1].setLabel("Import into Plex");
    await message.edit({ components });
  }
  catch(error) {
    Logger.Error(error.stack);
    const { message } = interaction;
    const components = [ActionRowBuilder.from(message.components[0])];
    components[0].components[1].setDisabled(false);
    await message.edit({ components });
    await interaction.editReply({ content: getErrorMessage(error) });
  }
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
      componentCustomId: "DOWNLOAD_MP3_BUTTON",
      messageId: message.id,
      userId: user.id
    };

    if (hasBusyInteraction(interactionProperties)) return;
    else addBusyInteraction(interactionProperties);

    const starterMessage = await message.channel.fetchStarterMessage();
    const url = getUrlFromString(starterMessage.content);

    const metadata = {
      artist: fields.getTextInputValue("artist"),
      audioFormat: "mp3",
      genre: fields.getTextInputValue("genre"),
      renameFileOnComplete: true,
      title: fields.getTextInputValue("title")
    }

    const onReject = async error => {
      Logger.Error(`Couldn't upload file to Discord\n⬛ ${error}`);
      const content = `Sorry! I caught an error when uploading your file:\n\`\`\`${error}\`\`\``;
      await interaction.editReply(content);
    };

    const { directory, filename: name, filepath } = await downloadUrl({ customId, messageId: message.id, userId: user.id, metadata, url });
    const files = [new AttachmentBuilder(filepath, { name })];
    const reply = await interaction.editReply({ files }).catch(onReject);
    Logger.Info(`Uploaded "${reply.attachments.first().name}"`);
    fs.removeSync(directory);
    deleteBusyInteraction({ componentCustomId: "DOWNLOAD_MP3_BUTTON", messageId: message.id, userId: user.id });
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function showMetadataModal({ interaction, modalCustomId, modalTitle }) {
  try {
    if (hasBusyInteraction({
      componentCustomId: interaction.customId,
      messageId: interaction.message.id,
      userId: interaction.user.id
    })) {
      interaction.reply({ content: "Please wait for your MP3 file to finish uploading.", ephemeral: true });
      return;
    }

    const { content } = await interaction.message.channel.fetchStarterMessage();
    const url = getUrlFromString(content);
    if (!url) return;

    const { author_name, title } = await oembed.extract(url).catch(error => {
      Logger.Error(`Failed to fetch oEmbed data\n⬛ ${error}`);
      interaction.reply({ content: getErrorMessage(error), ephemeral: true });
      return { author_name: "", title: "" };
    })

    if (!author_name && !title) return;

    const modal = new ModalBuilder()
      .addComponents(...getMetadataModalRows({ author_name, title }))
      .setCustomId(modalCustomId)
      .setTitle(modalTitle)

    await interaction.showModal(modal);
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

function showRemovalModal({ customId, interaction, modalTitle }) {
  try {
    const components = new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Reason for removal")
        .setRequired(true)
        .setStyle(TextInputStyle.Paragraph)
      );

    const modal = new ModalBuilder()
      .addComponents(components)
      .setCustomId(customId)
      .setTitle(modalTitle);

    interaction.showModal(modal);
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function downloadUrl({ customId, messageId, userId, metadata, url }) {
  const directory = `${temp_directory}/${(customId ?? "")}${(messageId ?? "")}${(userId ?? "")}`;
  const format = str => str.trim().replaceAll("'", "'\\''"); // escaped single quotes for ffmpeg

  const postprocessorArgs =
    "ffmpeg:"
      + " -metadata album='Downloads'"
      + " -metadata album_artist='Various Artists'"
      + " -metadata date=''"
      + " -metadata track=''"
      + (metadata?.artist && ` -metadata artist='${format(metadata.artist)}'`)
      + (metadata?.genre && ` -metadata genre='${format(metadata.genre)}'`)
      + (metadata?.title && ` -metadata title='${format(metadata.title)}'`)

  const outputFilename = metadata?.renameFileOnComplete
    ? `${directory}/${metadata.artist} - ${metadata.title}.%(ext)s`
    : `${directory}/%(uploader)s - %(title)s.%(ext)s`;

  const options = {
    audioQuality: 0,
    embedMetadata: true,
    extractAudio: true,
    format: "bestaudio/best",
    output: outputFilename,
    postprocessorArgs
  }

  if (metadata?.audioFormat) options["audioFormat"] = metadata.audioFormat;
  await youtubedl(url, options);

  const oldFilename = fs.readdirSync(directory)[0];
  const oldFilepath = resolve(`${directory}/${oldFilename}`);
  const newFilename = `${parse(oldFilename).name.replaceAll(".", "")}${parse(oldFilename).ext}`;
  const newFilepath = resolve(`${directory}/${newFilename}`);
  fs.renameSync(oldFilepath, newFilepath);

  return { directory, filename: basename(newFilepath), filepath: newFilepath }
}

const getCleanArtist = ({ author_name, title } = { author_name: "", title: "" }) => {
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

function getDownloadMessageRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("DOWNLOAD_MP3_BUTTON")
      .setEmoji("📲")
      .setLabel("Download MP3")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("NULL")
      .setDisabled(true)
      .setEmoji("⏳")
      .setLabel("Searching in Plex")
      .setStyle(ButtonStyle.Secondary)
  );
}

function getErrorMessage(error) {
  return `Sorry! I caught an error when fetching this URL:\n\`\`\`${error}\`\`\``;
}

function getMetadataModalRows({ author_name, title }) {
  return [new ActionRowBuilder().addComponents(
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
  )]
}

const getUrlFromString = input => {
  const match = input.match(/(https?:\/\/[^&\s]+)/);
  return match ? match[1] : null;
}