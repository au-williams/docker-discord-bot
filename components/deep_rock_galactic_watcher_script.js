import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { getChannelMessages, findChannelMessage } from "../index.js";
import { Logger } from "../logger.js";
import cron from "cron";
import date from "date-and-time";
import fs from "fs-extra";
import ordinal from "date-and-time/plugin/ordinal";
import randomItem from "random-item";
date.plugin(ordinal);

const { announcement_channel_ids } = fs.readJsonSync("components/deep_rock_galactic_watcher_config.json");

// ----------------------- //
// Interaction definitions //
// ----------------------- //

export const COMMAND_INTERACTIONS = [{
  name: "drg",
  description: "Privately shows the weekly deep dive assignments in Deep Rock Galactic 🎮",
  onInteractionCreate: ({ client, interaction }) => sendCurrentAssignmentsReply({ client, interaction })
}];

export const COMPONENT_INTERACTIONS = [
  {
    customId: "DEEP_DIVE_DETAILS_BUTTON",
    onInteractionCreate: ({ client, interaction }) => sendDeepDiveDetailsReply({ client, interaction })
  },
  {
    customId: "ELITE_DEEP_DIVE_DETAILS_BUTTON",
    onInteractionCreate: ({ client, interaction }) => sendEliteDeepDiveDetailsReply({ client, interaction })
  }
]

// ---------------------- //
// Discord event handlers //
// ---------------------- //

export const onClientReady = ({ client }) => {
  new cron.CronJob("0 9-22 * * *", sendNewAssignmentsMessages({ client }), null, true, "America/Los_Angeles", null, true);
};

// ------------------- //
// Component functions //
// ------------------- //

/**
 * Loop through each configured channel and send an updated message if the last sent message is outdated.
 * (Outdated channel messages have their buttons disabled because the DRG API can't fetch their old data)
 */
async function sendNewAssignmentsMessages({ client }) {
  try {
    for(const channel_id of announcement_channel_ids) {
      const channel = await client.channels.fetch(channel_id);
      const assignmentValues = await getAssignmentValues({ channel, client });
      const lastChannelMessage = await findChannelMessage(channel.id, ({ author, embeds }) => author.id === client.user.id && embeds?.[0]?.data?.author?.name.includes("Deep Rock Galactic"))
      const { currentDive, currentEliteDive } = assignmentValues;
      const { dive: lastDive, eliteDive: lastEliteDive } = getAssignmentValuesFromMessage(lastChannelMessage);
      const isNewAssignment = lastChannelMessage ? currentDive.name !== lastDive.name || currentEliteDive.name !== lastEliteDive.name : true;
      if (isNewAssignment) {
        const { previousDive, previousEliteDive } = assignmentValues;
        sendNewAssignmentsMessage({ assignmentValues, channel, client });
        disableRowButtons({ channel, client, previousDive, previousEliteDive });
      }
    }
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function sendNewAssignmentsMessage({ assignmentValues, channel }) {
  try {
    const { currentDive, currentEliteDive, currentEndTime, previousAssignmentsMessageUrl } = assignmentValues;
    const parsedEndTime = date.parse(currentEndTime.split("T")[0], "YYYY-MM-DD");
    const formattedEndTime = date.format(parsedEndTime, "MMMM DDD");

    const components = [getAssignmentsMessageRow({ previousAssignmentsMessageUrl })];
    const embeds = [await getAssignmentsMessageEmbed({ currentDive, currentEliteDive, embedName: "New weekly", formattedEndTime })];
    const files = [new AttachmentBuilder("assets\\drg_deep_dive.png"), new AttachmentBuilder("assets\\drg_supporter.png")];
    await channel.send({ components, embeds, files });

    Logger.Info(`Sent new weekly assignments message to ${channel.guild.name} #${channel.name}`);
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function sendDeepDiveDetailsReply({ client, interaction }) {
  try {
    const { channel } = interaction;
    const { currentDive, currentEndTime, currentStartTime } = await getAssignmentValues({ channel, client });
    sendAssignmentDetailsReply({ assignment: currentDive, currentEndTime, currentStartTime, interaction });
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function sendEliteDeepDiveDetailsReply({ client, interaction }) {
  try {
    const { channel } = interaction;
    const { currentEliteDive, currentEndTime, currentStartTime } = await getAssignmentValues({ channel, client });
    sendAssignmentDetailsReply({ assignment: currentEliteDive, currentEndTime, currentStartTime, interaction });
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function sendAssignmentDetailsReply({ assignment, currentEndTime, currentStartTime, interaction }) {
  try {
    await interaction.deferReply({ ephemeral: true });
    const color = assignment.type.toLowerCase() === "deep dive" ? 0x248046 : 0xDA373C;
    const embeds = [getAssignmentDetailsEmbed({ assignment, color, currentEndTime, currentStartTime })];
    const files = [new AttachmentBuilder("assets\\drg_deep_dive.png"), new AttachmentBuilder("assets\\drg_supporter.png")];
    await interaction.editReply({ embeds, files });
    Logger.Info(`Sent ${assignment.type.toLowerCase()} reply to ${interaction.channel.guild.name} #${interaction.channel.name}`);
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function sendCurrentAssignmentsReply({ client, interaction }) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const { channel } = interaction;
    const { currentDive, currentEliteDive, currentEndTime, previousAssignmentsMessageUrl } = await getAssignmentValues({ channel, client });
    const parsedEndTime = date.parse(currentEndTime.split("T")[0], "YYYY-MM-DD");
    const formattedEndTime = date.format(parsedEndTime, "MMMM DDD");

    const components = [getAssignmentsMessageRow({ previousAssignmentsMessageUrl })];
    const embeds = [await getAssignmentsMessageEmbed({ currentDive, currentEliteDive, embedName: "This weeks", formattedEndTime })];
    const files = [new AttachmentBuilder("assets\\drg_deep_dive.png"), new AttachmentBuilder("assets\\drg_supporter.png")];
    await interaction.editReply({ components, embeds, files });

    Logger.Info(`Sent this weeks assignments reply to ${channel.guild.name} #${channel.name}`);
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function disableRowButtons({ channel, client, previousDive, previousEliteDive }) {
  try {
    const previousAssignmentsMessages = (await getChannelMessages(channel.id)).filter(channelMessage => {
      const { dive, eliteDive } = getAssignmentValuesFromMessage(channelMessage);
      const isAuthorName = channelMessage?.embeds?.[0]?.data?.author?.name.includes("Deep Rock Galactic");
      const isPreviousAssignments = dive.name === previousDive.name && eliteDive.name === previousEliteDive.name;
      return isAuthorName && isPreviousAssignments && channelMessage.author.id === client.user.id;
    });

    for await(const previousAssignmentsMessage of previousAssignmentsMessages) {
      const row = ActionRowBuilder.from(previousAssignmentsMessage.components[0]);
      row.components[0].setDisabled(true) && row.components[1].setDisabled(true);
      await previousAssignmentsMessage.edit({ components: [row] });
    }

    Logger.Info(`Disabled buttons for ${previousAssignmentsMessages.length} outdated message${previousAssignmentsMessages.length === 1 ? "" : "s"} in ${channel.guild.name} #${channel.name}`)
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function getAssignmentValues({ channel, client }) {
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
      .setCustomId("DEEP_DIVE_DETAILS_BUTTON")
      .setEmoji("<:drg_deep_dive:1129691555733717053>")
      .setLabel("Deep Dive")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("ELITE_DEEP_DIVE_DETAILS_BUTTON")
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
