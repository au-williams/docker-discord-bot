import { AttachmentBuilder, EmbedBuilder, Events } from "discord.js";
import { Config } from "../services/config.js";
import { getLinkPreview } from "link-preview-js";
import { Logger } from "../services/logger.js";
import { Messages } from "../services/messages.js";
import { Utilities } from "../services/utilities.js";
import * as URL from "url";
import CronJob from "../entities/CronJob.js";
import date from "date-and-time";
import Listener from "../entities/Listener.js";
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

export const Listeners = Object.freeze({
  [Events.MessageDelete]: new Listener()
    .setFunction(Utilities.deleteMessageThread)
    .setRequiredChannels(config.announcement_discord_channel_ids)
});

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
 * TODO: Move this to utils, use in steam plugin
 */
export function removeTags(str) {
  return str
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035']/g, "'")
    .replace(/<h[1-6]>(.*?)<\/h[1-6]>/gi, "$1:")
    .replace(/(<([^>]+)>)/ig, "")
    .replace(/\s+/g, " ");
}

/**
 * Check for pending announcements on startup and a regular time interval
 * @param {object} param
 * @param {Client} param.client The Discord.js client
 * @param {Listener} param.listener
 */
export async function checkAndAnnounceRssUpdate({ client, listener }) {
  for(const { url, ignored_strings, required_strings } of config.rss_feeds) {
    const rss = await parser.parseURL(url).then(({ items }) =>
      items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)).find(item => {
        const isIgnoredMet = !ignored_strings?.length || !ignored_strings.some(str => item.title.toLowerCase().includes(str.toLowerCase()));
        const isRequirementMet = !required_strings?.length || required_strings.some(str => item.title.toLowerCase().includes(str.toLowerCase()));
        return isIgnoredMet && isRequirementMet;
      })
    );

    for(const channel_id of config.announcement_discord_channel_ids) {
      const existingMessage = Messages
        .get({ channelId: channel_id })
        .find(message => message.embeds?.[0]?.data.description?.includes(rss.link));

      if (existingMessage) continue;

      const hostName = URL.parse(rss.link).hostname;
      const articlePreview = await getLinkPreview(rss.link);
      const websitePreview = await getLinkPreview(`https://${hostName}`);

      const content = rss["content:encoded"] || rss.content;
      const description = Utilities.getTruncatedStringTerminatedByWord(removeTags(content), 133);
      const formattedDate = date.format(new Date(rss.pubDate), "MMMM DDD");
      const siteName = websitePreview.siteName || websitePreview.title;

      const embeds = [new EmbedBuilder()
        .setAuthor({ name: "New RSS announcement", iconURL: "attachment://rss_logo.png" })
        .setColor(0xF26109)
        .setDescription(`- [**${rss.title}**](${rss.link})\n${`_${description}_`}`)
        .setFooter({ text: `Posted on ${formattedDate}. Click the link to read the full announcement.` })
        .setImage(articlePreview.images[0])
        .setThumbnail(websitePreview.images[0])
        .setTitle(siteName)];

        const files = [new AttachmentBuilder("assets/rss_logo.png")];
        const channel = client.channels.cache.get(channel_id);
        const message = await channel.send({ embeds, files });
        Utilities.LogPresets.SentMessage(message, listener);

        const name =
          Utilities.getTruncatedStringTerminatedByChar(`💬 ${siteName} - ${rss.title}`, 100); // maximum thread name size

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
