import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { basename } from "path";
import { getUrlFromString, getFileSizeFromPath, tryDeleteDiscordMessages } from "../utilities.js";
import config from "./music_download_config.json" assert { type: "json" };
import fs from "fs-extra";
import youtubedl from "youtube-dl-exec";

// ------------- //
// Discord Hooks //
// ------------- //

export const OnMessageCreate = async ({ message }) => {
  // ---------------------------------------------------- //
  // check validity of message channel and message author //
  // ---------------------------------------------------- //

  const isChannel = config.channel_ids.includes(message.channel.id);
  if (!isChannel || message.author.bot) return null;

  // ---------------------------------------------------- //
  // check validity of message content (needs a good URL) //
  // ---------------------------------------------------- //

  const url = getUrlFromString(message.content);

  if (url === null) {
    const reply = await message.reply("Please only send music links to this channel.");
    setTimeout(async () => tryDeleteDiscordMessages(message, reply), 10000);
    return `Deleted message without link from ${message.author.tag}`;
  }

  // ----------------------------------------------------- //
  // start thread to show the user the bot is working hard //
  // (else the bot will look unresponsive during download) //
  // ----------------------------------------------------- //

  await message.startThread({
    name: "⏳ Processing your file",
    autoArchiveDuration: 60
  });

  // ----------------------------------------------------- //
  // download and get the filepath, or reply with an error //
  // ----------------------------------------------------- //

  const tempFilepath = await tryDownload(message.id, url).catch(async () => {
    const reply = await message.reply("This link is unsupported and cannot download.");
    message.thread.setName("👎 Download was aborted").then(x => x.setArchived(true));
    setTimeout(async () => tryDeleteDiscordMessages(message, reply), 10000);
    return `Deleted message with unsupported link from ${message.author.tag}`;
  });

  // ----------------------------------------------------- //
  // send the file attachment or an error if one is thrown //
  // ----------------------------------------------------- //

  let resultContent = "";

  message.thread
    .send({
      components: [
        new ActionRowBuilder().addComponents(
          getMp3FormatButtonBuilder({ isDisabled: tempFilepath.endsWith(".mp3") }),
          getPlexImportButtonBuilder({ isDisabled: false })
        )
      ],
      files: [tempFilepath]
    })
    .then(async () => {
      await message.thread.setName("👍 Download is ready");
      resultContent = `Sent a reply with download link to ${message.author.tag}`;
    })
    .catch(async error => {
      switch (error.code) {
        case 40005:
          const fileSize = getFileSizeFromPath(tempFilepath);
          await message.thread.setName("👎 Upload exceeds limit");
          await message.thread.send({
            content: `File size ${fileSize}MB exceeds the servers upload limit.`,
            components: [
              new ActionRowBuilder().addComponents(
                getMp3FormatButtonBuilder({ isDisabled: true }),
                getPlexImportButtonBuilder({ isDisabled: false })
              )
            ]
          });
          resultContent = `Tried to send a reply with download link that exceeded upload limit to ${message.author.tag}`;
          break;
        default:
          await message.thread.setName("👎 Upload was aborted");
          await message.thread.send({
            content: "The Discord API timed out and aborted the upload.",
            components: [
              new ActionRowBuilder().addComponents(
                getMp3FormatButtonBuilder({ isDisabled: false }),
                getPlexImportButtonBuilder({ isDisabled: false })
              )
            ]
          });
          resultContent = `Tried to send a reply with download link to ${message.author.tag} but the Discord API timed out.`;
          break;
      }
    })
    .finally(() => {
      setTimeout(async () => message.thread.setArchived(true), 10000);
      fs.unlinkSync(tempFilepath);
    });

  return resultContent;
};

const interactionActions = Object.freeze({
  GetMP3: "music_download_script_get_mp3",
  PlexImport: "music_download_script_plex_import",
  PlexDelete: "music_download_script_plex_delete"
});

export const OnInteractionCreate = ({ interaction }) => {
  const isAction = Object.values(interactionActions).includes(interaction.customId);
  if (!isAction) return null;

  switch (interaction.customId) {
    case interactionActions.GetMP3:
      return onGetMP3(interaction);
    case interactionActions.PlexImport:
      return onPlexImport(interaction);
    case interactionActions.PlexDelete:
      return onPlexDelete(interaction);
  }

  async function onPlexDelete(interaction) {
    const content = "This function isn't implemented yet.";
    await interaction.reply({ content, ephemeral: true });
    const starterMessage = await interaction.message.channel.fetchStarterMessage();
    await starterMessage.thread.setArchived(true);
    return `Could not delete file from Plex for ${interaction.user.tag}`;
  }

  /**
   * Download the URL in the native format and move to the library folder.
   * @param {ButtonInteraction} interaction
   * @returns {string} response
   */
  async function onPlexImport(interaction) {
    // -------------------------------------------------------- //
    // Verify the interaction user has the configured Plex role //
    // -------------------------------------------------------- //

    const starterMessage = await interaction.message.channel.fetchStarterMessage();

    if (!interaction.member.roles.cache.has(config.plex_user_role_id)) {
      const content = "You aren't authorized to import this into Plex.";
      const files = [{ attachment: "assets\\you_are_arrested.png" }];
      await interaction.reply({ content, files, ephemeral: true });
      await starterMessage.thread.setArchived(true);
      return `Denied importing a file into Plex for ${interaction.user.tag}`;
    }

    // -------------------------------------------------------- //
    // Get dependencies and check for any invalid module states //
    // -------------------------------------------------------- //

    await interaction.deferReply({ ephemeral: true });
    await starterMessage.thread.setArchived(true);

    const url = getUrlFromString(starterMessage.content);
    const tempFilepath = await tryDownload(interaction.message.id, url).catch(async () => {
      await interaction.editReply("The message URL was changed and cannot be downloaded.");
      await starterMessage.thread.setArchived(true);
      return `Could not import changed URL into Plex for ${interaction.user.tag}`;
    });

    // ---------------------------------------------------------- //
    // Edit the interaction buttons and interaction reply message //
    // ---------------------------------------------------------- //

    let replyContent = "Your file was already imported. Press the button again to delete it.";

    if (!fs.existsSync(`${config.plex_directory}/${basename(tempFilepath)}`)) {
      fs.moveSync(tempFilepath, `${config.plex_directory}/${basename(tempFilepath)}`);
      replyContent = "Your file imported and will be visible after the next automated scan.";
    }

    const interactionButtons = interaction.message.components[0].components;
    const mp3Button = interactionButtons.find(x => x.data.custom_id == interactionActions.GetMP3);
    const plexButton = getPlexDeleteButtonBuilder({ isDisabled: false });
    const components = [new ActionRowBuilder().addComponents(mp3Button, plexButton)];

    const files = [...interaction.message.attachments.values()];

    await starterMessage.thread.setArchived(false);
    await interaction.message.edit({ content: interaction.message.content, files, components });
    await interaction.editReply({ content: replyContent, ephemeral: true });
    await starterMessage.thread.setArchived(true);

    return `Imported a file into Plex for ${interaction.user.tag}`;
  }

  /**
   * Download the URL as MP3 and append it to the interaction message.
   * @param {ButtonInteraction} interaction
   * @returns {string} response
   */
  async function onGetMP3(interaction) {
    // -------------------------------------------------------- //
    // Get dependencies and check for any invalid module states //
    // -------------------------------------------------------- //
    const starterMessage = await interaction.message.channel.fetchStarterMessage();
    await interaction.deferReply({ ephemeral: true });
    await starterMessage.thread.setArchived(true);

    const url = getUrlFromString(starterMessage.content);
    const tempFilepath = await tryDownload(interaction.message.id, url, "mp3").catch(async () => {
      await interaction.editReply("The message URL was changed and cannot be downloaded.");
      return `Could not import changed URL into Plex for ${interaction.user.tag}`;
    });

    // ---------------------------------------------------------- //
    // Edit the interaction buttons and interaction reply message //
    // ---------------------------------------------------------- //

    const content = interaction.message.content;
    const buttons = interaction.message.components[0].components;
    const mp3Button = getMp3FormatButtonBuilder({ isDisabled: true });
    const plexButton = buttons.find(x => x.data.custom_id.includes("plex"));
    const components = [new ActionRowBuilder().addComponents(mp3Button, plexButton)];

    const files = [
      ...interaction.message.attachments.values(),
      new AttachmentBuilder(tempFilepath, { name: basename(tempFilepath) })
    ];

    let resultContent = `Uploaded a MP3 file for ${interaction.user.tag}`;
    let replyContent = "Your MP3 file was uploaded successfully.";

    await starterMessage.thread.setArchived(false);
    await interaction.message
      .edit({ content, files, components })
      .catch(async error => {
        switch (error.code) {
          case 40005:
            const fileSize = getFileSizeFromPath(tempFilepath);
            replyContent = `MP3 file size ${fileSize}MB exceeds the servers upload limit.`;
            resultContent = `Tried to edit a message with a download link that exceeded upload limit for ${interaction.user.tag}`;
            break;
          default:
            replyContent = "Discord timed out and aborted the MP3 upload. Try again later.";
            resultContent = `Tried to edit a message with a download link for ${interaction.user.tag} but the Discord API timed out.`;
            break;
        }
      })
      .finally(async () => {
        await interaction.editReply(replyContent);
        await starterMessage.thread.setArchived(true);
        fs.unlinkSync(tempFilepath);
      });

    return resultContent;
  }
};

// ------------ //
// Module Logic //
// ------------ //

const getMp3FormatButtonBuilder = ({ isDisabled }) =>
  new ButtonBuilder()
    .setDisabled(isDisabled)
    .setEmoji("🎧")
    .setCustomId(interactionActions.GetMP3)
    .setLabel(`Get as MP3`)
    .setStyle(ButtonStyle.Primary);

const getPlexImportButtonBuilder = ({ isDisabled }) =>
  new ButtonBuilder()
    .setDisabled(isDisabled)
    .setEmoji("<:plex:1093751472522543214>")
    .setCustomId(interactionActions.PlexImport)
    .setLabel("Import into Plex")
    .setStyle(ButtonStyle.Secondary);

const getPlexDeleteButtonBuilder = ({ isDisabled }) =>
  new ButtonBuilder()
    .setDisabled(isDisabled)
    .setEmoji("<:plex:1093751472522543214>")
    .setCustomId(interactionActions.PlexDelete)
    .setLabel("Delete from Plex")
    .setStyle(ButtonStyle.Secondary);

/**
 * Try downloading the file using yt-dlp and post processing with ffmpeg.
 * @param {string} url
 * @param {number} messageId
 * @param {string?} audioFormat
 * @returns {bool} Success
 */
async function tryDownload(id, url, audioFormat) {
  const options = {
    output: `${config.temp_directory}/${id}/%(title)s.%(ext)s`,
    format: "bestaudio/best",
    audioFormat: audioFormat, // nullable
    audioQuality: 0,
    extractAudio: true,
    embedMetadata: true,
    embedThumbnail: true,
    postprocessorArgs: `ffmpeg: -metadata album='Downloads' -metadata album_artist='Various Artists' -metadata date='' -metadata track=''`
  };

  // cli command:
  // yt-dlp https://www.youtube.com/watch?v=[VIDEO_ID] -f "bestaudio/best" --audio-quality 0 --extract-audio --embed-metadata --embed-thumbnail --postprocessor-args "ffmpeg: -metadata album='Downloads' -metadata album_artist='Various Artists' -metadata date=''  -metadata track=''"

  await youtubedl(url, options).catch(error => {
    throw new Error(error);
  });

  const filename = fs.readdirSync(`${config.temp_directory}/${id}`)[0];
  const filepath = `${config.temp_directory}/${id}/${filename}`;
  return filepath;
}
