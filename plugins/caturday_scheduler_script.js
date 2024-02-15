import { Cron } from "croner";
import { EmbedBuilder } from "discord.js";
import { filterChannelMessages, findChannelMessage } from "../index.js";
import { getCronOptions } from "../shared/helpers/object.js";
import { getLeastFrequentlyOccurringStrings } from "../shared/helpers/array.js";
import Config from "../shared/config.js";
import Logger from "../shared/logger.js";
import randomItem from "random-item";

const config = new Config("caturday_scheduler_config.json");
const logger = new Logger("caturday_scheduler_script.js");

// ------------------------------------------------------------------------- //
// >> INTERACTION DEFINITIONS                                             << //
// ------------------------------------------------------------------------- //

// todo: implement "add" / "delete" to Config.js
// todo: restore interactions from commit history

// ------------------------------------------------------------------------- //
// >> DISCORD EVENT HANDLERS                                              << //
// ------------------------------------------------------------------------- //

/**
 * Initialize the plugin Cron jobs and run any that missed their schedules
 */
export const onClientReady = async ({ client }) => {
  try {
    await config.initialize(client);
    await logger.initialize(client);

    // start announcement and maintenance Cron jobs

    const { cron_job_announcement_pattern, cron_job_maintenance_pattern } = config;
    Cron(cron_job_maintenance_pattern, getCronOptions(logger), cronJobMaintenance()).trigger();
    const cronEntrypoint = Cron(cron_job_announcement_pattern, getCronOptions(logger), () => cronJobAnnouncement(client));
    logger.info(`Queued Cron jobs with patterns "${config.cron_job_announcement_pattern}", "${config.cron_job_maintenance_pattern}"`);

    // trigger the announcement job if it missed its schedule
    // (today is Saturday > 9am and no announcement was sent)

    const now = new Date();
    const today9am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
    const lastChannelMessage = await findChannelMessage(config.discord_announcement_channel_id, () => true);
    const isMissedJob = now.getDay() === 6 && now.getHours() >= 9 && (lastChannelMessage ? lastChannelMessage.createdAt < today9am : true);
    if (isMissedJob) cronEntrypoint.trigger();
  }
  catch({ stack }) {
    logger.error(stack);
  }
}

// ------------------------------------------------------------------------- //
// >> PLUGIN FUNCTIONS                                                    << //
// ------------------------------------------------------------------------- //

/**
 * The Cron job to send caturday announcement messages
 * @param {Client} client
 */
async function cronJobAnnouncement(client) {
  try {
    // get all messages in the announcement channel
    const channelId = config.discord_announcement_channel_id;
    const filter = message => getImageUrlsFromMessage(message).length;
    const announcementChannelMessages = await filterChannelMessages(channelId, filter);

    // get all image urls attached to the announcement messages
    const map = message => getImageUrlsFromMessage(message)[0];
    const announcementChannelImageUrls = announcementChannelMessages.map(map);

    // fetch all required message data for the config values
    const configMessageData = await fetchMessageDataForConfigValues();
    const configImageUrls = configMessageData.map(x => x.attachmentImageUrl).filter(x => x);

    // get a collection of attachment URLs that have been sent the least often in the announcement Discord channel
    // (if some URLs haven't been sent we'll just use those, but if all have been we'll do more complex filtering)
    const potentialImageUrls = configImageUrls.some(url => !announcementChannelImageUrls.includes(url))
      ? configImageUrls.filter(url => !announcementChannelImageUrls.includes(url))
      : getLeastFrequentlyOccurringStrings(announcementChannelImageUrls);

    const randomImageUrl = randomItem(potentialImageUrls);
    const randomImageData = configMessageData.find(({ attachmentImageUrl}) => attachmentImageUrl === randomImageUrl);
    const { attachmentImageUrl, uploaderAvatarUrl, uploaderName } = randomImageData;

    const embed = new EmbedBuilder().setImage(attachmentImageUrl);
    embed.setAuthor({ iconURL: uploaderAvatarUrl, name: uploaderName });
    embed.setFooter({ text: "Happy Caturday! 🐱" });

    const channel = await client.channels.fetch(config.discord_announcement_channel_id);
    await channel.send({ embeds: [embed] });

    logger.info(`Sent caturday embed to ${channel.guild.name} #${channel.name}`);
  }
  catch({ stack }) {
    logger.error(stack);
  }
}

/**
 * The Cron job to update obsolete embedded uploader information
 */
async function cronJobMaintenance() {
  try {
    const configMessageData = await fetchMessageDataForConfigValues();
    const filter = ({ embeds }) => embeds?.[0]?.data?.footer?.text?.includes("Caturday");
    const caturdayMessages = await filterChannelMessages(config.discord_announcement_channel_id, filter);

    for(const message of caturdayMessages) {
      const { data: embedData } = message.embeds[0];
      if (!embedData.author) continue;

      const find = ({ attachmentImageUrl }) => attachmentImageUrl === embedData.image.url;
      const { uploaderAvatarUrl, uploaderName } = configMessageData.find(find) || {};
      if (!uploaderAvatarUrl && !uploaderName) continue;

      const isObsoleteAvatarUrl = embedData.author.icon_url !== uploaderAvatarUrl;
      const isObsoleteName = embedData.author.name !== uploaderName;
      if (!isObsoleteAvatarUrl && !isObsoleteName) continue;

      const embed = EmbedBuilder.from(message.embeds[0]);
      embed.setAuthor({ iconURL: uploaderAvatarUrl, name: uploaderName });
      await message.edit({ embeds: [embed] });
    }
  }
  catch({ stack }) {
    logger.error(stack);
  }
}

/**
 * Fetch metadata for each message the config values reference
 * @returns {Promise<Object[]>}
 */
async function fetchMessageDataForConfigValues() {
  try {
    return await Promise.all(config.discord_channel_message_ids_image_index.map(async item => {
      const split = item.split(",");
      const channel_id = split[0];
      const message_id = split[1];
      const image_index = split[2];

      const message = await findChannelMessage(channel_id, ({ id }) => id === message_id);
      const { attachments, author } = message;
      const member = await message.guild.members.fetch(author.id);

      return {
        attachmentImageUrl: Array.from(attachments.values())?.[image_index]?.url,
        uploaderAvatarUrl: author.displayAvatarURL(),
        uploaderName: member?.nickname || author.displayName
      }
    }))
  }
  catch({ stack }) {
    logger.error(stack);
  }
}

/**
 * Get a non-repeating collection of all image URLs attached to a Discord message
 * @param {Message} message
 * @returns {String[]}
 */
function getImageUrlsFromMessage({ attachments, embeds }) {
  try {
    const isDiscordUrl = url => typeof url === "string" && (url.includes("cdn.discordapp.com") || url.includes("media.discordapp.net"));
    const nestedImageUrls = [];

    if (attachments.size) {
      const imageAttachments = attachments.filter(({ contentType }) => contentType.includes("image"));
      nestedImageUrls.push(...imageAttachments.map(({ url }) => url));
    }

    if (embeds.length) {
      const imageEmbeds = embeds.filter(({ data }) => isDiscordUrl(data?.image?.url));
      if (imageEmbeds.length) nestedImageUrls.push(...imageEmbeds.map(({ data }) => data.image.url));
      const thumbnailEmbeds = embeds.filter(({ data }) => data?.type?.includes("image") && isDiscordUrl(data?.thumbnail?.url));
      if (thumbnailEmbeds.length) nestedImageUrls.push(...thumbnailEmbeds.map(({ data }) => data.thumbnail.url));
    }

    return [...new Set(nestedImageUrls)];
  }
  catch({ stack }) {
    logger.error(stack);
  }
}
