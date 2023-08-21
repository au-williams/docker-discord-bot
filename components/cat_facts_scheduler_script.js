import { getChannelMessages } from "../index.js";
import { Logger } from "../logger.js";
import cron from "cron";
import fs from "fs-extra";
import randomItem from 'random-item';

const { announcement_channel_ids } = fs.readJsonSync("components/cat_facts_scheduler_config.json");

// ----------------------- //
// Interaction definitions //
// ----------------------- //

export const COMMAND_INTERACTIONS = [{
  name: "catfact",
  description: "Publicly sends a message with a random cat fact 🐱",
  onInteractionCreate: ({ interaction }) => sendMessageReply({ interaction })
}]

// ---------------------- //
// Discord event handlers //
// ---------------------- //

export const onClientReady = async ({ client }) => {
  const now = new Date();
  const today9am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
  for(const channel_id of announcement_channel_ids) {
    const channel = await client.channels.fetch(channel_id);
    const channelMessages = await getChannelMessages(channel.id);
    const isMissedSchedule = now > today9am && (channelMessages.length ? channelMessages[0].createdAt < today9am : true);
    new cron.CronJob("0 9 * * *", () => sendScheduledMessage(channel), null, true, "America/Los_Angeles", null, isMissedSchedule);
  }
};

// ------------------- //
// Component functions //
// ------------------- //

async function sendScheduledMessage(channel) {
  try {
    const channelMessages = await getChannelMessages(channel.id);
    const apiCatFacts = await getApiCatFacts();
    const oldCatFacts = channelMessages.map(({ content }) => content);
    const newCatFacts = apiCatFacts.filter(catFact => !oldCatFacts.includes(catFact));
    // todo: this should reduce to find the least posted item once we exhaust the API of new data

    await channel.send(randomItem(newCatFacts));
    Logger.Info(`Sent cat fact message to ${channel.guild.name} #${channel.name}`);
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function sendMessageReply({ interaction }) {
  try {
    await interaction.deferReply();
    const apiCatFacts = await getApiCatFacts();
    await interaction.editReply({ content: randomItem(apiCatFacts) });
    Logger.Info(`Sent cat fact reply to ${interaction.channel.guild.name} #${interaction.channel.name}`);
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

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
