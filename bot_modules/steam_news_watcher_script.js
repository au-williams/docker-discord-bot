import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder } from "discord.js";
import { Logger } from "../logger.js";
import config from "./steam_news_watcher_config.json" assert { type: "json" };
import cron from "cron";
import date from 'date-and-time';
import ordinal from 'date-and-time/plugin/ordinal';
date.plugin(ordinal);

const DISCORD_CHANNELS = new Set();

const getPreviousDiscordMessage = async ({ channel, client, embedTitle }) => {
  const checkMessage = ({ author, embeds }) =>
    author.id === client.user.id
    && embeds.length > 0
    && embeds[0].data.title === embedTitle;

  // search all channel messages for the previous assignment message

  let fetchedMessages = await channel.messages.fetch({ limit: 100 });
  let resultMessage = Array.from(fetchedMessages.values()).find(checkMessage);

  while (!resultMessage && fetchedMessages) {
    fetchedMessages = await channel.messages.fetch({ limit: 100, before: fetchedMessages.last().id });
    resultMessage = Array.from(fetchedMessages.values()).find(checkMessage);
    if (fetchedMessages.size < 100) fetchedMessages = null;
  }

  return resultMessage;
}

export const OnClientReady = async ({ client }) => {
  for await (const channel_id of config.channel_ids) {
    const channel = channel_id && await client.channels.fetch(channel_id);
    if (!channel) Logger.Warn(`Invalid "channel_id" value in config file`);
    else DISCORD_CHANNELS.add(channel);
  }

  new cron.CronJob("0 9-22 * * *", async () => {
    try {
      for(const channel of DISCORD_CHANNELS) {
        for (const steam_app of config.steam_apps) {
          const steamAnnouncement =
            await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${steam_app.app_id}`)
              .then(response => response.json())
              .then(({ appnews }) =>
                appnews?.newsitems.find(({ feed_type: jsonFeedType, title: jsonTitle }) => {
                  const { title_keywords: configKeywords, feed_type: configFeedType } = steam_app;
                  // if config feed type was provided, verify the api response feed type matches
                  const isConfigFeedTypeExist = Number.isSafeInteger(configFeedType);
                  const isConfigFeedTypeMatch = isConfigFeedTypeExist ? configFeedType === jsonFeedType : true;
                  // if config keywords were provided, verify the api response title includes one
                  const isConfigKeywordsExist = Array.isArray(configKeywords) && configKeywords.length > 0;
                  const isConfigKeywordsMatch = isConfigKeywordsExist ? configKeywords.some(x => jsonTitle.toLowerCase().includes(x)) : true;
                  return isConfigFeedTypeMatch && isConfigKeywordsMatch;
                }))
              .then(result => result ? { date: result.date, title: result.title, url: result.url } : null);

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

          const previousDiscordMessage =
            await getPreviousDiscordMessage({ channel, client, embedTitle: steamAppDetails.data.name });

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
