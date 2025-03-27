import { AttachmentBuilder, EmbedBuilder, escapeNumberedList } from "discord.js";
import { Config } from "../services/config.js";
import { Logger } from "../services/logger.js";
import { Messages } from "../services/messages.js";
import { nanoid } from "nanoid";
import { Utilities } from "../services/utilities.js";
import CronJob from "../entities/CronJob.js";
import date from "date-and-time";
import Downloader from "nodejs-file-downloader";
import ordinal from "date-and-time/plugin/ordinal";
import path from "path";
date.plugin(ordinal);

// TODO:
// Streaming Plex with 2 users

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
  const plexRecentItems = await fetchPlexRecentItems();
  let plexServer;

  for(const plexRecentItem of plexRecentItems) {
    const isMovie = plexRecentItem.librarySectionTitle.toLowerCase().includes("movie");
    const isShow = plexRecentItem.librarySectionTitle.toLowerCase().includes("show");

    let channel;
    let embeds;
    let embedAuthor;
    let embedDescription;
    let embedFields;
    let embedFooter;
    let embedImage;
    let embedThumbnail;
    let embedTitle = `${plexRecentItem.parentTitle || plexRecentItem.title} (${plexRecentItem.parentYear || plexRecentItem.year})`;
    let shortDate;
    let files;
    let imdbGuid;

    if (isShow) {
      embedTitle += plexRecentItem.type === "season"
        ? ` \`Season ${plexRecentItem.index}\``
        : ` \`${plexRecentItem.title}\``;
    }

    for(const channel_id of config.discord_announcement_channel_ids) {
      const existingMessage = Messages
        .get({ channelId: channel_id })
        .find(({ embeds }) => embeds?.[0]?.data.title === embedTitle);

      if (existingMessage) continue;

      console.log(plexRecentItem)

      plexServer ??= await fetchPlexServerInfo();

      if (!imdbGuid) {
        const guids = await fetchPlexGuids(plexRecentItem);
        imdbGuid = guids.find(id => id.startsWith("imdb://")).replace("imdb://", "");
        // tmdbGuid = guids.find(id => id.startsWith("tmdb://")).replace("tmdb://", "");
        // tvdbGuid = guids.find(id => id.startsWith("tvdb://")).replace("tvdb://", "");
      }

      if (!embedAuthor && isMovie) {
        embedAuthor = "New movie in Plex Media Server";
      }

      if (!embedAuthor && isShow) {
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
          value: `[Plex (${plexRecentItem.librarySectionTitle})](https://app.plex.tv/desktop#!/server/${plexServer.machineIdentifier}/details?key=/library/metadata/${plexRecentItem.ratingKey})`
        }
      ];

      embedImage ??= await new Downloader({
        directory: `${config.temp_directory_path}/${nanoid()}`,
        fileName: "embed_image.jpg",
        url: `${config.plex_server_url}${plexRecentItem.art}.jpg`
      }).download().then(({ filePath }) => filePath);

      embedThumbnail ??= await new Downloader({
        directory: `${config.temp_directory_path}/${nanoid()}`,
        fileName: "embed_thumbnail.jpg",
        url: `${config.plex_server_url}${plexRecentItem.parentThumb || plexRecentItem.thumb}.jpg`
      }).download().then(({ filePath }) => filePath);

      files ??= [new AttachmentBuilder(embedImage), new AttachmentBuilder(embedThumbnail)];

      shortDate ??= date.format(new Date(1000 * (plexRecentItem.updatedAt || plexRecentItem.addedAt)), "MMMM DDD");

      embedFooter ??= `${plexRecentItem.updatedAt ? "Updated" : "Added"} on ${shortDate} with version ${plexServer.version}.`

      embeds ??= [new EmbedBuilder()
        .setAuthor({ name: embedAuthor, iconURL: "https://images.icon-icons.com/413/PNG/256/Plex_41067.png" })
        .setColor(0xFF9E16)
        .setDescription(embedDescription)
        .setImage(`attachment://${path.basename(embedImage)}`)
        .addFields(...embedFields)
        .setFooter({ text: embedFooter })
        .setThumbnail(`attachment://${path.basename(embedThumbnail)}`)
        .setTitle(`${embedTitle} `)];

      channel ??= client.channels.cache.get(channel_id);
      const message = await channel.send({ embeds, files });
      Utilities.LogPresets.SentMessage(message, listener);

      const threadOptions = { name: `💬 Plex Media Server • ${plexRecentItem.parentTitle || plexRecentItem.title} (${plexRecentItem.parentYear || plexRecentItem.year})` };
      const threadChannel = await Utilities.getOrCreateThreadChannel({ message, threadOptions });
    }
  }
}

/**
 *
 */
export async function fetchPlexServerInfo() {
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

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN LOGIC                                                   //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
