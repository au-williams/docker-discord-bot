const { Client, GatewayIntentBits } = require("discord.js");
const { bot_user_id, login_token } = require("./config.json");
const fs = require("fs-extra");
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
  ]
});

client.on("ready", () => InitializeModules().then(() => RunModuleFunction("OnReady", client)));

client.on("messageCreate", message => RunModuleFunction("OnMessageCreate", message));

// ------------ //
// Script logic //
// ------------ //

async function InitializeModules() {
  console.log(
    `Client "${client.users.cache.get(bot_user_id)?.username}" started` +
      ` with ${client.users.cache.size} user${client.users.cache.size === 1 ? "" : "s"}` +
      ` in ${client.channels.cache.size} channel${client.channels.cache.size === 1 ? "" : "s"}` +
      ` of ${client.guilds.cache.size} guild${client.guilds.cache.size === 1 ? "" : "s"}.`
  );

  // --------------------------------------------------- //
  // Populate bot_modules with scripts in ./bot_modules/ //
  // --------------------------------------------------- //

  const filenames = require("fs")
    .readdirSync(`./bot_modules/`)
    .filter(x => x.endsWith(".mjs"));

  for (const name of filenames)
    await import(`./bot_modules/${name}`).then(script => bot_modules.push({ name, script }));

  console.log(`🔄 Loaded modules ["${filenames.join(`", "`)}"] (${filenames.length})`);

  // --------------------------------------------------- //
  // Delete last sessions temp data from ./temp_storage/ //
  // --------------------------------------------------- //

  fs.emptyDir("./temp_storage/");
}

async function RunModuleFunction(functionName, param) {
  for (const module of bot_modules.filter(module => module.script[functionName])) {
    const log = { content: "", emoji: "" };

    try {
      log.content = await module.script[functionName](client, param);
      log.emoji = "✅";
    } catch (error) {
      log.content = `${error.toString().replace("Error: ", "")}`;
      log.emoji = "❌";
    }

    if (log.content) {
      const builder = [
        log.emoji && `${log.emoji}`,
        module.name && `"${module.name}"`,
        functionName && `[${functionName}]`,
        log.content && `-> ${log.content}`
      ].filter(x => x);

      console.log(builder.join(" "));
    }
  }
}

client.login(login_token);
