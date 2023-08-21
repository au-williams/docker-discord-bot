import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { findChannelMessage } from "../index.js";
import { Logger } from "../logger.js";
import cron from "cron";
import date from 'date-and-time';
import fs from "fs-extra";
import ordinal from 'date-and-time/plugin/ordinal';
import probe from "probe-image-size";

date.plugin(ordinal);

const { announcement_channel_ids, announcement_steam_apps } = fs.readJsonSync("components/steam_community_watcher_config.json");

export const onClientReady = async ({ client }) => {
  new cron.CronJob("0 9-22 * * *", trySendAllAnnouncements({ client }), null, true, "America/Los_Angeles", null, true);
};

async function trySendAllAnnouncements({ client }) {
  try {
    for (const channel_id of announcement_channel_ids) {
      const channel = await client.channels.fetch(channel_id);
      for (const steam_app of announcement_steam_apps) {
        trySendAnnouncement({ channel, client, steam_app });
      }
    }
  } catch(error) {
    Logger.Error(error);
  }
}

async function trySendAnnouncement({ channel, client, steam_app }) {
  try {
    if (!steam_app.app_id) {
      Logger.Error("Invalid app_id value in config file");
      return;
    }

    const steamAnnouncement = await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${steam_app.app_id}`)
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

    if (!steamAnnouncement) {
      Logger.Warn(`Couldn't fetch announcement for app_id "${steam_app.app_id}"`);
      return;
    }

    const steamAppDetails =
      await fetch(`https://store.steampowered.com/api/appdetails?appids=${steam_app.app_id}`)
        .then(response => response.json())
        .then(json => json[steam_app.app_id].success ? json[steam_app.app_id].data : null);

    if (!steamAppDetails) {
      Logger.Warn(`Couldn't fetch Steam details for app_id "${steam_app.app_id}"`);
      return;
    }

    const previousMessage = await findChannelMessage(channel.id, ({ author, embeds }) =>
      author.id === client.user.id
      && embeds.length
      && embeds[0].data.title === steamAppDetails.name
    );

    const getPreviousTitle = ({ embeds }) => {
      const regex = /\*\*(.*?)\*\*/;
      const matches = embeds[0].data.description.match(regex);
      return matches && matches.length >= 2 && matches[1];
    }

    if (previousMessage && getPreviousTitle(previousMessage) === steamAnnouncement.title) return;

    // multiply by 1000 to convert Unix timestamps to milliseconds
    const parsedDate = new Date(steamAnnouncement.date * 1000);
    const formattedDate = date.format(parsedDate, "MMMM DDD");

    const embeds = [
      new EmbedBuilder()
      .setAuthor({ name: "New Steam Community announcement", iconURL: "attachment://steam_logo.png" })
      .setColor(0x1A9FFF)
      .setDescription(`- [**${steamAnnouncement.title}**](${steamAnnouncement.url})`)
      .setFooter({ text: `Posted on ${formattedDate}. Click the link to read the full announcement.` })
      .setThumbnail(steamAppDetails.capsule_image)
      .setTitle(steamAppDetails.name)
    ]

    const imageUrl = steamAnnouncement.contents.match(/\[img\](.*?)\[\/img\]/)?.[1]?.replace("{STEAM_CLAN_IMAGE}", "https://clan.akamai.steamstatic.com/images/")
    const isLandscapeImage = imageUrl && await probe(imageUrl).then(({ height, width }) => width >= height * 1.25).catch(() => null);
    embeds[0].setImage(( isLandscapeImage ? imageUrl : steamAppDetails.header_image));

    await channel.send({ embeds, files: [new AttachmentBuilder('assets\\steam_logo.png')] });
  } catch(error) {
    Logger.Error(error);
  }
}
