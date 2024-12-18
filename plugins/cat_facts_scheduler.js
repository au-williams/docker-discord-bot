import { Config } from "../services/config.js";
import { DeploymentTypes } from "../entities/DeploymentTypes.js";
import { Logger } from "../services/logger.js";
import { Messages } from "../services/messages.js";
import { MessageType } from "discord.js";
import { Utilities } from "../services/utilities.js";
import CronJobScheduler from "../entities/CronJobScheduler.js";
import Listener from "../entities/Listener.js";
import randomItem from "random-item";

const config = new Config(import.meta.filename);
const logger = new Logger(import.meta.filename);

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
  new CronJobScheduler()
    .setEnabled(Messages.isInitialized)
    .setFunction(sendAnnouncementMessage)
    .setPattern(config.announcement_cron_job_pattern)
    .setTriggered(checkTodayMissingAnnouncement)
]);

/**
 * The interactions created by this script. We use these unique IDs to define
 * buttons, commands, and components and so Discord can emit the interactions
 * that we handle in the `Listeners<object>` variable.
 */
export const Interactions = Object.freeze({
  ChatInputCommandCatfact: "catfact"
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
  [Interactions.ChatInputCommandCatfact]: new Listener()
    .setDeploymentType(DeploymentTypes.ChatInputCommand)
    .setDescription("Publicly sends a message to the channel with a random cat fact. 🐱")
    .setFunction(sendSlashCommandReply)
});

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS LISTENERS                                           //
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
    .find(({ content, type }) => type === MessageType.Default && config.sanitized_catfact_api_responses.includes(content))
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
  const checkCatFact = content => config.sanitized_catfact_api_responses.includes(content);
  const channelCatFacts = channelMessages.map(item => item.content).filter(checkCatFact);

  const plural = Utilities.getPluralizedString("message", channelCatFacts);
  const debug = `Found ${channelCatFacts.length} existing cat fact ${plural}`;
  logger.debug(debug, listener);

  // ------------------------------------------------------------- //
  // Get a collection of cat facts sent the least amount of times. //
  // ------------------------------------------------------------- //

  let potentialCatFacts =
    config.sanitized_catfact_api_responses.filter(content => !channelCatFacts.includes(content));

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
    .editReply(randomItem(config.sanitized_catfact_api_responses))
    .then(result => Utilities.LogPresets.EditedReply(result, listener))
    .catch(error => logger.error(error, listener));
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN LOGIC                                                   //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
