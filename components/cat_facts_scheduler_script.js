import { basename } from "path";
import { Cron } from "croner";
import { fileURLToPath } from "url";
import { findChannelMessage, getChannelMessages } from "../index.js";
import { getLeastFrequentlyOccurringStrings } from "../shared/scripts/array.js"
import { Logger } from "../logger.js";
import fs from "fs-extra";
import randomItem from 'random-item';

const {
  cron_job_pattern, discord_announcement_channel_id, sanitized_catfact_api_responses
} = fs.readJsonSync("components/cat_facts_scheduler_config.json");

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

export const onClientReady = async ({ client }) => {
  const cronOptions = {};
  cronOptions["protect"] = true;
  cronOptions["name"] = basename(fileURLToPath(import.meta.url));
  cronOptions["catch"] = ({ stack }) => Logger.Error(stack, cronOptions.name);

  const cronJob = async () => {
    const channel = await client.channels.fetch(discord_announcement_channel_id);
    const channelMessages = await getChannelMessages(discord_announcement_channel_id);
    const channelCatFacts = channelMessages.map(({ content }) => content);

    let potentialCatFacts = sanitized_catfact_api_responses.filter(apiCatFact => !channelCatFacts.includes(apiCatFact));
    if (!potentialCatFacts.length) potentialCatFacts = getLeastFrequentlyOccurringStrings(channelCatFacts);
    const randomCatFact = randomItem(potentialCatFacts);
    await channel.send(randomCatFact);

    Logger.Info(`Sent a cat fact to ${channel.guild.name} #${channel.name}`);
  }

  const cronEntrypoint = Cron(cron_job_pattern, cronOptions, cronJob);

  // ------------------------------------------------ //
  // send a cat fact if one was not sent today at 9am //
  // ------------------------------------------------ //

  const now = new Date();
  const today9am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);

  const lastChannelMessage = await findChannelMessage(discord_announcement_channel_id, () => true);
  const isMissedJob = now > today9am && (lastChannelMessage?.createdAt < today9am ?? true);
  if (isMissedJob) cronEntrypoint.trigger();
};

// ------------------------------------------------------------------------- //
// >> COMPONENT FUNCTIONS                                                 << //
// ------------------------------------------------------------------------- //

async function onInteractionCreate({ interaction }) {
  try {
    await interaction.deferReply();
    await interaction.editReply(randomItem(sanitized_catfact_api_responses));
    Logger.Info(`Sent a cat fact to ${interaction.channel.guild.name} #${interaction.channel.name}`);
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}
