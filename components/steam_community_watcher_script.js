import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { findChannelMessage } from "../index.js";
import { Logger } from "../logger.js";
import { Cron } from "croner";
import date from 'date-and-time';
import fs from "fs-extra";
import ordinal from 'date-and-time/plugin/ordinal';
import probe from "probe-image-size";

const {
  announcement_channel_ids,
  announcement_steam_apps
} = fs.readJsonSync("components/steam_community_watcher_config.json");

date.plugin(ordinal);

// ---------------------- //
// Discord event handlers //
// ---------------------- //

export const onClientReady = async ({ client }) => {
  Cron("1 0 9-22 * * *", { timezone: "America/Los_Angeles" }, () => onCronJob({ client }));
  onCronJob({ client });
};

// ------------------- //
// Component functions //
// ------------------- //

function getPreviousEmbedTitle({ embeds }) {
  const regex = /\*\*(.*?)\*\*/;
  const matches = embeds[0].data.description.match(regex);
  return matches && matches.length >= 2 && matches[1];
}

async function getSteamAnnouncement({ steam_app }) {
  return await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${steam_app.app_id}`)
    .then(response => response.json())
    .then(({ appnews }) =>
      appnews?.newsitems.find(({ feed_type: jsonFeedType, title: jsonTitle }) => {
        const { feed_type: configFeedType, title_keywords: configKeywords } = steam_app;
        const isConfigFeedTypeExist = Number.isSafeInteger(configFeedType);
        const isConfigKeywordsExist = Array.isArray(configKeywords) && configKeywords.length > 0;
        const isConfigFeedTypeMatch = isConfigFeedTypeExist ? configFeedType === jsonFeedType : true;
        const isConfigKeywordsMatch = isConfigKeywordsExist ? configKeywords.some(x => jsonTitle.toLowerCase().includes(x)) : true;
        return isConfigFeedTypeMatch && isConfigKeywordsMatch;
      }));
}

async function getSteamAppDetails({ steam_app }) {
  return await fetch(`https://store.steampowered.com/api/appdetails?appids=${steam_app.app_id}`)
    .then(response => response.json())
    .then(json => json[steam_app.app_id].success ? json[steam_app.app_id].data : null);
}

async function onCronJob({ client }) {
  try {
    for (const channel_id of announcement_channel_ids) {
      const channel = await client.channels.fetch(channel_id);
      for await (const steam_app of announcement_steam_apps) {
        // validate steam app id or skip code execution
        if (!steam_app.app_id) Logger.Error("Invalid app_id value in config file");
        if (!steam_app.app_id) continue;

        // get steam announcement or skip code execution
        const steamAnnouncement = await getSteamAnnouncement({ steam_app });
        if (!steamAnnouncement) Logger.Warn(`Couldn't fetch announcement for app_id "${steam_app.app_id}"`);
        if (!steamAnnouncement) continue;

        // get steam app details or skip code execution
        const steamAppDetails = await getSteamAppDetails({ steam_app });
        if (!steamAppDetails) Logger.Warn(`Couldn't fetch Steam details for app_id "${steam_app.app_id}"`);
        if (!steamAppDetails) continue;

        // find previous message for steam app id and skip if it matches the latest announcement
        const find = ({ author, embeds }) => author.id === client.user.id && embeds?.[0]?.data?.title === steamAppDetails.name;
        const previousEmbedTitle = await findChannelMessage(channel.id, find).then(message => message && getPreviousEmbedTitle(message));
        if (previousEmbedTitle === steamAnnouncement.title) continue;

        // format the steam announcement date into a user-readable string
        // (multiply by 1000 to convert Unix timestamps to milliseconds)
        const parsedDate = new Date(steamAnnouncement.date * 1000);
        const formattedDate = date.format(parsedDate, "MMMM DDD");

        // get the first image in the steam announcement and check if it's in landscape orientation
        // (portrait orientated images are historically unfitting and will be replaced by the game image)
        const steamAnnouncementImageUrl = steamAnnouncement.contents.match(/\[img\](.*?)\[\/img\]/)?.[1]?.replace("{STEAM_CLAN_IMAGE}", "https://clan.akamai.steamstatic.com/images/")
        const isLandscapeImage = steamAnnouncementImageUrl && await probe(steamAnnouncementImageUrl).then(({ height, width }) => width >= height * 1.25).catch(() => null);

        const embeds = [new EmbedBuilder()
          .setAuthor({ name: "New Steam Community announcement", iconURL: "attachment://steam_logo.png" })
          .setColor(0x1A9FFF)
          .setDescription(`- [**${steamAnnouncement.title}**](${steamAnnouncement.url})`)
          .setFooter({ text: `Posted on ${formattedDate}. Click the link to read the full announcement.` })
          .setImage(( isLandscapeImage ? steamAnnouncementImageUrl : steamAppDetails.header_image))
          .setThumbnail(steamAppDetails.capsule_image)
          .setTitle(steamAppDetails.name)]

        await channel.send({ embeds, files: [new AttachmentBuilder('assets\\steam_logo.png')] });
      }
    }
  } catch({ stack }) {
    Logger.Error(stack);
  }
}
