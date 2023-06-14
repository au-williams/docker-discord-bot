import { basename, parse, resolve } from "path";
import { getUrlFromString } from "../utilities.js";
import { Logger } from "../logger.js";
import * as oembed from "@extractus/oembed-extractor";
import config from "./music_download_config.json" assert { type: "json" };
import fs from "fs-extra";
import youtubedl from "youtube-dl-exec";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

const INTERACTION_ACTIONS = Object.freeze({
  DOWNLOAD_BUTTON: "music_download_script_download_button",
  DOWNLOAD_MODAL: "music_download_script_download_modal",
  PLEX_IMPORT_BUTTON: "music_download_script_plex_import_button",
  PLEX_IMPORT_MODAL: "music_download_script_plex_import_modal",
  PLEX_REMOVE_BUTTON: "music_download_script_plex_remove_button",
  PLEX_REMOVE_MODAL: "music_download_script_plex_remove_modal"
});

const pendingInteractions = new Set(); // interaction.customId + interaction.user.id

export const OnMessageCreate = async ({ message }) => {
  const isConfigChannel = config.channel_ids.includes(message.channel.id);
  if (!isConfigChannel) return;

  const url = getUrlFromString(message.content);
  if (!url) return;

  const oembedMetadata = await oembed.extract(url).catch(() => undefined);
  if (!oembedMetadata) return;

  // create a new thread under the message containing an oembedded media url
  // send a message to the thread with buttons to download or import to plex

  const { title, author_name } = oembedMetadata;

  await message
    .startThread({ name: sanitizeTitle(title, author_name) })
    .then(thread => thread.members.remove(message.author.id));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(INTERACTION_ACTIONS.DOWNLOAD_BUTTON)
      .setEmoji("📲")
      .setLabel("Download MP3")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("NULL")
      .setDisabled(true)
      .setEmoji("⏳")
      .setLabel("Searching in Plex")
      .setStyle(ButtonStyle.Secondary)
  );

  const threadMessage = await message.thread.send({
    components: [row],
    content: "You can download this music to your device with the button below."
  });

  // check if the file exists in plex and update the plex button to reflect the result

  const updatePlexButton = isPlexFile => {
    row.components[1].setCustomId(isPlexFile ? INTERACTION_ACTIONS.PLEX_REMOVE_BUTTON : INTERACTION_ACTIONS.PLEX_IMPORT_BUTTON);
    row.components[1].setDisabled(false);
    row.components[1].setEmoji("<:plex:1093751472522543214>");
    row.components[1].setLabel(isPlexFile ? "Remove from Plex" : "Import into Plex")
    threadMessage.edit({ components: [row] });
  }

  tryDownload(message.id, url)
    .then(tempFilepath => {
      const plexFilepath = `${config.plex_directory}/${basename(tempFilepath)}`;
      const isPlexFile = fs.existsSync(plexFilepath);
      updatePlexButton(isPlexFile);
    })
    .catch(error => {
      Logger.Warn(`Couldn't complete Plex file validation: ${error}`);
      updatePlexButton(false);
    });
}

// when a message is updated, delete the existing thread and create a new thread for valid links
// (this is to avoid a message being updated as an invalid link and the user trying to download)
export const OnMessageUpdate = async ({ oldMessage, newMessage }) => {
  const isConfigChannel = config.channel_ids.includes(newMessage.channel.id);
  if (!isConfigChannel) return;

  const isContentUpdate = oldMessage?.content != newMessage.content;
  if (!isContentUpdate) return;

  if (newMessage.hasThread) await newMessage.thread.delete();
  OnMessageCreate({ message: newMessage });
}

export const OnInteractionCreate = async ({ interaction }) => {
  if (pendingInteractions.has(interaction.customId + interaction.user.id)) {
    interaction.deferUpdate();
    return;
  }

  const isAction = Object.values(INTERACTION_ACTIONS).includes(interaction.customId);
  if (!isAction) return;

  const channelId = (await interaction.message.channel.fetchStarterMessage()).channelId;
  const isChannel = config.channel_ids.includes(channelId);
  if (!isChannel) return;

  const replyUnauthorized = ({ interaction, appendedErrorText }) => {
    Logger.Info(`${interaction.member.nickname} was unauthorized to ${appendedErrorText}`);
    const content = `You aren't authorized to ${appendedErrorText}!`;
    const files = [{ attachment: "assets\\you_are_arrested.png" }];
    interaction.reply({ content, ephemeral: true, files });
  }

  switch (interaction.customId) {
    // Download URL with yt-dlp and upload to Discord
    case INTERACTION_ACTIONS.DOWNLOAD_BUTTON:
      return showMetadataModal({ interaction, customId: INTERACTION_ACTIONS.DOWNLOAD_MODAL, title: "Download MP3" });
    case INTERACTION_ACTIONS.DOWNLOAD_MODAL:
      return uploadUrlToThread({ interaction });
    // Download URL with yt-dlp and import to Plex
    case INTERACTION_ACTIONS.PLEX_IMPORT_BUTTON:
      return interaction.member.roles.cache.has(config.plex_user_role_id)
        ? showMetadataModal({ interaction, customId: INTERACTION_ACTIONS.PLEX_IMPORT_MODAL, title: "Import into Plex" })
        : replyUnauthorized({ interaction, appendedErrorText: "import into Plex" });
    case INTERACTION_ACTIONS.PLEX_IMPORT_MODAL:
      return interaction.member.roles.cache.has(config.plex_user_role_id)
        ? downloadUrlToPlex({ interaction })
        : replyUnauthorized({ interaction, appendedErrorText: "import into Plex" });
    // Remove yt-dlp filename from Plex (if exists)
    case INTERACTION_ACTIONS.PLEX_REMOVE_BUTTON:
      return interaction.member.roles.cache.has(config.plex_user_role_id)
        ? showRemovalModal({ interaction, customId: INTERACTION_ACTIONS.PLEX_REMOVE_MODAL, title: "Remove from Plex" })
        : replyUnauthorized({ interaction, appendedErrorText: "remove from Plex" })
    case INTERACTION_ACTIONS.PLEX_REMOVE_MODAL:
      return interaction.member.roles.cache.has(config.plex_user_role_id)
        ? deleteUrlFromPlex({ interaction })
        : replyUnauthorized({ interaction, appendedErrorText: "remove from Plex" })
  }

  // ----------------------- //
  // Modal builder functions //
  // ----------------------- //

  async function showRemovalModal({ interaction, customId, title }) {
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("reason")
              .setLabel("Reason for removal")
              .setRequired(true)
              .setStyle(TextInputStyle.Paragraph)
          )
        )
    )
  }

  async function showMetadataModal({ interaction, customId, title }) {
    const starterMessage = await interaction.message.channel.fetchStarterMessage();
    const url = getUrlFromString(starterMessage.content);
    if (!url) return;

    const metadata = await oembed.extract(url).catch(_ => null);
    if (!metadata) return;

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("title")
              .setLabel("Track Title")
              .setRequired(true)
              .setStyle(TextInputStyle.Short)
              .setValue(sanitizeTitle(metadata.title, metadata.author_name))
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("artist")
              .setLabel("Track Artist")
              .setRequired(true)
              .setStyle(TextInputStyle.Short)
              .setValue(sanitizeAuthorName(metadata.title, metadata.author_name))
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("genre")
              .setLabel("Track Genre")
              .setPlaceholder("Genre (Optional)")
              .setRequired(false)
              .setStyle(TextInputStyle.Short)
          )
        )
    )
  }

  // ---------------------- //
  // Modal submit functions //
  // ---------------------- //

  async function deleteUrlFromPlex({ interaction }) {
    await interaction.deferReply({ ephemeral: true });

    const row = ActionRowBuilder.from(interaction.message.components[0]);
    row.components[1].setDisabled(true);
    interaction.message.edit({ components: [row] });

    // --get-filename returns the pre-processed filename, which is NOT the resulting filename
    // download the file again for an exact value and silently weep over our performance loss

    const starterMessage = await interaction.message.channel.fetchStarterMessage();
    const url = getUrlFromString(starterMessage.content);

    tryDownload(starterMessage.id, url)
      .then(tempFilepath => {
        const plexFilepath = `${config.plex_directory}/${basename(tempFilepath)}`;
        const isPlexFile = fs.existsSync(plexFilepath);

        if (isPlexFile) {
          fs.rmSync(plexFilepath);
          Logger.Info(`${interaction.member.nickname} removed "${basename(tempFilepath)}" from the Plex media library`);
          const fetchAddress = `http://${config.plex_server_ip}:32400/library/sections/${config.plex_section_id}/refresh`;
          const fetchOptions = { method: 'GET', headers: { 'X-Plex-Token': config.plex_x_token } };
          fetch(fetchAddress, fetchOptions)
            .then(() => {
              interaction.editReply(`Your file was removed from the Plex media library and will be reflected after the library scan is complete.`);
              Logger.Info(`${interaction.member.nickname} started a Plex media library scan`)
            })
            .catch(() => {
              interaction.editReply(`Your file was removed from the Plex media library and will be reflected after the next automated library scan.`);
              Logger.Warn(`${interaction.member.nickname} couldn't start a Plex media library scan`)
            });
          fetch(fetchAddress, fetchOptions)
            .then(() => Logger.Info(`${interaction.member.nickname} started a Plex media library scan`))
            .catch(() => Logger.Warn(`${interaction.member.nickname} couldn't start a Plex media library scan`));
        } else {
          interaction.editReply(`Your file wasn't found and couldn't be removed from the Plex media library.`);
          Logger.Warn(`${interaction.member.nickname} couldn't remove "${basename(tempFilepath)}" from the Plex media library because it wasn't found.`);
        }

        row.components[1].setCustomId(INTERACTION_ACTIONS.PLEX_IMPORT_BUTTON)
        row.components[1].setLabel("Import into Plex");
      })
      .catch(error => {
        interaction.editReply(getErrorResponse(error));
        Logger.Warn(`Couldn't remove file from the Plex media library: ${error}`);
      })
      .finally(() => {
        row.components[1].setDisabled(false);
        interaction.message.edit({ components: [row] });
      })
  }

  async function downloadUrlToPlex({ interaction }) {
    await interaction.deferReply({ ephemeral: true });

    const row = ActionRowBuilder.from(interaction.message.components[0]);
    row.components[1].setDisabled(true);
    interaction.message.edit({ components: [row] });

    const starterMessage = await interaction.message.channel.fetchStarterMessage();
    const url = getUrlFromString(starterMessage.content);

    const metadata = {
      artist: interaction.fields.getTextInputValue("artist"),
      genre: interaction.fields.getTextInputValue("genre"),
      title: interaction.fields.getTextInputValue("title")
    }

    tryDownload(starterMessage.id, url, metadata)
      .then(tempFilepath => {
        const plexFilepath = `${config.plex_directory}/${basename(tempFilepath)}`;
        const isPlexFile = fs.existsSync(plexFilepath);

        if (isPlexFile) {
          interaction.editReply(`Your file already exists in the Plex media library and couldn't be imported.`);
          Logger.Warn(`${interaction.member.nickname} couldn't add "${basename(tempFilepath)}" to Plex because it already exists.`);
        } else {
          fs.moveSync(tempFilepath, plexFilepath, { overwrite: true });
          Logger.Info(`${interaction.member.nickname} added "${basename(tempFilepath)}" to the Plex media library`);
          const fetchAddress = `http://${config.plex_server_ip}:32400/library/sections/${config.plex_section_id}/refresh`;
          const fetchOptions = { method: 'GET', headers: { 'X-Plex-Token': config.plex_x_token } };
          fetch(fetchAddress, fetchOptions)
            .then(() => {
              interaction.editReply(`Success! Your file was imported into the Plex media library and will be visible after the library scan is complete.`);
              Logger.Info(`${interaction.member.nickname} started a Plex media library scan`)
            })
            .catch(() => {
              interaction.editReply(`Success! Your file was imported into the Plex media library and will be visible after the next automated library scan.`);
              Logger.Warn(`${interaction.member.nickname} couldn't start a Plex media library scan`)
            });
        }

        row.components[1].setCustomId(INTERACTION_ACTIONS.PLEX_REMOVE_BUTTON)
        row.components[1].setLabel("Remove from Plex");
      })
      .catch(error => {
        interaction.editReply(getErrorResponse(error));
        Logger.Warn(`Couldn't import file into the Plex media library: ${error}`);
      })
      .finally(() => {
        row.components[1].setDisabled(false);
        interaction.message.edit({ components: [row] });
      })
  }

  async function uploadUrlToThread({ interaction }) {
    await interaction.deferReply({ ephemeral: true });
    pendingInteractions.add(INTERACTION_ACTIONS.DOWNLOAD_BUTTON + interaction.user.id);
    pendingInteractions.add(INTERACTION_ACTIONS.DOWNLOAD_MODAL + interaction.user.id);

    const starterMessage = await interaction.message.channel.fetchStarterMessage();
    const url = getUrlFromString(starterMessage.content);
    if (!url) return;

    const tempFilepath = await tryDownload(interaction.message.id, url, { audioFormat: "mp3" });//.catch(onDownloadError);
    if (!tempFilepath) return;

    const name = basename(tempFilepath);
    const files = [new AttachmentBuilder(tempFilepath, { name })];

    interaction
      .editReply({ files })
      .catch(error => {
        interaction.editReply(getErrorResponse(error));
        Logger.Warn(`Couldn't upload MP3 file to Discord: ${error}`);
      })
      .finally(() => {
        if (fs.existsSync(tempFilepath)) fs.unlinkSync(tempFilepath);
        pendingInteractions.delete(INTERACTION_ACTIONS.DOWNLOAD_BUTTON + interaction.user.id);
        pendingInteractions.delete(INTERACTION_ACTIONS.DOWNLOAD_MODAL + interaction.user.id);
      });
  }
};

async function tryDownload(id, url, metadata) {
  const format = str => str.trim().replaceAll("'", "'\\''"); // escape single quote for ffmpeg

  let postprocessorArgs =
    "ffmpeg:"
      + " -metadata album='Downloads'"
      + " -metadata album_artist='Various Artists'"
      + " -metadata date=''"
      + " -metadata track=''"
      + (metadata?.artist && ` -metadata artist='${format(metadata.artist)}'`)
      + (metadata?.genre && ` -metadata genre='${format(metadata.genre)}'`)
      + (metadata?.title && ` -metadata title='${format(metadata.title)}'`)

  const options = {
    output: `${config.temp_directory}/${id}/%(uploader)s - %(title)s.%(ext)s`,
    format: "bestaudio/best",
    audioQuality: 0,
    extractAudio: true,
    embedMetadata: true,
    postprocessorArgs
  }

  if (metadata?.audioFormat) options["audioFormat"] = metadata.audioFormat;
  await youtubedl(url, options).catch(error => { throw new Error(error); });

  const oldFilename = fs.readdirSync(`${config.temp_directory}/${id}`)[0];
  const oldFilepath = resolve(`${config.temp_directory}/${id}/${oldFilename}`);

  const newFilename = `${parse(oldFilename).name.replaceAll(".", "")}${parse(oldFilename).ext}`;
  const newFilepath = resolve(`${config.temp_directory}/${id}/${newFilename}`);

  fs.renameSync(oldFilepath, newFilepath);
  return newFilepath;
}

const getErrorResponse = error => `I encountered an error and couldn't continue.\n\`\`\`${error}\n\`\`\``;

const sanitizeAuthorName = (title, author_name) => {
  let result = author_name;

  if (author_name.endsWith(" - Topic")) {
    result = result.slice(0, -" - Topic".length)
  }

  return result.trim();
}

const sanitizeTitle = (title, author_name) => {
  let result = title;

  if (title.endsWith(` by ${author_name}`)) {
    result = result.slice(0, -` by ${author_name}`.length);
  }

  if (title.startsWith(`${author_name} - `)) {
    result = result.slice(`${author_name} - `.length);
  }

  return result.trim();
}