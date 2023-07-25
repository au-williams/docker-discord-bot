import { Client, Events, GatewayIntentBits } from "discord.js";
import { Logger } from "./logger.js";
import config from "./config.json" assert { type: "json" };
import fs from "fs-extra";

const BOT_MODULES = [];
const CHANNEL_MESSAGES = {};

export const getChannelMessages = (channelId) => CHANNEL_MESSAGES[channelId];
export const findChannelMessage = (channelId, predicate) => getChannelMessages(channelId).find(predicate);

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

client.on(Events.ClientReady, async () => {
  initializeModules().then(() => runModuleFunction("OnClientReady", { client }));
});

client.on(Events.MessageCreate, message => {
  CHANNEL_MESSAGES[message.channel.id]?.unshift(message);
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
  const filenames = fs.readdirSync(`./BOT_MODULES/`);

  // populate BOT_MODULES with scripts in ./bot_modules/

  const scriptFilenames =
    filenames.filter(x => x.endsWith("_script.js") || x.endsWith("_script.ts"));

  for await (const filename of scriptFilenames) {
    await import(`./BOT_MODULES/${filename}`).then(instance => BOT_MODULES.push({ filename, instance }));
  }

  // populate CHANNEL_MESSAGES with all existing messages for channel ids in ./bot_modules/ configs

  const configFilenames = filenames.filter(x => x.endsWith("_config.json"));
  const loadJSON = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));

  for await (const filename of configFilenames) {
    const json = loadJSON(`./bot_modules/${filename}`);

    for await (const channel_id of json.channel_ids) {
      const isContinue = !channel_id || Array.isArray(CHANNEL_MESSAGES[channel_id]);
      if (isContinue) continue;

      const channel = await client.channels.fetch(channel_id);
      let fetchedMessages = await channel.messages.fetch({ limit: 1 });
      CHANNEL_MESSAGES[channel_id] = Array.from(fetchedMessages.values());

      do {
        const before = fetchedMessages.last().id;
        fetchedMessages = await channel.messages.fetch({ before, limit: 100 });
        CHANNEL_MESSAGES[channel_id].push(...Array.from(fetchedMessages.values()));
        if (fetchedMessages.size < 100) fetchedMessages = null;
      } while (fetchedMessages);
    }
  }

  const channelMessageCount = Object.keys(CHANNEL_MESSAGES)
    .reduce((total, current) => total += CHANNEL_MESSAGES[current].length, 0);

  Logger.Info(`Started modules ["${scriptFilenames.join(`", "`)}"] (${scriptFilenames.length}) with ${channelMessageCount} fetched messages`);

  // delete last sessions temp data from ./temp_storage/

  fs.emptyDir("./temp_storage/");
}

async function runModuleFunction(functionName, params) {
  for (const { filename, instance } of BOT_MODULES.filter(({ instance }) => instance[functionName])) {
    try {
      await instance[functionName](params);
    } catch (error) {
      Logger.Error(`${filename} ${functionName} threw an internal error`, error);
    }
  }
}

client.login(config.login_token);
