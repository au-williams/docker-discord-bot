import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { Cron } from "croner";
import { findChannelMessage } from "../index.js";
import { Logger } from "../logger.js";
import date from 'date-and-time';
import fs from "fs-extra";
import ordinal from 'date-and-time/plugin/ordinal';
import probe from "probe-image-size";
date.plugin(ordinal);

// todo: implement steam api retry policies!
// https://www.npmjs.com/package/fetch-retry

const {
  announcement_channel_id,
  announcement_steam_app_ids,
  create_announcement_thread
} = fs.readJsonSync("components/steam_community_watcher_config.json");

// ------------------------------------------------------------------------- //
// >> DISCORD EVENT HANDLERS                                              << //
// ------------------------------------------------------------------------- //

/**
 * Delete the associated thread when a message gets deleted
 * @param {{ client: Client }} client The Discord.js client
 * @param {{ message: Message }} message The deleted message
 */
export const onMessageDelete = async ({ client, message }) => {
  try {
    const isMessageChannelValid = message.channel.id === announcement_channel_id;
    if (!isMessageChannelValid) return;

    const channelMessage = await findChannelMessage(message.channel.id, ({ id }) => message.id === id);
    const isClientOwnedThread = message.hasThread && message.thread.ownerId === client.user.id;
    if (!isClientOwnedThread) return;

    await channelMessage.thread.delete();
    Logger.Info(`Deleted thread for deleted message ${message.id}`);
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
};

export const onClientReady = async ({ client }) => {
  const onError = ({ stack }) => Logger.Error(stack, "steam_community_watcher_script.js");
  Cron("0 * * * *", { catch: onError }, async job => {
    Logger.Info(`Triggered job pattern "${job.getPattern()}"`);
    const channel = await client.channels.fetch(announcement_channel_id);
    for (const steam_app of announcement_steam_app_ids) {
      // validate steam app id or skip code execution
      if (!steam_app.app_id) Logger.Error("Invalid app_id value in config file");
      if (!steam_app.app_id) continue;

      // get steam announcement or skip code execution
      const steamAnnouncement = await getNewSteamAnnouncement(steam_app);
      if (!steamAnnouncement) Logger.Warn(`Couldn't fetch announcement for app_id "${steam_app.app_id}"`);
      if (!steamAnnouncement) continue; // todo: implement api retry policy (steam api fails occasionally)

      // get steam app details or skip code execution
      const steamAppDetailsData = await getSteamAppDetailsData(steam_app);
      if (!steamAppDetailsData) Logger.Warn(`Couldn't fetch Steam details for app_id "${steam_app.app_id}"`);
      if (!steamAppDetailsData) continue; // todo: implement api retry policy (steam api fails occasionally)

      // if this message already exists skip code execution
      if (await findChannelMessage(announcement_channel_id, channelMessage =>
        channelMessage.embeds?.[0]?.data?.description?.includes(steamAnnouncement.url)
      )) continue;

      // format the steam announcement date into a user-readable string
      // (multiply by 1000 to convert Unix timestamps to milliseconds)
      const parsedDate = new Date(steamAnnouncement.date * 1000);
      const formattedDate = date.format(parsedDate, "MMMM DDD");

      // get the first image in the steam announcement and check if it's in landscape orientation
      // (portrait orientated images are historically unfitting and will be replaced by the game image)
      const steamAnnouncementImageUrl = steamAnnouncement.contents.match(/\[img\](.*?)\[\/img\]/)?.[1]?.replace("{STEAM_CLAN_IMAGE}", "https://clan.akamai.steamstatic.com/images/")
      const isLandscapeImage = steamAnnouncementImageUrl && await probe(steamAnnouncementImageUrl).then(({ height, width }) => width >= height * 1.25).catch(() => false);

      const embeds = [new EmbedBuilder()
        .setAuthor({ name: "New Steam Community announcement", iconURL: "attachment://steam_logo.png" })
        .setColor(0x1A9FFF)
        .setDescription(`- [**${steamAnnouncement.title}**](${steamAnnouncement.url})\n${formatAnnouncementDescription(steamAnnouncement)}`)
        .setFooter({ text: `Posted on ${formattedDate}. Click the link to read the full announcement.` })
        .setImage(( isLandscapeImage ? steamAnnouncementImageUrl : steamAppDetailsData.header_image))
        .setThumbnail(steamAppDetailsData.capsule_image)
        .setTitle(steamAppDetailsData.name)]

      const message = await channel.send({ embeds, files: [new AttachmentBuilder('assets\\steam_logo.png')] });
      if (!create_announcement_thread) continue;

      let name = `💬 ${steamAppDetailsData.name} - ${steamAnnouncement.title}`;
      if (name.length > 100) name = name.slice(0, 97) + "...";
      await message.startThread({ name });
    }
    Logger.Info(`Scheduled next job on "${date.format(job.nextRun(), "YYYY-MM-DDTHH:mm")}"`);
  }).trigger();
};

// ------------------------------------------------------------------------- //
// >> COMPONENT FUNCTIONS                                                 << //
// ------------------------------------------------------------------------- //

/**
 * Convert Steam announcement description BBCode to markdown for Discord formatting
 * @param {object} steamAnnouncement
 */
function formatAnnouncementDescription(steamAnnouncement) {
  const endsWithPunctuation = input => {
    const punctuations = [".", ".\"", ",", ";", ":", "!", "?", "-", "(", ")", "[", "]", "{", "}"];
    return punctuations.some(punctuation => input.endsWith(punctuation));
  }

  const formattedContents = steamAnnouncement.contents.split('\n').map((textLine, index) => {
    let result = textLine.trim();
    if (result === steamAnnouncement.title && index === 0) return "";
    if (result.startsWith("[*]") && !endsWithPunctuation(result)) result = `${result};`;
    if (result.startsWith("-")) result = `${result.replace("-", "").trim()};`;
    result = result.replaceAll('“', '"').replaceAll('”', '"'); // swap non-standard quote characters
    result = result.replace(/\[img\][^\[]+\[\/img\]/g, ''); // remove urls nested between [img] tags
    result = result.replace(/\[\/?[^\]]+\]/g, '') // remove any bracket tags - [b], [i], [list], etc
    if (result && !endsWithPunctuation(result)) result += ".";
    return result.trim();
  }).filter(x => x).join(" ");

  let formattedDescription = "";

  for(const formattedContent of formattedContents.split(" ")) {
    if ((`${formattedDescription} ${formattedContent}`).length > 133) break;
    else formattedDescription += ` ${formattedContent}`;
  }

  return `_${formattedDescription} [...]_`;
}

async function getNewSteamAnnouncement(steam_app) {
  return await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${steam_app.app_id}`)
    .then(response => response.json())
    .then(({ appnews }) =>
      appnews?.newsitems.find(({ feed_type: jsonFeedType, title: jsonTitle }) => {
        const { feed_type: configFeedType, title_keywords: configKeywords } = steam_app;
        // verify the values defined in the config are found in the result
        const isConfigFeedTypeExist = Number.isSafeInteger(configFeedType);
        const isConfigKeywordsExist = Array.isArray(configKeywords) && configKeywords.length > 0;
        const isConfigFeedTypeMatch = isConfigFeedTypeExist ? configFeedType === jsonFeedType : true;
        const isConfigKeywordsMatch = isConfigKeywordsExist ? configKeywords.some(x => jsonTitle.toLowerCase().includes(x)) : true;
        return isConfigFeedTypeMatch && isConfigKeywordsMatch;
      }));
}

async function getSteamAppDetailsData(steam_app) {
  return await fetch(`https://store.steampowered.com/api/appdetails?appids=${steam_app.app_id}&l=english`)
    .then(response => response.json())
    .then(json => json[steam_app.app_id].success && json[steam_app.app_id].data);
}
