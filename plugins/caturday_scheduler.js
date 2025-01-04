import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Events, InteractionContextType, UserSelectMenuBuilder } from "discord.js";
import { Config } from "../services/config.js";
import { DeploymentTypes } from "../entities/DeploymentTypes.js";
import { Emitter } from "../services/emitter.js";
import { Logger } from "../services/logger.js";
import { Messages } from "../services/messages.js";
import { Utilities } from "../services/utilities.js";
import CaturdayImageCache from "../entities/CaturdayImageCache.js";
import CronJob from "../entities/CronJob.js";
import date from "date-and-time";
import Listener from "../entities/Listener.js";
import ordinal from "date-and-time/plugin/ordinal";
import randomItem from "random-item";
import urlExist from "url-exist";
date.plugin(ordinal);

const config = new Config(import.meta.filename);
const logger = new Logger(import.meta.filename);

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region EMITTER.JS IMPORTS                                                //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

export const CronJobs = new Set([
  new CronJob()
    .setEnabled(Messages.isServiceEnabled)
    .setExpression(config.announcement_cron_job_expression)
    .setFunction(cronJobAnnouncement)
    .setRunOrder(1) // Run after Event.ClientReady!
    .setTriggered(checkMissingAnnouncement),
  new CronJob()
    .setEnabled(Messages.isServiceEnabled)
    .setExpression(config.maintenance_cron_job_expression)
    .setFunction(cronJobMaintenance)
    .setRunOrder(1) // Run after Event.ClientReady!
    .setTriggered(true),
]);

export const Interactions = Object.freeze({
  ButtonComponentHideMessage: "CATURDAY_BUTTON_COMPONENT_HIDE_MESSAGE",
  ButtonComponentMissingImage: "CATURDAY_BUTTON_COMPONENT_MISSING_IMAGE",
  ButtonComponentNewerImage: "CATURDAY_BUTTON_COMPONENT_NEWER_IMAGE",
  ButtonComponentOlderImage: "CATURDAY_BUTTON_COMPONENT_OLDER_IMAGE",
  ButtonComponentRemoveImage: "CATURDAY_BUTTON_COMPONENT_REMOVE_IMAGE",
  ButtonComponentSelectImage: "CATURDAY_BUTTON_COMPONENT_SELECT_IMAGE",
  ChatInputCommandCaturday: "caturday",
  ContextMenuCommandCollectCatTaxes: "Collect cat taxes",
  SelectMenuUploader: "CATURDAY_SELECT_MENU_UPLOADER",
});

export const Listeners = Object.freeze({
  [Events.ClientReady]: new Listener()
    .setEnabled(Messages.isServiceEnabled)
    .setFunction(initializeCaturdayImageCaches),
  [Events.GuildMemberAdd]:
    sendCatTaxDirectMessage,
  [Events.MessageCreate]: new Listener()
    .setFunction(onDirectMessageCreate)
    .setRequiredChannelType(ChannelType.DM),
  [Events.MessageDelete]: new Listener()
    .setFunction(onDirectMessageDelete)
    .setRequiredChannelType(ChannelType.DM),
  [Interactions.ButtonComponentHideMessage]: new Listener()
    .setDescription("Hides / deletes the message from your direct messages.")
    .setFunction(({ interaction, listener }) => interaction.message.delete().catch(error => logger.error(error, listener)))
    .setRequiredChannelType(ChannelType.DM),
  [Interactions.ButtonComponentMissingImage]: new Listener()
    .setDescription("This button is disabled because the image was deleted."),
  [Interactions.ButtonComponentNewerImage]: new Listener()
    .setDescription("Views the next image attachment sent to the channel.")
    .setFunction(onButtonComponentNewerImage),
  [Interactions.ButtonComponentOlderImage]: new Listener()
    .setDescription("Views the previous image attachment sent to the channel.")
    .setFunction(onButtonComponentOlderImage),
  [Interactions.ButtonComponentRemoveImage]: [
    new Listener()
      .setDescription("Removes the image from future Caturday announcements.")
      .setFunction(onButtonComponentRemoveImageDirectMessage)
      .setRequiredChannelType(ChannelType.DM)
      .setRequiredRoles(config.discord_admin_role_ids),
    new Listener()
      .setDescription("Removes the image from future Caturday announcements.")
      .setFunction(onButtonComponentRemoveImageGuildText)
      .setRequiredChannelType(ChannelType.GuildText)
      .setRequiredRoles(config.discord_admin_role_ids)
  ],
  [Interactions.ButtonComponentSelectImage]: [
    new Listener()
      .setDescription("Includes the image in future Caturday announcements.")
      .setFunction(onButtonComponentSelectImageDirectMessage)
      .setRequiredChannelType(ChannelType.DM)
      .setRequiredRoles(config.discord_admin_role_ids),
    new Listener()
      .setDescription("Includes the image in future Caturday announcements.")
      .setFunction(onButtonComponentSelectImageGuildText)
      .setRequiredChannelType(ChannelType.GuildText)
      .setRequiredRoles(config.discord_admin_role_ids)
  ],
  [Interactions.SelectMenuUploader]: new Listener()
    .setDescription("Chooses the user that should be attributed for the image.")
    .setFunction(onSelectMenuUser),
  [Interactions.ChatInputCommandCaturday]: new Listener()
    .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel)
    .setDeploymentType(DeploymentTypes.ChatInputCommand)
    .setDescription("Privately shows a file selector to submit channel pictures for #caturday 🐱")
    .setFunction(onChatInputCommandCaturday)
    .setRequiredRoles(config.discord_admin_role_ids),
  [Interactions.ContextMenuCommandCollectCatTaxes]: new Listener()
    .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel)
    .setDeploymentType(DeploymentTypes.UserContextMenuCommand)
    .setFunction(onContextMenuCommandCollectCatTaxes)
    .setRequiredRoles(config.discord_admin_role_ids)
});

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS IMPORTS                                             //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region PLUGIN COMPONENTS                                                 //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

const backButton = new ButtonBuilder()
  .setCustomId(Interactions.ButtonComponentOlderImage)
  .setEmoji("⬅️")
  .setStyle(ButtonStyle.Secondary);

const hideMessageButton = new ButtonBuilder()
  .setCustomId(Interactions.ButtonComponentHideMessage)
  .setEmoji("🧹")
  .setLabel("Hide message")
  .setStyle(ButtonStyle.Secondary);

const missingImageButton = new ButtonBuilder()
  .setCustomId(Interactions.ButtonComponentMissingImage)
  .setDisabled(true)
  .setEmoji("❔")
  .setLabel("Missing image")
  .setStyle(ButtonStyle.Secondary);

const nextButton = new ButtonBuilder()
  .setCustomId(Interactions.ButtonComponentNewerImage)
  .setEmoji("➡️")
  .setStyle(ButtonStyle.Secondary);

const removeImageButton = new ButtonBuilder()
  .setCustomId(Interactions.ButtonComponentRemoveImage)
  .setEmoji("🗑️")
  .setLabel("Remove image")
  .setStyle(ButtonStyle.Danger);

const selectImageButton = new ButtonBuilder()
  .setCustomId(Interactions.ButtonComponentSelectImage)
  .setEmoji("✅")
  .setLabel("Select image")
  .setStyle(ButtonStyle.Success);

/**
 * Get the user select menu
 * @param {string} defaultUploaderId
 * @returns {UserSelectMenuBuilder}
 */
export function getSelectMenuUser(defaultUploaderId) {
  return new UserSelectMenuBuilder()
    .setCustomId(Interactions.SelectMenuUploader)
    .setDefaultUsers([defaultUploaderId])
    .setPlaceholder("Select an uploader.");
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN COMPONENTS                                              //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region PLUGIN LOGIC                                                      //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * `Key: `attachmentUrl` `Value: cache`
 * @type {Map<string, CaturdayImageCache>}
 */
const caturdayImageCaches = new Map();

/**
 * `Key: `attachmentUrl` `Value: userId`
 * @type {Map<string, string>}
 */
const selectedUsers = new Map();

/**
 * Check if the Caturday announcement is missing and should be sent.
 * @returns {boolean}
 */
export function checkMissingAnnouncement() {
  const now = new Date(); // Only true on Sundays before 9am.
  if (now.getDay() !== 6 || now.getHours() < 9) {
    logger.debug("Date isn't Sunday or before 9am.");
    return false;
  }

  const attachmentUrls = [...caturdayImageCaches.keys()];

  const lastAnnouncementMessage = Messages
    .get({ channelId: config.announcement_discord_channel_id })
    .find(item => attachmentUrls.includes(Utilities.getEmbedImageUrlsInMessage(item)));

  if (!lastAnnouncementMessage) {
    logger.debug("Couldn't find last Caturday announcement.");
    return true;
  }

  const today9am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
  return lastAnnouncementMessage.createdAt < today9am;
}

/**
 * Check if the message was sent by a user and includes an image.
 * @param {Message} message
 * @returns {boolean}
 */
export function checkValidMessageImageAttachment(message) {
  return !message.author.bot && Utilities.checkImageAttachment(message)
}

/**
 * The Cron job to send caturday announcement messages
 * @param {object} param
 * @param {Client} param.client
 * @param {Listener} param.listener
 */
export async function cronJobAnnouncement({ client, listener }) {
  // -------------------- //
  // Get the channel data //
  // -------------------- //

  const channelImageUrls = Messages
    .get({ channelId: config.announcement_discord_channel_id })
    .map(item => item.embeds?.[0]?.data?.image?.url)
    .filter(item => item);

  // ------------------- //
  // Get the config data //
  // ------------------- //

  const configImageUrls = Array
    .from(caturdayImageCaches.values())
    .map(item => item.attachmentUrl);

  const unsentConfigImageUrls =
    configImageUrls.filter(url => !channelImageUrls.includes(url));

  const potentialImageUrls = [];

  if (unsentConfigImageUrls.length) {
    // Collect all config image URLs that have not been sent to the channel.
    logger.debug(`Found ${unsentConfigImageUrls.length} unsent caturday image ${Utilities.getPluralizedString("URL", unsentConfigImageUrls)}.`);
    potentialImageUrls.push(...configImageUrls.filter(url => !channelImageUrls.includes(url)));
  }
  else {
    // Collect the config image URLs that have been sent least to the channel.
    logger.debug("Could not find any unsent caturday image URLs.");
    const validImageUrls = channelImageUrls.filter(item => configImageUrls.includes(item));
    potentialImageUrls.push(...Utilities.getLeastFrequentlyOccurringStrings(validImageUrls));
  }

  if (!potentialImageUrls.length) {
    logger.warn("Could not find any potential image urls.");
    return;
  }

  const attachmentUrl = randomItem(potentialImageUrls);
  const userId = caturdayImageCaches.get(attachmentUrl).userId;
  const user = client.users.cache.get(userId);
  const channel = client.channels.cache.get(config.announcement_discord_channel_id);
  const member = channel.guild.members.cache.get(userId);

  const displayAvatarUrl = member?.displayAvatarURL() || user.displayAvatarURL();
  const displayName = member?.displayName || user.displayName;

  const embeds = [new EmbedBuilder()
    .setAuthor({ iconURL: displayAvatarUrl, name: displayName, url: `https://discordapp.com/users/${user.id}` })
    .setColor((await Utilities.getVibrantColorFromUrl(displayAvatarUrl)))
    .setFooter({ text: "Happy Caturday! 🐱 Send me your cat taxes! 🪙" })
    .setImage(attachmentUrl)];

  channel
    .send({ embeds })
    .then(result => Utilities.LogPresets.SentMessage(result, listener))
    .catch(error => logger.error(error, listener));
}

/**
 * The Cron job to update obsolete embed uploader information
 * @param {object} param
 * @param {Client} param.client
 * @param {Listener} param.listener
 */
export async function cronJobMaintenance({ client, listener }) {
  // --------------------------------------------------- //
  // Check all channel messages for embed author updates //
  // --------------------------------------------------- //

  const channelMessages = Messages
    .get({ channelId: config.announcement_discord_channel_id })
    .filter(item =>
      item.embeds.length
      && item.embeds[0].data.author?.url
      && item.embeds[0].data.footer?.text?.includes("Caturday")
    );

  const channel =
    client.channels.cache.get(config.announcement_discord_channel_id);

  for(const message of channelMessages) {
    const userId = message.embeds[0].author.url.split("/").pop();
    const member = channel.guild.members.cache.get(userId);
    const user = client.users.cache.get(userId);

    const displayAvatarUrl = member?.displayAvatarURL() || user.displayAvatarURL();
    const displayName = member?.displayName || user.displayName;

    const isObsoleteAvatarUrl = message.embeds[0].data.author.icon_url !== displayAvatarUrl;
    const isObsoleteName = message.embeds[0].data.author.name !== displayName;
    if (!isObsoleteAvatarUrl && !isObsoleteName) continue;

    const vibrantAvatarColor = isObsoleteAvatarUrl
      ? await Utilities.getVibrantColorFromUrl(displayAvatarUrl)
      : message.embeds[0].data.color;

    const embed = EmbedBuilder.from(message.embeds[0]);
    embed.setAuthor({ iconURL: displayAvatarUrl, name: displayName, url: `https://discordapp.com/users/${userId}` });
    embed.setColor(vibrantAvatarColor);

    message
      .edit({ embeds: [embed] })
      .then(result => Utilities.LogPresets.EditedMessage(result, listener))
      .catch(error => logger.error(error, listener));
  }

  // ------------------------------------------------- //
  // Send missing replies to dms with images to review //
  // ------------------------------------------------- //

  const pendingMessages = Messages.filter(item =>
    item.channel.type === ChannelType.DM
    && item.author.id !== client.user.id
    && Utilities.checkImageAttachment(item)
    && !Messages.get({ referenceId: item.id, userId: client.user.id }).length
  )

  for (const message of pendingMessages) {
    await onDirectMessageCreate({ client, listener, message });
  }
}

/**
 * Get the index of the attachment url in the message attachment map.
 * @param {Message} message
 * @param {string} attachmentUrl
 * @returns {number}
 */
export function getAttachmentIndex(message, attachmentUrl) {
  if (!message?.attachments?.size) return -1;
  return Array.from(message.attachments.values()).findIndex(item => item.url === attachmentUrl);
}

/**
 * Get the composite key used uniquely store config data.
 * @param {number} userId
 * @param {number} messageId
 * @param {number} attachmentIndex
 * @returns {string}
 */
export function getCompositeKey(userId, messageId, attachmentIndex) {
  return [userId, messageId, attachmentIndex].join(",");
}

/**
 * Fetch all cached data for the configured Caturday images.
 * @param {object} param
 * @param {Listener} param.listener
 */
export async function initializeCaturdayImageCaches({ listener }) {
  for (const item of config.discord_caturday_ids) {
    const split = item.split(",");

    const userId = split[0];
    const message = Messages.get({ messageId: split[1] });

    if (!message) {
      logger.warn(`Couldn't find message for "${item}" config value.`, listener);
      continue;
    }

    const attachmentIndex = Number(split[2]);
    const attachmentUrl = Array.from(message.attachments.values())[attachmentIndex]?.url;

    if (!attachmentUrl) {
      logger.warn(`Couldn't find attachment url for "${item}" config value.`, listener);
      continue;
    }

    if (!await urlExist(attachmentUrl)) {
      logger.warn(`Couldn't verify attachment url "${attachmentUrl}" exists for "${item}" config value.`, listener);
      continue;
    }

    const cache = new CaturdayImageCache({ attachmentUrl, message, userId });
    caturdayImageCaches.set(attachmentUrl, cache);
    selectedUsers.set(attachmentUrl, userId);
  }
}

/**
 * Navigate the viewed image attachment back or next.
 * @param {ButtonInteraction} interaction
 * @param {Listener} listener
 * @param {Function} callback
 */
export async function onCaturdayButtonComponentBase(interaction, listener, callback) {
  await interaction.deferUpdate();

  // -------------------------------------------------------- //
  // Get the indexes of the viewed message and its attachment //
  // -------------------------------------------------------- //

  const messages = Messages
    .get({ channelId: interaction.channel.id })
    .filter(checkValidMessageImageAttachment);

  let attachmentIndex;
  let messageIndex;

  for (const i in messages) {
    messageIndex = Number(i); // why does JS make this numerical index a string...?
    attachmentIndex = getAttachmentIndex(messages[messageIndex], interaction.message.content);
    if (attachmentIndex > -1) break;
  }

  // ----------------------------------------------------------- //
  // Set the message and attachment indexes to their next values //
  // ----------------------------------------------------------- //

  const result = callback(attachmentIndex, messageIndex, messages);
  const { isBackDisabled, isNextDisabled } = result;
  attachmentIndex = result.attachmentIndex;
  messageIndex = result.messageIndex;

  // ---------------------------------------------------------- //
  // Update the message with the new button / attachment values //
  // ---------------------------------------------------------- //

  const message = messages[messageIndex];
  const attachmentUrl = Array.from(message.attachments.values())[attachmentIndex].url;
  const userId = selectedUsers.get(attachmentUrl) || message.author.id;
  const compositeKey = getCompositeKey(userId, message.id, attachmentIndex);

  const btn1 = config.discord_caturday_ids.includes(compositeKey) ? removeImageButton : selectImageButton;
  const btn2 = backButton.setDisabled(isBackDisabled);
  const btn3 = nextButton.setDisabled(isNextDisabled);
  const menu = getSelectMenuUser(userId).setDisabled(config.discord_caturday_ids.includes(compositeKey));

  const row1 = new ActionRowBuilder().addComponents(menu);
  const row2 = new ActionRowBuilder().addComponents(btn1, btn2, btn3, Emitter.moreInfoButton);

  interaction
    .editReply({ components: [row1, row2], content: attachmentUrl, fetchReply: true })
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));
}

/**
 * Navigate to and display the next newer image.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonComponentNewerImage({ interaction, listener }) {
  await onCaturdayButtonComponentBase(interaction, listener, (attachmentIndex, messageIndex, messages) => {
    if (!attachmentIndex) {
      messageIndex += 1;
      attachmentIndex = messages[messageIndex].attachments.size - 1;
    }
    else {
      attachmentIndex -= 1;
    }

    const isBackDisabled = attachmentIndex === messages[messageIndex].attachments.size - 1 && !messages[messageIndex - 1];
    const isNextDisabled = !attachmentIndex && !messages[messageIndex + 1];

    return { attachmentIndex, isBackDisabled, isNextDisabled, messageIndex };
  });
}

/**
 * Navigate to and display the next older image.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonComponentOlderImage({ interaction, listener }) {
  await onCaturdayButtonComponentBase(interaction, listener, (attachmentIndex, messageIndex, messages) => {
    if (attachmentIndex === messages[messageIndex].attachments.size - 1) {
      messageIndex -= 1;
      attachmentIndex = 0;
    }
    else {
      attachmentIndex += 1;
    }

    const isBackDisabled = !attachmentIndex && !messages[messageIndex - 1];
    const isNextDisabled = attachmentIndex === messages[messageIndex].attachments.size - 1 && !messages[messageIndex + 1];

    return { attachmentIndex, isBackDisabled, isNextDisabled, messageIndex };
  });
}

/**
 * Remove the data from the config file and log.
 * @param {string} compositeKey
 * @param {Listener} listener
 */
export function onButtonComponentRemoveImageBase(compositeKey, listener) {
  if (config.discord_caturday_ids.includes(compositeKey)) {
    const i = config.discord_caturday_ids.indexOf(compositeKey);
    config.discord_caturday_ids.splice(i, 1);
    config.save();
    logger.info(`Deleted "${compositeKey}" from config file.`, listener);
  }
}

/**
 * Remove the selected image from a direct message channel.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonComponentRemoveImageDirectMessage({ interaction, listener }) {
  await interaction.deferUpdate();
  Emitter.setBusy(interaction, true);

  const attachmentUrl = Utilities.getLinkFromString(interaction.message.content);
  const message = Messages.get({ attachmentUrl });
  const userId = message.id;
  const attachments = Array.from(message.attachments.values());
  const attachmentIndex = attachments.findIndex(item => item.url === attachmentUrl);

  const compositeKey = getCompositeKey(userId, message.id, attachmentIndex);
  onButtonComponentRemoveImageBase(compositeKey, listener);

  const buttons = [selectImageButton, hideMessageButton.setDisabled(false), Emitter.moreInfoButton];
  const components = [new ActionRowBuilder().addComponents(...buttons)];

  interaction
    .editReply({ components, fetchReply: true })
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));

  Emitter.setBusy(interaction, false);
}

/**
 * Remove the selected image from a guild text channel.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonComponentRemoveImageGuildText({ interaction, listener }) {
  await interaction.deferUpdate();
  Emitter.setBusy(interaction, true);

  const attachmentUrl = interaction.message.content;
  const message = Messages.get({ attachmentUrl });
  const userId = selectedUsers.get(attachmentUrl) || message.author.id;
  const attachments = Array.from(message.attachments.values());
  const attachmentIndex = attachments.findIndex(item => item.url === attachmentUrl);

  const compositeKey = getCompositeKey(userId, message.id, attachmentIndex);
  onButtonComponentRemoveImageBase(compositeKey, listener);

  const menu = getSelectMenuUser(userId).setDisabled(false);
  const row1 = new ActionRowBuilder().addComponents(menu);
  const row2 = ActionRowBuilder.from(interaction.message.components[1]);
  row2.components[0] = selectImageButton;

  interaction
    .editReply({ components: [row1, row2], content: attachmentUrl, fetchReply: true })
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));

  selectedUsers.set(attachmentUrl, message.author.id);
  Emitter.setBusy(interaction, false);
}

/**
 * Select the image in a direct message channel. A message will be sent to the
 * image uploader when their image was approved for the first time (meaning if
 * you remove and approve additional times they will be approved silently).
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonComponentSelectImageDirectMessage({ interaction, listener }) {
  await interaction.deferUpdate();
  Emitter.setBusy(interaction, true);

  const attachmentUrl = Utilities.getLinkFromString(interaction.message.content);
  const message = Messages.get({ attachmentUrl });

  if (!message || !await urlExist(attachmentUrl)) {
    const components =
      [new ActionRowBuilder().addComponents(missingImageButton, hideMessageButton.setDisabled(false), Emitter.moreInfoButton)];

    interaction
      .editReply({ components, fetchReply: true })
      .then(reply => Utilities.LogPresets.EditedReply(reply, listener))
      .catch(error => logger.error(error, listener));

    const content =
      "This image was deleted by the author. You can remove its review message by clicking the hide message button.";

    interaction
      .followUp({ content, ephemeral: true, fetchReply: true })
      .then(followUp => Utilities.LogPresets.SentFollowUp(followUp, listener))
      .catch(error => logger.error(error, listener));

    Emitter.setBusy(interaction, false);
    return;
  }

  const attachments = Array.from(message.attachments.values());
  const attachmentIndex = attachments.findIndex(item => item.url === attachmentUrl);
  const compositeKey = getCompositeKey(message.author.id, message.id, attachmentIndex);

  if (!config.discord_caturday_ids.includes(compositeKey)) {
    config.discord_caturday_ids.push(compositeKey);
    config.save();

    const isExistingReply = Messages.some(item =>
      item.reference
      && item.reference.messageId === message.id
      && item.content.toLowerCase().includes("approved")
    );

    // Send a notification to the image uploader that it has been approved.
    // (Check if a message hasn't been sent first so we don't spam them...)
    if (!isExistingReply) {
      message
        .reply("Your cat tax was approved by our cat staff. Thank you! 🐱")
        .then(reply => Utilities.LogPresets.SentReply(reply, listener))
        .catch(error => logger.error(error, listener));
    }
  }

  const components = [new ActionRowBuilder().addComponents(
    removeImageButton,
    hideMessageButton.setDisabled(true),
    Emitter.moreInfoButton
  )];

  interaction
    .editReply({ components, fetchReply: true })
    .then(reply => Utilities.LogPresets.EditedReply(reply, listener))
    .catch(error => logger.error(error, listener));

  Emitter.setBusy(interaction, false);
}

/**
 * Select the image in a guild text channel.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonComponentSelectImageGuildText({ interaction, listener }) {
  await interaction.deferUpdate();
  Emitter.setBusy(interaction, true);

  const attachmentUrl = interaction.message.content;
  const message = Messages.get({ attachmentUrl });

  if (!message || !await urlExist(attachmentUrl)) {
    // Disable the review image message button(s).
    const row1 = new ActionRowBuilder().addComponents(getSelectMenuUser(userId).setDisabled(true));
    const row2 = ActionRowBuilder.from(interaction.message.components[1]);
    row2.components[0].setDisabled(true);

    interaction
      .editReply({ components: [row1, row2], fetchReply: true })
      .then(reply => Utilities.LogPresets.EditedReply(reply, listener))
      .catch(error => logger.error(error, listener));

    // Send a follow up message notifying the reviewer.
    const content = "This image was deleted by the author and it cannot be selected.";

    interaction
      .followUp({ content, ephemeral: true, fetchReply: true })
      .then(followUp => Utilities.LogPresets.SentFollowUp(followUp, listener))
      .catch(error => logger.error(error, listener));

    Emitter.setBusy(interaction, false);
    return;
  }

  const userId = selectedUsers.get(attachmentUrl) || message.author.id;
  const attachments = Array.from(message.attachments.values());
  const attachmentIndex = attachments.findIndex(item => item.url === attachmentUrl);
  const compositeKey = getCompositeKey(userId, message.id, attachmentIndex);

  if (!config.discord_caturday_ids.includes(compositeKey)) {
    config.discord_caturday_ids.push(compositeKey);
    config.save();
  }

  const row1 = new ActionRowBuilder().addComponents(getSelectMenuUser(userId).setDisabled(true));
  const row2 = ActionRowBuilder.from(interaction.message.components[1]);
  row2.components[0] = removeImageButton;

  interaction
    .editReply({ components: [row1, row2], content: attachmentUrl, fetchReply: true })
    .then(reply => Utilities.LogPresets.EditedReply(reply, listener))
    .catch(error => logger.error(error, listener));

  Emitter.setBusy(interaction, false);
}

/**
 * Display the image selector when the command is sent
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onChatInputCommandCaturday({ interaction, listener }) {
  await interaction.deferReply({ ephemeral: true });

  const messages = Messages
    .get({ channelId: interaction.channel.id })
    .filter(item => !item.author.bot && Utilities.checkImageAttachment(item));

  if (!messages.length) {
    interaction
      .editReply({ content: "I couldn't find any message attachments in this channel." })
      .then(reply => Utilities.LogPresets.EditedReply(reply, listener))
      .catch(error => logger.error(error, listener));
    return;
  }

  const message = messages[0];
  const attachmentIndex = message.attachments.size - 1;
  const attachmentUrl = Array.from(message.attachments.values())[attachmentIndex].url;
  const userId = selectedUsers.get(attachmentUrl) || message.author.id;
  const compositeKey = getCompositeKey(userId, message.id, attachmentIndex);

  const btn1 = config.discord_caturday_ids.includes(compositeKey) ? removeImageButton : selectImageButton;
  const btn2 = backButton.setDisabled(true);
  const btn3 = nextButton.setDisabled(!attachmentIndex && !messages[1]);
  const menu = getSelectMenuUser(userId).setDisabled(config.discord_caturday_ids.includes(compositeKey));

  const row1 = new ActionRowBuilder().addComponents(menu);
  const row2 = new ActionRowBuilder().addComponents(btn1, btn2, btn3, Emitter.moreInfoButton);

  interaction
    .editReply({ components: [row1, row2], content: attachmentUrl, fetchReply: true })
    .then(reply => Utilities.LogPresets.EditedReply(reply, listener))
    .catch(error => logger.error(error, listener));
}

/**
 * Send a DM to the user requesting them to pay their cat taxes.
 * @param {object} param
 * @param {Client} param.client
 * @param {UserContextMenuCommandInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onContextMenuCommandCollectCatTaxes({ client, interaction, listener }) {
  await interaction.deferReply({ ephemeral: true });
  const user = client.users.cache.get(interaction.targetId);

  // Verify the target user is not a bot.
  if (user.bot) {
    interaction
      .editReply({ content: `I can't collect cat taxes from ${user} because they're a bot.`})
      .then(reply => Utilities.LogPresets.EditedReply(reply, listener))
      .catch(error => logger.error(error, listener));
    logger.warn(`${interaction.user.displayName} tried to collect cat taxes from a bot "${user.displayName}"`);
    return;
  }

  // Get count of times target user is an author.
  const count = config.discord_caturday_ids.reduce((total, item) => {
    const message = Messages.get({ messageId: item.split(",")[1] });
    if (message?.author.id === user.id) total += 1;
    return total;
  }, 0);

  const percent =
    Math.round(Utilities.getPercentage(count, config.discord_caturday_ids.length));

  const messageContent =
    `### :coin: Hello ${user}! You've been asked to pay your cat tax.`
    + "\n- __You can pay just by sending me pictures of your pets.__ :calling:"
    + `\n- You've contributed ${percent}% of the cat taxes we've collected. :hand_with_index_finger_and_thumb_crossed:`
    + `\nAll cat taxes queue for <#${config.announcement_discord_channel_id}> after review from our pawditors.`

  const replyContent =
    `I sent this message as a DM to ${user}:`;

  const files = [new AttachmentBuilder("assets/cat_tax.jpg")];

  user
    .send({ content: messageContent, files })
    .then(message => Utilities.LogPresets.SentMessageFile(message, "cat_tax.jpg", listener))
    .catch(error => logger.error(error, listener));

  interaction
    .editReply({ content: replyContent, fetchReply: true })
    .then(reply => Utilities.LogPresets.EditedReply(reply, listener))
    .catch(error => logger.error(error, listener));

  interaction
    .followUp({ content: messageContent, ephemeral: true, files })
    .then(followUp => Utilities.LogPresets.SentFollowUp(followUp, listener))
    .catch(error => logger.error(error, listener));
}

/**
 * On direct message create send all attachments to the image reviewers and
 * notify the image uploader of their pending review status.
 * @param {object} param
 * @param {Client} param.client
 * @param {Listener} param.listener
 * @param {Message} param.message
 */
export async function onDirectMessageCreate({ client, listener, message }) {
  const isClient = message.author.id === client.user.id;
  const isImage = Utilities.checkImageAttachment(message);
  if (isClient || !isImage) return;

  const content = `${message.author} [**sent a cat tax for review.**]`;
  const items = Array.from(message.attachments.values());
  const messages = [];

  for(const i in items) {
    const attachmentUrl = items[i].url;
    const buttons = [selectImageButton, hideMessageButton.setDisabled(false), Emitter.moreInfoButton];
    const components = [new ActionRowBuilder().addComponents(...buttons)];
    messages.push({ content: `${content}(${attachmentUrl})`, components });
  }

  for(const roleId of config.discord_admin_role_ids) {
    const guilds = client.guilds.cache.filter(guild => guild.roles.cache.some(role => role.id === roleId));
    const members = guilds.map(guild => [...guild.roles.cache.get(roleId).members.values()]).flat();

    for(const member of members) {
      for(const message of messages) {
        member.user
          .send(message)
          .then(message => Utilities.LogPresets.SentMessage(message, listener))
          .catch(error => logger.error(error, listener));
      }
    }
  }

  message
    .reply({ content: "Your cat tax is received and pending review by our cat staff. 🪙", fetchReply: true })
    .then(reply => Utilities.LogPresets.SentReply(reply, listener))
    .catch(error => logger.error(error, listener));
}

/**
 * Delete and/or disable the related messages when a Caturday image is deleted
 * from a users direct messages.
 * @param {object} param
 * @param {Client} param.client
 * @param {Listener} param.listener
 * @param {Message} param.message
 */
export async function onDirectMessageDelete({ client, listener, message }) {
  const isClient = message.author.id === client.user.id;
  const isImage = Utilities.checkImageAttachment(message);
  if (isClient || !isImage) return;

  logger.info(`${message.author.displayName} deleted a Caturday review image.`, listener);
  const attachments = Array.from(message.attachments.values());

  for (let i = 0; i < attachments.length; i++) {
    // --------------------------------------------- //
    // Delete the image from the config if it exists //
    // --------------------------------------------- //

    const compositeKey = getCompositeKey(message.author.id, message.id, i);

    if (config.discord_caturday_ids.includes(compositeKey)) {
      const i = config.discord_caturday_ids.indexOf(compositeKey);
      config.discord_caturday_ids.splice(i, 1);
      config.save();
      logger.info(`Deleted "${compositeKey}" from Caturday config file.`, listener);
    }

    // ------------------------------------------ //
    // Disable the image reviewer direct messages //
    // ------------------------------------------ //

    const reviewMessages = Messages.filter(item =>
      item.author.id === client.user.id &&
      item.channel.type === ChannelType.DM &&
      item.content.includes(attachments[i].url)
    );

    for (const reviewMessage of reviewMessages) {
      const buttons = [missingImageButton, hideMessageButton.setDisabled(false), Emitter.moreInfoButton];
      const components = [new ActionRowBuilder().addComponents(...buttons)];

      reviewMessage
        .edit({ components })
        .then(result => Utilities.LogPresets.EditedReply(result, listener))
        .catch(error => logger.error(error, listener));
    }

    // ------------------------------------ //
    // Delete the reference direct messages //
    // ------------------------------------ //

    const referenceMessages = Messages.get({ referenceId: message.id });

    for (const referenceMessage of referenceMessages) {
      referenceMessage.delete().catch(logger.error)
    }
  }
}

/**
 * Save the response when a user is selected.
 * @param {object} param
 * @param {UserSelectMenuInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onSelectMenuUser({ interaction, listener }) {
  await interaction.deferUpdate();
  selectedUsers.set(interaction.message.content, interaction.values[0]);
  Utilities.LogPresets.DebugSetValue("selectMenuUser", interaction.values[0], listener);
}

/**
 * Send the cat tax collection direct message.
 * @param {object} param
 * @param {GuildMember} param.member
 * @param {Listener} param.listener
 */
export async function sendCatTaxDirectMessage({ member, listener }) {
  // Verify the target user is not a bot.
  if (member.user.bot) return;

  // Get count of times target user is an author.
  const count = config.discord_caturday_ids.reduce((total, item) => {
    const message = Messages.get({ messageId: item.split(",")[1] });
    if (message?.author.id === member.id) total += 1;
    return total;
  }, 0);

  const percent =
    Math.round(Utilities.getPercentage(count, config.discord_caturday_ids.length));

  const messageContent =
    `### :coin: Hello ${member}! You've been asked to pay your cat tax.`
    + "\n- __You can pay just by sending me pictures of your pets.__ :calling:"
    + `\n- You've contributed ${percent}% of the cat taxes we've collected. :hand_with_index_finger_and_thumb_crossed:`
    + `\nAll cat taxes queue for <#${config.announcement_discord_channel_id}> after review from our pawditors.`

  const files = [new AttachmentBuilder("assets/cat_tax.jpg")];

  member.user
    .send({ content: messageContent, files })
    .then(result => Utilities.LogPresets.SentMessage(result, listener))
    .catch(error => logger.error(error, listener));
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN LOGIC                                                   //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
