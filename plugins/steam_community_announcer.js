import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { Config } from "../services/config.js";
import { Emitter } from "../services/emitter.js";
import { Logger } from "../services/logger.js";
import { Messages } from "../services/messages.js";
import { Utilities } from "../services/utilities.js";
import CronJob from "../entities/CronJob.js";
import date from "date-and-time";
import fetchRetry from "fetch-retry";
import Listener from "../entities/Listener.js";
import ordinal from "date-and-time/plugin/ordinal";
import probe from "probe-image-size";
date.plugin(ordinal);

const config = new Config(import.meta.filename);
const logger = new Logger(import.meta.filename);

const fetch = fetchRetry(global.fetch, Utilities.fetchRetryPolicy);

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
  ButtonSubscribeMe: "STEAM_BUTTON_SUBSCRIBE_ME",
  ButtonUnsubscribeMe: "STEAM_BUTTON_UNSUBSCRIBE_ME",
});

export const Listeners = Object.freeze({
  [Interactions.ButtonSubscribeMe]: new Listener()
    .setDescription("Pressing this button adds ${DISPLAYNAME} to the list of users pinged when news for ${EMBED_TITLE} is sent to ${GUILD_NAME} #${CHANNEL_NAME}.")
    .setFunction(onButtonSubscribeMe),
  [Interactions.ButtonUnsubscribeMe]: new Listener()
    .setDescription("Pressing this button removes ${DISPLAYNAME} from the list of users pinged when news for ${EMBED_TITLE} is sent to ${GUILD_NAME} #${CHANNEL_NAME}.")
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
  for (const steam_app of config.announcement_steam_apps) {
    const {
      discord_announcement_channel_ids, discord_override_embed_image,
      discord_override_embed_thumbnail, discord_override_embed_title,
      discord_subscribed_user_ids, steam_app_id, steam_ignored_strings_content,
      steam_ignored_strings_title, steam_required_strings_content,
      steam_required_strings_title
    } = steam_app;

    if (!steam_app_id?.trim()) {
      throw new Error(`Invalid steam_app_id "${steam_app_id}"`);
    }

    //////////////////////////////////////////////////////////////////////////////
    // Allow garbage data in app id definition to make managing the JSON easier //
    // I don't know what game "12345" is but I know what game "12345 - Halo" is //
    //////////////////////////////////////////////////////////////////////////////
    const steamAppId = steam_app_id.split(" ")[0].trim();

    // Fetch the latest announcement that meets the config criteria.
    const steamAppAnnouncement = await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${steamAppId}`)
      .then(response => response.json())
      .then(({ appnews }) => appnews?.newsitems.find(({ contents, feed_type, title }) => {
        if (feed_type !== 1) return false; // "feed_type === 1" are official announcements
        const includes = (source, str) => str.trim() && source.toLowerCase().includes(str.toLowerCase());
        const isIgnoredContentValid = !steam_ignored_strings_content?.filter(Boolean).length || !steam_ignored_strings_content.filter(Boolean).some(str => includes(contents, str));
        const isIgnoredTitleValid = !steam_ignored_strings_title?.filter(Boolean).length || !steam_ignored_strings_title.filter(Boolean).some(str => includes(title, str));
        const isRequiredContentValid = !steam_required_strings_content?.filter(Boolean).length || steam_required_strings_content.filter(Boolean).some(str => includes(contents, str));
        const isRequiredTitleValid = !steam_required_strings_title?.filter(Boolean).length || steam_required_strings_title.filter(Boolean).some(str => includes(title, str));
        return isIgnoredContentValid && isIgnoredTitleValid && isRequiredContentValid && isRequiredTitleValid;
      }));

    if (!steamAppAnnouncement) continue; // No announcement was found!

    // Fetch the Steam Store app data for the announcement.
    const steamAppDetailsData = await fetch(`https://store.steampowered.com/api/appdetails?appids=${steamAppId}&l=english`)
      .then(response => response.json())
      .then(json => json[steamAppId].data);

    if (!steamAppDetailsData) continue; // No game data was found!

    for (const channel_id of discord_announcement_channel_ids) {
      const existingMessage = Messages
        .get({ channelId: channel_id })
        .find(({ embeds }) => embeds?.[0]?.data?.description?.includes(steamAppAnnouncement.url));

      if (existingMessage) continue; // Announcement was already sent!

      ////////////////////////////////////////////////////
      // Build the embed fields with announcement data. //
      ////////////////////////////////////////////////////

      const content = Utilities.removeHtmlCodeTags(steamAppAnnouncement.contents);
      const embedImage = discord_override_embed_image?.trim() || await findLandscapeImage(steamAppAnnouncement) || steamAppDetailsData.header_image;
      const embedTitle = discord_override_embed_title?.trim() || steamAppDetailsData.name;
      const shortDescription = Utilities.getTruncatedStringTerminatedByWord(content, 200);
      const shortDate = date.format(new Date(steamAppAnnouncement.date * 1000), "MMMM DDD");

      const embeds = [new EmbedBuilder()
        .setAuthor({ name: "New Steam Community announcement", iconURL: "attachment://steam_logo.png" })
        .setColor(0x1A9FFF)
        .setDescription(`- [**${steamAppAnnouncement.title}**](${steamAppAnnouncement.url})\n_${shortDescription}_`)
        .setFooter({ text: `Posted on ${shortDate}. Click the link to read the full announcement.` })
        .setImage(embedImage)
        .setThumbnail(discord_override_embed_thumbnail?.trim() || steamAppDetailsData.capsule_image)
        .setTitle(embedTitle)];

      const files = [new AttachmentBuilder("assets/steam_logo.png")];

      /////////////////////////////////////////////
      // Send the embedded announcement message. //
      /////////////////////////////////////////////

      const channel = client.channels.cache.get(channel_id);
      const message = await channel.send({ embeds, files });
      Utilities.LogPresets.SentMessage(message, listener);

      ///////////////////////////////////////////
      // Create the discussion thread channel. //
      ///////////////////////////////////////////

      const threadOptions = { name: `💬 ${embedTitle} • ${steamAppAnnouncement.title}` };
      const threadChannel = await Utilities.getOrCreateThreadChannel({ message, threadOptions });

      //////////////////////////////////////
      // Send the thread channel message. //
      //////////////////////////////////////

      const replyButton1 = buttonSubscribeMe.setCustomId(`${Interactions.ButtonSubscribeMe}${JSON.stringify({ steamAppId })}`);
      const replyButton2 = buttonUnsubscribeMe.setCustomId(`${Interactions.ButtonUnsubscribeMe}${JSON.stringify({ steamAppId })}`);
      const replyComponents = [new ActionRowBuilder().addComponents(replyButton1, replyButton2, Emitter.moreInfoButton)];

      const subscribers = discord_subscribed_user_ids?.filter(userId => userId.trim()).map(userId => `<@${userId}>`);
      const replyContent = subscribers?.length && `📨 ${subscribers.join(" ")}`;
      const replyDescription = `Press the \`🟩🔔 Subscribe me\` button to be alerted when new ${embedTitle} announcements are sent to ${channel} 📬`;
      const replyEmbeds = [new EmbedBuilder().setDescription(replyDescription)];

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
 * Get the first landscape orientation from the announcement contents.
 * @async
 * @param {object} steamAppAnnouncement
 * @returns {string?}
 */
export async function findLandscapeImage(steamAppAnnouncement) {
  const map = match => match[1].replace("{STEAM_CLAN_IMAGE}", "https://clan.akamai.steamstatic.com/images/");
  const announcementImageUrls = [...steamAppAnnouncement.contents.matchAll(/\[img\](.*?)\[\/img\]/g)].map(map);

  for(const url of announcementImageUrls) {
    const isValidSize = await probe(url).then(({ height, width }) => width >= height * 1.25 && width <= height * 4);
    if (isValidSize) return url;
  }
}

/**
 * Find the steamAppId bundled in the customId field and the steam_app from the config file so we can update it.
 * @param {object} param
 * @param {Listener} param.listener
 * @throws If { steamAppId } is not in customId
 * @throws If steam_app_id not in config
 * @returns {object}
 */
export function findSteamAppConfig({ listener }) {
  const steamAppId = listener.customData?.steamAppId;
  if (!steamAppId) throw new Error("Couldn't find { steamAppId } in interaction[\"customId\"].");

  const findSteamApp = ({ steam_app_id }) => steam_app_id.startsWith(steamAppId);
  const steam_app = config.announcement_steam_apps.find(findSteamApp);
  if (!steam_app) throw new Error(`Couldn't find steam_app_id "${steamAppId}" in config.`);

  return steam_app;
}

/**
 * Save interaction users id to the config and update the message content.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonSubscribeMe({ interaction, listener }) {
  await interaction.deferReply({ ephemeral: true });

  const steam_app = findSteamAppConfig({ interaction, listener });
  steam_app.discord_subscribed_user_ids ??= [];
  let replyContent = "";

  if (!steam_app.discord_subscribed_user_ids.includes(interaction.user.id)) {
    replyContent = "You've been subscribed to these announcements! 🔔";
    steam_app.discord_subscribed_user_ids ??= [];
    steam_app.discord_subscribed_user_ids.push(interaction.user.id);
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
  await updateSubscribeMessage({ interaction, listener, steam_app });
}

/**
 * Remove interaction users id from the config and update the message content.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonUnsubscribeMe({ interaction, listener }) {
  await interaction.deferReply({ ephemeral: true });

  const steam_app = findSteamAppConfig({ interaction, listener });
  steam_app.discord_subscribed_user_ids ??= [];
  let replyContent = "";

  if (steam_app.discord_subscribed_user_ids.includes(interaction.user.id)) {
    replyContent = "You've been unsubscribed from these announcements. 🔕";
    steam_app.discord_subscribed_user_ids = steam_app.discord_subscribed_user_ids.filter(id => id !== interaction.user.id);
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
  await updateSubscribeMessage({ interaction, listener, steam_app });
}

/**
 * Update the message with subscribed users when the subscribed users change.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 * @param {object} param.steam_app
 */
export async function updateSubscribeMessage({ interaction, listener, steam_app }) {
  const subscribers = steam_app.discord_subscribed_user_ids?.filter(userId => userId.trim()).map(userId => `<@${userId}>`);

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
