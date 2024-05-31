import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { Cron } from "croner";
import { fetchRetryPolicy } from "../shared/helpers/constants.js"
import { getChannelMessages, findChannelMessage, filterChannelMessages } from "../index.js";
import { getCronOptions } from "../shared/helpers/utilities.js";
import { tryDeleteMessageThread } from "../shared/helpers/discord.js";
import { PluginSlashCommand } from "../shared/models/PluginHandler.js";
import { PluginInteraction } from "../shared/models/PluginHandler.js";
import Config from "../shared/config.js";
import date from "date-and-time";
import fetchRetry from 'fetch-retry';
import Logger from "../shared/logger.js";
import ordinal from "date-and-time/plugin/ordinal";
import randomItem from "random-item";
date.plugin(ordinal);

const config = new Config("deep_rock_galactic_watcher_config.json");
const logger = new Logger("deep_rock_galactic_watcher_script.js");

const fetch = fetchRetry(global.fetch, fetchRetryPolicy);

// ------------------------------------------------------------------------- //
// >> PLUGIN DEFINITIONS                                                  << //
// ------------------------------------------------------------------------- //

export const PLUGIN_CUSTOM_IDS = Object.freeze({
  DRG_BUTTON_COMPONENT_DEEP_DIVE: "DRG_BUTTON_COMPONENT_DEEP_DIVE",
  DRG_BUTTON_COMPONENT_ELITE_DEEP_DIVE: "DRG_BUTTON_COMPONENT_ELITE_DEEP_DIVE",
});

export const PLUGIN_HANDLERS = [
  new PluginInteraction({
    customId: PLUGIN_CUSTOM_IDS.DRG_BUTTON_COMPONENT_DEEP_DIVE,
    onInteractionCreate: ({ client, interaction }) => onDrgButtonComponentDeepDive({ client, interaction })
  }),
  new PluginInteraction({
    customId: PLUGIN_CUSTOM_IDS.DRG_BUTTON_COMPONENT_ELITE_DEEP_DIVE,
    onInteractionCreate: ({ client, interaction }) => onDrgButtonComponentEliteDeepDive({ client, interaction })
  }),
  new PluginSlashCommand({
    commandName: "drg",
    description: "Privately shows the weekly deep dive assignments in Deep Rock Galactic 🎮",
    onInteractionCreate: ({ client, interaction }) => onDrgSlashCommand({ client, interaction })
  })
]

// ------------------------------------------------------------------------- //
// >> DISCORD EVENT HANDLERS                                              << //
// ------------------------------------------------------------------------- //

/**
 * Check for pending announcements on startup and a regular time interval
 * @param {Object} param
 * @param {Client} param.client The Discord.js client
 */
export const onClientReady = async ({ client }) => {
  await config.initialize(client);
  await logger.initialize(client);

  const channel = await client.channels.fetch(config.discord_announcement_channel_id);

  const cronJob = async () => {
    const assignments = await getCurrentAndPreviousAssignments({ channel, client });
    const { currentDive, currentEliteDive, currentEndTime, currentStartTime, previousAssignmentsMessageUrl } = assignments;

    // ------------------------------------------------------------------------- //
    // check if the most recent API assignments are new and need to be announced //
    // ------------------------------------------------------------------------- //

    const isUnannouncedAssignments = await (async () => {
      const find = message => getIsPluginMessage(client, message);
      const lastChannelMessage = await findChannelMessage(channel.id, find);
      if (!lastChannelMessage) return true;
      const { dive, eliteDive } = getAssignmentValuesFromMessage(lastChannelMessage);
      return currentDive.name + currentEliteDive.name !== dive.name + eliteDive.name;
    })();

    if (!isUnannouncedAssignments) return;

    // -------------------------------------------------------------------------- //
    // disable all enabled buttons so users can't interact with outdated messages //
    // -------------------------------------------------------------------------- //

    const filter = message =>
      getIsPluginMessage(client, message)
      // don't use .some(({ disabled }) => !disabled) because a 3rd button exists that should be enabled!
      && (!message.components[0].components[0].disabled || !message.components[0].components[1].disabled)

    for (const message of await filterChannelMessages(channel.id, filter)) {
      const row = ActionRowBuilder.from(message.components[0]);
      row.components[0].setDisabled(true);
      row.components[1].setDisabled(true);
      await message.edit({ components: [row] });
    }

    // todo: if the 3rd button link doesn't reference the previous message, update it
    // (this happens when a message is deleted and then the button stops functioning)

    // -------------------------------------------------------------------------- //
    // create the embedded announcement message then send it to the guild channel //
    // -------------------------------------------------------------------------- //

    const parsedEndTime = date.parse(currentEndTime.split("T")[0], "YYYY-MM-DD");
    const parsedStartTime = date.parse(currentStartTime.split("T")[0], "YYYY-MM-DD");
    const formattedEndTime = date.format(parsedEndTime, "MMMM DDD");

    const message = await channel.send({
      components: [getAssignmentsMessageRow({ previousAssignmentsMessageUrl })],
      embeds: [await getAssignmentsMessageEmbed({ currentDive, currentEliteDive, embedName: "New weekly", formattedEndTime })],
      files: [new AttachmentBuilder("assets\\drg_deep_dive.png"), new AttachmentBuilder("assets\\drg_supporter.png")]
    });

    const name = `💬 Deep Rock Galactic - Deep Dives for ${date.format(parsedStartTime, "MMMM DDD YYYY")}`;
    await message.startThread({ name });

    logger.info(`Sent announcement to ${channel.guild.name} #${channel.name}`);
  };

  Cron(config.cron_job_announcement_pattern, getCronOptions(logger), cronJob).trigger();
  logger.info(`Queued Cron job with pattern "${config.cron_job_announcement_pattern}"`);
};

/**
 * Delete the child thread when its message parent is deleted
 * @param {Object} param
 * @param {Message} param.message The deleted message
 */
export const onMessageDelete = ({ message }) => tryDeleteMessageThread({
  allowedChannelIds: [config.discord_announcement_channel_id],
  logger, starterMessage: message
});

// ------------------------------------------------------------------------- //
// >> PLUGIN FUNCTIONS                                                    << //
// ------------------------------------------------------------------------- //

/**
 * Get whether a channel message was sent by this plugin
 * @param {Client} client
 * @param {Message} message
 * @returns {bool}
 */
function getIsPluginMessage(client, message) {
  return message.author.id === client.user.id
    && message.embeds?.[0]?.data?.author?.name.includes("Deep Rock Galactic");
}

async function onDrgButtonComponentDeepDive({ client, interaction }) {
  try {
    const { channel } = interaction;
    const { currentDive, currentEndTime, currentStartTime } = await getCurrentAndPreviousAssignments({ channel, client });
    sendAssignmentDetailsReply({ assignment: currentDive, currentEndTime, currentStartTime, interaction });
  }
  catch(e) {
    logger.error(e);
  }
}

async function onDrgButtonComponentEliteDeepDive({ client, interaction }) {
  try {
    const { channel } = interaction;
    const { currentEliteDive, currentEndTime, currentStartTime } = await getCurrentAndPreviousAssignments({ channel, client });
    sendAssignmentDetailsReply({ assignment: currentEliteDive, currentEndTime, currentStartTime, interaction });
  }
  catch(e) {
    logger.error(e);
  }
}

async function sendAssignmentDetailsReply({ assignment, currentEndTime, currentStartTime, interaction }) {
  try {
    await interaction.deferReply({ ephemeral: true });
    const color = assignment.type.toLowerCase() === "deep dive" ? 0x248046 : 0xDA373C;
    const embeds = [getAssignmentDetailsEmbed({ assignment, color, currentEndTime, currentStartTime })];
    const files = [new AttachmentBuilder("assets\\drg_deep_dive.png"), new AttachmentBuilder("assets\\drg_supporter.png")];
    await interaction.editReply({ embeds, files });
    logger.info(`Sent ${assignment.type.toLowerCase()} reply to ${interaction.channel.guild.name} #${interaction.channel.name}`);
  }
  catch(e) {
    logger.error(e);
  }
}

async function onDrgSlashCommand({ client, interaction }) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const { channel } = interaction;
    const { currentDive, currentEliteDive, currentEndTime, previousAssignmentsMessageUrl } = await getCurrentAndPreviousAssignments({ channel, client });
    const parsedEndTime = date.parse(currentEndTime.split("T")[0], "YYYY-MM-DD");
    const formattedEndTime = date.format(parsedEndTime, "MMMM DDD");

    const components = [getAssignmentsMessageRow({ previousAssignmentsMessageUrl })];
    const embeds = [await getAssignmentsMessageEmbed({ currentDive, currentEliteDive, embedName: "This weeks", formattedEndTime })];
    const files = [new AttachmentBuilder("assets\\drg_deep_dive.png"), new AttachmentBuilder("assets\\drg_supporter.png")];
    await interaction.editReply({ components, embeds, files });

    logger.info(`Sent embed reply to ${channel.guild.name} #${channel.name}`);
  }
  catch(e) {
    logger.error(e);
  }
}

async function getCurrentAndPreviousAssignments({ channel, client }) {
  const { currentDive, currentEliteDive, currentEndTime, currentStartTime } =
    await fetch("https://drgapi.com/v1/deepdives")
      .then(response => response.json())
      .then(({ endTime, startTime, variants }) => ({
        currentDive: variants.find(({ type }) => type.toLowerCase() === "deep dive"),
        currentEliteDive: variants.find(({ type }) => type.toLowerCase() === "elite deep dive"),
        currentEndTime: endTime,
        currentStartTime: startTime
      }));

  const previousAssignmentsMessage = (await getChannelMessages(channel.id))
    .filter(({ author, embeds }) =>
      author.id === client.user.id
      && embeds?.[0]?.data?.fields?.[0]?.name
      && embeds?.[0]?.data?.fields?.[0]?.value
      && embeds?.[0]?.data?.author?.name?.includes("Deep Rock Galactic")
    ).find(({ embeds }) =>
      !embeds[0].data.fields[0].name.includes(currentDive.name)
      && !embeds[0].data.fields[0].value.includes(currentEliteDive.name)
    );

  const previousAssignmentsMessageUrl = previousAssignmentsMessage?.url;
  const { dive: previousDive, eliteDive: previousEliteDive } = getAssignmentValuesFromMessage(previousAssignmentsMessage);
  return { currentDive, currentEliteDive, currentEndTime, currentStartTime, previousDive, previousEliteDive, previousAssignmentsMessageUrl }
}

function getAssignmentValuesFromMessage(message) {
  const dive = {
    biome: message?.embeds?.[0]?.data?.fields?.[0]?.name?.split(" in ").pop(),
    name: message?.embeds?.[0]?.data?.fields?.[0]?.name?.match(/"(.*?)"/)[1],
  }

  const eliteDive = {
    biome: message?.embeds?.[0]?.data?.fields?.[0]?.value?.replaceAll("**", "").split(" in ").pop(),
    name: message?.embeds?.[0]?.data?.fields?.[0]?.value?.replaceAll("**", "").match(/"(.*?)"/)[1],
  }

  return { dive, eliteDive }
}

async function getAssignmentsMessageEmbed({ currentDive, currentEliteDive, embedName, formattedEndTime }) {
  const name = `🟩 \`${currentDive.type}\` "${currentDive.name}" in ${currentDive.biome}`;
  const value = `🟥 **\`${currentEliteDive.type}\` "${currentEliteDive.name}" in ${currentEliteDive.biome}**`;

  const title = await fetch("https://drgapi.com/v1/salutes")
    .then(response => response.json())
    .then(({ salutes }) => randomItem(salutes))

  return new EmbedBuilder()
    .setAuthor({ iconURL: "attachment://drg_supporter.png", name: `${embedName} assignments in Deep Rock Galactic` }) // "New weekly / This weeks assignments in Deep Rock Galactic"
    .setColor(0xFF4400)
    .addFields({ name, value })
    .setFooter({ text: `Heads up miners — these expire on ${formattedEndTime}. Press a button for assignment details.` })
    .setThumbnail("attachment://drg_deep_dive.png")
    .setTitle(`_**"${title}"**_`)
}

function getAssignmentsMessageRow({ previousAssignmentsMessageUrl }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("DEEP_DIVE_BUTTON")
      .setEmoji("<:drg_deep_dive:1129691555733717053>")
      .setLabel("Deep Dive")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("ELITE_DEEP_DIVE_BUTTON")
      .setEmoji("<:drg_deep_dive:1129691555733717053>")
      .setLabel("Elite Deep Dive")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setDisabled(!previousAssignmentsMessageUrl)
      .setLabel("View Previous Week")
      .setURL(previousAssignmentsMessageUrl || "https://www.google.com") // use any URL for validation check
      .setStyle(ButtonStyle.Link)
  )
}

function getAssignmentDetailsEmbed({ assignment, color, currentEndTime, currentStartTime }) {
  const { biome, name, stages, type } = assignment;

  const formattedStages = stages.map(({ anomaly, id, primary, secondary, warning }) => {
    const objectiveLabel = `Objective${primary && secondary ? "s" : "" }`;
    const objectiveValue = [primary, secondary].filter(x => x).join(", ");
    const embedEmoji = "<:drg_deep_dive:1129691555733717053>";
    const embedName = `${embedEmoji} STAGE ${id} ${embedEmoji}`;
    const embedValue = [
      `• \`${objectiveLabel}\` ${objectiveValue}`,
      anomaly && `• \`Anomaly\` _${anomaly}_`,
      warning && `• \`Warning\` _${warning}_`
    ].filter(stage => stage).join("\n");
    return { name: embedName, value: embedValue }
  });

  const parsedEndTime = date.parse(currentEndTime.split("T")[0], "YYYY-MM-DD");
  const parsedStartTime = date.parse(currentStartTime.split("T")[0], "YYYY-MM-DD");
  const formattedEndTime = date.format(parsedEndTime, "MMMM DDD");
  const formattedStartTime = date.format(parsedStartTime, "MMMM DDD");

  return new EmbedBuilder()
    .setAuthor({ iconURL: "attachment://drg_supporter.png", name: `${type} assignment details` })
    .setColor(color)
    .setDescription(`Available from **${formattedStartTime}** to **${formattedEndTime}**`)
    .addFields(formattedStages)
    .setThumbnail("attachment://drg_deep_dive.png")
    .setTitle(`"${name}" in ${biome}`)
}
