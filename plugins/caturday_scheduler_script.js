import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { Cron } from "croner";
import { filterChannelMessages, findChannelMessage } from "../index.js";
import { getAverageColorFromUrl, getCronOptions, getLeastFrequentlyOccurringStrings, getPercentage, getVibrantColorFromUrl } from "../shared/helpers/utilities.js";
import { PluginContextMenuItem, PluginSlashCommand } from "../shared/models/PluginHandler.js";
import { PluginInteraction } from "../shared/models/PluginHandler.js";
import Config from "../shared/config.js";
import Logger from "../shared/logger.js";
import randomItem from "random-item";

const config = new Config("caturday_scheduler_config.json");
const logger = new Logger("caturday_scheduler_script.js");

// ------------------------------------------------------------------------- //
// >> PLUGIN DEFINITIONS                                                  << //
// ------------------------------------------------------------------------- //

const PLUGIN_CUSTOM_IDS = Object.freeze({
  CATURDAY_BUTTON_COMPONENT_NEWER: "CATURDAY_BUTTON_COMPONENT_NEWER",
  CATURDAY_BUTTON_COMPONENT_OLDER: "CATURDAY_BUTTON_COMPONENT_OLDER",
  CATURDAY_BUTTON_COMPONENT_REMOVE: "CATURDAY_BUTTON_COMPONENT_REMOVE",
  CATURDAY_BUTTON_COMPONENT_SELECT: "CATURDAY_BUTTON_COMPONENT_SELECT",
});

export const PLUGIN_HANDLERS = [
  new PluginContextMenuItem({
    commandName: "Collect cat taxes",
    onInteractionCreate: ({ interaction }) => onCollectCatTaxContextMenuItem({ interaction }),
    requiredRoleIds: () => [config.discord_admin_role_id]
  }),
  new PluginInteraction({
    customId: PLUGIN_CUSTOM_IDS.CATURDAY_BUTTON_COMPONENT_OLDER,
    onInteractionCreate: ({ interaction }) => onCaturdayButtonComponentOlder({ interaction }),
    requiredRoleIds: () => [config.discord_admin_role_id]
  }),
  new PluginInteraction({
    customId: PLUGIN_CUSTOM_IDS.CATURDAY_BUTTON_COMPONENT_NEWER,
    onInteractionCreate: ({ interaction }) => onCaturdayButtonComponentNewer({ interaction }),
    requiredRoleIds: () => [config.discord_admin_role_id]
  }),
  new PluginInteraction({
    customId: PLUGIN_CUSTOM_IDS.CATURDAY_BUTTON_COMPONENT_SELECT,
    onInteractionCreate: ({ interaction }) => onCaturdayButtonComponentSelect({ interaction }),
    requiredRoleIds: () => [config.discord_admin_role_id]
  }),
  new PluginInteraction({
    customId: PLUGIN_CUSTOM_IDS.CATURDAY_BUTTON_COMPONENT_REMOVE,
    onInteractionCreate: ({ interaction }) => onCaturdayButtonComponentRemove({ interaction }),
    requiredRoleIds: () => [config.discord_admin_role_id]
  }),
  new PluginSlashCommand({
    commandName: "caturday",
    description: "Privately shows a file selector to submit channel pictures for #caturday 🐱",
    onInteractionCreate: ({ interaction }) => onCaturdaySlashCommand({ interaction }),
    requiredRoleIds: () => [config.discord_admin_role_id]
  })
]

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

    const cronAnnouncementEntrypoint = Cron(config.cron_job_announcement_pattern, getCronOptions(logger), () => cronJobAnnouncement(client));
    const cronMaintenanceEntrypoint = Cron(config.cron_job_maintenance_pattern, getCronOptions(logger), cronJobMaintenance());
    cronMaintenanceEntrypoint.trigger(); // trigger the maintenance job on startup

    logger.info(`Queued Cron jobs with patterns "${config.cron_job_announcement_pattern}", "${config.cron_job_maintenance_pattern}"`);

    // trigger the announcement job if it missed its schedule
    // (today is Saturday > 9am and no announcement was sent)

    const now = new Date();
    const today9am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
    const lastChannelMessage = await findChannelMessage(config.discord_announcement_channel_id, () => true);
    const isMissedAnnouncement = now.getDay() === 6 && now.getHours() >= 9 && (lastChannelMessage ? lastChannelMessage.createdAt < today9am : true);
    if (isMissedAnnouncement) cronAnnouncementEntrypoint.trigger();
  }
  catch(e) {
    logger.error(e);
  }
}

export const onGuildMemberUpdate = async ({ client, oldMember, newMember }) => {
  try {
    // todo: CATURDAY
    // update the embed uploader displayname if it was updated
    if (oldMember.displayName == newMember.displayName) return;

  }
  catch(e) {
    logger.error(e);
  }
}

export const onUserUpdate = async ({ client, oldUser, newUser }) => {
  try {
    // todo: CATURDAY
    const isAvatarUpdate = oldUser.displayAvatarURL() != newUser.displayAvatarURL();
    const isDisplayNameUpdate = oldUser.displayName != newUser.displayName;
  }
  catch(e) {
    logger.error(e);
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
    const configMessageData = await fetchAllMetadataForConfig();
    const configImageUrls = configMessageData.map(x => x.attachmentImageUrl).filter(x => x);

    // get a collection of attachment URLs that have been sent the least often in the announcement Discord channel
    // (if some URLs haven't been sent we'll just use those, but if all have been we'll do more complex filtering)
    const potentialImageUrls = configImageUrls.some(url => !announcementChannelImageUrls.includes(url))
      ? configImageUrls.filter(url => !announcementChannelImageUrls.includes(url))
      : getLeastFrequentlyOccurringStrings(announcementChannelImageUrls);

    const randomImageUrl = randomItem(potentialImageUrls);
    const randomImageData = configMessageData.find(({ attachmentImageUrl}) => attachmentImageUrl === randomImageUrl);
    const { attachmentImageUrl, uploaderAvatarUrl, uploaderId, uploaderName } = randomImageData;

    const embed = new EmbedBuilder()
      .setAuthor({ iconURL: uploaderAvatarUrl, name: uploaderName, url: `https://discordapp.com/users/${uploaderId}` })
      .setColor((await getVibrantColorFromUrl(uploaderAvatarUrl)))
      .setFooter({ text: "Happy Caturday! 🐱" })
      .setImage(attachmentImageUrl);

    const channel = await client.channels.fetch(config.discord_announcement_channel_id);
    await channel.send({ embeds: [embed] });

    logger.info(`Sent caturday embed to ${channel.guild.name} #${channel.name}`);
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * The Cron job to update obsolete embedded uploader information
 */
async function cronJobMaintenance() {
  try {
    const configMessageData = await fetchAllMetadataForConfig();
    const filter = ({ embeds }) => embeds?.[0]?.data?.footer?.text?.includes("Caturday");
    const caturdayMessages = await filterChannelMessages(config.discord_announcement_channel_id, filter);

    for(const message of caturdayMessages) {
      const { data: embedData } = message.embeds[0];
      if (!embedData.author) continue;

      // todo: fetch avatar from Discord do not rely on cache
      const find = ({ attachmentImageUrl }) => attachmentImageUrl === embedData.image.url;
      const { uploaderAvatarUrl, uploaderId, uploaderName } = configMessageData.find(find) || {};
      if (!uploaderAvatarUrl && !uploaderName) continue;

      const isObsoleteAvatarUrl = embedData.author.icon_url !== uploaderAvatarUrl;
      const isObsoleteName = embedData.author.name !== uploaderName;
      if (!isObsoleteAvatarUrl && !isObsoleteName) continue;

      const vibrantAvatarColor = isObsoleteAvatarUrl
        ? await getVibrantColorFromUrl(uploaderAvatarUrl)
        : embedData.color;

      const embed = EmbedBuilder.from(message.embeds[0]);
      embed.setAuthor({ iconURL: uploaderAvatarUrl, name: uploaderName, url: `https://discordapp.com/users/${uploaderId}` });
      embed.setColor(vibrantAvatarColor);

      await message.edit({ embeds: [embed] });
    }
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Fetch metadata for each message the config values reference
 * @returns {Promise<Object[]>}
 */
async function fetchAllMetadataForConfig() {
  try {
    return await Promise.all(config.discord_channel_message_ids_image_index.map(async item => {
      const split = item.split(","); // [channel_id, message_id, image_index]
      const message = await findChannelMessage(split[0], ({ id }) => id === split[1]);
      return await fetchMetadataForMessage(message, split[2]);
    }))
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Fetch the embed metadata for a message
 * @param {Message} message
 * @param {Number} imageIndex
 * @returns {Object}
 */
async function fetchMetadataForMessage(message, imageIndex = -1) {
  try {
    const { attachments } = message;
    const author = await message.author.fetch();
    const member = await message.guild.members.fetch(author.id);

    return {
      attachmentImageUrl: imageIndex > -1 ? Array.from(attachments.values())?.[imageIndex]?.url : undefined,
      uploaderAvatarUrl: author.displayAvatarURL(),
      uploaderId: author.id,
      uploaderName: member?.nickname || author.displayName
    }
  }
  catch(e) {
    logger.error(e);
  }
}


/**
 * Get a preformatted component row for the slash command
 * @async
 * @param {Object} param
 * @param {Interaction} param.interaction
 * @param {Number} param.imageIndex
 * @param {Message} param.sourceMessage
 * @returns {Promise<ActionRowBuilder[]>}
 */
async function getCommandComponents({ interaction, imageIndex, sourceMessage }) {
  try {
    // build the button components

    const components = [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("_").setLabel("_").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("CATURDAY_BUTTON_COMPONENT_OLDER").setLabel("← Older Picture").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("CATURDAY_BUTTON_COMPONENT_NEWER").setLabel("Newer Picture →").setStyle(ButtonStyle.Secondary),
    )];

    const configString = getConfigString(sourceMessage, imageIndex);
    const imageUrlExists = config.discord_channel_message_ids_image_index.includes(configString);

    components[0].components[0]
      .setCustomId(imageUrlExists ? PLUGIN_CUSTOM_IDS.CATURDAY_BUTTON_COMPONENT_REMOVE : PLUGIN_CUSTOM_IDS.CATURDAY_BUTTON_COMPONENT_SELECT)
      .setLabel(imageUrlExists ? "Remove Picture" : "Select Picture")
      .setStyle(imageUrlExists ? ButtonStyle.Danger : ButtonStyle.Success);

    const find = message => !message.author.bot && getImageUrlsFromMessage(message).length;
    const channelMessagesWithImageUrls = await filterChannelMessages(interaction.channel.id, find);

    const sourceMessageIndex = channelMessagesWithImageUrls.map(({ id }) => id).indexOf(sourceMessage.id);

    // disable the older button when there is nothing to navigate to

    const isOlderMessageExisting = sourceMessageIndex < channelMessagesWithImageUrls.length - 1;
    const isFirstImageAttachment = imageIndex === 0;
    components[0].components[1].setDisabled(!isOlderMessageExisting && isFirstImageAttachment);

    // disable the newer button when there is nothing to navigate to

    const isNewerMessageExisting = sourceMessageIndex > 0;
    const isLastImageAttachment = imageIndex === getImageUrlsFromMessage(sourceMessage).length - 1;
    components[0].components[2].setDisabled(!isNewerMessageExisting && isLastImageAttachment);

    return components;
  }
  catch(e) {
    logger.error(e);
  }
}

function getConfigString(message, index) {
  return `${message.channel.id},${message.id},${index}`;
}

/**
 * Get a non-repeating collection of all image URLs attached to a Discord message
 * @param {Message} message
 * @returns {String[]}
 */
function getImageUrlsFromMessage({ attachments, embeds }) {
  try {
    const nestedImageUrls = [];

    const isDiscordUrl = url =>
      typeof url === "string" && (url.includes("cdn.discordapp.com") || url.includes("media.discordapp.net"));

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
  catch(e) {
    logger.error(e);
  }
}

async function onCaturdayButtonComponentNewer({ interaction }) {
  try {
    await interaction.deferUpdate();

    // get all messages with image attachments

    const filter = message => !message.author.bot && getImageUrlsFromMessage(message).length;
    const channelMessagesWithImages = await filterChannelMessages(interaction.channel.id, filter);

    // get the image attachment from the embed

    const embedImageUrl = getImageUrlsFromMessage(interaction.message)[0];

    // get the next image to be attached to the embed

    const sourceMessageUrl = interaction.message.embeds[0].author.url;
    const sourceMessageIndex = channelMessagesWithImages.map(({ url }) => url).indexOf(sourceMessageUrl);
    const sourceMessageImages = getImageUrlsFromMessage(channelMessagesWithImages[sourceMessageIndex]);
    const sourceMessageImageIndex = sourceMessageImages.indexOf(embedImageUrl);

    const getNewerChannelMessage = () => channelMessagesWithImages[channelMessagesWithImages.reduce((total, current, index) => {
      const isImageMessage = getImageUrlsFromMessage(current).length;
      const isNewerMessage = index < sourceMessageIndex;
      const isFurtherIndex = index > total; // we want the largest index possible
      if (isImageMessage && isNewerMessage && isFurtherIndex) return total = index;
      else return total;
    }, 0)];

    const nextSourceMessage = sourceMessageImageIndex < sourceMessageImages.length - 1
      ? channelMessagesWithImages[sourceMessageIndex] // source message has more attachments so don't go to newer message
      : getNewerChannelMessage();

    const nextImageIndex = nextSourceMessage.id === channelMessagesWithImages[sourceMessageIndex].id
      ? sourceMessageImageIndex + 1
      : 0;

    // edit the embed with the next image

    const {
      attachmentImageUrl,
      uploaderAvatarUrl,
      uploaderName
    } = await fetchMetadataForMessage(nextSourceMessage, nextImageIndex);

    const channelMessagesWithImageUrls = await filterChannelMessages(interaction.channel.id, filter);
    const channelMessagesAttachments = channelMessagesWithImageUrls.map(x => Array.from(x.attachments.values()).reverse()).flat();
    const channelMessagesAttachmentIndex = channelMessagesAttachments.findIndex(x => x.url === attachmentImageUrl)

    const embed = new EmbedBuilder()
      .setAuthor({ iconURL: uploaderAvatarUrl, name: uploaderName, url: nextSourceMessage.url })
      .setColor((await getAverageColorFromUrl(uploaderAvatarUrl)).hex)
      .setFooter({ text: `Viewing image attachment ${channelMessagesAttachmentIndex + 1} of ${channelMessagesAttachments.length} 🗃️` })
      .setImage(attachmentImageUrl);

    await interaction.editReply({
      components: await getCommandComponents({ interaction, imageIndex: nextImageIndex, sourceMessage: nextSourceMessage }),
      embeds: [embed]
    });
  }
  catch(e) {
    logger.error(e);
  }
}

async function onCaturdayButtonComponentOlder({ interaction }) {
  try {
    await interaction.deferUpdate();

    // get all messages with image attachments

    const filter = message => !message.author.bot && getImageUrlsFromMessage(message).length;
    const channelMessagesWithImages = await filterChannelMessages(interaction.channel.id, filter);

    // get the image attachment from the embed

    const embedImageUrl = getImageUrlsFromMessage(interaction.message)[0];

    // get the next image to be attached to the embed

    const sourceMessageUrl = interaction.message.embeds[0].author.url;
    const sourceMessageIndex = channelMessagesWithImages.map(({ url }) => url).indexOf(sourceMessageUrl);
    const sourceMessageImages = getImageUrlsFromMessage(channelMessagesWithImages[sourceMessageIndex]);
    const sourceMessageImageIndex = sourceMessageImages.indexOf(embedImageUrl);

    const nextSourceMessage = sourceMessageImageIndex > 0
      ? channelMessagesWithImages[sourceMessageIndex] // source message has more attachments so don't go to older message
      : channelMessagesWithImages.find((message, index) => index > sourceMessageIndex);

    const nextImageIndex = sourceMessageImageIndex > 0
      ? sourceMessageImageIndex - 1
      : getImageUrlsFromMessage(nextSourceMessage).length - 1;

    // edit the embed with the next image

    const {
      attachmentImageUrl,
      uploaderAvatarUrl,
      uploaderName
    } = await fetchMetadataForMessage(nextSourceMessage, nextImageIndex);

    const channelMessagesWithImageUrls = await filterChannelMessages(interaction.channel.id, filter);
    const channelMessagesAttachments = channelMessagesWithImageUrls.map(x => Array.from(x.attachments.values()).reverse()).flat();
    const channelMessagesAttachmentIndex = channelMessagesAttachments.findIndex(x => x.url === attachmentImageUrl)

    const embed = new EmbedBuilder()
      .setAuthor({ iconURL: uploaderAvatarUrl, name: uploaderName, url: nextSourceMessage.url })
      .setColor((await getAverageColorFromUrl(uploaderAvatarUrl)).hex)
      .setFooter({ text: `Viewing image attachment ${channelMessagesAttachmentIndex + 1} of ${channelMessagesAttachments.length} 🗃️` })
      .setImage(attachmentImageUrl);

    await interaction.editReply({
      components: await getCommandComponents({ interaction, imageIndex: nextImageIndex, sourceMessage: nextSourceMessage }),
      embeds: [embed]
    });
  }
  catch(e) {
    logger.error(e);
  }
}

async function onCaturdayButtonComponentRemove({ interaction }) {
  try {
    await interaction.deferUpdate();

    const components = [ActionRowBuilder.from(interaction.message.components[0])];
    components[0].components[0].setDisabled(true);
    components[0].components[1].setDisabled(true);
    components[0].components[2].setDisabled(true);
    await interaction.editReply({ components });

    // get all messages with image attachments

    const filter = message => !message.author.bot && getImageUrlsFromMessage(message).length;
    const channelMessagesWithImages = await filterChannelMessages(interaction.channel.id, filter);

    // get the image attachment from the embed

    const embedImageUrl = getImageUrlsFromMessage(interaction.message)[0];

    // get the next image to be attached to the embed

    const sourceMessageUrl = interaction.message.embeds[0].author.url;
    const sourceMessageIndex = channelMessagesWithImages.map(({ url }) => url).indexOf(sourceMessageUrl);
    const sourceMessageImages = getImageUrlsFromMessage(channelMessagesWithImages[sourceMessageIndex]);
    const sourceMessageImageIndex = sourceMessageImages.indexOf(embedImageUrl);
    const sourceMessage = channelMessagesWithImages[sourceMessageIndex];

    const configString = getConfigString(sourceMessage, sourceMessageImageIndex);

    if (config.discord_channel_message_ids_image_index.includes(configString)) {
      const index = config.discord_channel_message_ids_image_index.indexOf(configString);
      config.discord_channel_message_ids_image_index.splice(index, 1);
      await config.saveChanges();
    }

    await interaction.editReply({
      components: await getCommandComponents({
        imageIndex: sourceMessageImageIndex,
        interaction,
        sourceMessage
      })
    });
  }
  catch(e) {
    Logger.error(e);
  }
}

async function onCaturdayButtonComponentSelect({ interaction }) {
  try {
    await interaction.deferUpdate();

    const components = [ActionRowBuilder.from(interaction.message.components[0])];
    components[0].components[0].setDisabled(true);
    components[0].components[1].setDisabled(true);
    components[0].components[2].setDisabled(true);
    await interaction.editReply({ components });

    // get all messages with image attachments

    const filter = message => !message.author.bot && getImageUrlsFromMessage(message).length;
    const channelMessagesWithImages = await filterChannelMessages(interaction.channel.id, filter);

    // get the image attachment from the embed

    const embedImageUrl = getImageUrlsFromMessage(interaction.message)[0];

    // get the next image to be attached to the embed

    const sourceMessageUrl = interaction.message.embeds[0].author.url;
    const sourceMessageIndex = channelMessagesWithImages.map(({ url }) => url).indexOf(sourceMessageUrl);
    const sourceMessageImages = getImageUrlsFromMessage(channelMessagesWithImages[sourceMessageIndex]);
    const sourceMessageImageIndex = sourceMessageImages.indexOf(embedImageUrl);
    const sourceMessage = channelMessagesWithImages[sourceMessageIndex];

    const configString = getConfigString(sourceMessage, sourceMessageImageIndex);

    if (!config.discord_channel_message_ids_image_index.includes(configString)) {
      config.discord_channel_message_ids_image_index.push(configString);
      await config.saveChanges();
    }

    await interaction.editReply({
      components: await getCommandComponents({
        imageIndex: sourceMessageImageIndex,
        interaction,
        sourceMessage
      })
    });
  }
  catch(e) {
    Logger.error(e);
  }
}

async function onCollectCatTaxContextMenuItem({ interaction }) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const member = await interaction.guild.members.fetch(interaction.targetId);

    // verify the target user is a member of the guild
    if (!member) {
      await interaction.editReply({ content: `I can't collect cat taxes from <@${interaction.targetId}> because they're not a valid guild member.`})
      logger.warn(`${interaction.user.displayName} tried to collect cat taxes from a non-guild member "${interaction.targetId}"`);
      return;
    }

    // verify the target user is not a bot
    if (member.user.bot) {
      await interaction.editReply({ content: `I can't collect cat taxes from ${member} because they're a Discord bot.`})
      logger.warn(`${interaction.user.displayName} tried to collect cat taxes from a bot "${interaction.targetId}"`);
      return;
    }

    // get author of each caturday submission
    const caturdayAuthorIds = await Promise.all(config.discord_channel_message_ids_image_index.map(async item => {
      const split = item.split(","); // [channel_id, message_id, image_index]
      const message = await findChannelMessage(split[0], ({ id }) => id === split[1]);
      return message.author.id
    }));

    // get count of times target user is an author
    const contributionCount = caturdayAuthorIds.filter(id => id === member.user.id).length;

    const contributionString = contributionCount
      ? `You contributed ${Math.round(getPercentage(contributionCount, config.discord_channel_message_ids_image_index.length))}% of the cat taxes we've collected.`
      : "You haven't contributed any cat taxes we've collected."

    const content =
      `### :coin: Hello ${member}! You've been asked to pay your cat tax.`
      + `\n- __You can pay just by sending me pictures of your pets.__ :calling:`
      + `\n- ${contributionString} :hand_with_index_finger_and_thumb_crossed:`
      + `\nAll cat taxes queue for <#${config.discord_announcement_channel_id}> after review from our pawditors.`

    const files = [new AttachmentBuilder("assets\\cat_tax.jpg")];

    await member.user.send({ content, files });
    await interaction.editReply({ content: `I sent this message as a DM to ${member}:`});
    await interaction.followUp({ content, ephemeral: true, files });
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Display the image selector when the command is sent
 * @param {Object} param
 * @param {Interaction} param.interaction
 */
async function onCaturdaySlashCommand({ interaction }) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const filter = message => !message.author.bot && getImageUrlsFromMessage(message).length;
    const sourceMessage = await findChannelMessage(interaction.channel.id, filter);

    if (!sourceMessage) {
      await interaction.editReply({ content: "I couldn't find any message attachments in this channel." });
      return;
    }

    const imageIndex = getImageUrlsFromMessage(sourceMessage).length - 1;

    const {
      attachmentImageUrl,
      uploaderAvatarUrl,
      uploaderName
    } = await fetchMetadataForMessage(sourceMessage, imageIndex);

    const channelMessagesWithImageUrls = await filterChannelMessages(interaction.channel.id, filter);
    const channelMessagesAttachments = channelMessagesWithImageUrls.map(x => Array.from(x.attachments.values()).reverse()).flat();
    const channelMessagesAttachmentIndex = channelMessagesAttachments.findIndex(x => x.url === attachmentImageUrl)

    const embed = new EmbedBuilder()
      .setAuthor({ iconURL: uploaderAvatarUrl, name: uploaderName, url: sourceMessage.url })
      .setColor((await getAverageColorFromUrl(uploaderAvatarUrl)).hex)
      .setFooter({ text: `Viewing image attachment ${channelMessagesAttachmentIndex + 1} of ${channelMessagesAttachments.length} 🗃️` })
      .setImage(attachmentImageUrl);

    await interaction.editReply({
      components: await getCommandComponents({ interaction, imageIndex, sourceMessage }),
      content: `Select a picture from this channel to be included in <#${config.discord_announcement_channel_id}>`,
      embeds: [embed]
    });
  }
  catch(e) {
    logger.error(e);
  }
}
