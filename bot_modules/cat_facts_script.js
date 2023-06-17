import { Logger } from "../logger.js";
import config from "./cat_facts_config.json" assert { type: "json" };
import cron from "cron";

export const OnReady = ({ client }) => {
  const cronJob = new cron.CronJob("0 9 * * *", () => sendCatFacts(client));
  cronJob.start();
};

async function sendCatFacts(client) {
  for (const channel_id of config.channel_ids) {
    const channel = client.channels.cache.get(channel_id);
    const channelMessageContent = await getAllMessageContentsFromChannel(channel);
    let message = null;

    while (!message) {
      let fact = await fetch("https://catfact.ninja/fact?max_length=256")
        .then(response => response.json())
        .then(data => data.fact.trim());

      if (!endsInPunctuation(fact)) fact += ".";
      if (!channelMessageContent.includes(fact)) message = fact;
    }

    channel
      .send(message)
      .then(() => console.log(`A cat fact was sent to ${channel.guild.name} #${channel.name}!`))
      .catch(Logger.Error);
  }
}

function endsInPunctuation(str) {
  const punctuationMarks = [".", ",", ";", ":", "!", "?", "-", "(", ")", "[", "]", "{", "}"];
  return punctuationMarks.includes(str.slice(-1));
}

async function getAllMessageContentsFromChannel(channel) {
  // Fetch the last message in the channel
  let lastMessage = await channel.messages.fetch({ limit: 1 });
  let messagesContent = [];

  // Loop through all the messages in the channel
  while (lastMessage) {
    // Get up to 100 messages before the last message
    let fetchedMessages = await channel.messages.fetch({ limit: 100, before: lastMessage.id });
    let fetchedMessagesContent = Array.from(fetchedMessages.values()).map(m => m.content);
    messagesContent = messagesContent.concat(fetchedMessagesContent);

    // If we fetched less than 100 messages, we've reached the beginning of the channel
    if (fetchedMessages.size < 100) lastMessage = null;
    else lastMessage = fetchedMessages.last();
  }

  return messagesContent;
}
