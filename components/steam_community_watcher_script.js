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
  announcement_channel_ids,
  announcement_steam_app_ids,
  create_announcement_thread
} = fs.readJsonSync("components/steam_community_watcher_config.json");

// ---------------------- //
// Discord event handlers //
// ---------------------- //

export const onClientReady = async ({ client }) => {
  const onError = ({ stack }) => Logger.Error(stack, "steam_community_watcher_script.js");
  Cron("0 * * * *", { catch: onError }, async job => {
    Logger.Info(`Triggered job pattern "${job.getPattern()}"`);
    for (const channel_id of announcement_channel_ids) {
      const channel = await client.channels.fetch(channel_id);
      for await (const steam_app of announcement_steam_app_ids) {
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

        // skip code execution if the last discord message for steam app includes the last announcement url from the steam api
        const includesUrl = ({ embeds }) => embeds[0].data.description?.includes(steamAnnouncement.url);
        const includesTitle = ({ embeds }) => embeds[0].data.description?.includes(`- [**${steamAnnouncement.title}**]`);
        const find = ({ author, embeds }) => author.id === client.user.id && embeds?.[0]?.data?.title === steamAppDetails.name;
        if (await findChannelMessage(channel.id, find).then(message => message && (includesUrl(message) || includesTitle(message)))) continue;

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
          .setDescription(`- [**${steamAnnouncement.title}**](${steamAnnouncement.url})\n${formatAnnouncementDescription({ steamAnnouncement })}`)
          .setFooter({ text: `Posted on ${formattedDate}. Click the link to read the full announcement.` })
          .setImage(( isLandscapeImage ? steamAnnouncementImageUrl : steamAppDetails.header_image))
          .setThumbnail(steamAppDetails.capsule_image)
          .setTitle(steamAppDetails.name)]

        const message = await channel.send({ embeds, files: [new AttachmentBuilder('assets\\steam_logo.png')] });
        if (!create_announcement_thread) continue;

        let name = `💬 ${steamAppDetails.name} - ${steamAnnouncement.title}`;
        if (name.length > 100) name = name.slice(0, 97) + "...";
        await message.startThread({ name });
      }
    }
    Logger.Info(`Scheduled next job on "${date.format(job.nextRun(), "YYYY-MM-DDTHH:mm")}"`);
  }).trigger();
};

// ------------------- //
// Component functions //
// ------------------- //

// convert incoming BBCode from Steam to markdown for Discord and reduce the number of result characters
function formatAnnouncementDescription({ steamAnnouncement }) {
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
  return await fetch(`https://store.steampowered.com/api/appdetails?appids=${steam_app.app_id}&l=english`)
    .then(response => response.json())
    .then(json => json[steam_app.app_id].success ? json[steam_app.app_id].data : null);
}
