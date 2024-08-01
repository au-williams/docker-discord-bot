import { Client, Events, GatewayIntentBits, Partials, REST, Routes } from "discord.js";
import { getFormattedRoles, getPluralizedString } from "./shared/helpers/utilities.js";
import fs from "fs-extra";
import Logger from "./shared/logger.js";

const {
  discord_bot_login_token,
  discord_prefetch_channel_ids,
  temp_directory
} = fs.readJsonSync("./config.json");

const INITIALIZED_PLUGINS = [];

const logger = new Logger("index.js");

// ------------------------------------------------------------------------- //
// >> DISCORD.JS CLIENT                                                   << //
// ------------------------------------------------------------------------- //

const client = new Client({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [
    Partials.Channel,
    Partials.Message
  ],
  rest: {
    timeout: 60000
  }
});

// ------------------------------------------------------------------------- //
// >> DISCORD EVENT HANDLERS                                              << //
// ------------------------------------------------------------------------- //

client.on(Events.ClientReady, async () => {
  try {
    // clear last sessions temp folder
    await fs.emptyDir(temp_directory);
  }
  catch(e) {
    // temp may be locked on Windows 💩
    logger.error(e);
  }

  try {
    // initialize client dependencies
    await initializeMessages();
    await initializePlugins();

    // compile and send console log
    const messageCount = Object.keys(CHANNEL_MESSAGES).reduce((total, current) => total += CHANNEL_MESSAGES[current].length, 0);
    logger.info(`${client.user.username} started with ${INITIALIZED_PLUGINS.length} plugins and ${messageCount} prefetched messages`);

    invokePluginsFunction("onClientReady", { client });
  }
  catch(e) {
    logger.error(e);
  }
});

client.on(Events.GuildMemberAdd, member => {
  try {
    invokePluginsFunction("onGuildMemberAdd", { client, member });
  }
  catch(e) {
    logger.error(e);
  }
});

client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  try {
    invokePluginsFunction("onGuildMemberUpdate", { client, oldMember, newMember });
  }
  catch(e) {
    logger.error(e);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    const isInteractionHandler = handler => handler.isInteraction(interaction);

    const pluginHandlers = INITIALIZED_PLUGINS
      .filter(({ instance }) => instance.PLUGIN_HANDLERS?.some(isInteractionHandler))
      .map(({ filename, instance }) => ({ filename, handler: instance.PLUGIN_HANDLERS.find(isInteractionHandler) }))

    if (!pluginHandlers.length) {
      logger.warn(`An unhandled command was received: "${interaction.commandName}"`);
      return;
    }

    for (const { filename, handler } of pluginHandlers) {
      if (handler.isLocked(interaction.member)) {
        logger.warn(`${interaction.user.username} tried to use "${handler.name}"`, filename);
        const rolesLabel = getPluralizedString("role", handler.requiredRoleIds.length);
        const rolesValue = getFormattedRoles(handler.requiredRoleIds).join(" ");
        const content = `🔒 Sorry but this can only be used by the ${rolesValue} ${rolesLabel}.`;
        await interaction.reply({ content, ephemeral: true });
        continue;
      }

      logger.info(`${interaction.user.username} used "${handler.name}"`, filename);
      await handler.onInteractionCreate({ client, interaction });
    }
  }
  catch(e) {
    logger.error(e);
  }
});

client.on(Events.MessageCreate, message => {
  try {
    CHANNEL_MESSAGES[message.channel.id]?.unshift(message); // add message to lazy-loaded message history
    invokePluginsFunction("onMessageCreate", { client, message });
  }
  catch(e) {
    logger.error(e);
  }
});

client.on(Events.MessageDelete, async message => {
  try {
    await invokePluginsFunction("onMessageDelete", { client, message });
    // remove from lazy-loaded message history
    // todo: instead of deleting message from memory, we should just flag it as deleted instead
    const index = CHANNEL_MESSAGES[message.channel.id]?.map(({ id }) => id).indexOf(message.id);
    if (index != null && index > -1) CHANNEL_MESSAGES[message.channel.id].splice(index, 1);
  }
  catch(e) {
    logger.error(e);
  }
});

client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
  try {
    invokePluginsFunction("onMessageUpdate", { client, newMessage, oldMessage });
  }
  catch(e) {
    logger.error(e);
  }
});

/**
 * Refetch the starter message of a created thread so its readonly .hasThread property is up to date
 */
client.on(Events.ThreadCreate, async threadChannel => {
  try {
    const starterMessage = await threadChannel.fetchStarterMessage();
    const { channel } = starterMessage;

    const index = CHANNEL_MESSAGES[channel.id].findIndex(({ id }) => id === starterMessage.id);
    const response = await channel.messages.fetch(starterMessage.id);
    CHANNEL_MESSAGES[channel.id][index] = response
  }
  catch(e) {
    logger.error(e);
  }
});

/**
 * Refetch the starter message of a deleted thread so its readonly .hasThread property is up to date
 */
client.on(Events.ThreadDelete, async threadChannel => {
  try {
    const starterMessage = await threadChannel.fetchStarterMessage().catch(() => null);
    if (!starterMessage) return; // starterMessage is deleted so we don't care about it
    const { channel } = starterMessage;

    const index = CHANNEL_MESSAGES[channel.id]?.findIndex(({ id }) => id === starterMessage.id);
    if (!index) return; // message isn't cached so we don't care about it either

    const response = await channel.messages.fetch(starterMessage.id);
    CHANNEL_MESSAGES[channel.id][index] = response
  }
  catch(e) {
    logger.error(e);
  }
});

client.on(Events.UserUpdate, (oldUser, newUser) => {
  try {
    invokePluginsFunction("onUserUpdate", { client, oldUser, newUser });
  }
  catch(e) {
    logger.error(e);
  }
});

// ------------------------------------------------------------------------- //
// >> CHANNEL MESSAGE HANDLERS                                            << //
// ------------------------------------------------------------------------- //

const CHANNEL_MESSAGES = {};

export const getChannelMessages = async channelId => {
  try {
    if (!CHANNEL_MESSAGES[channelId]) {
      const channel = await client.channels.fetch(channelId);
      let fetchedMessages = await channel.messages.fetch({ limit: 1 }).catch(() => []);
      CHANNEL_MESSAGES[channelId] = Array.from(fetchedMessages.values());
      if (!fetchedMessages.size) return CHANNEL_MESSAGES[channelId];

      do {
        const before = fetchedMessages.last().id;
        fetchedMessages = await channel.messages.fetch({ before, limit: 100 });
        CHANNEL_MESSAGES[channelId].push(...Array.from(fetchedMessages.values()));
        if (fetchedMessages.size < 100) fetchedMessages = null;
      } while (fetchedMessages);
    }

    return CHANNEL_MESSAGES[channelId];
  }
  catch(e) {
    logger.error(e);
  }
}

export const filterChannelMessages = async (channelId, filter) => {
  try {
    const channelMessages = CHANNEL_MESSAGES[channelId] ?? await getChannelMessages(channelId);
    return channelMessages.filter(filter);
  }
  catch(e) {
    logger.error(e);
  }
}

export const findChannelMessage = async (channelId, find) => {
  try {
    const channelMessages = CHANNEL_MESSAGES[channelId] ?? await getChannelMessages(channelId);
    return channelMessages.find(find);
  }
  catch(e) {
    logger.error(e);
  }
}

// ------------------------------------------------------------------------- //
// >> PLUGIN FUNCTIONS                                                    << //
// ------------------------------------------------------------------------- //

/**
 * Send a PUT request to Discord with the current slash commands
 */
async function deploy() {
  try {
    logger.info(`Starting command deployment ...`);

    // load all plugins into memory
    await initializePlugins();

    const body = INITIALIZED_PLUGINS
      .filter(({ instance }) => instance.PLUGIN_HANDLERS)
      .map(({ instance }) => instance.PLUGIN_HANDLERS)
      .flat()
      .filter(handler => handler.builder)
      .map(handler => handler.builder);

    // load credentials from config to push the payload to Discord
    const { discord_bot_client_id, discord_bot_login_token } = fs.readJsonSync("config.json");
    const rest = new REST({ version: "10" }).setToken(discord_bot_login_token);
    const data = await rest.put(Routes.applicationCommands(discord_bot_client_id), { body });
    logger.info(`Successfully reloaded ${data.length} (/) commands [${data.map(x => x.name).join(", ")}]`);
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Load all messages from prefetched Discord channels
 */
async function initializeMessages() {
  try {
    const channelIds = discord_prefetch_channel_ids.filter(channel_id => channel_id);
    for (const channel_id of channelIds) await getChannelMessages(channel_id);
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Load all plugins into memory so they can execute during discord events
 */
async function initializePlugins() {
  if (INITIALIZED_PLUGINS.length) return;

  for (const filename of fs.readdirSync(`./plugins/`).filter(fn => fn.endsWith("_script.js"))) {
    try {
      // todo: allow disabling of plugins - should this run OnClientReady() and not import any that throw?
      await import(`./plugins/${filename}`).then(instance => INITIALIZED_PLUGINS.push({ filename, instance }));
    }
    catch(e) {
      logger.error(`"${filename}" ${e}`);
    }
  }

  await import(`./shared/config.js`).then(instance => INITIALIZED_PLUGINS.push({ filename: "config.js", instance }))
}

/**
 * Invoke the function of the provided name in every plugin script that has it
 * @param {string} functionName The function name to invoke `"onMessageCreate"`
 * @param {Object} params The params to pass to the invoked function
 */
async function invokePluginsFunction(functionName, params) {
  for (const { filename, instance } of INITIALIZED_PLUGINS.filter(({ instance }) => instance[functionName])) {
    try {
      await instance[functionName](params);
    }
    catch (e) {
      logger.error(`"${filename}" "${functionName}" threw an uncaught error`);
      logger.error(e);
    }
  }
}

process.argv.includes("deploy")
  ? deploy().then(() => client.login(discord_bot_login_token))
  : client.login(discord_bot_login_token);
