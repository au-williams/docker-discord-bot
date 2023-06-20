import { Logger } from "../logger.js";
import config from "./cat_facts_config.json" assert { type: "json" };
import cron from "cron";

export const OnReady = async ({ client }) => {
  const now = new Date();
  const today9am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);

  for(const channel_id of config.channel_ids) {
    const channel = await client.channels.fetch(channel_id);
    const messages = await channel.messages.fetch({ limit: 1 });

    // -------------------------------------- //
    // schedule the message to be sent at 9am //
    // -------------------------------------- //

    new cron.CronJob("0 9 * * *", () => sendCatFact({ channel })).start();

    // --------------------------------------------- //
    // check if we missed the schedule while offline //
    // --------------------------------------------- //

    const isMessageOutdated = now > today9am && (!messages.size || messages.first().createdAt < today9am);
    if (isMessageOutdated) sendCatFact({ channel });
  }
};

async function sendCatFact({ channel }) {
  const channelMessageContent = await getAllMessageContentsFromChannel(channel);
  let attempts = 0;
  let content = "";

  while (!content) {
    // verify message is unique before sending to the channel
    let fact = await fetch("https://catfact.ninja/fact?max_length=256")
      .then(response => response.json())
      .then(data => data.fact.trim());

    if (!endsInPunctuation(fact)) fact += ".";
    if (!channelMessageContent.includes(fact)) content = fact;
    attempts += 1;
  }

  channel
    .send(content)
    .then(() => Logger.Info(`A cat fact was sent to ${channel.guild.name} #${channel.name} after ${attempts} catfact API ${attempts == 1 ? "query" : "queries"}`))
    .catch(Logger.Error);
}

function endsInPunctuation(str) {
  const punctuationMarks = [".", ",", ";", ":", "!", "?", "-", "(", ")", "[", "]", "{", "}"];
  return punctuationMarks.includes(str.slice(-1));
}

async function getAllMessageContentsFromChannel(channel) {
  let lastMessage = await channel.messages.fetch({ limit: 1 });
  let messagesContent = [];

  while (lastMessage) {
    let fetchedMessages = await channel.messages.fetch({ limit: 100, before: lastMessage.id });
    let fetchedMessagesContent = Array.from(fetchedMessages.values()).map(m => m.content);
    messagesContent = messagesContent.concat(fetchedMessagesContent);
    // we have reached the beginning if we fetched under 100 messages
    if (fetchedMessages.size < 100) lastMessage = null;
    else lastMessage = fetchedMessages.last();
  }

  return messagesContent;
}