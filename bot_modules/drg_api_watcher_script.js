import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder } from "discord.js";
import { Logger } from "../logger.js";
import config from "./drg_api_watcher_config.json" assert { type: "json" };
import cron from "cron";
import date from 'date-and-time';
import ordinal from 'date-and-time/plugin/ordinal';
import randomItem from 'random-item';
date.plugin(ordinal);

const INTERACTION_ACTIONS = Object.freeze({
  DEEP_DIVE_BUTTON: "drg_api_watcher_script_deep_dive_button",
  ELITE_DEEP_DIVE_BUTTON: "drg_api_watcher_script_elite_deep_dive_button"
});

const DISCORD_CHANNELS = new Set();

export const OnClientReady = async ({ client }) => {
  for await (const channel_id of config.channel_ids) {
    const channel = channel_id && await client.channels.fetch(channel_id);
    if (!channel) Logger.Warn(`Invalid "channel_id" value in config file`);
    else DISCORD_CHANNELS.add(channel);
  }

  new cron.CronJob("0 9-22 * * *", async () => {
    for(const channel of DISCORD_CHANNELS) {
      // check if assignments have been updated
      const { currentDive, currentEliteDive, currentEndTime } = await getCurrentAssignments();
      const { previousDive, previousEliteDive, previousAssignmentMessage } = await getPreviousAssignments({ channel, client });
      if (currentDive.name === previousDive.name && currentEliteDive.name === previousEliteDive.name) continue;

      // build message embed and send to channel
      const parsedEndTime = date.parse(currentEndTime.split('T')[0], 'YYYY-MM-DD');
      const formattedEndTime = date.format(parsedEndTime, "MMMM DDD");
      const randomSalute = await getRandomSalute();

      const components = getDiscordComponents({ previousAssignmentMessage });
      const embeds = getDiscordMessageEmbeds({ currentDive, currentEliteDive, formattedEndTime, randomSalute });
      const files = [new AttachmentBuilder('assets\\drg_deep_dive.png'), new AttachmentBuilder('assets\\drg_supporter.png')];
      channel.send({ components, embeds, files }).then(() => {
        if (previousAssignmentMessage) {
          const row = ActionRowBuilder.from(previousAssignmentMessage.components[0]);
          row.components[0].setDisabled(true) && row.components[1].setDisabled(true);
          previousAssignmentMessage.edit({ components: [row] });
        }
      });
    }
  }, null, true, "America/Los_Angeles", null, true);

  // Get the components that will be sent with the Discord message
  const getDiscordComponents = ({ previousAssignmentMessage }) => [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(INTERACTION_ACTIONS.DEEP_DIVE_BUTTON)
        .setEmoji("<:drg_deep_dive:1129691555733717053>")
        .setLabel("Deep Dive")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(INTERACTION_ACTIONS.ELITE_DEEP_DIVE_BUTTON)
        .setEmoji("<:drg_deep_dive:1129691555733717053>")
        .setLabel("Elite Deep Dive")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setDisabled(!previousAssignmentMessage)
        .setLabel("View Previous Week")
        .setURL(previousAssignmentMessage?.url || "https://www.google.com") // use any URL for validation check
        .setStyle(ButtonStyle.Link)
    )
  ]

  // Get the embeds that will be sent with the Discord message
  const getDiscordMessageEmbeds = ({ currentDive, currentEliteDive, formattedEndTime, randomSalute }) => [
    new EmbedBuilder()
      .setAuthor({
        iconURL: "attachment://drg_supporter.png",
        name: "New weekly assignments in Deep Rock Galactic"
      })
      .setColor(0xFF4400)
      .addFields({
        name: `🟩 \`${currentDive.type}\` "${currentDive.name}" in ${currentDive.biome}`,
        value: `🟥 **\`${currentEliteDive.type}\` "${currentEliteDive.name}" in ${currentEliteDive.biome}**`
      })
      .setFooter({
        text: `Heads up miners — these expire on ${formattedEndTime}. Press a button for assignment details.`,
      })
      .setThumbnail("attachment://drg_deep_dive.png")
      .setTitle(`_**"${randomSalute}"**_`)
    ]

  // Get a random salute from the DRG API -> "Rock and stone!"
  const getRandomSalute = async () =>
    await fetch("https://drgapi.com/v1/salutes")
      .then(response => response.json())
      .then(({ salutes }) => randomItem(salutes))
};

export const OnInteractionCreate = async ({ interaction }) => {
  const { customId, message: { channel }, user: { username } } = interaction;

  const isAction = Object.values(INTERACTION_ACTIONS).includes(customId);
  if (!isAction) return;

  const isChannel = config.channel_ids.includes(channel.id);
  if (!isChannel) return;

  Logger.Info(`${username} interacted with "${customId}"`);

  switch (customId) {
    case INTERACTION_ACTIONS.DEEP_DIVE_BUTTON: {
      const { currentDive, currentStartTime, currentEndTime } = await getCurrentAssignments();
      return ReplyDeepDiveDetails({ assignment: currentDive, currentStartTime, currentEndTime});
    }
    case INTERACTION_ACTIONS.ELITE_DEEP_DIVE_BUTTON: {
      const { currentEliteDive, currentStartTime, currentEndTime } = await getCurrentAssignments();
      return ReplyDeepDiveDetails({ assignment: currentEliteDive, currentStartTime, currentEndTime});
    }
  }

  function getDiscordReplyEmbeds({ assignment, color, currentStartTime, currentEndTime }) {
    const { biome, name, stages, type } = assignment;

    const formattedStages = stages.map(stage => {
      const objectiveLabel = `Objective${stage.primary && stage.secondary ? "s" : "" }`;
      const objectiveValue = [stage.primary, stage.secondary].filter(x => x).join(", ");
      const embedEmoji = "<:drg_deep_dive:1129691555733717053>";
      const embedName = `${embedEmoji} STAGE ${stage.id} ${embedEmoji}`;
      const embedValue = [
        `• \`${objectiveLabel}\` ${objectiveValue}`,
        stage.anomaly && `• \`Anomaly\` _${stage.anomaly}_`,
        stage.warning && `• \`Warning\` _${stage.warning}_`
      ].filter(stage => stage).join("\n");
      return { name: embedName, value: embedValue }
    });

    const parsedEndTime = date.parse(currentEndTime.split('T')[0], 'YYYY-MM-DD');
    const formattedEndTime = date.format(parsedEndTime, "MMMM DDD");

    const parsedStartTime = date.parse(currentStartTime.split('T')[0], 'YYYY-MM-DD');
    const formattedStartTime = date.format(parsedStartTime, "MMMM DDD");

    return [new EmbedBuilder()
      .setAuthor({ iconURL: "attachment://drg_supporter.png", name: `${type} assignment details` })
      .setColor(color)
      .setDescription(`Available from **${formattedStartTime}** to **${formattedEndTime}**`)
      .addFields(formattedStages)
      .setThumbnail("attachment://drg_deep_dive.png")
      .setTitle(`"${name}" in ${biome}`)
    ]
  }

  async function ReplyDeepDiveDetails({ assignment, currentStartTime, currentEndTime }) {
    await interaction.deferReply({ ephemeral: true });
    const color = assignment.type.toLowerCase() === "deep dive" ? 0x248046 : 0xDA373C;
    const files = [new AttachmentBuilder('assets\\drg_deep_dive.png'), new AttachmentBuilder('assets\\drg_supporter.png')];
    const embeds = getDiscordReplyEmbeds({ assignment, color, currentStartTime, currentEndTime });
    interaction.editReply({ embeds, files })
  }
}

// Get the current Deep Rock Galactic assignments from the DRG API
const getCurrentAssignments = async () =>
  fetch("https://drgapi.com/v1/deepdives")
    .then(response => response.json())
    .then(json => ({
      currentDive: json.variants.find(({ type }) => type === "Deep Dive"),
      currentEliteDive: json.variants.find(({ type }) => type === "Elite Deep Dive"),
      currentEndTime: json.endTime,
      currentStartTime: json.startTime
    }));

// Get the previous Deep Rock Galactic assignments from the Discord channel
const getPreviousAssignments = async ({ channel, client }) => {
  const checkMessage = ({ author, embeds }) =>
    author.id === client.user.id
    && embeds.length
    && embeds[0].data.author?.name.includes('Deep Rock Galactic');

  // search all channel messages for the previous assignment message

  let fetchedMessages = await channel.messages.fetch({ limit: 100 });
  let previousAssignmentMessage = Array.from(fetchedMessages.values()).find(checkMessage);

  while (!previousAssignmentMessage && fetchedMessages) {
    fetchedMessages = await channel.messages.fetch({ limit: 100, before: fetchedMessages.last().id });
    previousAssignmentMessage = Array.from(fetchedMessages.values()).find(checkMessage);
    if (fetchedMessages.size < 100) fetchedMessages = null;
  }

  // parse resulting channel message to rebuild the assignment data

  const previousDive = {
    biome: previousAssignmentMessage?.embeds[0].data.fields[0]?.name.split(" in ").pop(),
    name: previousAssignmentMessage?.embeds[0].data.fields[0]?.name.match(/"(.*?)"/)[1],
  }

  const previousEliteDive = {
    biome: previousAssignmentMessage?.embeds[0].data.fields[0]?.value.replaceAll("**", "").split(" in ").pop(),
    name: previousAssignmentMessage?.embeds[0].data.fields[0]?.value.replaceAll("**", "").match(/"(.*?)"/)[1],
  }

  return { previousDive, previousEliteDive, previousAssignmentMessage };
}
