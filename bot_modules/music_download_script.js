import { basename } from "path";
import { getUrlFromString, getFileSizeFromPath, tryDeleteDiscordMessages } from "../utilities.js";
import * as oembed from "@extractus/oembed-extractor";
import config from "./music_download_config.json" assert { type: "json" };
import fs from "fs-extra";
import youtubedl from "youtube-dl-exec";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

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

  const files = [
    await tryDownload(message.id, url).catch(async () => {
      const reply = await message.reply("This link is unsupported and cannot download.");
      await message.thread.setName("⚠ Download was aborted");
      setTimeout(async () => tryDeleteDiscordMessages(message, reply), 10000);
      return `Deleted message with unsupported link from ${message.author.tag}`;
    })
  ];

  // ----------------------------------------------------- //
  // send the file attachment or an error if one is thrown //
  // ----------------------------------------------------- //

  // let resultContent = "";
  let content = "This track is ready to be downloaded using the link below.";

  const mp3Button = new ButtonBuilder()
    .setCustomId(interactionActions.GetMp3Button)
    .setDisabled(files[0].endsWith(".mp3"))
    .setEmoji("🎧")
    .setLabel(`Get MP3 file`)
    .setStyle(files[0].endsWith(".mp3") ? ButtonStyle.Secondary : ButtonStyle.Primary);

  const plexButton = new ButtonBuilder()
    .setCustomId(interactionActions.PlexImportButton)
    .setDisabled(false)
    .setEmoji("<:plex:1093751472522543214>")
    .setLabel("Import into Plex")
    .setStyle(ButtonStyle.Secondary);

  const components = [new ActionRowBuilder().addComponents(mp3Button, plexButton)];

  message.thread
    .send({ content, components, files })
    .then(async () => {
      await message.thread.setName("💿 Download is ready");
      // resultContent = `Sent a reply with download link to ${message.author.tag}`;
    })
    .catch(async error => {
      switch (error.code) {
        case 40005:
          const fileSize = getFileSizeFromPath(files[0]);
          content = `File size ${fileSize}MB exceeds the servers upload limit.`;
          components[0].components[0].setDisabled(true); // disable MP3 button
          await message.thread.setName("⚠ Upload exceeds limit");
          await message.thread.send({ content, components });
          // resultContent = `Tried to send a reply with download link that exceeded upload limit to ${message.author.tag}`;
          break;
        default:
          content = "The Discord API timed out and aborted the upload.";
          await message.thread.setName("⚠ Upload was aborted");
          await message.thread.send({ content, components });
          // resultContent = `Tried to send a reply with download link to ${message.author.tag} but the Discord API timed out.`;
          break;
      }
    })
    .finally(() => fs.unlinkSync(files[0]));

  // return resultContent;
};

const interactionActions = Object.freeze({
  GetMp3Button: "music_download_script_get_mp3",
  PlexImportButton: "music_download_script_plex_import_button",
  PlexDeleteButton: "music_download_script_plex_delete_button",
  PlexImportModal: "music_download_script_plex_import_modal",
  PlexDeleteModal: "music_download_script_plex_delete_modal"
});

const verifyInteractionChannel = async ({ channel, message }) => {
  switch (channel.type) {
    case ChannelType.GuildText:
      return config.channel_ids.includes(channel.id);
    case ChannelType.PublicThread:
      const starterMessage = await message.channel.fetchStarterMessage();
      return config.channel_ids.includes(starterMessage.channelId);
    case ChannelType.DM:
      return true;
    default:
      throw new Error(`Unexpected channel type: ${channel.type}`);
  }
};

export const OnInteractionCreate = async ({ interaction }) => {
  const isAction = Object.values(interactionActions).includes(interaction.customId);
  const isChannel = await verifyInteractionChannel(interaction);
  if (!isAction || !isChannel) return null;

  switch (interaction.customId) {
    case interactionActions.GetMp3Button:
      return onGetMp3Button(interaction);
    case interactionActions.PlexImportButton:
      return onPlexImportButton(interaction);
    case interactionActions.PlexDeleteButton:
      return onPlexDeleteButton(interaction);
    case interactionActions.PlexImportModal:
      return onPlexImportModal(interaction);
    case interactionActions.PlexDeleteModal:
      return onPlexDeleteModal(interaction);
  }

  /**
   * Create and show the "PlexImportModal" when the "PlexImportButton" button is pressed
   * @param {ButtonInteraction} interaction
   */
  async function onPlexImportButton(interaction) {
    // ----------------------------------------------------- //
    // Fetch music file metadata values from the page source //
    // ----------------------------------------------------- //

    const starterMessage = await interaction.message.channel.fetchStarterMessage();
    const url = getUrlFromString(starterMessage.content);
    let { title, author_name } = await oembed.extract(url);

    if (title.endsWith(` by ${author_name}`)) {
      // SoundCloud provides redundant information in title
      title = title.slice(0, -` by ${author_name}`.length);
    }

    // ------------------------------------------------------ //
    // Create a modal to update metadata values before import //
    // ------------------------------------------------------ //

    const titleInput = new TextInputBuilder()
      .setCustomId("title")
      .setLabel("Track Title")
      .setRequired(true)
      .setStyle(TextInputStyle.Short)
      .setValue(title);

    const artistInput = new TextInputBuilder()
      .setCustomId("artist")
      .setLabel("Track Artist")
      .setRequired(true)
      .setStyle(TextInputStyle.Short)
      .setValue(author_name);

    const genreInput = new TextInputBuilder()
      .setCustomId("genre")
      .setLabel("Track Genre")
      .setRequired(false)
      .setStyle(TextInputStyle.Short);

    const modal = new ModalBuilder()
      .setCustomId(interactionActions.PlexImportModal)
      .setTitle("Import into Plex")
      .addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(artistInput),
        new ActionRowBuilder().addComponents(genreInput)
      );

    await interaction.showModal(modal);
  }

  /**
   * Create and show the "PlexDeleteModal" when the "PlexDeleteButton" button is pressed
   * @param {ButtonInteraction} interaction
   */
  async function onPlexDeleteButton(interaction) {
    const reasonInput = new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Reason for deletion")
      .setRequired(true)
      .setStyle(TextInputStyle.Paragraph);

    const modal = new ModalBuilder()
      .setCustomId(interactionActions.PlexDeleteModal)
      .setTitle("Delete from Plex")
      .addComponents(new ActionRowBuilder().addComponents(reasonInput));

    await interaction.showModal(modal);
  }

  async function onPlexDeleteModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // -------------------------------------------------------- //
    // Verify the interaction user has the configured Plex role //
    // -------------------------------------------------------- //

    if (!interaction.member.roles.cache.has(config.plex_user_role_id)) {
      const content = "You aren't authorized to delete this from Plex.";
      const files = [{ attachment: "assets\\you_are_arrested.png" }];
      interaction.editReply({ content, files, ephemeral: true });
      return `Denied deleting a file from Plex for ${interaction.user.tag}`;
    }

    // ---------------------------------------------------------- //
    // Edit the interaction buttons and interaction reply message //
    // ---------------------------------------------------------- //

    // todo: fs delete

    const row = ActionRowBuilder.from(interaction.message.components[0]);
    row.components[1]
      .setCustomId(interactionActions.PlexImportButton)
      .setDisabled(false)
      .setLabel("Import into Plex");

    interaction.message.edit({ components: [row] });
    interaction.followUp({ content: "This isn't implemented yet.", ephemeral: true });
    return `Deleted a file from Plex for ${interaction.user.tag}`;
  }

  async function onPlexImportModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // -------------------------------------------------------- //
    // Verify the interaction user has the configured Plex role //
    // -------------------------------------------------------- //

    if (!interaction.member.roles.cache.has(config.plex_user_role_id)) {
      const content = "You aren't authorized to import this into Plex.";
      const files = [{ attachment: "assets\\you_are_arrested.png" }];
      interaction.editReply({ content, files, ephemeral: true });
      return `Denied importing a file into Plex for ${interaction.user.tag}`;
    }

    // -------------------------------------------------------- //
    // Get dependencies and check for any invalid module states //
    // -------------------------------------------------------- //

    const row = ActionRowBuilder.from(interaction.message.components[0]);
    row.components[1].setDisabled(true); // disable plex button component
    interaction.message.edit({ components: [row] });

    const starterMessage = await interaction.message.channel.fetchStarterMessage();
    const url = getUrlFromString(starterMessage.content);

    const tempFilepath = await tryDownload(interaction.message.id, url, {
      title: interaction.fields.getTextInputValue("title"),
      artist: interaction.fields.getTextInputValue("artist"),
      genre: interaction.fields.getTextInputValue("genre")
    }).catch(async () => {
      await interaction.deleteReply();
      interaction.followUp("The message link changed and can't be used.");
      return `Could not import changed URL into Plex for ${interaction.user.tag}`;
    });

    // ---------------------------------------------------------- //
    // Edit the interaction buttons and interaction reply message //
    // ---------------------------------------------------------- //

    const destination = `${config.plex_directory}/${basename(tempFilepath)}`;
    // const isOverwrite = fs.existsSync(destination); (for verbose logging)
    fs.moveSync(tempFilepath, destination, { overwrite: true });
    await interaction.deleteReply();

    row.components[1]
      .setCustomId(interactionActions.PlexDeleteButton)
      .setDisabled(false)
      .setLabel("Delete from Plex");

    interaction.message.edit({ components: [row] });
    interaction.followUp({
      content: `Success! Your file was imported into Plex and will be visible after the next automated library scan.`,
      ephemeral: true
    });

    return `Imported a file into Plex for ${interaction.user.tag}`;
  }

  /**
   * Download the URL as MP3 and append it to the interaction message.
   * @param {ButtonInteraction} interaction
   * @returns {string} response
   */
  async function onGetMp3Button(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // -------------------------------------------------------- //
    // Get dependencies and check for any invalid module states //
    // -------------------------------------------------------- //

    const row = ActionRowBuilder.from(interaction.message.components[0]);
    row.components[0].setStyle(ButtonStyle.Secondary).setDisabled(true);
    interaction.message.edit({ components: [row] });

    const starterMessage = await interaction.message.channel.fetchStarterMessage();
    const url = getUrlFromString(starterMessage.content);
    const tempFilepath = await tryDownload(interaction.message.id, url, {
      audioFormat: "mp3"
    }).catch(async () => {
      await interaction.deleteReply();
      row.components[0].setStyle(ButtonStyle.Primary).setDisabled(false);
      interaction.message.edit({ components: [row] });
      const content = "The message link changed and can't be used.";
      interaction.followUp({ content, ephemeral: true });
      return `Could not import changed URL into Plex for ${interaction.user.tag}`;
    });

    // ---------------------------------------------------------- //
    // Edit the interaction buttons and interaction reply message //
    // ---------------------------------------------------------- //

    const files = [...interaction.message.attachments.values()];
    files.push(new AttachmentBuilder(tempFilepath, { name: basename(tempFilepath) }));

    let resultContent = `Uploaded a MP3 file for ${interaction.user.tag}`;
    let replyContent = "Your MP3 file was uploaded successfully.";

    await interaction.message
      .edit({ components: [row], files })
      .catch(error => {
        row.components[0].setStyle(ButtonStyle.Primary).setDisabled(false);
        interaction.message.edit({ components: [row] });

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
        await interaction.deleteReply();
        interaction.followUp({ content: replyContent, ephemeral: true });
        fs.unlinkSync(tempFilepath);
      });

    return resultContent;
  }
};

// ------------ //
// Module Logic //
// ------------ //

/**
 * Try downloading the file using yt-dlp and post processing with ffmpeg.
 * @param {string} url
 * @param {number} messageId
 * @param {object} options
 * @returns {bool} Success
 */
async function tryDownload(id, url, options) {
  let postprocessorArgs = `ffmpeg: -metadata album='Downloads' -metadata album_artist='Various Artists' -metadata date='' -metadata track=''`;
  if (options?.title) postprocessorArgs += ` -metadata title='${options.title}'`;
  if (options?.artist) postprocessorArgs += ` -metadata artist='${options.artist}'`;
  if (options?.genre) postprocessorArgs += ` -metadata genre='${options.genre}'`;

  await youtubedl(url, {
    output: `${config.temp_directory}/${id}/%(title)s.%(ext)s`,
    format: "bestaudio/best",
    audioFormat: options?.audioFormat, // nullable
    audioQuality: 0,
    extractAudio: true,
    embedMetadata: true,
    embedThumbnail: true,
    postprocessorArgs
  }).catch(error => {
    throw new Error(error);
  });

  // cli command:
  // yt-dlp https://www.youtube.com/watch?v=[VIDEO_ID] -f "bestaudio/best" --audio-quality 0 --extract-audio --embed-metadata --embed-thumbnail --postprocessor-args "ffmpeg: -metadata album='Downloads' -metadata album_artist='Various Artists' -metadata date=''  -metadata track=''"

  const filename = fs.readdirSync(`${config.temp_directory}/${id}`)[0];
  const filepath = `${config.temp_directory}/${id}/${filename}`;
  return filepath;
}
