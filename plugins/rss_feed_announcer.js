import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { Config } from "../services/config.js";
import { getLinkPreview } from "link-preview-js";
import { Logger } from "../services/logger.js";
import { Messages } from "../services/messages.js";
import { Utilities } from "../services/utilities.js";
import * as URL from "url";
import CronJob from "../entities/CronJob.js";
import date from "date-and-time";
import ordinal from "date-and-time/plugin/ordinal";
import Parser from "rss-parser";
date.plugin(ordinal);

const config = new Config(import.meta.filename);
const logger = new Logger(import.meta.filename);

const parser = new Parser();

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
  for(const rss_feed of config.announcement_rss_feeds) {
    const {
      discord_announcement_channel_ids, discord_override_embed_image,
      discord_override_embed_thumbnail, discord_override_embed_title,
      rss_feed_url, rss_ignored_strings_content, rss_required_strings_content,
      rss_ignored_strings_title, rss_required_strings_title
    } = rss_feed;

    // Sort the results by the most recent date and find by config criteria
    const article = await parser.parseURL(rss_feed_url).then(({ items }) =>
      items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)).find(({ content, title }) => {
        const includes = (source, str) => str.trim() && source.toLowerCase().includes(str.toLowerCase());
        const isIgnoredContentValid = !rss_ignored_strings_content?.length || !rss_ignored_strings_content.some(str => includes(content, str));
        const isIgnoredTitleValid = !rss_ignored_strings_title?.length || !rss_ignored_strings_title.some(str => includes(title, str));
        const isRequiredContentValid = !rss_required_strings_content?.length || rss_required_strings_content.some(str => includes(content, str));
        const isRequiredTitleValid = !rss_required_strings_title?.length || rss_required_strings_title.some(str => includes(title, str));
        return isIgnoredContentValid && isIgnoredTitleValid && isRequiredContentValid && isRequiredTitleValid;
      })
    );

    if (!article) continue; // No suitable article was found!

    for(const channel_id of discord_announcement_channel_ids) {
      const existingMessage = Messages
        .get({ channelId: channel_id })
        .find(message => message.embeds?.[0]?.data.description?.includes(article.link));

      if (existingMessage) continue; // Article was already sent!

      const hostName = URL.parse(article.link).hostname;
      const articlePreview = await getLinkPreview(article.link);
      const websitePreview = await getLinkPreview(`https://${hostName}`);

      const content = Utilities.removeTagsFromEncodedString(article["content:encoded"] || article.content);
      const description = Utilities.getTruncatedStringTerminatedByWord(content, 133);
      const formattedDate = date.format(new Date(article.pubDate), "MMMM DDD");
      const title = discord_override_embed_title || websitePreview.siteName || websitePreview.title;

      /* -------------------------------------------------------------------------------- *
       * TODO: Check if discord_override_embed_image and discord_override_embed_thumbnail *
       *       include "https://" to determine if an image attachment should be uploaded! *
       * -------------------------------------------------------------------------------- */

      const embeds = [new EmbedBuilder()
        .setAuthor({ name: "New RSS announcement", iconURL: "attachment://rss_logo.png" })
        .setColor(0xF26109)
        .setDescription(`- [**${article.title}**](${article.link})\n_${description}_`)
        .setFooter({ text: `Posted on ${formattedDate}. Click the link to read the full announcement.` })
        .setImage(discord_override_embed_image || articlePreview.images[0])
        .setThumbnail(discord_override_embed_thumbnail || websitePreview.images[0])
        .setTitle(title)];

        const files = [new AttachmentBuilder("assets/rss_logo.png")];
        const channel = client.channels.cache.get(channel_id);
        const message = await channel.send({ embeds, files });
        Utilities.LogPresets.SentMessage(message, listener);

        const name =
          Utilities.getTruncatedStringTerminatedByChar(`💬 ${title} - ${article.title}`, 100); // maximum thread name size

        message
          .startThread({ name })
          .then(result => Utilities.LogPresets.CreatedThread(result, listener))
          .catch(error => logger.error(error, listener));
    }
  }
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN LOGIC                                                   //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
