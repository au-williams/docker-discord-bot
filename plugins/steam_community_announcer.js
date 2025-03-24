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
// #region EMITTER.JS IMPORTS                                                //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

export const CronJobs = new Set([
  new CronJob()
    .setEnabled(Messages.isServiceEnabled)
    .setExpression(config.announcement_cron_job_expression)
    .setFunction(checkAndAnnounceUpdates)
    .setTriggered()
]);

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS IMPORTS                                             //
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
export async function checkAndAnnounceUpdates({ client, listener }) {
  for (const steam_app of config.announcement_steam_apps) {
    const {
      discord_announcement_channel_ids, discord_override_embed_image,
      discord_override_embed_thumbnail, discord_override_embed_title,
      steam_app_id, steam_ignored_strings_content, steam_ignored_strings_title,
      steam_required_strings_content, steam_required_strings_title
    } = steam_app;

    const steamAppAnnouncement = await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${steam_app_id}`)
      .then(response => response.json())
      .then(({ appnews }) => appnews?.newsitems.find(({ contents, feed_type, title }) => {
        if (feed_type !== 1) return false; // "feed_type === 1" are official announcements
        const includes = (source, str) => str.trim() && source.toLowerCase().includes(str.toLowerCase());
        const isIgnoredContentValid = !steam_ignored_strings_content?.length || !steam_ignored_strings_content.some(str => includes(contents, str));
        const isIgnoredTitleValid = !steam_ignored_strings_title?.length || !steam_ignored_strings_title.some(str => includes(title, str));
        const isRequiredContentValid = !steam_required_strings_content?.length || steam_required_strings_content.some(str => includes(contents, str));
        const isRequiredTitleValid = !steam_required_strings_title?.length || steam_required_strings_title.some(str => includes(title, str));
        return isIgnoredContentValid && isIgnoredTitleValid && isRequiredContentValid && isRequiredTitleValid;
      }));

      console.log("steamAppAnnouncement")
      console.log(steamAppAnnouncement)

    if (!steamAppAnnouncement) continue;

    const steamAppDetailsData = await fetch(`https://store.steampowered.com/api/appdetails?appids=${steam_app_id}&l=english`)
      .then(response => response.json())
      .then(json => json[steam_app_id].data);

    if (!steamAppDetailsData) continue;

    for (const channel_id of discord_announcement_channel_ids) {
      const existingMessage = Messages
        .get({ channelId: channel_id })
        .find(({ embeds }) => embeds?.[0]?.data?.description?.includes(steamAppAnnouncement.url));

      if (existingMessage) continue; // Article was already sent!

      const content = Utilities.removeHtmlCodeTags(steamAppAnnouncement.contents);
      const description = Utilities.getTruncatedStringTerminatedByWord(content, 133);
      const parsedDate = new Date(steamAppAnnouncement.date * 1000);
      const formattedDate = date.format(parsedDate, "MMMM DDD");

      const image = discord_override_embed_image.trim()
        || await getLandscapeImage(steamAppAnnouncement)
        || steamAppDetailsData.header_image;

      const embeds = [new EmbedBuilder()
        .setAuthor({ name: "New Steam Community announcement", iconURL: "attachment://steam_logo.png" })
        .setColor(0x1A9FFF)
        .setDescription(`- [**${steamAppAnnouncement.title}**](${steamAppAnnouncement.url})\n_${description}_`)
        .setFooter({ text: `Posted on ${formattedDate}. Click the link to read the full announcement.` })
        .setImage(image)
        .setThumbnail(discord_override_embed_thumbnail.trim() || steamAppDetailsData.capsule_image)
        .setTitle(discord_override_embed_title.trim() || steamAppDetailsData.name)];

      const files = [new AttachmentBuilder("assets/steam_logo.png")];
      const channel = client.channels.cache.get(channel_id);
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
}

/**
 * Get the first landscape orientation from the announcement contents.
 * @async
 * @param {object} steamAppAnnouncement
 * @returns {string?}
 */
async function getLandscapeImage(steamAppAnnouncement) {
  // Replace API string symbols with their real value
  const map = match => match[1].replace("{STEAM_CLAN_IMAGE}", "https://clan.akamai.steamstatic.com/images/");
  const announcementImageUrls = [...steamAppAnnouncement.contents.matchAll(/\[img\](.*?)\[\/img\]/g)].map(map);

  for(const url of announcementImageUrls) {
    const isValidSize = await probe(url).then(({ height, width }) => width >= height * 1.25 && width <= height * 4);
    if (isValidSize) return url;
  }
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN LOGIC                                                   //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
