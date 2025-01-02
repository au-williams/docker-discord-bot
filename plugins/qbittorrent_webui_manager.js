import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, Events, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from "discord.js";
import { Config } from "../services/config.js";
import { DeploymentTypes } from "../entities/DeploymentTypes.js";
import { Emitter } from "../services/emitter.js";
import { Logger } from "../services/logger.js";
import { Utilities } from "../services/utilities.js";
import CronJob from "../entities/CronJob.js";
import date from "date-and-time";
import Listener from "../entities/Listener.js";

const config = new Config(import.meta.filename);
const logger = new Logger(import.meta.filename);

/**
 * The selected throttle duration list item.
 * @type {Map<string, string>} <messageId, selectedValue>
 */
const selectedThrottleDurations = new Map();

/**
 * The starter message interaction (for editing).
 * @type {Map<string, ChatInputCommandInteraction>} <messageId, interaction>
 */
const starterMessageInteractions = new Map();

/**
 * The authentication cookie for the qBittorrent WebAPI.
 * @type {string}
 */
let cookie;

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region EMITTER.JS LISTENERS                                              //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * The interactions created by this script. We use these unique IDs to define
 * buttons, commands, and components and so Discord can emit the interactions
 * that we handle in the `Listeners<object>` variable.
 */
export const Interactions = Object.freeze({
  ButtonAddMagnet: "QB_BUTTON_ADD_MAGNET",
  ButtonSaveChanges: "QB_BUTTON_SAVE_CHANGES",
  ButtonManageSpeedLimit: "QB_BUTTON_MANAGE_SPEED_LIMIT",
  ButtonRemoveSpeedLimit: "QB_BUTTON_REMOVE_SPEED_LIMIT",
  ChatInputCommandQbittorrent: "qbittorrent",
  SelectMenuThrottleDuration: "QB_SELECT_MENU_THROTTLE_DURATION"
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
  [Events.ClientReady]: new Listener()
    .setFunction(onClientReady),
  [Interactions.ButtonAddMagnet]: new Listener()
    .setDescription("Displays a popup to paste a new magnet link for the qBittorrent download queue.")
    .setFunction(() => { throw new Error("Not implemented") })
    .setRequiredRoles(config.discord_required_role_ids),
  [Interactions.ButtonManageSpeedLimit]: new Listener()
    .setDescription("Displays a select menu to create, update, or remove the qBittorrent speed limit.")
    .setFunction(onButtonSpeedLimit)
    .setRequiredRoles(config.discord_required_role_ids),
  [Interactions.ButtonSaveChanges]: new Listener()
    .setDescription("Save the select menu changes.")
    .setFunction(onButtonSaveChanges)
    .setRequiredRoles(config.discord_required_role_ids),
  [Interactions.ChatInputCommandQbittorrent]: new Listener()
    .setDeploymentType(DeploymentTypes.ChatInputCommand)
    .setDescription("Privately sends a message to the channel with the qBittorrent WebUI status. 🌐")
    .setFunction(sendSlashCommandReply)
    .setRequiredRoles(config.discord_required_role_ids),
  [Interactions.SelectMenuThrottleDuration]: new Listener()
    .setDescription("Chooses an action to perform to the qBittorrent speed limit.")
    .setFunction(onSelectMenuThrottleDuration),
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

const buttonAddMagnet = new ButtonBuilder()
  .setCustomId(Interactions.ButtonAddMagnet)
  .setEmoji("🧲")
  .setLabel("Add magnet")
  .setStyle(ButtonStyle.Secondary);

const buttonManageSpeedLimit = new ButtonBuilder()
  .setCustomId(Interactions.ButtonManageSpeedLimit)
  .setEmoji("⏱️")
  .setLabel("Speed limit")
  .setStyle(ButtonStyle.Secondary);

const buttonSaveChanges = new ButtonBuilder()
  .setCustomId(Interactions.ButtonSaveChanges)
  .setDisabled(true)
  .setEmoji("☑️")
  .setLabel("Save changes")
  .setStyle(ButtonStyle.Secondary);

/**
 * Get the speed limit duration select menu.
 * @param {string} selectedValue
 * @param {boolean} isSpeedLimitEnabled
 * @returns {StringSelectMenuBuilder}
 */
function getSelectMenuSpeedLimitDuration(selectedValue, isSpeedLimitEnabled) {
  const options = [];

  if (isSpeedLimitEnabled) {
    options.push(new StringSelectMenuOptionBuilder()
      .setDefault(selectedValue === "remove")
      .setLabel("🔥 Remove the speed limit")
      .setValue("remove"))
  }

  for (let i = 1; i < 7; i++) {
    const value = date.addHours(new Date(), i);
    const label = date.format(value, "M/DD @ h:mm A").replace("@", "at");
    options.push(new StringSelectMenuOptionBuilder()
      .setDefault(selectedValue === i.toString())
      .setLabel(`⏱️ Limit speed for ${i} ${Utilities.getPluralizedString("hour", i)} until ${label}`)
      .setValue(i.toString()));
  }

  options.push(new StringSelectMenuOptionBuilder()
    .setDefault(selectedValue === "indefinite")
    .setLabel("⚠️ Limit speed indefinitely")
    .setValue("indefinite")
  )

  return new StringSelectMenuBuilder()
    .setCustomId(Interactions.SelectMenuThrottleDuration)
    .addOptions(...options)
    .setPlaceholder("Select the speed limit duration");
}

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
 * Format the bytes per second as KiB/s or MiB/s.
 * @param {number} bytesPerSecond
 * @returns {string}
 */
export function formatSpeed(bytesPerSecond) {
  if (bytesPerSecond < 1048576) { // Below 1 MiB
    const kib = bytesPerSecond / 1024;
    return `${kib.toFixed(2)} KiB/s`;
  } else { // 1 MiB or more
    const mib = bytesPerSecond / 1048576;
    return `${mib.toFixed(2)} MiB/s`;
  }
}

/**
 * Get the Qbittorrent version from the API.
 * @async
 * @param {string} cookie
 * @returns {Promise<string>}
 */
export async function getQbittorrentVersion(cookie) {
  const url = `${config.qbittorrent_host}/api/v2/app/version`;
  const options = { method: "GET", headers: { "Cookie": cookie } }
  const response = await fetch(url, options);
  if (response.ok) return await response.text();
  throw new Error(await response.text());
}

/**
 * Get the Qbittorrent WebAPI version from the API.
 * @async
 * @param {string} cookie
 * @returns {Promise<string>}
 */
export async function getQbittorrentWebApiVersion(cookie) {
  const url = `${config.qbittorrent_host}/api/v2/app/webapiVersion`;
  const options = { method: "GET", headers: { "Cookie": cookie } }
  const response = await fetch(url, options);
  if (response.ok) return await response.text();
  throw new Error(await response.text());
}

/**
 * Get the Qbittorrent transfer info from the API.
 * @async
 * @param {string} cookie
 * @returns {Promise<string>}
 */
export async function getQbittorrentInfo(cookie) {
  const url = `${config.qbittorrent_host}/api/v2/transfer/info`;
  const options = { method: "GET", headers: { "Cookie": cookie } }
  const response = await fetch(url, options);
  if (response.ok) return await response.json();
  throw new Error(await response.text());
}

/**
 * Get the Qbittorrent speed limit enabled state from the API.
 * @async
 * @param {string} cookie
 * @returns {Promise<boolean>}
 */
export async function getQbittorrentSpeedLimitEnabled(cookie) {
  const url = `${config.qbittorrent_host}/api/v2/transfer/speedLimitsMode`;
  const options = { method: "GET", headers: { "Cookie": cookie } }
  const response = await fetch(url, options);
  if (response.ok) return await response.text() === "1";
  throw new Error(await response.text());
}

/**
 * Toggle the Qbittorrent speed limit mode with the API.
 * @async
 * @param {string} cookie
 * @returns {Promise<string>}
 */
export async function postQbittorrentToggleSpeedLimitsMode(cookie) {
  const url = `${config.qbittorrent_host}/api/v2/transfer/toggleSpeedLimitsMode`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": cookie
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

/**
 *
 */
export async function onButtonSpeedLimit({ client, interaction, listener }) {
  await interaction.deferReply({ ephemeral: true });

  const isSpeedLimitEnabled = await getQbittorrentSpeedLimitEnabled(cookie);

  const components = [
    new ActionRowBuilder().addComponents(getSelectMenuSpeedLimitDuration(null, isSpeedLimitEnabled)),
    new ActionRowBuilder().addComponents(buttonSaveChanges, Emitter.moreInfoButton),
  ];

  interaction.editReply({ components });
}

/**
 * Description placeholder
 * @export
 * @async
 * @param {{ client: any; interaction: any; listener: any; }} param0
 * @param {*} param0.client
 * @param {*} param0.interaction
 * @param {*} param0.listener
 * @returns {*}
 */
export async function onButtonSaveChanges({ client, interaction, listener }) {
  await interaction.deferUpdate();
  Emitter.setBusy(interaction, true);

  const isSpeedLimitEnabled = await getQbittorrentSpeedLimitEnabled(cookie);
  const duration = selectedThrottleDurations.get(interaction.message.id);
  let selectMenuThrottleDuration;

  switch(duration) {
    case "remove": {
      if (isSpeedLimitEnabled) await postQbittorrentToggleSpeedLimitsMode(cookie);
      config.cron_job_date = ""; // Speed limit is removed. Remove disable date.
      selectMenuThrottleDuration = getSelectMenuSpeedLimitDuration(null, false);
      break;
    }
    case "indefinite": {
      if (!isSpeedLimitEnabled) await postQbittorrentToggleSpeedLimitsMode(cookie);
      config.cron_job_date = ""; // Speed limit is indefinite. Remove disable date.
      selectMenuThrottleDuration = getSelectMenuSpeedLimitDuration(null, true);
      break;
    }
    default: {
      // Update the Qbittorrent speed limit mode.
      if (!isSpeedLimitEnabled) await postQbittorrentToggleSpeedLimitsMode(cookie);
      selectMenuThrottleDuration = getSelectMenuSpeedLimitDuration(null, true);

      // Save date to config in case the client is restarted.
      const cronJobDate = date.addHours(new Date(), duration);
      config.cron_job_date = cronJobDate.toString();

      // Create the Cron job to run on the date.
      Emitter.stopCronJobs(onQbittorrentCronJob);
      const cronJob = new CronJob().setExpression(cronJobDate).setFunction(onQbittorrentCronJob);
      Emitter.scheduleCronJob({ client, interaction, listener, cronJob });
      break;
    }
  }

  config.save();

  interaction
    .deleteReply()
    .then(result => Utilities.LogPresets.DeletedReply(result, listener))
    .catch(error => logger.error(error, listener));

  await Utilities.delay(250);

  const { embeds } = await buildEmbeddedMessage();

  starterMessageInteractions
    .get(interaction.message.reference.messageId)
    .editReply({ embeds, fetchReply: true })
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));

  Emitter.setBusy(interaction, false);
}

export async function buildEmbeddedMessage() {
  const embeds = [new EmbedBuilder()];
  const files = [new AttachmentBuilder("assets/qbittorrent_logo.png")];

  let downloadLineItem = "";
  let uploadLineItem = "";
  let footer = "";

  const isSpeedLimitEnabled = await getQbittorrentSpeedLimitEnabled(cookie);
  const info = await getQbittorrentInfo(cookie);
  const version = await getQbittorrentVersion(cookie);
  const webApiVersion = await getQbittorrentWebApiVersion(cookie);

  if (isSpeedLimitEnabled) {
    footer = "🔴 Speed limit is being enforced until ";

    if (config.cron_job_date) {
      const cronJobDate = new Date(config.cron_job_date);
      const datestamp = date.format(cronJobDate, "MMM DDD");
      const timestamp = date.format(cronJobDate, "h:mm")
      const meridiem = date.format(cronJobDate, "a").toUpperCase();
      footer += `${datestamp} at ${timestamp} ${meridiem}.`;
    }
    else {
      footer += "it's been removed."
    }

    downloadLineItem = `- Downloading at ${formatSpeed(info.dl_info_speed)} \`[${formatSpeed(info.dl_rate_limit)}]\``;
    uploadLineItem = `- Uploading at ${formatSpeed(info.up_info_speed)} \`[${formatSpeed(info.up_rate_limit)}]\``;
  }
  else {
    downloadLineItem = `- Downloading at ${formatSpeed(info.dl_info_speed)}`;
    uploadLineItem = `- Uploading at ${formatSpeed(info.up_info_speed)}`;
    footer = "🟢 No speed limit set! This may slow down other services.";
  }

  if (info.dl_info_speed > 4194304) downloadLineItem += " 🔥";
  if (info.up_info_speed > 2097152) uploadLineItem += " 🔥";

  embeds[0].setAuthor({ iconURL: "attachment://qbittorrent_logo.png", name: `qBittorrent ${version} • API v${webApiVersion}` });
  embeds[0].setColor(0x5a82b0);
  embeds[0].setDescription([downloadLineItem, uploadLineItem].join("\n"));
  embeds[0].setFooter({ text: footer })
  embeds[0].setThumbnail("attachment://qbittorrent_logo.png");

  return { embeds, files };
}

/**
 * @export
 * @async
 * @returns {*}
 */
export async function onQbittorrentCronJob() {
  const isSpeedLimitEnabled = await getQbittorrentSpeedLimitEnabled(cookie);
  if (isSpeedLimitEnabled) await postQbittorrentToggleSpeedLimitsMode(cookie);
  config.cron_job_date = "";
  config.save();
}

/**
 *
 */
export async function onClientReady({ client, interaction, listener }) {
  const qbittorrent_host = config.qbittorrent_host;
  const password = config.qbittorrent_password;
  const username = config.qbittorrent_username;

  const url = `${qbittorrent_host}/api/v2/auth/login`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  cookie = response.headers.get("set-cookie");
  logger.info("Qbittorrent WebUI login successful!");

  if (config.cron_job_date) {
    const cronJobDate = new Date(config.cron_job_date);
    const cronJob = new CronJob().setExpression(cronJobDate).setFunction(onQbittorrentCronJob);
    Emitter.scheduleCronJob({ client, cronJob, interaction, listener });
  }
}

/**
 *
 */
export async function onSelectMenuThrottleDuration({ listener, interaction }) {
  await interaction.deferUpdate();
  selectedThrottleDurations.set(interaction.message.id, interaction.values[0]);

  // Get the speed limit enabled state from the message to skip an API call.
  const selectMenuOptions = interaction.message.components[0].components[0].data.options;
  const isSpeedLimitEnabled = selectMenuOptions.some(item => item.value === "remove");

  const actionRow1 = new ActionRowBuilder().addComponents(getSelectMenuSpeedLimitDuration(interaction.values[0], isSpeedLimitEnabled));
  const actionRow2 = ActionRowBuilder.from(interaction.message.components[1]);
  actionRow2.components[0].setDisabled(false);

  interaction
    .editReply({ components: [actionRow1, actionRow2], fetchReply: true })
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));

  Utilities.LogPresets.DebugSetValue("selectedThrottleDurations", interaction.values[0], listener);
}

/**
 * @param {object} param
 * @param {CommandInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function sendSlashCommandReply({ interaction, listener }) {
  const reply = await interaction.deferReply({ ephemeral: true, fetchReply: true });

  starterMessageInteractions.set(reply.id, interaction);

  const buttons = [buttonAddMagnet, buttonManageSpeedLimit, Emitter.moreInfoButton];
  const components = [new ActionRowBuilder().addComponents(...buttons)];
  const { embeds, files } = await buildEmbeddedMessage();

  interaction
    .editReply({ components, embeds, files })
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));
}


///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN LOGIC                                                   //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
