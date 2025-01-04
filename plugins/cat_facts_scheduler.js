import { Config } from "../services/config.js";
import { DeploymentTypes } from "../entities/DeploymentTypes.js";
import { Logger } from "../services/logger.js";
import { Messages } from "../services/messages.js";
import { MessageType } from "discord.js";
import { Utilities } from "../services/utilities.js";
import CronJob from "../entities/CronJob.js";
import Listener from "../entities/Listener.js";
import randomItem from "random-item";

const config = new Config(import.meta.filename);
const logger = new Logger(import.meta.filename);

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region EMITTER.JS IMPORTS                                                //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

export const CronJobs = new Set([
  new CronJob()
    .setEnabled(Messages.isServiceEnabled)
    .setExpression(config.announcement_cron_job_expression)
    .setFunction(sendAnnouncementMessage)
    .setTriggered(checkTodayMissingAnnouncement)
]);

export const Interactions = Object.freeze({
  ChatInputCommandCatfact: "catfact"
});

export const Listeners = Object.freeze({
  [Interactions.ChatInputCommandCatfact]: new Listener()
    .setDeploymentType(DeploymentTypes.ChatInputCommand)
    .setDescription("Sends a message with a random cat fact to the channel. 🐱")
    .setFunction(sendSlashCommandReply)
});

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS IMPORTS                                             //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region PLUGIN LOGIC                                                      //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * Checks if the announcement message for today is missing.
 * @async
 * @returns {boolean}
 */
export function checkTodayMissingAnnouncement() {
  const now = new Date();
  const today9am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
  if (now < today9am) return false;

  const lastAnnouncementCreatedAt = Messages
    .get({ channelId: config.announcement_discord_channel_id })
    .find(({ content, type }) => type === MessageType.Default && config.catfact_responses.includes(content))
    ?.createdAt;

  if (!lastAnnouncementCreatedAt) return true;
  return lastAnnouncementCreatedAt < today9am;
}

/**
 * Send a new cat fact message to the announcement channel.
 * @param {object} param
 * @param {Client} param.client
 * @param {Listener} param.listener
 */
export function sendAnnouncementMessage({ client, listener }) {
  const channelMessages = Messages.get({ channelId: config.announcement_discord_channel_id });
  const checkCatFact = content => config.catfact_responses.includes(content);
  const channelCatFacts = channelMessages.map(item => item.content).filter(checkCatFact);

  const plural = Utilities.getPluralizedString("message", channelCatFacts);
  const debug = `Found ${channelCatFacts.length} existing cat fact ${plural}`;
  logger.debug(debug, listener);

  // ------------------------------------------------------------- //
  // Get a collection of cat facts sent the least amount of times. //
  // ------------------------------------------------------------- //

  let potentialCatFacts =
    config.catfact_responses.filter(content => !channelCatFacts.includes(content));

  if (!potentialCatFacts.length) {
    potentialCatFacts = Utilities.getLeastFrequentlyOccurringStrings(channelCatFacts);
  }

  // ---------------------------------------------------------- //
  // Send a random collection item to the announcement channel. //
  // ---------------------------------------------------------- //

  client.channels.cache.get(config.announcement_discord_channel_id)
    .send(randomItem(potentialCatFacts))
    .then(result => Utilities.LogPresets.SentMessage(result, listener))
    .catch(error => logger.error(error, listener));
}

/**
 * Send a random cat fact to the interaction channel.
 * @param {object} param
 * @param {CommandInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function sendSlashCommandReply({ interaction, listener }) {
  await interaction.deferReply();

  interaction
    .editReply(randomItem(config.catfact_responses))
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN LOGIC                                                   //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
