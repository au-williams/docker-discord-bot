import { createRequire } from "module";
const require = createRequire(import.meta.url);
const config = require("./cat_facts_config.json");
const cron = require("cron");

// ------------- //
// Discord Hooks //
// ------------- //

export const OnReady = ({ client }) => {
  // todo: if missing yesterdays cat fact, send one regardless of cron
  const cronJob = new cron.CronJob("0 9 * * *", async () => SendCatFacts(client));
  cronJob.start();
};

// ------------ //
// Module Logic //
// ------------ //

async function SendCatFacts(client) {
  for (const channel_id of config.channel_ids) {
    const channel = client.channels.cache.get(channel_id);
    const channelMessageContent = await getAllMessagesContentFromChannel(channel);
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
      .catch(console.error);
  }
}

function endsInPunctuation(str) {
  const punctuationMarks = [".", ",", ";", ":", "!", "?", "-", "(", ")", "[", "]", "{", "}"];
  return punctuationMarks.includes(str.slice(-1));
}

async function getAllMessagesContentFromChannel(channel) {
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
