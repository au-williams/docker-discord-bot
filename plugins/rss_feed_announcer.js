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
    .setFunction(checkAndAnnounceRssUpdate)
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
export async function checkAndAnnounceRssUpdate({ client, listener }) {
  for(const rss_feed of config.announcement_rss_feeds) {
    const {
      discord_announcement_channel_ids, discord_embed_image,
      discord_embed_thumbnail, discord_embed_title, rss_feed_url,
      rss_content_ignored_strings, rss_content_required_strings,
      rss_title_ignored_strings, rss_title_required_strings
    } = rss_feed;

    const rss = await parser.parseURL(rss_feed_url).then(({ items }) =>
      items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)).find(({ content, title }) => {
        const includes = (source, str) => source.toLowerCase().includes(str.toLowerCase());
        const isContentIgnoredMet = !rss_content_ignored_strings?.length || !rss_content_ignored_strings.some(str => includes(content, str));
        const isContentRequirementMet = !rss_content_required_strings?.length || rss_content_required_strings.some(str => includes(content, str));
        const isTitleIgnoredMet = !rss_title_ignored_strings?.length || !rss_title_ignored_strings.some(str => includes(title, str));
        const isTitleRequirementMet = !rss_title_required_strings?.length || rss_title_required_strings.some(str => includes(title, str));
        return isContentIgnoredMet && isContentRequirementMet && isTitleIgnoredMet && isTitleRequirementMet;
      })
    );

    if (!rss) continue; // No suitable article was found!

    for(const channel_id of discord_announcement_channel_ids) {
      const existingMessage = Messages
        .get({ channelId: channel_id })
        .find(message => message.embeds?.[0]?.data.description?.includes(rss.link));

      if (existingMessage) continue; // Article was already sent!

      const hostName = URL.parse(rss.link).hostname;
      const articlePreview = await getLinkPreview(rss.link);
      const websitePreview = await getLinkPreview(`https://${hostName}`);

      const content = Utilities.removeTagsFromEncodedString(rss["content:encoded"] || rss.content);
      const description = Utilities.getTruncatedStringTerminatedByWord(content, 133);
      const formattedDate = date.format(new Date(rss.pubDate), "MMMM DDD");
      const title = discord_embed_title || websitePreview.siteName || websitePreview.title;

      // TODO: check if discord_embed_image and discord_embed_thumbnail include "https://" else upload file

      const embeds = [new EmbedBuilder()
        .setAuthor({ name: "New RSS announcement", iconURL: "attachment://rss_logo.png" })
        .setColor(0xF26109)
        .setDescription(`- [**${rss.title}**](${rss.link})\n_${description}_`)
        .setFooter({ text: `Posted on ${formattedDate}. Click the link to read the full announcement.` })
        .setImage(discord_embed_image || articlePreview.images[0])
        .setThumbnail(discord_embed_thumbnail || websitePreview.images[0])
        .setTitle(title)];

        const files = [new AttachmentBuilder("assets/rss_logo.png")];
        const channel = client.channels.cache.get(channel_id);
        const message = await channel.send({ embeds, files });
        Utilities.LogPresets.SentMessage(message, listener);

        const name =
          Utilities.getTruncatedStringTerminatedByChar(`💬 ${title} - ${rss.title}`, 100); // maximum thread name size

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
