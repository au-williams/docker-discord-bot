import { AttachmentBuilder, EmbedBuilder, Events } from "discord.js";
import { Config } from "../services/config.js";
import { Logger } from "../services/logger.js";
import { Messages } from "../services/messages.js";
import { Utilities } from "../services/utilities.js";
import CronJob from "../entities/CronJob.js";
import date from "date-and-time";
import emojiRegex from "emoji-regex";
import fetchRetry from "fetch-retry";
import Listener from "../entities/Listener.js";
import ordinal from "date-and-time/plugin/ordinal";
import probe from "probe-image-size";
date.plugin(ordinal);

const config = new Config(import.meta.filename);
const logger = new Logger(import.meta.filename);

const fetch = fetchRetry(global.fetch, Utilities.fetchRetryPolicy);

// TODO: Remove all emoji
// TODO: Headers end with :
// TODO: List items end with ;

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region EMITTER.JS LISTENERS                                              //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * The Cron jobs created by this script. The Cron jobs defined here will be
 * automatically scheduled by the framework to run based on their patterns.
 */
export const CronJobs = new Set([
  new CronJob()
    .setEnabled(Messages.isServiceEnabled)
    .setExpression(config.announcement_cron_job_expression)
    .setFunction(checkAndAnnounceUpdate)
    .setTriggered()
]);

/**
 * The event listeners handled by this script. The key is a Discord event or an
 * interaction property from the `Interactions<object>` variable. The value is
 * a `Listener` object and requires a function to be set. Listeners that only
 * set a function can use the function as the value and it will be wrapped in
 * a Listener by the framework for you automatically. When the key is emitted
 * by Discord then the value will be executed. You may use an array to define
 * multiple Listeners for a single key.
 */
export const Listeners = Object.freeze({
  [Events.MessageDelete]: new Listener()
    .setFunction(Utilities.deleteMessageThread)
    .setRequiredChannels(config.announcement_discord_channel_id)
});

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS LISTENERS                                           //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region PLUGIN LOGIC                                                      //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * Check for pending announcements on startup and a regular time interval
 * @param {object} param
 * @param {Client} param.client The Discord.js client
 * @param {Listener} param.listener
 */
export async function checkAndAnnounceUpdate({ client, listener }) {
  const channel = client.channels.cache.get(config.announcement_discord_channel_id);

  for (const steam_app_id of config.announcement_steam_app_ids) {
    // validate steam app id or skip code execution
    if (!steam_app_id) logger.error("Invalid app_id value in config file", listener);
    if (!steam_app_id) continue;

    // get steam announcement or skip code execution
    const steamAppAnnouncement = await getSteamAppMostRecentAnnouncement(steam_app_id);
    if (!steamAppAnnouncement) logger.warn(`Couldn't fetch announcement for app_id "${steam_app_id}"`, listener);
    if (!steamAppAnnouncement) continue;

    // get steam app details or skip code execution
    const steamAppDetailsData = await getSteamAppDetailsData(steam_app_id);
    if (!steamAppDetailsData) logger.warn(`Couldn't fetch Steam details for app_id "${steam_app_id}"`, listener);
    if (!steamAppDetailsData) continue;

    // if this message already exists skip code execution
    const channelMessage = Messages
      .get({ channelId: config.announcement_discord_channel_id})
      .find(({ embeds }) => embeds?.[0]?.data?.description?.includes(steamAppAnnouncement.url));
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

    const embeds = [new EmbedBuilder()
      .setAuthor({ name: "New Steam Community announcement", iconURL: "attachment://steam_logo.png" })
      .setColor(0x1A9FFF)
      .setDescription(`- [**${steamAppAnnouncement.title}**](${steamAppAnnouncement.url})\n${formatAnnouncementDescription(steamAppAnnouncement)}`)
      .setFooter({ text: `Posted on ${formattedDate}. Click the link to read the full announcement.` })
      .setImage(announcementImageUrl)
      .setThumbnail(steamAppDetailsData.capsule_image)
      .setTitle(steamAppDetailsData.name)];

    const files = [new AttachmentBuilder("assets/steam_logo.png")];
    const message = await channel.send({ embeds, files });
    Utilities.LogPresets.SentMessage(message, listener);

    const name =
      Utilities.getTruncatedStringTerminatedByChar(`💬 ${steamAppDetailsData.name} - ${steamAppAnnouncement.title}`, 100); // maximum thread name size

    message
      .startThread({ name })
      .then(result => Utilities.LogPresets.CreatedThread(result, listener))
      .catch(error => logger.error(error, listener));
  }
}

/**
 * Convert Steam announcement description BBCode to markdown for Discord formatting
 * @param {object} steamAnnouncement
 * @returns {string}
 */
export function formatAnnouncementDescription(steamAnnouncement) {
  const contents = steamAnnouncement.contents.split("\n").map(content => {
    content = content.replaceAll("“", "\"") // replace non-standard quote characters
    content = content.replaceAll("”", "\"") // replace non-standard quote characters
    content = content.replaceAll(/\[img\][^[]+\[\/img\]/g, "") // remove [img] tags
    content = content.replaceAll(/\[\/?[^\]]+\]/g, "") // remove any formatted tags
    content = content.trim();
    const emojiMatches = content.match(emojiRegex());
    const punctuations = [".", ".\"", ",", ";", ":", "!", "?", "-", "(", ")", "[", "]", "{", "}"];
    const isEndsWithEmoji = emojiMatches?.some(match => content.endsWith(match));
    const isEndsWithPunctuation = punctuations.some(punctuation => content.endsWith(punctuation));
    if (content && !isEndsWithEmoji && !isEndsWithPunctuation) content += ".";
    return content;
  }).filter(content => content);

  // drop the duplicate title if it was included in Steams API response
  const title = Utilities.getStringWithoutEmojis(steamAnnouncement.title).trim();
  if (contents.length && contents[0].startsWith(title)) contents.shift();
  return `_${Utilities.getTruncatedStringTerminatedByWord(contents.join(" "), 133)}_`;
}

/**
 * Get the game data from the Steam API.
 * @param {string} steam_app_id
 * @returns {Promise<object>}
 */
async function getSteamAppDetailsData(steam_app_id) {
  return await fetch(`https://store.steampowered.com/api/appdetails?appids=${steam_app_id}&l=english`)
    .then(response => response.json())
    .then(json => json[steam_app_id].data);
}

/**
 * Get the most recent announcement from the Steam API.
 * @param {string} steam_app_id
 * @returns {Promise<object>}
 */
async function getSteamAppMostRecentAnnouncement(steam_app_id) {
  return await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${steam_app_id}`)
    .then(response => response.json()) // "feed_type === 1" finds official announcements
    .then(({ appnews }) => appnews?.newsitems.find(({ feed_type }) => feed_type === 1));
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN LOGIC                                                   //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
