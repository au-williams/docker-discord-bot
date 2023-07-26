import { getChannelMessages } from "../index.js";
import { Logger } from "../logger.js";
import config from "./cat_facts_scheduler_config.json" assert { type: "json" };
import cron from "cron";
import randomItem from 'random-item';

export const OnClientReady = async ({ client }) => {
  const now = new Date();
  const today9am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);

  for(const channel_id of config.channel_ids) {
    const channel = await client.channels.fetch(channel_id).catch(Logger.Error);
    const isMissedSchedule = now > today9am && channel && getChannelMessages(channel.id)[0]?.createdAt < today9am;
    new cron.CronJob("0 9 * * *", () => sendCatFact(channel), null, true, "America/Los_Angeles", null, isMissedSchedule);
  }
};

async function sendCatFact(channel) {
  try {
    const apiCatFacts = await fetch("https://catfact.ninja/facts?max_length=256&limit=500")
      .then(response => response.json())
      .then(({ data }) => data.map(({ fact }) => {
        let cleanedFact = fact.trim()
          .replaceAll("“", "\"").replaceAll("”", "\"")
          .replaceAll(" .", ".").replaceAll(".i.", ".")
          .replaceAll("’", "'");

        const punctuations = [".", ".\"", ",", ";", ":", "!", "?", "-", "(", ")", "[", "]", "{", "}"];
        if (!punctuations.some(punctuation => cleanedFact.endsWith(punctuation))) cleanedFact += ".";
        return cleanedFact;
      }));

    const oldCatFacts = getChannelMessages(channel.id).map(({ content }) => content);
    const newCatFacts = apiCatFacts.filter(item => !oldCatFacts.includes(item));
    // todo: this should reduce to find the least posted cat facts once we exhaust the API of new data

    const info = `A cat fact was sent to ${channel.guild.name} #${channel.name}`;

    channel
      .send(randomItem(newCatFacts))
      .then(() => Logger.Info(info))
  }
  catch(error) {
    Logger.Error(error);
  }
}
