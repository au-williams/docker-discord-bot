import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from "discord.js";
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
 * The authentication cookie for the qBittorrent WebAPI.
 * @type {string}
 */
let cookie;

/**
 * The selected speed limit duration list item.
 * @type {Map<string, string>} <messageId, selectedValue>
 */
const selectedSpeedLimitDurations = new Map();

/**
 * The starter message interaction (for editing).
 * @type {Map<string, ChatInputCommandInteraction>} <messageId, interaction>
 */
const starterMessageInteractions = new Map();

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region EMITTER.JS IMPORTS                                                //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

export const Interactions = Object.freeze({
  ButtonAddMagnet: "QB_BUTTON_ADD_MAGNET",
  ButtonSaveChanges: "QB_BUTTON_SAVE_CHANGES",
  ButtonManageSpeedLimit: "QB_BUTTON_MANAGE_SPEED_LIMIT",
  ButtonRemoveSpeedLimit: "QB_BUTTON_REMOVE_SPEED_LIMIT",
  ChatInputCommandQbittorrent: "qbittorrent",
  SelectMenuSpeedLimitDuration: "QB_SELECT_MENU_SPEED_LIMIT_DURATION"
});

export const Listeners = Object.freeze({
  [Events.ClientReady]:
    onClientReady,
  [Interactions.ButtonAddMagnet]: new Listener()
    .setDescription("Displays a popup to paste a new magnet link for the qBittorrent download queue.")
    .setFunction(() => { throw new Error("Not implemented") })
    .setRequiredRoles(config.discord_required_role_ids),
  [Interactions.ButtonManageSpeedLimit]: new Listener()
    .setDescription("Displays a select menu to create, update, or remove the qBittorrent speed limit.")
    .setFunction(onButtonSpeedLimit)
    .setRequiredRoles(config.discord_required_role_ids),
  [Interactions.ButtonSaveChanges]: new Listener()
    .setDescription("Saves the selected speed limit duration. This button is disabled when no menu item has been selected.")
    .setFunction(onButtonSaveChanges)
    .setRequiredRoles(config.discord_required_role_ids),
  [Interactions.ChatInputCommandQbittorrent]: new Listener()
    .setDeploymentType(DeploymentTypes.ChatInputCommand)
    .setDescription("Sends you a message to manage the qBittorrent WebUI. 🌐")
    .setFunction(onChatInputCommandQbittorrent)
    .setRequiredRoles(config.discord_required_role_ids),
  [Interactions.SelectMenuSpeedLimitDuration]: new Listener()
    .setDescription("Chooses a duration to use the qBittorrent speed limit for. The speed limit will be removed once the duration has been reached.")
    .setFunction(onSelectMenuSpeedLimitDuration),
});

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS IMPORTS                                             //
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
    const label = date.format(value, "M/D @ h:mm A").replace("@", "at");
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
    .setCustomId(Interactions.SelectMenuSpeedLimitDuration)
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
 * Build the message `embeds` and `files` properties. This will take more than
 * one second while the qBittorrent API is fetched multiple times to calculate
 * average download and upload speeds.
 * @async
 * @returns {object}
 */
export async function buildEmbeddedMessage() {
  const embeds = [new EmbedBuilder()];
  const files = [new AttachmentBuilder("assets/qbittorrent_logo.png")];

  let downloadLineItem = "";
  let uploadLineItem = "";
  let footer = "";

  const isSpeedLimitEnabled = await getQbittorrentSpeedLimitEnabled(cookie);

  let info = await getQbittorrentInfo(cookie);
  const version = await getQbittorrentVersion(cookie);
  const webApiVersion = await getQbittorrentWebApiVersion(cookie);

  const downloadSpeeds = [info.dl_info_speed];
  const uploadSpeeds = [info.up_info_speed];

  for(let i = 0; i < 5; i++) {
    await Utilities.delay(200);
    info = await getQbittorrentInfo(cookie);
    downloadSpeeds.push(info.dl_info_speed);
    uploadSpeeds.push(info.up_info_speed);
  }

  const averageDownloadSpeed = downloadSpeeds.reduce((a, b) => a + b) / downloadSpeeds.length;
  const averageUploadSpeed = uploadSpeeds.reduce((a, b) => a + b) / uploadSpeeds.length;

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

    downloadLineItem = `- Downloading at ${formatSpeed(averageDownloadSpeed)} \`[${formatSpeed(info.dl_rate_limit)}]\``;
    uploadLineItem = `- Uploading at ${formatSpeed(averageUploadSpeed)} \`[${formatSpeed(info.up_rate_limit)}]\``;
  }
  else {
    downloadLineItem = `- Downloading at ${formatSpeed(averageDownloadSpeed)}`;
    uploadLineItem = `- Uploading at ${formatSpeed(averageUploadSpeed)}`;
    footer = "🟢 No speed limit is set! This could slow down other services.";
  }

  if (averageDownloadSpeed > 4194304) downloadLineItem += " 🔥";
  if (averageUploadSpeed > 2097152) uploadLineItem += " 🔥";

  embeds[0].setAuthor({ iconURL: "attachment://qbittorrent_logo.png", name: `qBittorrent ${version} • API v${webApiVersion}` });
  embeds[0].setColor(0x5a82b0);
  embeds[0].setDescription([downloadLineItem, uploadLineItem].join("\n"));
  embeds[0].setFooter({ text: footer })
  embeds[0].setThumbnail("attachment://qbittorrent_logo.png");

  return { embeds, files };
}

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
 *
 */
export async function onButtonSaveChanges({ client, interaction, listener }) {
  await interaction.deferUpdate();
  Emitter.setBusy(interaction, true);

  const isSpeedLimitEnabled = await getQbittorrentSpeedLimitEnabled(cookie);
  const duration = selectedSpeedLimitDurations.get(interaction.message.id);

  switch(duration) {
    case "remove": {
      if (isSpeedLimitEnabled) await postQbittorrentToggleSpeedLimitsMode(cookie);
      config.cron_job_date = ""; // Speed limit is removed. Remove disable date.
      break;
    }
    case "indefinite": {
      if (!isSpeedLimitEnabled) await postQbittorrentToggleSpeedLimitsMode(cookie);
      config.cron_job_date = ""; // Speed limit is indefinite. Remove disable date.
      break;
    }
    default: {
      // Update the Qbittorrent speed limit mode.
      if (!isSpeedLimitEnabled) await postQbittorrentToggleSpeedLimitsMode(cookie);

      // Save date to config in case the client is restarted.
      const cronJobDate = date.addHours(new Date(), Number(duration));
      config.cron_job_date = cronJobDate.toString();

      // Create the Cron job to run on the date.
      Emitter.stopCronJobs(onQbittorrentCronJob);
      const cronJob = new CronJob().setExpression(cronJobDate).setFunction(onQbittorrentCronJob);
      Emitter.scheduleCronJob({ client, cronJob, interaction, listener });
      break;
    }
  }

  config.save();

  interaction
    .deleteReply()
    .then(() => Utilities.LogPresets.DeletedReply(interaction, listener))
    .catch(error => logger.error(error, listener));

  const { embeds } = await buildEmbeddedMessage();

  starterMessageInteractions
    .get(interaction.message.reference.messageId)
    .editReply({ embeds, fetchReply: true })
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));

  Emitter.setBusy(interaction, false);
}

/**
 *
 */
export async function onButtonSpeedLimit({ interaction, listener }) {
  await interaction.deferReply({ ephemeral: true });

  const isSpeedLimitEnabled = await getQbittorrentSpeedLimitEnabled(cookie);

  const components = [
    new ActionRowBuilder().addComponents(getSelectMenuSpeedLimitDuration(null, isSpeedLimitEnabled)),
    new ActionRowBuilder().addComponents(buttonSaveChanges.setDisabled(true), Emitter.moreInfoButton),
  ];

  interaction
    .editReply({ components, fetchReply: true })
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));
}

/**
 * @param {object} param
 * @param {CommandInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onChatInputCommandQbittorrent({ interaction, listener }) {
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
    Emitter.stopCronJobs(onQbittorrentCronJob); // Just in case of any jobs previously created.
    const cronJob = new CronJob().setExpression(cronJobDate).setFunction(onQbittorrentCronJob);
    Emitter.scheduleCronJob({ client, cronJob, interaction, listener });
  }
}

/**
 * When the Cron job is invoked, remove the config value and disable the speed
 * limit via post request to the qBittorrent API.
 * @async
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
export async function onSelectMenuSpeedLimitDuration({ listener, interaction }) {
  await interaction.deferUpdate();

  selectedSpeedLimitDurations.set(interaction.message.id, interaction.values[0]);

  // Get the speed limit enabled state from the message to skip an API call.
  const selectMenuOptions = interaction.message.components[0].components[0].data.options;
  const isSpeedLimitEnabled = selectMenuOptions.some(item => item.value === "remove");

  const menu = getSelectMenuSpeedLimitDuration(interaction.values[0], isSpeedLimitEnabled);
  const row1 = new ActionRowBuilder().addComponents(menu);
  const row2 = ActionRowBuilder.from(interaction.message.components[1]);
  row2.components[0] = buttonSaveChanges.setDisabled(false);

  interaction
    .editReply({ components: [row1, row2], fetchReply: true })
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));

  Utilities.LogPresets.DebugSetValue("selectedSpeedLimitDurations", interaction.values[0], listener);
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

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN LOGIC                                                   //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
