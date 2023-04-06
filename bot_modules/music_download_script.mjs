import { basename } from "path";
import { createRequire } from "module";
import { extract } from "@extractus/oembed-extractor";
import { parseFile } from "music-metadata";
const require = createRequire(import.meta.url);
const config = require("./music_download_config.json");
const youtubedl = require("youtube-dl-exec");
const fs = require("fs-extra");

// ------------- //
// Discord Hooks //
// ------------- //

export const OnMessageCreate = async (client, message) => {
  // Verify the message channel and message author
  const isConfigChannel = config.channel_ids.includes(message.channel.id);
  if (!isConfigChannel || message.author.bot) return;
  message.suppressEmbeds(config.suppress_embed);

  // Verify the message content contains a URL
  const url = GetUrlFromString(message.content);
  if (!url) {
    const reply = await message.reply("Please only send music links to this channel.");
    setTimeout(() => message.delete() && reply.delete(), 10000);
    return `Deleted message without link from ${message.author.tag}`;
  }

  // Verify the message content URL is successfully downloaded
  const isDownloadSuccess = await TryDownload(url, message.id);
  if (!isDownloadSuccess) {
    const reply = await message.reply("This link is unsupported and cannot download.");
    setTimeout(() => message.delete() && reply.delete(), 10000);
    return `Deleted message with unsupported link from ${message.author.tag}`;
  }

  await SendDownloadMessage(message);
  TryMoveDeleteFileFromTemp(message);

  return `Sent a reply with download link to ${message.author.tag}`;
};

// ------------ //
// Module Logic //
// ------------ //

/**
 * Get the size of a file in megabytes rounded to two decimal places.
 * @param {string} filepath
 * @returns {number}
 */
function GetFileSize(filepath) {
  return Math.round((fs.statSync(filepath).size / (1024 * 1024) + Number.EPSILON) * 100) / 100;
}

/**
 * Get the URL from a string regardless of its position therein.
 * @param {string} input
 * @returns {string|null}
 */
function GetUrlFromString(input) {
  const urlRegex = /(https?:\/\/[^\s]+)/;
  const match = input.match(urlRegex);
  return (match && match[1]) || null;
}

/**
 * Send the embedded message with a thread containing the download link.
 * @param {string} filepath
 * @param {Message} message
 */
async function SendDownloadMessage(message) {
  // ------------------------------------------- //
  // load dependencies and populate embed fields //
  // ------------------------------------------- //
  const filename = fs.readdirSync(`${config.temp_directory}/${message.id}`)[0];
  const filepath = `${config.temp_directory}/${message.id}/${filename}`;

  const fileSize = GetFileSize(filepath);
  const metadata = await parseFile(filepath).catch(console.error);
  const { artist, album, albumartist } = metadata.common;

  const title = `${basename(filepath)} (${fileSize} MB)`;
  const description = `- **Artist**: ${artist}\n- **Album**: ${album}\n- **Album Artist**: ${albumartist}`;
  const url = (await extract(GetUrlFromString(message.content))).thumbnail_url;
  const text = `Content may not appear in Plex until the next automated library refresh.`;

  // ------------------------------------------- //
  // send embed message and download file thread //
  // ------------------------------------------- //

  const replyMessage = await message.reply({
    allowedMentions: { repliedUser: false },
    embeds: [{ type: "rich", title, description, thumbnail: { url }, footer: { text } }]
  });

  const replyThread = await replyMessage
    .startThread({ name: "⏳ Uploading your file" })
    .then(async thr => thr.setLocked(true))
    .catch(console.error);

  if (fileSize < 8) {
    await replyThread
      .send({ files: [filepath] })
      .then(() => replyThread.setName("👍 Download is ready").then(x => x.setArchived(true)))
      .catch(() => {
        replyThread.send({ content: `The Discord API timed out and aborted the upload.` });
        replyThread.setName("👎 Upload was aborted").then(x => x.setArchived(true));
      });
  } else {
    await replyThread
      .send({ content: `File size ${fileSize}MB exceeds the 8MB upload limit.` })
      .finally(() => replyThread.setName("👎 Upload exceeds limit").then(x => x.setArchived(true)));
  }
}

/**
 * Try downloading the file using yt-dlp and post processing with ffmpeg.
 * @param {string} url
 * @param {number} messageId
 * @returns {bool} Success
 */
async function TryDownload(url, messageId) {
  const directory = `${config.temp_directory}/${messageId}/`;

  await youtubedl(url, {
    output: `${directory}/%(title)s.%(ext)s`,
    format: "bestaudio/best",
    // audioFormat: "mp3",
    audioQuality: 0,
    extractAudio: true,
    embedMetadata: true,
    embedThumbnail: true,
    postprocessorArgs: `ffmpeg: -metadata album='Downloads' -metadata album_artist='Various Artists' -metadata year=''`
  }).catch(() => null); // I don't care about this error and neither should you - it's handled in the calling function.

  return fs.existsSync(directory) && fs.readdirSync(directory).length;
}

/**
 * Try moving the file from temp storage to the media library.
 * @param {Message} message Discord.js Message
 * @returns {string} Download filepath
 */
function TryMoveDeleteFileFromTemp(message) {
  const filename = fs.readdirSync(`${config.temp_directory}/${message.id}`)[0];
  const tempFilepath = `${config.temp_directory}/${message.id}/${filename}`;
  const plexFilepath = `${config.plex_directory}/${filename}`;

  // ----------------------------------------- //
  // move the file if it doesn't already exist //
  // ----------------------------------------- //

  if (!fs.existsSync(plexFilepath)) {
    fs.moveSync(tempFilepath, plexFilepath);
  }

  // ----------------------------------------- //
  // delete the temp folder and anything in it //
  // ----------------------------------------- //

  const rmDirectory = `${config.temp_directory}/${message.id}`;
  const rmOptions = { recursive: true, force: true };
  fs.rmSync(rmDirectory, rmOptions);
}
