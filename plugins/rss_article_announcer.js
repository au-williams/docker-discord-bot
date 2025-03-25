import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { Config } from "../services/config.js";
import { Emitter } from "../services/emitter.js";
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
    .setFunction(checkAndAnnounceUpdates)
    .setTriggered()
]);

export const Interactions = Object.freeze({
  ButtonSubscribeMe: "RSS_BUTTON_SUBSCRIBE_ME",
  ButtonUnsubscribeMe: "RSS_BUTTON_UNSUBSCRIBE_ME",
});

export const Listeners = Object.freeze({
  [Interactions.ButtonSubscribeMe]: new Listener()
    .setDescription("Pressing this button adds ${DISPLAYNAME} to the list of users pinged when news for \"${EMBED_TITLE}\" is sent.")
    .setFunction(onButtonSubscribeMe),
  [Interactions.ButtonUnsubscribeMe]: new Listener()
    .setDescription("Pressing this button removes ${DISPLAYNAME} from the list of users pinged when news for \"${EMBED_TITLE}\" is sent.")
    .setFunction(onButtonUnsubscribeMe),
});

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS IMPORTS                                             //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

const buttonSubscribeMe = new ButtonBuilder()
  .setCustomId(Interactions.ButtonSubscribeMe)
  .setEmoji("🔔")
  .setLabel("Subscribe me")
  .setStyle(ButtonStyle.Success);

const buttonUnsubscribeMe = new ButtonBuilder()
  .setCustomId(Interactions.ButtonUnsubscribeMe)
  .setEmoji("🔕")
  .setLabel("Unsubscribe me")
  .setStyle(ButtonStyle.Danger);

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
      discord_subscribed_user_ids, rss_feed_url, rss_ignored_strings_content,
      rss_required_strings_content, rss_ignored_strings_title,
      rss_required_strings_title
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

    let hostName = URL.parse(article.link).hostname;
    let index = rss_feed_url.indexOf(hostName);
    hostName = rss_feed_url.slice(0, index + hostName.length);

    for(const channel_id of discord_announcement_channel_ids) {
      const existingMessage = Messages
        .get({ channelId: channel_id })
        .find(({ embeds }) => embeds?.[0]?.data.description?.includes(article.link));

      if (existingMessage) continue; // Article was already sent!

      const articlePreview = await getLinkPreview(article.link);
      const websitePreview = await getLinkPreview(hostName);

      const content = Utilities.removeHtmlCodeTags(article["content:encoded"] || article.content);
      const embedDescription = Utilities.getTruncatedStringTerminatedByWord(content, 133);
      const embedTitle = discord_override_embed_title?.trim() || websitePreview.siteName || websitePreview.title;
      const shortDate = date.format(new Date(article.pubDate), "MMMM DDD");

      /* -------------------------------------------------------------------------------- *
       * TODO: Check if discord_override_embed_image and discord_override_embed_thumbnail *
       *       include "https://" to determine if an image attachment should be uploaded! *
       * -------------------------------------------------------------------------------- */

      const embeds = [new EmbedBuilder()
        .setAuthor({ name: "New RSS announcement", iconURL: "attachment://rss_logo.png" })
        .setColor(0xF26109)
        .setDescription(`- [**${article.title}**](${article.link})\n_${embedDescription}_`)
        .setFooter({ text: `Posted on ${shortDate}. Click the link to read the full announcement.` })
        .setImage(discord_override_embed_image?.trim() || articlePreview.images[0])
        .setThumbnail(discord_override_embed_thumbnail?.trim() || websitePreview.images[0])
        .setTitle(embedTitle)];

        const files = [new AttachmentBuilder("assets/rss_logo.png")];

        const channel = client.channels.cache.get(channel_id);
        const message = await channel.send({ embeds, files });
        Utilities.LogPresets.SentMessage(message, listener);

        const threadOptions = { name: `💬 ${embedTitle} - ${article.title}` };
        const threadChannel = await Utilities.getOrCreateThreadChannel({ message, threadOptions });

        const replyButton1 = buttonSubscribeMe.setCustomId(`${Interactions.ButtonSubscribeMe}${JSON.stringify({ hostName })}`);
        const replyButton2 = buttonUnsubscribeMe.setCustomId(`${Interactions.ButtonUnsubscribeMe}${JSON.stringify({ hostName })}`);
        const replyComponents = [new ActionRowBuilder().addComponents(replyButton1, replyButton2, Emitter.moreInfoButton)];

        const subscribers = discord_subscribed_user_ids?.filter(userId => userId.trim()).map(userId => `<@${userId}>`);
        const replyContent = subscribers?.length && `📨 ${subscribers.join(" ")}`;
        const replyDescription = `Use these buttons to be pinged when new ${embedTitle} announcements are sent. 📬`;
        const replyEmbeds = [new EmbedBuilder().setColor(0x1E1F22).setDescription(replyDescription)];

        const replyOptions = { components: replyComponents, embeds: replyEmbeds };
        if (replyContent) replyOptions.content = replyContent;

        threadChannel
          .send(replyOptions)
          .then(result => Utilities.LogPresets.SentMessage(result, listener))
          .catch(error => logger.error(error, listener));
    }
  }
}

/**
 * Find the hostName bundled in the customId field and the rss_feed from the config file so we can update it.
 * @param {object} param
 * @param {Listener} param.listener
 * @throws If { hostName } is not in customId
 * @throws If rss_feed_url not in config
 * @returns {object}
 */
export function findRssFeedConfig({ listener }) {
  const hostName = listener.customData?.hostName;
  if (!hostName) throw new Error("Couldn't find { hostName } in interaction[\"customId\"].");

  const findRssFeed = ({ rss_feed_url }) => rss_feed_url.startsWith(hostName);
  const rss_feed = config.announcement_rss_feeds.find(findRssFeed);
  if (!rss_feed) throw new Error(`Couldn't find rss_feed_url host "${hostName}" in config.`);

  return rss_feed;
}

/**
 * Save interaction users id to the config and update the message content.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonSubscribeMe({ interaction, listener }) {
  await interaction.deferReply({ ephemeral: true });

  const rss_feed = findRssFeedConfig({ interaction, listener });
  rss_feed.discord_subscribed_user_ids ??= [];
  let replyContent = "";

  if (!rss_feed.discord_subscribed_user_ids.includes(interaction.user.id)) {
    replyContent = "You've been subscribed to these announcements! 🔔";
    rss_feed.discord_subscribed_user_ids ??= [];
    rss_feed.discord_subscribed_user_ids.push(interaction.user.id);
    config.save();
  }
  else {
    replyContent = "You're already subscribed to these announcements! 🔔";
  }

  interaction
    .editReply(replyContent)
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));

  if (interaction.message.content.includes(interaction.user)) return;
  await updateSubscribeMessage({ interaction, listener, rss_feed });
}

/**
 * Remove interaction users id from the config and update the message content.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonUnsubscribeMe({ interaction, listener }) {
  await interaction.deferReply({ ephemeral: true });

  const rss_feed = findRssFeedConfig({ interaction, listener });
  rss_feed.discord_subscribed_user_ids ??= [];
  let replyContent = "";

  if (rss_feed.discord_subscribed_user_ids.includes(interaction.user.id)) {
    replyContent = "You've been unsubscribed from these announcements. 🔕";
    rss_feed.discord_subscribed_user_ids = rss_feed.discord_subscribed_user_ids.filter(id => id !== interaction.user.id);
    config.save();
  }
  else {
    replyContent = "You're already unsubscribed from these announcements. 🔕";
  }

  interaction
    .editReply(replyContent)
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));

  if (!interaction.message.content.includes(interaction.user)) return;
  await updateSubscribeMessage({ interaction, listener, rss_feed });
}

/**
 * Update the message with subscribed users when the subscribed users change.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 * @param {object} param.rss_feed
 */
export async function updateSubscribeMessage({ interaction, listener, rss_feed }) {
  const subscribers = rss_feed.discord_subscribed_user_ids?.filter(userId => userId.trim()).map(userId => `<@${userId}>`);

  interaction.message
    .edit(subscribers?.length && `📨 ${subscribers.join(" ")}` || "")
    .then(result => Utilities.LogPresets.EditedMessage(result, listener))
    .catch(error => logger.error(error, listener));
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN LOGIC                                                   //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
