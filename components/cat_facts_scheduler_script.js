import { Cron } from "croner";
import { findChannelMessage, getChannelMessages } from "../index.js";
import { Logger } from "../logger.js";
import date from 'date-and-time';
import fs from "fs-extra";
import randomItem from 'random-item';

const { announcement_channel_ids } = fs.readJsonSync("components/cat_facts_scheduler_config.json");

// ----------------------- //
// Interaction definitions //
// ----------------------- //

export const COMMAND_INTERACTIONS = [{
  name: "catfact",
  description: "Publicly sends a message with a random cat fact 🐱",
  onInteractionCreate
}];

// ---------------------- //
// Discord event handlers //
// ---------------------- //

export const onClientReady = async ({ client }) => {
  const now = new Date();
  const today9am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);

  for(const channel_id of announcement_channel_ids) {
    const onError = ({ stack }) => Logger.Error(stack, "cat_facts_scheduler_script.js");
    const cron = Cron("0 9 * * *", { catch: onError }, async job => {
      Logger.Info(`Triggered job pattern "${job.getPattern()}"`);
      const oldCatFacts = (await getChannelMessages(channel_id)).map(({ content }) => content);
      const newCatFacts = (await getApiCatFacts()).filter(catFact => !oldCatFacts.includes(catFact));
      const channel = await client.channels.fetch(channel_id);
      await channel.send(randomItem(newCatFacts)); // this should reduce the least posted items when the API runs out of new data
      Logger.Info(`Sent cat fact message to ${channel.guild.name} #${channel.name}`);
      Logger.Info(`Scheduled next job on "${date.format(job.nextRun(), "YYYY-MM-DDTHH:mm")}"`);
    });

    const lastChannelMessage = await findChannelMessage(channel_id, () => true);
    const isMissedJob = now > today9am && (lastChannelMessage?.createdAt < today9am ?? true);
    if (isMissedJob) cron.trigger();
  }
};

// ------------------- //
// Component functions //
// ------------------- //

async function getApiCatFacts() {
  return await fetch("https://catfact.ninja/facts?max_length=256&limit=500")
    .then(response => response.json())
    .then(({ data }) => data.map(({ fact }) => {
      let cleanedFact = fact.trim()
        .replaceAll("“", "\"").replaceAll("”", "\"")
        .replaceAll(" .", ".").replaceAll(".i.", ".")
        .replaceAll(" /", " ").replaceAll("’", "'");

      const punctuations = [".", ".\"", ",", ";", ":", "!", "?", "-", "(", ")", "[", "]", "{", "}"];
      if (!punctuations.some(punctuation => cleanedFact.endsWith(punctuation))) cleanedFact += ".";
      return cleanedFact;
    }));
}

async function onInteractionCreate({ interaction }) {
  try {
    await interaction.deferReply();
    await interaction.editReply({ content: randomItem(await getApiCatFacts()) });
    Logger.Info(`Sent cat fact reply to ${interaction.channel.guild.name} #${interaction.channel.name}`);
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}
