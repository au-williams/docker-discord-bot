import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { findChannelMessage } from "../index.js";
import { Logger } from "../logger.js";
import config from "./steam_community_watcher_config.json" assert { type: "json" };
import cron from "cron";
import date from 'date-and-time';
import ordinal from 'date-and-time/plugin/ordinal';
date.plugin(ordinal);

export const OnClientReady = async ({ client }) => {
  new cron.CronJob("0 9-22 * * *", async () => {
    try {
      for await (const channel_id of config.channel_ids) {
        const channel = await client.channels.fetch(channel_id);
        for (const steam_app of config.steam_apps) {
          const steamAnnouncement =
            await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${steam_app.app_id}`)
              .then(response => response.json())
              .then(({ appnews }) =>
                appnews?.newsitems.find(({ feed_type: jsonFeedType, title: jsonTitle }) => {
                  const { title_keywords: configKeywords, feed_type: configFeedType } = steam_app;
                  const isConfigFeedTypeExist = Number.isSafeInteger(configFeedType);
                  const isConfigKeywordsExist = Array.isArray(configKeywords) && configKeywords.length > 0;
                  const isConfigFeedTypeMatch = isConfigFeedTypeExist ? configFeedType === jsonFeedType : true;
                  const isConfigKeywordsMatch = isConfigKeywordsExist ? configKeywords.some(x => jsonTitle.toLowerCase().includes(x)) : true;
                  return isConfigFeedTypeMatch && isConfigKeywordsMatch;
                }))
              .then(result => result ? { date: result.date, title: result.title, url: result.url } : null); // todo: simplify this

          if (!steamAnnouncement) {
            Logger.Warn(`Couldn't find announcement for app_id "${steam_app.app_id}"`);
            continue;
          }

          const steamAppDetails =
            await fetch(`https://store.steampowered.com/api/appdetails?appids=${steam_app.app_id}`)
              .then(response => response.json())
              .then(json => json[steam_app.app_id])

          if (!steamAppDetails.success) {
            Logger.Warn(`Couldn't successfully resolve the store.steampowered.com api`);
            continue;
          }

          const previousDiscordMessage = findChannelMessage(channel.id, ({ author, embeds }) =>
            author.id === client.user.id && embeds.length && embeds[0].data.title === steamAppDetails.data.name
          );

          const getPreviousTitle = ({ embeds }) => {
            const regex = /\*\*(.*?)\*\*/;
            const matches = embeds[0].data.description.match(regex);
            return matches && matches.length >= 2 && matches[1];
          }

          // extract the previous announcement title from the discord message
          const previousTitle = previousDiscordMessage && getPreviousTitle(previousDiscordMessage);
          if (previousTitle === steamAnnouncement.title) continue;

          // multiply by 1000 to convert Unix timestamps to milliseconds
          const parsedAnnouncementDate = new Date(steamAnnouncement.date * 1000);
          const formattedAnnouncementDate = date.format(parsedAnnouncementDate, "MMMM DDD");

          const embeds = [
            new EmbedBuilder()
              .setAuthor({ name: "New Steam Community announcement", iconURL: "attachment://steam_logo.png" })
              .setColor(0x1A9FFF)
              .setDescription(`- [**${steamAnnouncement.title}**](${steamAnnouncement.url})`)
              .setFooter({ text: `Posted on ${formattedAnnouncementDate}. Click the link to read the full announcement.` })
              .setThumbnail(steamAppDetails.data.capsule_image)
              .setTitle(steamAppDetails.data.name)
          ]

          const files = [new AttachmentBuilder('assets\\steam_logo.png')];

          channel.send({ embeds, files })
        }
      }
    }
    catch(error) {
      Logger.Error(error);
    }
  }, null, true, "America/Los_Angeles", null, true);
};
