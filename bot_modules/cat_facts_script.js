import { Logger } from "../logger.js";
import config from "./cat_facts_config.json" assert { type: "json" };
import cron from "cron";

export const OnClientReady = async ({ client }) => {
  const now = new Date();
  const today9am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);

  for(const channel_id of config.channel_ids) {
    const channel = await client.channels.fetch(channel_id);
    const messages = await channel.messages.fetch({ limit: 1 });

    /* ------------------------------------------- *
     * schedule the channel message to send at 9am *
     * ------------------------------------------- */

    new cron.CronJob("0 9 * * *", () => sendCatFact({ channel })).start();

    /* ------------------------------------------- *
     * send if we missed the schedule when offline *
     * ------------------------------------------- */

    const isMissedSchedule = now > today9am && (!messages.size || messages.first().createdAt < today9am);
    if (isMissedSchedule) sendCatFact({ channel });
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

    attempts += 1;
    if (!endsInPunctuation(fact)) fact += ".";
    fact = fact.replaceAll("“", "\"").replaceAll("”", "\"");
    if (!channelMessageContent.includes(fact)) content = fact;
  }

  const { guild, name } = channel;
  const info = `A cat fact was sent to ${guild.name} #${name} (${attempts} total API quer${attempts == 1 ? "y" : "ies"})`;

  channel
    .send(content)
    .then(() => Logger.Info(info))
    .catch(Logger.Error);
}

function endsInPunctuation(string) {
  const punctuation = [".", ".\"", ",", ";", ":", "!", "?", "-", "(", ")", "[", "]", "{", "}"];
  return punctuation.some(p => string.endsWith(p));
}

async function getAllMessageContentsFromChannel(channel) {
  let lastMessage = await channel.messages.fetch({ limit: 1 });
  let messageContents = [];

  while (lastMessage) {
    const fetchedMessages = await channel.messages.fetch({ limit: 100, before: lastMessage.id });
    const fetchedMessagesContent = Array.from(fetchedMessages.values()).map(m => m.content);
    messageContents = messageContents.concat(fetchedMessagesContent);
    // we have reached the beginning if we fetched under 100 messages
    if (fetchedMessages.size < 100) lastMessage = null;
    else lastMessage = fetchedMessages.last();
  }

  return messageContents;
}