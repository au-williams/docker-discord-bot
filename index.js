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
  initializeModules().then(() => runModuleFunction("OnReady", { client }));
});

client.on(Events.MessageCreate, message => {
  !message.author.bot && runModuleFunction("OnMessageCreate", { client, message });
});

client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
  !newMessage.author.bot && runModuleFunction("OnMessageUpdate", { client, oldMessage, newMessage });
});

// Store the interactions being processed so their executions can't be spammed.
const busyInteractions = new Set();

client.on(Events.InteractionCreate, async interaction => {
  const compositeKey = interaction.message.id + interaction.customId;

  if (busyInteractions.has(compositeKey)) {
    interaction.deferUpdate();
    return null;
  }

  busyInteractions.add(compositeKey);
  await runModuleFunction("OnInteractionCreate", { client, interaction });
  busyInteractions.delete(compositeKey);
});

// ------------ //
// Script logic //
// ------------ //

async function initializeModules() {
  console.log(
    `Client "${client.users.cache.get(client.user.id)?.username}" started` +
      ` with ${client.users.cache.size} user${client.users.cache.size === 1 ? "" : "s"}` +
      ` in ${client.channels.cache.size} channel${client.channels.cache.size === 1 ? "" : "s"}` +
      ` of ${client.guilds.cache.size} guild${client.guilds.cache.size === 1 ? "" : "s"}.`
  );

  // --------------------------------------------------- //
  // Populate bot_modules with scripts in ./bot_modules/ //
  // --------------------------------------------------- //

  const filenames = fs.readdirSync(`./bot_modules/`).filter(x => x.endsWith(".js"));

  for (const name of filenames)
    await import(`./bot_modules/${name}`).then(script => bot_modules.push({ name, script }));

  Logger.Info(`Loaded modules ["${filenames.join(`", "`)}"] (${filenames.length})`);

  // --------------------------------------------------- //
  // Delete last sessions temp data from ./temp_storage/ //
  // --------------------------------------------------- //

  fs.emptyDir("./temp_storage/");
}

async function runModuleFunction(functionName, params) {
  for (const module of bot_modules.filter(module => module.script[functionName])) {
    try {
      await module.script[functionName](params);
    } catch (error) {
      Logger.Error(`${module.name} ${functionName} threw an unhandled error\n❌ ${module.name} -> ${error}`);
    }
  }
}

client.login(config.login_token);
