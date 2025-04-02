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
    .setFunction(checkAndAnnounceUpdates)
    .setTriggered(),
  new CronJob()
    .setEnabled(config.discord_enable_custom_activity)
    .setExpression(config.announcement_cron_job_expression)
    .setFunction(checkAndUpdateActivity)
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

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region PLUGIN COMPONENTS                                                 //
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
// #endregion PLUGIN COMPONENTS                                              //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region PLUGIN LOGIC                                                      //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * Check for Plex session info to display in the client activity.
 * @param {object} param
 * @param {Client} param.client The Discord.js client
 * @param {Listener} param.listener
 */
export async function checkAndUpdateActivity({ client, listener }) {
  const sessions = await fetchPlexSessions();
  const currentActivityState = client.user.presence.activities[0]?.state;

  if (sessions.size) {
    const isMovie = sessions.Metadata.some(item => item.librarySectionTitle.toLowerCase().includes("movie"));
    const isMusic = sessions.Metadata.some(item => item.librarySectionTitle.toLowerCase().includes("music"));
    const isShow = sessions.Metadata.some(item => item.librarySectionTitle.toLowerCase().includes("show"));

    let updatedActivityState;

    if ([isMovie, isMusic, isShow].filter(Boolean).length > 1) {
      updatedActivityState = "media";
    }
    else if (isMovie) {
      updatedActivityState = "movie";
    }
    else if (isMusic) {
      updatedActivityState = "music";
    }
    else if (isShow) {
      updatedActivityState = "show";
    }
    else {
      throw new Error("Unexpected value");
    }

    if (sessions.size === 1 && !isMusic) updatedActivityState = `a ${updatedActivityState}`;
    else if (sessions.size > 1 && !isMusic) updatedActivityState = `${updatedActivityState}s`;
    updatedActivityState = `Streaming ${updatedActivityState} to ${sessions.size} ${Utilities.getPluralizedString("client", sessions.size)}`;

    if (currentActivityState !== updatedActivityState) {
      logger.debug(`Setting activity to "${updatedActivityState}"`, listener);
      const activities = [{ name: updatedActivityState, type: ActivityType.Custom }];
      client.user.setPresence({ activities, status: PresenceUpdateStatus.DoNotDisturb });
    }
  }
  else if (currentActivityState) {
    logger.debug(`Removing activity "${currentActivityState}"`, listener);
    client.user.setPresence({ activities: [], status: PresenceUpdateStatus.Online });
  }
}

/**
 * Check for pending announcements on startup and a regular time interval
 * @param {object} param
 * @param {Client} param.client The Discord.js client
 * @param {Listener} param.listener
 */
export async function checkAndAnnounceUpdates({ client, listener }) {
  // Sort items by aired order and group by parent id
  const plexRecentItems = await fetchPlexPlaylistItems(config.plex_playlist_keys)
    .then(items => items.sort((a, b) => a.parentIndex - b.parentIndex || a.index - b.index).reduce((previous, current) => {
      const highestRatingKey = current.grandparentRatingKey || current.parentRatingKey || current.ratingKey;
      previous[highestRatingKey] ??= { episodes: [], ...current };
      if (current.type !== "episode") return previous;
      previous[highestRatingKey].episodes.push(current);
      return previous;
    }, {}));

  let plexServer;

  // Loop each item, with each item possibly containing a list
  for(const highestRatingKey of Object.keys(plexRecentItems)) {
    const recentItem = plexRecentItems[highestRatingKey];
    const metadata = await fetchPlexMetadata(highestRatingKey);

    let channel;
    let embedImage;
    let embedTitle = `${metadata.title} (${metadata.year})`;
    let embeds;
    let embedThumbnail;
    let files;
    let imdbGuid;
    let shortDate;

    for(const channel_id of config.discord_announcement_channel_ids) {
      const existingMessage = Messages
        .get({ channelId: channel_id })
        .find(({ embeds }) => embeds?.[0]?.data.title === embedTitle);

      let embedAuthor;

      if (recentItem.type === "movie") {
        if (existingMessage) continue; // Continue if the movie has already been announced.
        embedAuthor = "New movie in Plex Media Server";
      }

      let unannouncedEpisodes;

      if (recentItem.type === "episode") {
        if (existingMessage) {
          // Filter the episodes returned by the Plex API for the episodes added AFTER the last announcement message was sent.
          unannouncedEpisodes = recentItem.episodes.filter(item => new Date(item.addedAt * 1000) > existingMessage.createdAt);
          if (!unannouncedEpisodes.length) continue; // Continue if all episodes have already been announced.
        }
        else {
          // No message exists which means no episodes have been announced.
          unannouncedEpisodes = recentItem.episodes;
        }

        embedAuthor= `New ${Utilities.getPluralizedString("episode", unannouncedEpisodes)} in Plex Media Server`;
      }

      plexServer ??= await fetchPlexServer();

      if (!imdbGuid) {
        imdbGuid = metadata.Guid?.map(({ id }) => id).find(id => id.startsWith("imdb://"))?.replace("imdb://", "");
      }

      const embedFields = [];
      const value1 = `[IMDb (${imdbGuid})](https://www.imdb.com/title/${imdbGuid}/)`;
      const value2 = `[Plex (${recentItem.librarySectionTitle})](https://app.plex.tv/desktop#!/server/${plexServer.machineIdentifier}/details?key=/library/metadata/${highestRatingKey})`;
      embedFields.push({ inline: true, name: "View Details", value: value1 }, { inline: true, name: "View Details", value: value2 });

      // Append the unannounced episodes to the embed in "S00E00 EPISODE_TITLE" format.
      if (unannouncedEpisodes.length) {
        let items = unannouncedEpisodes.slice(0, unannouncedEpisodes.length === 3 ? 3 : 2);
        let value = items.map(i => `- \`${formatSeasonEpisodeLabel(i)}\` ["${i.title}"](https://app.plex.tv/desktop#!/server/${plexServer.machineIdentifier}/details?key=/library/metadata/${recentItem.ratingKey})`).join("\n");
        const remainingCount = unannouncedEpisodes.length - items.length;
        if (remainingCount) value += `\n- ... and ${remainingCount} more`;
        embedFields.unshift({ name: `${Utilities.getPluralizedString("Episode", unannouncedEpisodes)} Added`, value });
      }

      // Fetch the file from the relative Plex link. Using the URL as-is does not load in Discord.
      embedImage ??= !config.discord_enable_compact_embed && await new Downloader({
        directory: `${config.temp_directory_path}/${nanoid()}`,
        fileName: "embed_image.jpg",
        url: `${config.plex_server_url}${recentItem.art}.jpg`
      }).download().then(({ filePath }) => filePath);

      // Fetch the file from the relative Plex link. Using the URL as-is does not load in Discord.
      embedThumbnail ??= await new Downloader({
        directory: `${config.temp_directory_path}/${nanoid()}`,
        fileName: "embed_thumbnail.jpg",
        url: `${config.plex_server_url}${recentItem.grandparentThumb || recentItem.parentThumb || recentItem.thumb}.jpg`
      }).download().then(({ filePath }) => filePath);

      files ??= [
        new AttachmentBuilder("assets/plex_logo.webp"),
        new AttachmentBuilder(embedImage),
        new AttachmentBuilder(embedThumbnail)
      ];

      shortDate ??=
        date.format(new Date(1000 * recentItem.addedAt), "MMMM DDD");

      embeds ??= [new EmbedBuilder()
        .setAuthor({ name: embedAuthor, iconURL: "attachment://plex_logo.webp" })
        .setColor(0xFF9E16)
        .setDescription(`_${escapeNumberedList(Utilities.getTruncatedStringTerminatedByWord(metadata.summary, 200))}_`)
        .addFields(...embedFields)
        .setFooter({ text: `Added on ${shortDate} using PMS version ${plexServer.version}.` })
        .setImage(`attachment://${path.basename(embedImage)}`)
        .setThumbnail(`attachment://${path.basename(embedThumbnail)}`)
        .setTitle(embedTitle)];

      channel ??= client.channels.cache.get(channel_id);
      const message = await channel.send({ embeds, files });
      Utilities.LogPresets.SentMessage(message, listener);

      const threadOptions = { name: `💬 Plex Media Server • ${embedTitle}` };
      const threadChannel = await Utilities.getOrCreateThreadChannel({ message, threadOptions });

      const replyButton1 = buttonSubscribeMe.setCustomId(`${Interactions.ButtonSubscribeMe}${JSON.stringify({ ratingKey: highestRatingKey })}`);
      const replyButton2 = buttonUnsubscribeMe.setCustomId(`${Interactions.ButtonUnsubscribeMe}${JSON.stringify({ ratingKey: highestRatingKey })}`);
      const replyComponents = [new ActionRowBuilder().addComponents(replyButton1, replyButton2, Emitter.moreInfoButton)];

      const subscribers = config.discord_subscribed_users[highestRatingKey]?.filter(userId => userId.trim()).map(userId => `<@${userId}>`);
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
 * Fetches the `/library/metadata` endpoint from Plex for the library item key and returns the most useful data.
 * @param {string} key
 * @returns {object}
 */
export async function fetchPlexMetadata(key) {
  return await fetch(`${config.plex_server_url}/library/metadata/${key}`, {
    headers: { "Accept": "application/json", "X-Plex-Token": config.plex_access_token },
    method: "GET"
  })
  .then(response => response.json())
  .then(response => response.MediaContainer?.Metadata?.[0]);
}

/**
 * Fetches the `/activities` endpoint from Plex for the playlist key and returns the most useful data.
 * @param {string} playlistKeys
 * @returns {object}
 */
export async function fetchPlexPlaylistItems(playlistKeys) {
  const busyLibrarySectionIds = await fetch(`${config.plex_server_url}/activities`, {
    headers: { "Accept": "application/json", "X-Plex-Token": config.plex_access_token },
    method: "GET"
  })
  .then(response => response.json())
  .then(response => response.MediaContainer?.Activity?.map(item => item?.Context?.librarySectionID) ?? []);

  const result = [];

  for (const playlistKey of playlistKeys) {
    const playlist = await fetch(`${config.plex_server_url}/playlists/${playlistKey}/items`, {
      headers: { "Accept": "application/json", "X-Plex-Token": config.plex_access_token },
      method: "GET"
    })
    .then(response => response.json())
    .then(response => response.MediaContainer?.Metadata);

    const librarySectionID =
      playlist?.find(item => item.librarySectionID)?.librarySectionID?.toString();

    if (busyLibrarySectionIds.includes(librarySectionID)) {
      logger.debug(`Library ${librarySectionID} is busy. Skipping fetch.`);
      continue;
    }

    if (!playlist) continue;
    result.push(playlist);
  }

  return result.flat();
}

/**
 * Fetches the `/servers` endpoint from Plex and returns the most useful data.
 * @returns {object}
 */
export async function fetchPlexServer() {
  return await fetch(`${config.plex_server_url}/servers`, {
    headers: { "Accept": "application/json", "X-Plex-Token": config.plex_access_token },
    method: "GET"
  })
  .then(response => response.json())
  .then(response => response.MediaContainer?.Server?.[0]);
}

/**
 * Fetches the `/status/sessions` endpoint from Plex and returns the most useful data.
 * @returns {object}
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
 * Format items into S##E## format.
 * @param {object} item
 * @returns {string}
 */
export function formatSeasonEpisodeLabel(item) {
  const s = `S${item.parentIndex < 10 ? "0" : ""}${item.parentIndex}`;
  const e = `E${item.index < 10 ? "0" : ""}${item.index}`;
  return `${s}${e}`;
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
 * @param {string} param.ratingKey
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
