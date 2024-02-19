import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { Cron } from "croner";
import { fetchRetryPolicy } from "../shared/helpers/constants.js";
import { findChannelMessage } from "../index.js";
import { getCronOptions } from "../shared/helpers/utilities.js";
import { tryDeleteMessageThread } from "../shared/helpers/discord.js";
import Config from "../shared/config.js";
import date from 'date-and-time';
import fetchRetry from 'fetch-retry';
import Logger from "../shared/logger.js";
import ordinal from 'date-and-time/plugin/ordinal';
import probe from "probe-image-size";
date.plugin(ordinal);

const config = new Config("steam_community_watcher_config.json");
const logger = new Logger("steam_community_watcher_script.js");

const fetch = fetchRetry(global.fetch, fetchRetryPolicy);

// ------------------------------------------------------------------------- //
// >> DISCORD EVENT HANDLERS                                              << //
// ------------------------------------------------------------------------- //

/**
 * Delete the child thread when its message parent is deleted
 * @param {Object} param
 * @param {Client} param.client The Discord.js client
 * @param {Message} param.message The deleted message
 */
export const onMessageDelete = ({ message }) => tryDeleteMessageThread({
  allowedChannelIds: [config.discord_announcement_channel_id],
  logger, starterMessage: message
});

/**
 * Check for pending announcements on startup and a regular time interval
 * @param {Object} param
 * @param {Client} param.client The Discord.js client
 */
export const onClientReady = async ({ client }) => {
  await config.initialize(client);
  await logger.initialize(client);

  const channel = await client.channels.fetch(config.discord_announcement_channel_id);

  const cronJob = async () => {
    for (const steam_app_id of config.announcement_steam_app_ids) {
      // validate steam app id or skip code execution
      if (!steam_app_id) logger.error("Invalid app_id value in config file");
      if (!steam_app_id) continue;

      // get steam announcement or skip code execution
      const steamAppAnnouncement = await getSteamAppMostRecentAnnouncement(steam_app_id);
      if (!steamAppAnnouncement) logger.warn(`Couldn't fetch announcement for app_id "${steam_app_id}"`);
      if (!steamAppAnnouncement) continue;

      // get steam app details or skip code execution
      const steamAppDetailsData = await getSteamAppDetailsData(steam_app_id);
      if (!steamAppDetailsData) logger.warn(`Couldn't fetch Steam details for app_id "${steam_app_id}"`);
      if (!steamAppDetailsData) continue;

      // if this message already exists skip code execution
      const find = ({ embeds }) => embeds?.[0]?.data?.description?.includes(steamAppAnnouncement.url);
      const channelMessage = await findChannelMessage(config.discord_announcement_channel_id, find);
      if (channelMessage) continue;

      // format the steam announcement date into a user-readable string
      // (multiply by 1000 to convert Unix timestamps to milliseconds)
      const parsedDate = new Date(steamAppAnnouncement.date * 1000);
      const formattedDate = date.format(parsedDate, "MMMM DDD");

      const map = match => match[1].replace("{STEAM_CLAN_IMAGE}", "https://clan.akamai.steamstatic.com/images/");
      const announcementImageUrls = [...steamAppAnnouncement.contents.matchAll(/\[img\](.*?)\[\/img\]/g)].map(map);

      // JavaScript .find() doesn't support async ... yay code smell! JavaScript is so good. Nobody could have ever predicted a need for async .find()!
      // const find = async url => await probe(url).then(({ height, width }) => width >= height * 1.25 && width <= height * 4); // validate image size
      let announcementImageUrl = steamAppDetailsData.header_image;

      for(const url of announcementImageUrls) {
        // why would we ever want to 1 line this when we could use the power of JAVASCRIPT to write a 5 line loop instead?!
        const isValidSize = await probe(url).then(({ height, width }) => width >= height * 1.25 && width <= height * 4);
        if (isValidSize) announcementImageUrl = url;
        if (isValidSize) break;
      }

      const embed = new EmbedBuilder();
      embed.setAuthor({ name: "New Steam Community announcement", iconURL: "attachment://steam_logo.png" });
      embed.setColor(0x1A9FFF);
      embed.setDescription(`- [**${steamAppAnnouncement.title}**](${steamAppAnnouncement.url})\n${formatAnnouncementDescription(steamAppAnnouncement)}`);
      embed.setFooter({ text: `Posted on ${formattedDate}. Click the link to read the full announcement.` });
      embed.setImage(announcementImageUrl);
      embed.setThumbnail(steamAppDetailsData.capsule_image);
      embed.setTitle(steamAppDetailsData.name);

      const message = await channel.send({
        embeds: [embed],
        files: [new AttachmentBuilder('assets\\steam_logo.png')]
      });

      let name = `💬 ${steamAppDetailsData.name} - ${steamAppAnnouncement.title}`;
      if (name.length > 100) name = name.slice(0, 97) + "...";
      await message.startThread({ name });

      logger.info(`Sent announcement for "${steam_app_id}" to ${channel.guild.name} #${channel.name}`)
    }
  }

  Cron(config.cron_job_announcement_pattern, getCronOptions(logger), cronJob).trigger();
  logger.info(`Queued Cron job with pattern "${config.cron_job_announcement_pattern}"`);
};

// ------------------------------------------------------------------------- //
// >> PLUGIN FUNCTIONS                                                    << //
// ------------------------------------------------------------------------- //

/**
 * Convert Steam announcement description BBCode to markdown for Discord formatting
 * @param {Object} steamAnnouncement
 */
function formatAnnouncementDescription(steamAnnouncement) {
  const endsWithPunctuation = input => {
    const punctuations = [".", ".\"", ",", ";", ":", "!", "?", "-", "(", ")", "[", "]", "{", "}"];
    return punctuations.some(punctuation => input.endsWith(punctuation));
  }

  const formattedContents = steamAnnouncement.contents.split('\n').map((textLine, index) => {
    let result = textLine.trim();
    if (result === steamAnnouncement.title && index === 0) return "";
    if (result.startsWith("[*]") && !endsWithPunctuation(result)) result = `${result};`;
    if (result.startsWith("-")) result = `${result.replace("-", "").trim()};`;
    result = result.replaceAll('“', '"').replaceAll('”', '"'); // swap non-standard quote characters
    result = result.replace(/\[img\][^[]+\[\/img\]/g, ''); // remove links nested between [img] tags
    result = result.replace(/\[\/?[^\]]+\]/g, '') // remove any bracket tags - [b], [i], [list], etc
    if (result && !endsWithPunctuation(result)) result += ".";
    return result.trim();
  }).filter(x => x).join(" ");

  let formattedDescription = "";

  for(const formattedContent of formattedContents.split(" ")) {
    if ((`${formattedDescription} ${formattedContent}`).length > 133) break;
    else formattedDescription += ` ${formattedContent}`;
  }

  return `_${formattedDescription} [...]_`;
}

/**
 * Get the game data from the Steam API
 * @param {Object} steam_app
 * @returns {Object}
 */
async function getSteamAppDetailsData(steam_app_id) {
  return await fetch(`https://store.steampowered.com/api/appdetails?appids=${steam_app_id}&l=english`)
    .then(response => response.json())
    .then(json => json[steam_app_id].data);
}

/**
 * Get the most recent announcement from the Steam API
 * @param {Object} steam_app
 * @returns {Object}
 */
async function getSteamAppMostRecentAnnouncement(steam_app_id) {
  return await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${steam_app_id}`)
    .then(response => response.json()) // "feed_type === 1" finds official announcements
    .then(({ appnews }) => appnews?.newsitems.find(({ feed_type }) => feed_type === 1));
}
