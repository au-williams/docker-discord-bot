import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events } from "discord.js";
import { Config } from "../services/config.js";
import { DeploymentTypes } from "../entities/DeploymentTypes.js";
import { Emitter } from "../services/emitter.js";
import { Logger } from "../services/logger.js";
import { Messages } from "../services/messages.js";
import { Utilities } from "../services/utilities.js";
import CronJob from "../entities/CronJob.js";
import date from "date-and-time";
import fetchRetry from "fetch-retry";
import Listener from "../entities/Listener.js";
import ordinal from "date-and-time/plugin/ordinal";
import randomItem from "random-item";
date.plugin(ordinal);

const config = new Config(import.meta.filename);
const logger = new Logger(import.meta.filename);

const fetch = fetchRetry(global.fetch, Utilities.fetchRetryPolicy);

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region EMITTER.JS LISTENERS                                              //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * The Cron jobs created by this script. The Cron jobs defined here will be
 * automatically scheduled by the framework to run based on their patterns.
 */
export const CronJobs = new Set([
  new CronJob()
    .setEnabled(Messages.isInitialized)
    .setExpression(config.announcement_cron_job_expression)
    .setFunction(checkAndAnnounceAssignments)
    .setTriggered()
]);

/**
 * The interactions created by this script. We use these unique IDs to define
 * buttons, commands, and components and so Discord can emit the interactions
 * that we handle in the `Listeners<object>` variable.
 */
export const Interactions = Object.freeze({
  ButtonComponentDeepDive: "DRG_BUTTON_COMPONENT_DEEP_DIVE",
  ButtonComponentEliteDeepDive: "DRG_BUTTON_COMPONENT_ELITE_DEEP_DIVE",
  ChatInputCommandDrg: "drg"
});

/**
 * The event listeners handled by this script. The key is a Discord event or an
 * interaction property from the `Interactions<object>` variable. The value is
 * a `Listener` object and requires a function to be set. Listeners that only
 * set a function can use the function as the value and it will be wrapped in
 * a Listener by the framework for you automatically. When the key is emitted
 * by Discord then the value will be executed. You may use an array to define
 * multiple Listeners for a single key.
 */
export const Listeners = Object.freeze({
  [Events.MessageDelete]: new Listener()
    .setFunction(Utilities.deleteMessageThread)
    .setRequiredChannels(config.announcement_discord_channel_id),
  [Interactions.ButtonComponentDeepDive]: new Listener()
    .setDescription("Privately shows you this weeks Deep Dive assignment details.")
    .setFunction(replyDeepDiveAssignmentDetails),
  [Interactions.ButtonComponentEliteDeepDive]: new Listener()
    .setDescription("Privately shows you this weeks Elite Deep Dive assignment details.")
    .setFunction(replyEliteDeepDiveAssignmentDetails),
  [Interactions.ChatInputCommandDrg]: new Listener()
    .setDeploymentType(DeploymentTypes.ChatInputCommand)
    .setDescription("Privately shows you this weeks Deep Dive assignments in Deep Rock Galactic. 🎮")
    .setFunction(replyThisWeeksAssignments),
});

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS LISTENERS                                           //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region PLUGIN COMPONENTS                                                 //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

const deepDiveButton = new ButtonBuilder()
  .setCustomId(Interactions.ButtonComponentDeepDive)
  .setEmoji(config.discord_emoji_deep_rock_galactic)
  .setLabel("Deep Dive")
  .setStyle(ButtonStyle.Success);

const eliteDeepDiveButton = new ButtonBuilder()
  .setCustomId(Interactions.ButtonComponentEliteDeepDive)
  .setEmoji(config.discord_emoji_deep_rock_galactic)
  .setLabel("Elite Deep Dive")
  .setStyle(ButtonStyle.Danger);

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN COMPONENTS                                              //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region PLUGIN LOGIC                                                      //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * Cache the API response for a faster reply time.
 * @type {object}
 */
let cachedApiAssignments;

/**
 * Send any unsent API assignments to the Discord announcement channel.
 * @param {object} param
 * @param {Client} param.client
 * @param {Listener} param.listener
 */
export async function checkAndAnnounceAssignments({ client, listener }) {
  cachedApiAssignments = await fetchApiAssignments();

  // ------------------------------------------------------------------------- //
  // check if the most recent API assignments are new and need to be announced //
  // ------------------------------------------------------------------------- //

  const { dive, eliteDive, endTime, startTime } = cachedApiAssignments;
  const { dive: lastDive, eliteDive: lastEliteDive } = getLastSentAssignments();

  const isNewAssignments = lastDive.name + lastEliteDive.name !== dive.name + eliteDive.name;
  if (!isNewAssignments) return;

  // -------------------------------------------------------------------------- //
  // create the embedded announcement message then send it to the guild channel //
  // -------------------------------------------------------------------------- //

  const parsedEndTime = date.parse(endTime.split("T")[0], "YYYY-MM-DD");
  const parsedStartTime = date.parse(startTime.split("T")[0], "YYYY-MM-DD");
  const formattedEndTime = date.format(parsedEndTime, "MMMM DDD");

  const components = [new ActionRowBuilder().addComponents(deepDiveButton, eliteDeepDiveButton, Emitter.moreInfoButton)];
  const embeds = [await getAssignmentsMessageEmbed({ dive, eliteDive, embedName: "New weekly", formattedEndTime })];
  const files = [new AttachmentBuilder("assets/drg_deep_dive.png"), new AttachmentBuilder("assets/drg_supporter.png")]

  const channel = client.channels.cache.get(config.announcement_discord_channel_id);
  const message = await channel.send({ components, embeds, files });
  Utilities.LogPresets.SentMessage(message, listener);

  const name = `💬 Deep Rock Galactic - Deep Dives for ${date.format(parsedStartTime, "MMMM DDD YYYY")}`;
  const thread = await message.startThread({ name });
  Utilities.LogPresets.CreatedThread(thread, listener);

  // -------------------------------------------------------------------------- //
  // disable all enabled buttons so users can't interact with outdated messages //
  // -------------------------------------------------------------------------- //

  // TODO: Enable all buttons then remove!!!

  // const pluginMessages = Messages.get(config.announcement_discord_channel_id).filter(message =>
  //   message.author.id === config.discord_bot_client_user_id &&
  //   message.embeds?.[0]?.data?.author?.name.includes("Deep Rock Galactic")
  // );

  // for (const message of pluginMessages) {
  //   const row = ActionRowBuilder.from(message.components[0]);
  //   row.components[0].setDisabled(false);
  //   row.components[1].setDisabled(false);
  //   await message.edit({ components: [row] });
  // }
}

/**
 * Get an embed formatted with the current Deep Dive and Elite Deep Dive from the Deep Rock Galactic API.
 * @async
 * @param {object} param
 * @param {object} param.dive
 * @param {object} param.eliteDive
 * @param {string} param.embedName
 * @param {string} param.formattedEndTime
 * @returns {Promise<EmbedBuilder>}
 */
export async function getAssignmentsMessageEmbed({ dive, eliteDive, embedName, formattedEndTime }) {
  const authorIconUrl = "attachment://drg_supporter.png";
  const authorName = `${embedName} assignments in Deep Rock Galactic`; // "New weekly" / "This weeks" assignments in Deep Rock Galactic
  const fieldName = `🟩 \`${dive.type}\` "${dive.name}" in ${dive.biome}`;
  const fieldValue = `🟥 **\`${eliteDive.type}\` "${eliteDive.name}" in ${eliteDive.biome}**`;
  const footerText = `Heads up miners — these expire on ${formattedEndTime}. Press a button for assignment details.`;
  const thumbnail = "attachment://drg_deep_dive.png";

  const title = `_**"${await fetch("https://drgapi.com/v1/salutes")
    .then(response => response.json())
    .then(({ salutes }) => randomItem(salutes))}"**_`;

  return new EmbedBuilder()
    .setAuthor({ iconURL: authorIconUrl, name: authorName })
    .setColor(0xFF4400)
    .addFields({ name: fieldName, value: fieldValue })
    .setFooter({ text: footerText })
    .setThumbnail(thumbnail)
    .setTitle(title)
}

/**
 * Get the current assignments from the Deep Rock Galactic API.
 * @returns {object}
 */
async function fetchApiAssignments() {
  return await fetch("https://drgapi.com/v1/deepdives")
    .then(response => response.json())
    .then(({ endTime, startTime, variants }) => ({
      dive: variants.find(({ type }) => type.toLowerCase() === "deep dive"),
      eliteDive: variants.find(({ type }) => type.toLowerCase() === "elite deep dive"),
      endTime,
      startTime
    }));
}

/**
 * Format the time received from the Deep Rock Galactic API.
 * @param {string} time endTime | startTime
 * @returns {string}
 */
export function getFormattedTime(time) {
  const parsedTime = date.parse(time.split("T")[0], "YYYY-MM-DD");
  return date.format(parsedTime, "MMMM DDD");
}

/**
 * Get the assignments last sent to the Discord announcement channel.
 * @returns {object}
 */
export function getLastSentAssignments() {
  const message = Messages
    .get({
      channelId: config.announcement_discord_channel_id
    })
    .find(({ author, embeds }) =>
      author.id === config.discord_bot_client_user_id
      && embeds?.[0]?.data?.fields?.[0]?.name
      && embeds?.[0]?.data?.fields?.[0]?.value
      && embeds?.[0]?.data?.author?.name?.includes("Deep Rock Galactic")
    );

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

/**
 * Send an ephemeral message with the Deep Rock Galactic assignments.
 * @param {object} param
 * @param {ChatInputCommandInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function replyThisWeeksAssignments({ interaction, listener }) {
  await interaction.deferReply({ ephemeral: true });

  const { dive, eliteDive, endTime } = await fetchApiAssignments();
  const parsedEndTime = date.parse(endTime.split("T")[0], "YYYY-MM-DD");
  const formattedEndTime = date.format(parsedEndTime, "MMMM DDD");

  const components = [new ActionRowBuilder().addComponents(deepDiveButton, eliteDeepDiveButton, Emitter.moreInfoButton)];
  const embeds = [await getAssignmentsMessageEmbed({ dive, eliteDive, embedName: "This weeks", formattedEndTime })];
  const files = [new AttachmentBuilder("assets/drg_deep_dive.png"), new AttachmentBuilder("assets/drg_supporter.png")];

  interaction
    .editReply({ components, embeds, files })
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));
}

/**
 * Reply the assignment details for the provided assignment type.
 * @async
 * @param {object} param
 * @param {object} param.assignment
 * @param {number} param.color
 * @param {string} param.endTime
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 * @param {string} param.startTime
 */
export async function replyAssignmentDetails({ assignment, color, endTime, interaction, listener, startTime }) {
  await interaction.deferReply({ ephemeral: true });

  const fields = assignment.stages.map(({ anomaly, id, primary, secondary, warning }) => {
    const objectives = [primary, secondary].filter(item => item);
    const emoji = config.discord_emoji_deep_rock_galactic;
    const label = Utilities.getPluralizedString("Objective", objectives.length);
    const fieldName = `${emoji} STAGE ${id} ${emoji}`;
    let fieldValue = `• \`${label}\` ${objectives.join(", ")}`;
    if (anomaly) fieldValue += `\n• \`Anomaly\` _${anomaly}_`;
    if (warning) fieldValue += `\n• \`Warning\` _${warning}_`;
    return { name: fieldName, value: fieldValue }
  });

  const embed = new EmbedBuilder()
    .setAuthor({ iconURL: "attachment://drg_supporter.png", name: `${assignment.type} assignment details` })
    .setColor(color)
    .setDescription(`Available from **${getFormattedTime(startTime)}** to **${getFormattedTime(endTime)}**`)
    .addFields(fields)
    .setThumbnail("attachment://drg_deep_dive.png")
    .setTitle(`"${assignment.name}" in ${assignment.biome}`);

  const files = [
    new AttachmentBuilder("assets/drg_deep_dive.png"),
    new AttachmentBuilder("assets/drg_supporter.png")
  ];

  interaction
    .editReply({ embeds: [embed], files })
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));
}

/**
 * Show the deep dive information when the deep dive button is pressed.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function replyDeepDiveAssignmentDetails({ interaction, listener }) {
  const { dive: assignment, endTime, startTime } = cachedApiAssignments || await fetchApiAssignments();
  await replyAssignmentDetails({ assignment, color: 0x248046, endTime, interaction, listener, startTime });
}

/**
 * Show the elite deep dive information when the elite deep dive button is pressed.
 * @param {object} param
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function replyEliteDeepDiveAssignmentDetails({ interaction, listener }) {
  const { eliteDive: assignment, endTime, startTime } = cachedApiAssignments || await fetchApiAssignments();
  await replyAssignmentDetails({ assignment, color: 0xDA373C, endTime, interaction, listener, startTime });
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN LOGIC                                                   //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
