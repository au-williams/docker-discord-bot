import { basename } from "path";
import { getBaseTextChannel } from "./utilities.js";
import getCallerFile from "get-caller-file";

const getFilename = () => {
  const filepaths = [...Array(Error.stackTraceLimit).keys()].map(i => getCallerFile(i)).slice(1);
  const filepath = filepaths.find(x => x && !x.endsWith("logger.js"));
  return filepath ? basename(filepath) : null;
};

export const getLogIdentifier = ({ message, interaction }) => {
  const authorTag = message?.author.tag || interaction.user.tag;
  const guildName = message?.guild.name || interaction.guild.name;
  const channelName = getBaseTextChannel(message?.channel || interaction.channel).name;
  return `[${authorTag} | ${guildName} #${channelName}]`;
}

export class Logger {
  static Info(str) {
    console.log(`✅ ${getFilename()} -> ${str}`);
  }
  static Warn(str) {
    console.warn(`❔ ${getFilename()} -> ${str}`);
  }
  static Error(str) {
    console.error(`❌ ${getFilename()} -> ${str}`);
  }
}

// import { Client, Events, GatewayIntentBits } from "discord.js";
// import config from "./config.json" assert { type: "json" };

// let informationThread;
// let warningThread;
// let errorThread;

// export class Logger {
//   static async Initialize(client) {
//     this.client = client;

//     for (const channel_id of config.log_channel_ids) {
//       const channel = await client.channels.fetch(channel_id);
//       const messages = await channel.messages.fetch();

//       const missingThreads = [];
//       messages.find(m => m.content.includes("Information")) || missingThreads.push("Information");
//       messages.find(m => m.content.includes("Warning")) || missingThreads.push("Warning");
//       messages.find(m => m.content.includes("Error")) || missingThreads.push("Error");

//       missingThreads.forEach(type => {
//         // const embed =
//         // channel.send(type);
//       });
//     }
//   }
//   static Information() {}
//   static Warning() {}
//   static Error() {}
// }
