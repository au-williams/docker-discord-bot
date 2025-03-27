import { ActionRowBuilder, ActivityType, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeNumberedList, PresenceUpdateStatus } from "discord.js";
import { Config } from "../services/config.js";
import { Emitter } from "../services/emitter.js";
import { Logger } from "../services/logger.js";
import { Messages } from "../services/messages.js";
import { nanoid } from "nanoid";
import { Utilities } from "../services/utilities.js";
import CronJob from "../entities/CronJob.js";
import date from "date-and-time";
import Downloader from "nodejs-file-downloader";
import Listener from "../entities/Listener.js";
import ordinal from "date-and-time/plugin/ordinal";
import path from "path";
date.plugin(ordinal);

// TODO:
// Streaming Plex with 2 users

const config = new Config(import.meta.filename);
const logger = new Logger(import.meta.filename);

let cachedSessionSize;

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
  ButtonSubscribeMe: "PLEX_BUTTON_SUBSCRIBE_ME",
  ButtonUnsubscribeMe: "PLEX_BUTTON_UNSUBSCRIBE_ME",
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
  const plexRecentItems = await fetchPlexRecentItems();
  let plexServer;

  if (config.discord_enable_rich_presence) {
    const sessions = await fetchPlexSessions();

    if (sessions.size !== cachedSessionSize && sessions.size === 0) {
      client.user.setPresence({ activities: null, status: PresenceUpdateStatus.Online });
      cachedSessionSize = sessions.size;
    }
    else if (sessions.size !== cachedSessionSize) {
      const isMovie = sessions.Metadata.some(item => item.librarySectionTitle.toLowerCase().includes("movie"));
      const isMusic = sessions.Metadata.some(item => item.librarySectionTitle.toLowerCase().includes("music"));
      const isShow = sessions.Metadata.some(item => item.librarySectionTitle.toLowerCase().includes("show"));

      let activityName;
      let activityType = ActivityType.Streaming;

      if ([isMovie, isMusic, isShow].filter(Boolean).length > 1) {
        activityName = "media";
      }
      else if (isMovie) {
        activityName = sessions.size === 1 ? "a movie" : "movies";
      }
      else if (isShow) {
        activityName = sessions.size === 1 ? "a show" : "shows";
      }
      else if (isMusic) {
        activityName = "music";
      }

      activityName += ` to ${sessions.size} ${Utilities.getPluralizedString("client", sessions.size)}`;
      // TODO: status doesn't seem to work. Why? The code is correct per the documentation.
      client.user.setPresence({ activities: [{ name: activityName, type: activityType }], status: "dnd" });
      cachedSessionSize = sessions.size;
    }
  }

  for(const plexRecentItem of plexRecentItems) {
    const isMovie = plexRecentItem.librarySectionTitle.toLowerCase().includes("movie");
    const isShow = plexRecentItem.librarySectionTitle.toLowerCase().includes("show");

    ///////////////////////////////////////////////////////////////////////////
    // Assign as needed so we don't make a do of unnecessary fetch requests! //
    ///////////////////////////////////////////////////////////////////////////

    let channel;
    let embeds;
    let embedAuthor;
    let embedDescription;
    let embedFields;
    let embedFooter;
    let embedImage;
    let embedThumbnail;
    let shortDate;
    let files;
    let imdbGuid;

    // Pre-format the embed title so we can check its existence in the channel.
    let embedTitle =
      `${plexRecentItem.parentTitle || plexRecentItem.title} (${plexRecentItem.parentYear || plexRecentItem.year})`;

    if (isShow && plexRecentItem.type === "season") {
      embedTitle += ` \`Season ${plexRecentItem.index}\``;
    }

    if (isShow && plexRecentItem.type !== "season") {
      // TODO: I've only seen "season" so I don't know if this exists. But it
      // has a field and that implies it changes so does "episode" exist too?
      embedTitle += ` \`${plexRecentItem.title}\``;
    }

    for(const channel_id of config.discord_announcement_channel_ids) {
      const existingMessage = Messages
        .get({ channelId: channel_id })
        .find(({ embeds }) => embeds?.[0]?.data.title === embedTitle);

      if (existingMessage) continue; // Message was already sent!

      plexServer ??= await fetchPlexServer();

      if (!imdbGuid) {
        const guids = await fetchPlexGuids(plexRecentItem);
        imdbGuid = guids.find(id => id.startsWith("imdb://")).replace("imdb://", "");
      }

      if (!embedAuthor && isMovie) {
        embedAuthor = "New movie in Plex Media Server";
      }

      if (!embedAuthor && isShow) {
        // TODO: I don't know if "episode" exists in the Plex response. I have not seen it.
        embedAuthor = `New ${plexRecentItem.type === "season" ? "season" : "episode"} in Plex Media Server`;
      }

      embedDescription ??=
        `_${escapeNumberedList(Utilities.getTruncatedStringTerminatedByWord(plexRecentItem.parentSummary || plexRecentItem.summary, 200))}_`;

      embedFields ??= [
        {
          inline: true,
          name: "View Details",
          value: `[IMDb (${imdbGuid})](https://www.imdb.com/title/${imdbGuid}/)`
        },
        {
          inline: true,
          name: "View Details",
          value: `[Plex (${plexRecentItem.librarySectionTitle})](https://app.plex.tv/desktop#!/server/${plexServer.machineIdentifier}/details?key=/library/metadata/${plexRecentItem.parentRatingKey || plexRecentItem.ratingKey})`
        }
      ];

      // Fetch the file from the relative Plex link. Using the URL as-is does not load in Discord.
      embedImage ??= !config.discord_enable_compact_embed && await new Downloader({
        directory: `${config.temp_directory_path}/${nanoid()}`,
        fileName: "embed_image.jpg",
        url: `${config.plex_server_url}${plexRecentItem.art}.jpg`
      }).download().then(({ filePath }) => filePath);

      // Fetch the file from the relative Plex link. Using the URL as-is does not load in Discord.
      embedThumbnail ??= await new Downloader({
        directory: `${config.temp_directory_path}/${nanoid()}`,
        fileName: "embed_thumbnail.jpg",
        url: `${config.plex_server_url}${plexRecentItem.parentThumb || plexRecentItem.thumb}.jpg`
      }).download().then(({ filePath }) => filePath);

      files ??= [new AttachmentBuilder("assets/plex_logo.webp"), new AttachmentBuilder(embedThumbnail)];

      embeds ??= [new EmbedBuilder()
        .setAuthor({ name: embedAuthor, iconURL: "attachment://plex_logo.webp" })
        .setColor(0xFF9E16)
        .setDescription(embedDescription)
        .addFields(...embedFields)
        .setThumbnail(`attachment://${path.basename(embedThumbnail)}`)
        .setTitle(`${embedTitle} `)];

      if (!config.discord_enable_compact_embed) {
        files.push(new AttachmentBuilder(embedImage));
        shortDate ??= date.format(new Date(1000 * (plexRecentItem.updatedAt || plexRecentItem.addedAt)), "MMMM DDD");
        embedFooter ??= `${plexRecentItem.updatedAt ? "Updated" : "Added"} on ${shortDate} using PMS version ${plexServer.version}.`;
        embeds[0].setFooter({ text: embedFooter });
        embeds[0].setImage(`attachment://${path.basename(embedImage)}`);
      }

      channel ??= client.channels.cache.get(channel_id);
      const message = await channel.send({ embeds, files });
      Utilities.LogPresets.SentMessage(message, listener);

      const threadOptions = { name: `💬 Plex Media Server • ${plexRecentItem.parentTitle || plexRecentItem.title} (${plexRecentItem.parentYear || plexRecentItem.year})` };
      const threadChannel = await Utilities.getOrCreateThreadChannel({ message, threadOptions });

      const ratingKey = plexRecentItem.parentRatingKey || plexRecentItem.ratingKey;
      const replyButton1 = buttonSubscribeMe.setCustomId(`${Interactions.ButtonSubscribeMe}${JSON.stringify({ ratingKey })}`);
      const replyButton2 = buttonUnsubscribeMe.setCustomId(`${Interactions.ButtonUnsubscribeMe}${JSON.stringify({ ratingKey })}`);
      const replyComponents = [new ActionRowBuilder().addComponents(replyButton1, replyButton2, Emitter.moreInfoButton)];

      const subscribers = config.discord_subscribed_users[ratingKey]?.filter(userId => userId.trim()).map(userId => `<@${userId}>`);
      const replyContent = subscribers?.length && `📨 ${subscribers.join(" ")}`;
      const replyDescription = `Press the \`🟩🔔 Subscribe me\` button to be alerted when new ${plexRecentItem.parentTitle || plexRecentItem.title} (${plexRecentItem.parentYear || plexRecentItem.year}) announcements are sent to ${channel} 📬`;
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
 *
 */
export async function fetchPlexSessions() {
  return await fetch(`${config.plex_server_url}/status/sessions`, {
    headers: { "Accept": "application/json", "X-Plex-Token": config.plex_access_token },
    method: "GET"
  })
  .then(response => response.json())
  .then(response => response.MediaContainer);
}

/**
 *
 */
export async function fetchPlexServer() {
  return await fetch(`${config.plex_server_url}/servers`, {
    headers: { "Accept": "application/json", "X-Plex-Token": config.plex_access_token },
    method: "GET"
  })
  .then(response => response.json())
  .then(response => response.MediaContainer.Server[0]);
}

/**
 *
 */
export async function fetchPlexGuids(plexRecentItem) {
  return await fetch(`${config.plex_server_url}/library/metadata/${plexRecentItem.parentRatingKey || plexRecentItem.ratingKey}`, {
    headers: {
      "Accept": "application/json",
      "X-Plex-Token": config.plex_access_token
    },
    method: "GET"
  })
  .then(response => response.json())
  .then(response => response.MediaContainer.Metadata[0].Guid.map(({ id }) => id));
}

/**
 *
 */
export async function fetchPlexRecentItems() {
  return await fetch(`${config.plex_server_url}/library/recentlyAdded`, {
      headers: {
        "Accept": "application/json",
        "X-Plex-Token": config.plex_access_token
      },
      method: "GET"
    })
    .then(response => response.json())
    .then(response => response.MediaContainer.Metadata.filter(item =>
      item.librarySectionTitle.toLowerCase().includes("movies")
      || item.librarySectionTitle.toLowerCase().includes("shows")
    ).slice(0, config.plex_recent_item_count));
}

/**
 * Save interaction users id to the config and update the message content.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonSubscribeMe({ interaction, listener }) {
  await interaction.deferReply({ ephemeral: true });

  const ratingKey = listener.customData?.ratingKey;
  if (!ratingKey) throw new Error("Couldn't find { ratingKey } in interaction[\"customId\"].");

  let replyContent = "";

  if (!config.discord_subscribed_users[ratingKey]?.includes(interaction.user.id)) {
    replyContent = "You've been subscribed to these announcements! 🔔";
    config.discord_subscribed_users[ratingKey] ??= [];
    config.discord_subscribed_users[ratingKey].push(interaction.user.id);
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
  await updateSubscribeMessage({ interaction, listener, ratingKey });
}

/**
 * Remove interaction users id from the config and update the message content.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onButtonUnsubscribeMe({ interaction, listener }) {
  await interaction.deferReply({ ephemeral: true });

  const ratingKey = listener.customData?.ratingKey;
  if (!ratingKey) throw new Error("Couldn't find { ratingKey } in interaction[\"customId\"].");

  let replyContent = "";

  if (config.discord_subscribed_users[ratingKey]?.includes(interaction.user.id)) {
    replyContent = "You've been unsubscribed from these announcements. 🔕";
    config.discord_subscribed_users[ratingKey] = config.discord_subscribed_users[ratingKey].filter(id => id !== interaction.user.id);
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
  await updateSubscribeMessage({ interaction, listener, ratingKey });
}

/**
 * Update the message with subscribed users when the subscribed users change.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 * @param {object} param.rss_feed
 */
export async function updateSubscribeMessage({ interaction, listener, ratingKey }) {
  const subscribers = config.discord_subscribed_users[ratingKey]?.filter(userId => userId.trim()).map(userId => `<@${userId}>`);

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
