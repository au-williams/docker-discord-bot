import { basename, parse, resolve } from "path";
import { getUrlFromString, getFileSizeFromPath, sanitizeOembedTitle } from "../utilities.js";
import { Logger, getLogIdentifier } from "../logger.js";
import * as oembed from "@extractus/oembed-extractor";
import config from "./music_download_config.json" assert { type: "json" };
import fs from "fs-extra";
import youtubedl from "youtube-dl-exec";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration
} from "discord.js";

const interactionActions = Object.freeze({
  GetMp3Button: "music_download_script_get_mp3",
  PlexImportButton: "music_download_script_plex_import_button",
  PlexDeleteButton: "music_download_script_plex_delete_button",
  PlexImportModal: "music_download_script_plex_import_modal",
  PlexDeleteModal: "music_download_script_plex_delete_modal"
});

const getErrorResponse = error => `I encountered an error and couldn't continue.\n\`\`\`${error}\n\`\`\``;

export const OnMessageCreate = async ({ message }) => {
  // Verify message channel id is in music_download_config.json
  if (!config.channel_ids.includes(message.channel.id)) return;

  // Verify message contains the URL to download
  const url = getUrlFromString(message.content);
  if (!url) return;

  const log = getLogIdentifier({ message });
  Logger.Info(`${log} Started yt-dlp download "${url}"`);
  await message.startThread({
    autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
    name: `Processing your music file`
  });

  const onDownloadError = error => {
    Logger.Warn(`${log} Failed yt-dlp download "${url}"`);
    error = `ERROR: ${error.toString().split(" ").filter(x => x.toLowerCase() !== "error:").join(" ")}`;
    message.reply(getErrorResponse(error));
    message.thread.delete();
  }

  const tempFilepath = await tryDownload(message.id, url).catch(onDownloadError);
  if (!tempFilepath) return;

  // Build the response interaction components
  const isMp3File = tempFilepath.endsWith(".mp3");
  const isPlexFile = fs.existsSync(`${config.plex_directory}/${basename(tempFilepath)}`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(interactionActions.GetMp3Button)
      .setDisabled(isMp3File)
      .setEmoji("🎧")
      .setLabel(`Get MP3 file`)
      .setStyle(isMp3File ? ButtonStyle.Secondary : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(interactionActions[isPlexFile ? "PlexDeleteButton" : "PlexImportButton"])
      .setDisabled(false)
      .setEmoji("<:plex:1093751472522543214>")
      .setLabel(`${isPlexFile ? "Delete from" : "Import into"} Plex`)
      .setStyle(ButtonStyle.Secondary)
  );

  const fileSize = getFileSizeFromPath(tempFilepath);
  let { title, author_name } = await oembed.extract(url);
  title = sanitizeOembedTitle(title, author_name);

  message.thread
    .send({
      content: "This music is ready to be downloaded with the link below.",
      components: [row],
      files: [tempFilepath]
    })
    .then(() => {
      Logger.Info(`${log} Uploaded "${basename(tempFilepath)}" (${fileSize}MB)`);
      message.thread.setName(`Download is ready (${title})`);
    })
    .catch(async error => {
      Logger.Warn(`${log} Failed upload "${basename(tempFilepath)}" (${fileSize}MB)`);
      error = `ERROR: ${error.toString().split(" ").filter(x => x.toLowerCase() !== "error:").join(" ")}`;
      message.thread.send({ content: getErrorResponse(error), components: [row] });
      message.thread.setName(`Discord upload failed (${title})`);
    })
    .finally(() => {
      if (fs.existsSync(tempFilepath)) fs.unlinkSync(tempFilepath);
    })
}

export const OnMessageUpdate = async ({ oldMessage, newMessage }) => {
  const isValidChannel = config.channel_ids.includes(newMessage.channel.id);
  const isThreadCreate = !oldMessage?.hasThread && newMessage.hasThread;
  const isContentUpdate = oldMessage?.content != newMessage.content;
  if (!isValidChannel || !isContentUpdate || isThreadCreate) return;
  if (newMessage.hasThread) await newMessage.thread.delete();
  OnMessageCreate({ message: newMessage });
}

const verifyInteractionChannel = async ({ channel, message }) => {
  switch (channel.type) {
    case ChannelType.DM: return true;
    case ChannelType.GuildText: return config.channel_ids.includes(channel.id);
    case ChannelType.PublicThread: return config.channel_ids.includes((await message.channel.fetchStarterMessage()).channelId);
    default: return false;
  }
};

export const OnInteractionCreate = async ({ interaction }) => {
  const isAction = Object.values(interactionActions).includes(interaction.customId);
  const isChannel = await verifyInteractionChannel(interaction);
  if (!isAction || !isChannel) return null;

  const log = getLogIdentifier({ interaction });

  switch (interaction.customId) {
    case interactionActions.GetMp3Button: return onGetMp3Button(interaction);
    case interactionActions.PlexImportButton: return onPlexImportButton(interaction);
    case interactionActions.PlexImportModal: return onPlexImportModal(interaction);
    case interactionActions.PlexDeleteButton: return onPlexDeleteButton(interaction);
    case interactionActions.PlexDeleteModal: return onPlexDeleteModal(interaction);
  }

  async function onPlexImportButton(interaction) {
    const content = (await interaction.message.channel.fetchStarterMessage()).content;
    let { title, author_name } = await oembed.extract(getUrlFromString(content));
    title = sanitizeOembedTitle(title, author_name);

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(interactionActions.PlexImportModal)
        .setTitle("Import into Plex")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("title")
              .setLabel("Track Title")
              .setRequired(true)
              .setStyle(TextInputStyle.Short)
              .setValue(title)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("artist")
              .setLabel("Track Artist")
              .setRequired(true)
              .setStyle(TextInputStyle.Short)
              .setValue(author_name)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("genre")
              .setLabel("Track Genre")
              .setPlaceholder("Genre (Optional)")
              .setRequired(false)
              .setStyle(TextInputStyle.Short)
          )
          // new ActionRowBuilder().addComponents(
          //   new TextInputBuilder()
          //     .setCustomId("start_time")
          //     .setLabel("Track Start Time")
          //     .setPlaceholder("HH:MM:SS (Optional)")
          //     .setRequired(false)
          //     .setStyle(TextInputStyle.Short)
          //     .setValue("00:00")
          // ),
          // new ActionRowBuilder().addComponents(
          //   new TextInputBuilder()
          //     .setCustomId("end_time")
          //     .setLabel("Track End Time")
          //     .setPlaceholder("HH:MM:SS (Optional)")
          //     .setRequired(false)
          //     .setStyle(TextInputStyle.Short)
          //     .setValue("10:21")
          // )
        )
    )

    Logger.Info(`${log} Showed the Plex import modal`);
  }

  async function onPlexImportModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const row = ActionRowBuilder.from(interaction.message.components[0]);
    interaction.message.edit({ components: [row.components[1].setDisabled(true) && row] });

    const modalData = {
      title: interaction.fields.getTextInputValue("title"),
      artist: interaction.fields.getTextInputValue("artist"),
      genre: interaction.fields.getTextInputValue("genre")
    }

    if (!interaction.member.roles.cache.has(config.plex_user_role_id)) {
      const content = "You aren't authorized to import this into Plex.";
      const files = [{ attachment: "assets\\you_are_arrested.png" }];
      interaction.editReply({ content, files });
      const { title, artist, genre } = modalData;
      Logger.Info(`${log} Denied importing a file into Plex`);
      Logger.Info(`Track metadata - title: "${title}", artist: "${artist}", genre: "${genre}"`);
      return;
    }

    const starterMessage = await interaction.message.channel.fetchStarterMessage();
    const url = getUrlFromString(starterMessage.content);

    const onDownloadError = error => {
      Logger.Warn(`${log} Couldn't download link from message`);
      error = `ERROR: ${error.toString().split(" ").filter(x => x.toLowerCase() !== "error:").join(" ")}`;
      interaction.editReply(getErrorResponse(error)); // delete and follow up?
      interaction.message.edit({ components: [row.components[1].setDisabled(false) && row] });
    }

    const tempFilepath = await tryDownload(interaction.message.id, url, modalData).catch(onDownloadError);
    if (tempFilepath === null) return;

    const plexFilepath = `${config.plex_directory}/${basename(tempFilepath)}`;
    fs.moveSync(tempFilepath, plexFilepath, { overwrite: true });

    Logger.Info(`${log} Imported file into Plex "${basename(plexFilepath)}"`);

    row.components[1]
      .setCustomId(interactionActions.PlexDeleteButton)
      .setDisabled(false)
      .setLabel("Delete from Plex");

    interaction.editReply(`Success! Your file was imported into Plex and will be visible after the next automated library scan.`);
    interaction.message.edit({ components: [row] });
  }

  async function onPlexDeleteButton(interaction) {
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(interactionActions.PlexDeleteModal)
        .setTitle("Delete from Plex")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("reason")
              .setLabel("Reason for deletion")
              .setRequired(true)
              .setStyle(TextInputStyle.Paragraph)
          )
        )
    )
    Logger.Info(`${log} Showed the Plex delete modal`);
  }

  async function onPlexDeleteModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const row = ActionRowBuilder.from(interaction.message.components[0]);
    interaction.message.edit({ components: [row.components[1].setDisabled(true) && row] });

    if (!interaction.member.roles.cache.has(config.plex_user_role_id)) {
      interaction.message.edit({ components: [row.components[1].setDisabled(false) && row] });
      const content = "You aren't authorized to delete this from Plex.";
      const files = [{ attachment: "assets\\you_are_arrested.png" }];
      interaction.editReply({ content, files, ephemeral: true });
      const reason = interaction.fields.getTextInputValue("reason");
      Logger.Info(`${log} Denied deleting a file from Plex`);
      Logger.Info(`Reason for deletion: ${reason}`);
      return;
    }

    // --get-filename returns the pre-processed filename, which is NOT the resulting filename
    // download the file again for an exact value and silently weep over our performance loss

    const starterMessage = await interaction.message.channel.fetchStarterMessage();
    const url = getUrlFromString(starterMessage.content);

    const onDownloadError = error => {
      Logger.Warn(`${log} Couldn't download link from message`);
      error = `ERROR: ${error.toString().split(" ").filter(x => x.toLowerCase() !== "error:").join(" ")}`;
      interaction.editReply(getErrorResponse(error)); // delete and follow up?
      interaction.message.edit({ components: [row.components[1].setDisabled(false) && row] });
    }

    const tempFilepath = await tryDownload(starterMessage.id, url).catch(onDownloadError);
    if (!tempFilepath) return;

    if (fs.existsSync(`${config.plex_directory}/${basename(tempFilepath)}`)) {
      fs.rmSync(plexFilepath);
      Logger.Info(`${log} Deleted file from Plex "${basename(tempFilepath)}"`);
      interaction.editReply(replyContent);
    } else {
      Logger.Warn(`${log} Couldn't find file to delete from Plex "${basename(tempFilepath)}"`)
      interaction.editReply(`This file was not found in the Plex library and could not be removed.`);
    }
    Logger.Warn(`Reason for deletion: ${reason}`);

    row.components[1]
      .setCustomId(interactionActions.PlexImportButton)
      .setDisabled(false)
      .setLabel("Import into Plex");

    interaction.message.edit({ components: [row] });
  }

  async function onGetMp3Button(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const row = ActionRowBuilder.from(interaction.message.components[0]);
    row.components[0].setStyle(ButtonStyle.Secondary).setDisabled(true);
    interaction.message.edit({ components: [row] });

    const starterMessage = await interaction.message.channel.fetchStarterMessage();
    const url = getUrlFromString(starterMessage.content);

    const onDownloadError = error => {
      Logger.Warn(`${log} Couldn't download link from message`);
      error = `ERROR: ${error.toString().split(" ").filter(x => x.toLowerCase() !== "error:").join(" ")}`;
      interaction.editReply(getErrorResponse(error)); // delete and follow up?
      row.components[0].setStyle(ButtonStyle.Primary).setDisabled(false);
      interaction.message.edit({ components: [row] });
    }

    const tempFilepath = await tryDownload(interaction.message.id, url, { audioFormat: "mp3" }).catch(onDownloadError);
    if (!tempFilepath) return;

    const attachment = new AttachmentBuilder(tempFilepath, { name: basename(tempFilepath) });
    const files = [...interaction.message.attachments.values(), attachment];

    await interaction.message
      .edit({ components: [row], files })
      .then(() => interaction.editReply("Your MP3 file was uploaded successfully."))
      .catch(async error => {
        row.components[0].setStyle(ButtonStyle.Primary).setDisabled(false);
        interaction.message.edit({ components: [row] });
        switch (error.code) {
          case 40005:
            return interaction.editReply(`MP3 file size ${getFileSizeFromPath(tempFilepath)}MB exceeds the servers upload limit.`);
          default:
            return interaction.editReply("Discord timed out and aborted the MP3 upload. Try again later.");
        }
      })
      .finally(() => {
        if (fs.existsSync(tempFilepath)) fs.unlinkSync(tempFilepath);
      });
  }
};

async function tryDownload(id, url, modalOptions) {
  let postprocessorArgs = `ffmpeg: -metadata album='Downloads' -metadata album_artist='Various Artists' -metadata date='' -metadata track=''`;

  const formatArg = str => str.trim().replaceAll("'", "'\\''");
  if (modalOptions?.title) postprocessorArgs += ` -metadata title='${formatArg(modalOptions.title)}'`;
  if (modalOptions?.artist) postprocessorArgs += ` -metadata artist='${formatArg(modalOptions.artist)}'`;
  if (modalOptions?.genre) postprocessorArgs += ` -metadata genre='${formatArg(modalOptions.genre)}'`;

  const options = {
    output: `${config.temp_directory}/${id}/%(uploader)s - %(title)s.%(ext)s`,
    format: "bestaudio/best",
    audioQuality: 0,
    extractAudio: true,
    embedMetadata: true,
    postprocessorArgs
  }

  if (modalOptions?.audioFormat)
    options["audioFormat"] = modalOptions.audioFormat;

  await youtubedl(url, options).catch(error => {
    throw new Error(error);
  });

  // cli command:
  // yt-dlp https://www.youtube.com/watch?v=[VIDEO_ID] -f "bestaudio/best" --audio-quality 0 --extract-audio --embed-metadata --embed-thumbnail --postprocessor-args "ffmpeg: -metadata album='Downloads' -metadata album_artist='Various Artists' -metadata date=''  -metadata track=''"

  const oldFilename = fs.readdirSync(`${config.temp_directory}/${id}`)[0];
  const oldFilepath = resolve(`${config.temp_directory}/${id}/${oldFilename}`);

  const newFilename = `${parse(oldFilename).name.replaceAll(".", "")}${parse(oldFilename).ext}`;
  const newFilepath = resolve(`${config.temp_directory}/${id}/${newFilename}`);

  fs.renameSync(oldFilepath, newFilepath);
  return newFilepath;
}
