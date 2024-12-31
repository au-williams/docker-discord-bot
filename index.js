import { Client, Events, GatewayIntentBits, Options, Partials, REST, Routes } from "discord.js";
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
  await fs.emptyDir(config.temp_directory);
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

client.on(Events.ClientReady, () => Emitter.initialize(client).then(({ emit }) => emit({
  event: Events.ClientReady,
  params: { client }
})));

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

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// >> DEPLOYMENT DEFINITIONS                                              << //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * Launch after deployment when the deploy parameter is provided on startup.
 */
process.argv.includes("deploy")
  ? invokeDeploy().then(() => client.login(config.discord_bot_login_token))
  : client.login(config.discord_bot_login_token);

/**
 * Send a PUT request to Discord with the current slash commands.
 */
async function invokeDeploy() {
  // ----------------------------------------------------------------------- //
  // Initialize Emitter to populate the command listeners                    //
  // ----------------------------------------------------------------------- //

  logger.info("Starting command deployment ...");

  await Emitter.initialize(client);

  // ----------------------------------------------------------------------- //
  // Populate the request body with command builders                         //
  // ----------------------------------------------------------------------- //

  const body = [];

  Emitter.listeners.forEach(listener => {
    if (listener.deploymentType != null) {
      const { builder } = listener;
      if (builder) body.push(builder);
      else throw new Error("Unexpected deployment type.");
    }
  });

  console.log(body)
  // ----------------------------------------------------------------------- //
  // Submit the request to the Discord API                                   //
  // ----------------------------------------------------------------------- //

  const rest = new REST({ version: "10" }).setToken(config.discord_bot_login_token);
  const data = await rest.put(Routes.applicationCommands(config.discord_bot_client_user_id), { body });
  const plural = Utilities.getPluralizedString("command", data.length);
  const names = data.map(({ name }) => name).join(", ")

  logger.info(`Successfully deployed ${data.length} ${plural} [${names}]`);
}
