import { Client, Events, GatewayIntentBits } from "discord.js";
import { Logger } from "./logger.js";
import config from "./config.json" assert { type: "json" };
import fs from "fs-extra";
const bot_modules = [];

// --------------------------------------------------- //
// Create the Discord.js client and its event handlers //
// --------------------------------------------------- //

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  rest: {
    timeout: 60000
  }
});

client.on(Events.ClientReady, () => {
  initializeModules().then(() => runModuleFunction("OnClientReady", { client }));
});

client.on(Events.MessageCreate, message => {
  !message.author.bot && runModuleFunction("OnMessageCreate", { client, message });
});

client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
  !newMessage.author.bot && runModuleFunction("OnMessageUpdate", { client, oldMessage, newMessage });
});

client.on(Events.InteractionCreate, interaction => {
  runModuleFunction("OnInteractionCreate", { client, interaction });
});

// ------------ //
// Script logic //
// ------------ //

async function initializeModules() {
  // --------------------------------------------------- //
  // Populate bot_modules with scripts in ./bot_modules/ //
  // --------------------------------------------------- //

  const filenames = fs.readdirSync(`./bot_modules/`).filter(x => x.endsWith(".js") || x.endsWith(".ts"));

  for (const filename of filenames) {
    await import(`./bot_modules/${filename}`).then(instance => bot_modules.push({ filename, instance }));
  }

  Logger.Info(`Started bot modules ["${filenames.join(`", "`)}"] (${filenames.length})`);

  // --------------------------------------------------- //
  // Delete last sessions temp data from ./temp_storage/ //
  // --------------------------------------------------- //

  fs.emptyDir("./temp_storage/");
}

async function runModuleFunction(functionName, params) {
  for (const { filename, instance } of bot_modules.filter(({ instance }) => instance[functionName])) {
    try {
      await instance[functionName](params);
    } catch (error) {
      Logger.Error(`${filename} ${functionName} threw an internal error`, error);
    }
  }
}

client.login(config.login_token);
