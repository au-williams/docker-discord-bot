import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder } from "discord.js";
import { Logger } from "../logger.js";
import config from "./drg_api_watcher_config.json" assert { type: "json" };
import cron, { CronTime } from "cron";
import date from 'date-and-time';
import ordinal from 'date-and-time/plugin/ordinal';
import randomItem from 'random-item';
date.plugin(ordinal);

const INTERACTION_ACTIONS = Object.freeze({
  DEEP_DIVE_BUTTON: "drg_api_watcher_script_deep_dive_button",
  ELITE_DEEP_DIVE_BUTTON: "drg_api_watcher_script_elite_deep_dive_button",
  DEEP_ROCK_TRIVIA_BUTTON: "drg_api_watcher_script_deep_rock_trivia_button",
});

export const OnClientReady = async ({ client }) => {
  for(const channel_id of config.channel_ids) {
    // verify channel is valid (if we throw in cron index.js won't catch)
    const channel = channel_id && await client.channels.fetch(channel_id);
    if (!channel) throw new Error(`invalid "channel_id" value in configuration file`);
  }

  new cron.CronJob("0 9-22 * * *", async () => {
    for(const channel_id of config.channel_ids) {
      const channel = await client.channels.fetch(channel_id);

      // check if missions have been updated
      const { currentDeepDive, currentEliteDeepDive, currentEndTime } = await getCurrentDeepRockMissions();
      const { previousDeepDive, previousEliteDeepDive } = await getPreviousDeepRockMissions({ channel, client });
      const isSameDeepDive = currentDeepDive.name === previousDeepDive.name;
      const isSameEliteDeepDive = currentEliteDeepDive.name === previousEliteDeepDive.name;
      if (isSameDeepDive && isSameEliteDeepDive) continue;

      // build message embed and send to channel
      const randomSalute = await getRandomSalute();
      const parsedEndTime = date.parse(currentEndTime.split('T')[0], 'YYYY-MM-DD');
      const formattedEndTime = date.format(parsedEndTime, "MMMM DDD");

      const components = getDiscordComponents();
      const embeds = getDiscordMessageEmbeds({ currentDeepDive, currentEliteDeepDive, formattedEndTime, randomSalute });
      const files = [new AttachmentBuilder('assets\\drg_deep_dive.png'), new AttachmentBuilder('assets\\drg_supporter.png')];
      channel.send({ embeds, components, files });
    }
  }, null, true, "America/Los_Angeles", null, true);

  // Get the components that will be sent with the Discord message
  const getDiscordComponents = () => [
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
        .setCustomId(INTERACTION_ACTIONS.DEEP_ROCK_TRIVIA_BUTTON)
        .setEmoji("<:drg_beer:1129691577976098816>")
        .setLabel("Deep Rock Trivia")
        .setStyle(ButtonStyle.Secondary)
    )
  ]

  // Get the embeds that will be sent with the Discord message
  const getDiscordMessageEmbeds = ({ currentDeepDive, currentEliteDeepDive, formattedEndTime, randomSalute }) => [
    new EmbedBuilder()
      .setAuthor({
        iconURL: "attachment://drg_supporter.png",
        name: "New missions in Deep Rock Galactic"
      })
      .setColor(0xFF4400)
      .addFields({
        name: `🟩 \`${currentDeepDive.type}\` _"${currentDeepDive.name}"_ in ${currentDeepDive.biome}`,
        value: `🟥 **\`${currentEliteDeepDive.type}\` _"${currentEliteDeepDive.name}"_ in ${currentEliteDeepDive.biome}**`
      })
      .setFooter({
        text: `Heads up miners — these expire on ${formattedEndTime}. Press a button for mission details.`,
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
    case INTERACTION_ACTIONS.DEEP_ROCK_TRIVIA_BUTTON: {
      return ReplyDeepRockTrivia();
    }
    case INTERACTION_ACTIONS.DEEP_DIVE_BUTTON: {
      const { currentDeepDive, currentStartTime, currentEndTime } = await getCurrentDeepRockMissions();
      return ReplyDeepDiveDetails({ mission: currentDeepDive, currentStartTime, currentEndTime});
    }
    case INTERACTION_ACTIONS.ELITE_DEEP_DIVE_BUTTON: {
      const { currentEliteDeepDive, currentStartTime, currentEndTime } = await getCurrentDeepRockMissions();
      return ReplyDeepDiveDetails({ mission: currentEliteDeepDive, currentStartTime, currentEndTime});
    }
  }

  function GetDiscordReplyEmbeds({ mission, currentStartTime, currentEndTime }) {
    const { biome, name, seed, stages, type } = mission;

    const formattedStages = stages.map(stage => {
      const emoji = "<:drg_deep_dive:1129691555733717053>";
      const name = `${emoji} STAGE ${stage.id} ${emoji}`;
      const value = [
        stage.primary && `\`Primary Objective\` ${stage.primary}`,
        stage.secondary && `\`Secondary Objective\` ${stage.secondary}`,
        stage.anomaly && `\`Mission Anomaly\` ${stage.anomaly}`,
        stage.warning && `\`Mission Warning\` ${stage.warning}`
      ].filter(stage => stage).join("\n");
      return { name, value }
    });

    const parsedEndTime = date.parse(currentEndTime.split('T')[0], 'YYYY-MM-DD');
    const formattedEndTime = date.format(parsedEndTime, "MMMM DDD");

    const parsedStartTime = date.parse(currentStartTime.split('T')[0], 'YYYY-MM-DD');
    const formattedStartTime = date.format(parsedStartTime, "MMMM DDD");

    return [new EmbedBuilder()
      .setAuthor({ iconURL: "attachment://drg_supporter.png", name: `Weekly ${type} mission details` })
      .setColor(0xFF4400)
      .setDescription(`Available from ${formattedStartTime} to ${formattedEndTime}`)
      .addFields(formattedStages)
      .setFooter({ text: `This ${type} was generated with seed ${seed}` })
      .setThumbnail("attachment://drg_deep_dive.png")
      .setTitle(`_"${name}"_ in ${biome}`)
    ]
  }

  async function ReplyDeepDiveDetails({ mission, currentStartTime, currentEndTime }) {
    await interaction.deferReply({ ephemeral: true });
    const files = [new AttachmentBuilder('assets\\drg_deep_dive.png'), new AttachmentBuilder('assets\\drg_supporter.png')];
    const embeds = GetDiscordReplyEmbeds({ mission, currentStartTime, currentEndTime });
    interaction.editReply({ embeds, files })
  }

  async function ReplyDeepRockTrivia() {
    await interaction.deferReply({ ephemeral: true });
    fetch("https://drgapi.com/v1/trivia")
      .then(response => response.json())
      .then(async ({ trivia }) => {
        let item = randomItem(trivia);
        const index = trivia.indexOf(item);
        // perform string cleanup on the API response
        item = item.replaceAll("\"", "'").replaceAll("dont", "don't").replaceAll("you are", "you're");
        interaction.editReply(`Deep Rock Trivia #${index + 1}: _"${item}"_`);
      });
  }
}

// Get the current Deep Rock Galactic missions from the DRG API
const getCurrentDeepRockMissions = async () =>
  fetch("https://drgapi.com/v1/deepdives")
    .then(response => response.json())
    .then(json => ({
      currentDeepDive: json.variants.find(({ type }) => type === "Deep Dive"),
      currentEliteDeepDive: json.variants.find(({ type }) => type === "Elite Deep Dive"),
      currentEndTime: json.endTime,
      currentStartTime: json.startTime
    }));

// Get the previous Deep Rock Galactic missions from the Discord channel
const getPreviousDeepRockMissions = async ({ channel, client }) => {
  const checkMessage = ({ author, embeds }) =>
    author.id === client.user.id
    && embeds.length
    && embeds[0].data.author?.name.includes('Deep Rock Galactic');

  // search all channel messages for the previous mission message

  let fetchedMessages = await channel.messages.fetch({ limit: 100 });
  let previousMissionMessage = Array.from(fetchedMessages.values()).find(checkMessage);

  while (!previousMissionMessage && fetchedMessages) {
    fetchedMessages = await channel.messages.fetch({ limit: 100, before: fetchedMessages.last().id });
    previousMissionMessage = Array.from(fetchedMessages.values()).find(checkMessage);
    if (fetchedMessages.size < 100) fetchedMessages = null;
  }

  // parse resulting channel message to rebuild the mission data

  const previousDeepDive = {
    biome: previousMissionMessage?.embeds[0].data.fields[0]?.name.split(" in ").pop(),
    name: previousMissionMessage?.embeds[0].data.fields[0]?.name.match(/"(.*?)"/)[1],
  }

  const previousEliteDeepDive = {
    biome: previousMissionMessage?.embeds[0].data.fields[0]?.value.replaceAll("**", "").split(" in ").pop(),
    name: previousMissionMessage?.embeds[0].data.fields[0]?.value.replaceAll("**", "").match(/"(.*?)"/)[1],
  }

  return { previousDeepDive, previousEliteDeepDive };
}
