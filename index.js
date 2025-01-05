import { ApplicationCommandType, Client, Events, GatewayIntentBits, Options, Partials, REST, Routes } from "discord.js";
import { Config } from "./services/config.js";
import { Emitter } from "./services/emitter.js";
import { Logger } from "./services/logger.js";
import { Utilities } from "./services/utilities.js";
import fs from "fs-extra";

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// >> CLIENT DEPENDENCIES                                                 << //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

export const client = new Client({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    GuildMemberManager: {
      maxSize: 200,
      keepOverLimit: member => member.id === member.client.user.id,
    },
  }),
  partials: [Partials.Channel, Partials.Message],
  rest: { timeout: 60000 }
});

const config = new Config();
const logger = new Logger(import.meta.filename);

try {
  // clear last sessions temp folder
  await fs.emptyDir(config.temp_directory_path);
}
catch(e) {
  // temp folder may be locked on Windows 💩
  logger.error(e);
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// >> CLIENT EVENT EMITTERS                                               << //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

client.on(Events.ClientReady, async () => {
  await Emitter.initialize(client);

  if (process.argv.includes("deploy")) {
    logger.info("Starting deployment ...");
    const body = Emitter.builders;
    const rest = new REST({ version: "10" }).setToken(config.discord_bot_login_token);
    const data = await rest.put(Routes.applicationCommands(client.user.id), { body });
    const label = Utilities.getPluralizedString("command", data.length);
    const names = data.map(d => `"${d.type === ApplicationCommandType.ChatInput ? "/" : ""}${d.name}"`);
    logger.info(`Finished deploying ${data.length} ${label} [${names.join(", ")}]`);
  }

  Emitter.emit({
    event: Events.ClientReady,
    params: { client }
  });
});

client.on(Events.GuildMemberAdd, (member) => Emitter.emit({
  event: Events.GuildMemberAdd,
  params: { client, member }
}));

client.on(Events.GuildMemberUpdate, (oldMember, newMember) => Emitter.emit({
  event: Events.GuildMemberUpdate,
  params: { client, oldMember, newMember }
}));

client.on(Events.InteractionCreate, (interaction) => Emitter.emit({
  event: Events.InteractionCreate,
  interaction: interaction,
  params: { client, interaction }
}));

client.on(Events.MessageCreate, (message) => Emitter.emit({
  event: Events.MessageCreate,
  params: { client, message }
}));

client.on(Events.MessageDelete, (message) => Emitter.emit({
  event: Events.MessageDelete,
  params: { client, message }
}));

client.on(Events.MessageUpdate, (oldMessage, newMessage) => Emitter.emit({
  event: Events.MessageUpdate,
  params: { client, oldMessage, newMessage }
}));

client.on(Events.ThreadDelete, (threadChannel) => Emitter.emit({
  event: Events.ThreadDelete,
  params: { client, threadChannel }
}));

client.on(Events.UserUpdate, (oldUser, newUser) => Emitter.emit({
  event: Events.UserUpdate,
  params: { client, oldUser, newUser }
}));

client.login(config.discord_bot_login_token);
