import { Cron } from "croner";
import { findChannelMessage, getChannelMessages } from "../index.js";
import { getCronOptions } from "../shared/helpers/object.js";
import { getLeastFrequentlyOccurringStrings } from "../shared/helpers/array.js"
import Config from "../shared/config.js";
import Logger from "../shared/logger.js";
import randomItem from 'random-item';

const config = new Config("cat_facts_scheduler_config.json");
const logger = new Logger("cat_facts_scheduler_script.js");

// ------------------------------------------------------------------------- //
// >> INTERACTION DEFINITIONS                                             << //
// ------------------------------------------------------------------------- //

export const COMMAND_INTERACTIONS = [{
  name: "catfact",
  description: "Publicly sends a message with a random cat fact 🐱",
  onInteractionCreate
}];

// ------------------------------------------------------------------------- //
// >> DISCORD EVENT HANDLERS                                              << //
// ------------------------------------------------------------------------- //

/**
 * Send a new cat fact on a regular time interval
 * @param {Object} param
 * @param {Client} param.client The Discord.js client
 */
export const onClientReady = async ({ client }) => {
  await config.initialize(client);
  await logger.initialize(client);

  const cronJob = async () => {
    const channel = await client.channels.fetch(config.discord_announcement_channel_id);
    const channelMessages = await getChannelMessages(config.discord_announcement_channel_id);
    const channelCatFacts = channelMessages.map(({ content }) => content);

    // --------------------------------------------------------------------------- //
    // get a collection of cat facts that have been sent the least amount of times //
    // --------------------------------------------------------------------------- //

    let potentialCatFacts = config.sanitized_catfact_api_responses.filter(fact => !channelCatFacts.includes(fact));
    if (!potentialCatFacts.length) potentialCatFacts = getLeastFrequentlyOccurringStrings(channelCatFacts);

    // -------------------------------------------------------------------------- //
    // get a random cat fact from the collection and send it to the guild channel //
    // -------------------------------------------------------------------------- //

    const randomCatFact = randomItem(potentialCatFacts);
    await channel.send(randomCatFact);

    logger.info(`Sent a cat fact to ${channel.guild.name} #${channel.name}`);
  }

  const cronEntrypoint = Cron(config.cron_job_announcement_pattern, getCronOptions(logger), cronJob);
  logger.info(`Queued Cron job with pattern "${config.cron_job_announcement_pattern}"`);

  // ---------------------------------------------------------------------------- //
  // send a cat fact if the schedule was missed and one was not sent today at 9am //
  // ---------------------------------------------------------------------------- //

  const now = new Date();
  const today9am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
  const lastChannelMessage = await findChannelMessage(config.discord_announcement_channel_id, () => true);
  const isMissedJob = now > today9am && (lastChannelMessage?.createdAt < today9am ?? true);
  if (isMissedJob) cronEntrypoint.trigger();
};

// ------------------------------------------------------------------------- //
// >> PLUGIN FUNCTIONS                                                    << //
// ------------------------------------------------------------------------- //

/**
 * Send a random cat fact to the interaction channel
 * @param {Object} param
 * @param {Interaction} param.interaction
 */
async function onInteractionCreate({ interaction }) {
  try {
    await interaction.deferReply();
    await interaction.editReply(randomItem(config.sanitized_catfact_api_responses));
    logger.info(`Sent a cat fact to ${interaction.channel.guild.name} #${interaction.channel.name}`);
  }
  catch({ stack }) {
    logger.error(stack);
  }
}
