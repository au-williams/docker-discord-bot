import { Client, Events, GatewayIntentBits, Partials, REST, Routes } from "discord.js";
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

// todo: this function should be cleaned up ... good luck!
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      invokeOnInteractionCreate({
        filter: ({ instance }) => instance.COMMAND_INTERACTIONS?.some(({ name } = {}) => name === interaction.commandName),
        map: ({ filename, instance }) => ({ filename, ...instance.COMMAND_INTERACTIONS.find(({ name } = {}) => name === interaction.commandName) }),
        interactionName: `/${interaction.commandName}`,
        interactionType: "command"
      });
    }

    if (interaction.isButton() || interaction.isModalSubmit()) {
      invokeOnInteractionCreate({
        filter: ({ instance }) => instance.COMPONENT_INTERACTIONS?.some(({ customId } = {}) => customId === interaction.customId),
        map: ({ filename, instance }) => ({ filename, ...instance.COMPONENT_INTERACTIONS.find(({ customId } = {}) => customId === interaction.customId) }),
        interactionName: interaction.customId,
        interactionType: interaction.isButton() ? "button" : "modal"
      });
    }

    function invokeOnInteractionCreate({ filter, interactionName, interactionType, map }) {
      INITIALIZED_PLUGINS.filter(filter).map(map).forEach(({ filename, onInteractionCreate, requiredChannelIds, requiredUserRoleIds }) => {
        const { channel, member: { roles }, user: { username } } = interaction;

        // requiredChannelIds may be a getter function for loaded dependencies, we must resolve it before evaluating it
        const resolvedChannelIds = typeof requiredChannelIds === "function" ? requiredChannelIds() : requiredChannelIds;
        const isRequiredChannels = !Array.isArray(resolvedChannelIds) || resolvedChannelIds.includes(channel.id);

        /**
         * Because some config values may be unavailable at execution time, references to them can be
         *   in getter format. Try to unpack them before evaluation. If a single value is passed as a
         *   string to simplify its definition then add support by evaluating it in Array format.
         * @type {Object} param
         * @type {bool} param.isRequiredRoles
         * @type {String[]} param.uniqueRoleIds
         */
        const { isRequiredRoles, uniqueRoleIds } = (() => {
          let resolvedRoleIds = requiredUserRoleIds;
          if (typeof resolvedRoleIds === "undefined") return { isRequiredRoles: true, uniqueRoleIds: [] };
          if (typeof resolvedRoleIds === "function") resolvedRoleIds = resolvedRoleIds();
          if (typeof resolvedRoleIds === "string") resolvedRoleIds = [resolvedRoleIds];
          if (!Array.isArray(resolvedRoleIds)) throw "Invalid required role ID type";
          const isRequiredRoles = resolvedRoleIds.some(roleId => roles.cache.some(({ id }) => id === roleId));
          const uniqueRoleIds = [...new Set(resolvedRoleIds)];
          return { isRequiredRoles, uniqueRoleIds };
        })();

        const formatContent = (message, valueStart, values, valueEnd) => {
          const predicate = (p, c, i) => `${p}${i && i === values.length - 1 ? " and " : " "}${valueStart}${c}${valueEnd}`;
          return values.reduce(predicate, message);
        }

        if (isRequiredChannels && isRequiredRoles) {
          onInteractionCreate({ client, interaction });
          logger.info(`${username} used ${interactionType} interaction "${interactionName}"`, filename);
        }

        else if (!isRequiredRoles) {
          const content = formatContent(`\`🔒Locked\` This can only be used by the`, "<@&", uniqueRoleIds, ">") + ` role${uniqueRoleIds.length === 1 ? "" : "s"}!`;
          interaction.reply({ content, ephemeral: true }).then(() => logger.info(`${username} tried ${interactionType} interaction "${interactionName}"`, filename));
        }

        else if (!isRequiredChannels) {
          const uniqueRequiredChannelIds = [...new Set(resolvedChannelIds)];
          const content = formatContent(`This can only be used in the`, "<#", uniqueRequiredChannelIds, ">") + ` channel${uniqueRequiredChannelIds.length === 1 ? "" : "s"}!`;
          interaction.reply({ content, ephemeral: true }).then(() => logger.info(`${username} tried ${interactionType} interaction "${interactionName}"`, filename));
        }
      });
    }
  }
  catch(e) {
    logger.error(e);
  }
});

client.on(Events.MessageCreate, message => {
  try {
    // add message to lazy-loaded message history
    CHANNEL_MESSAGES[message.channel.id]?.unshift(message);
    invokePluginsFunction("onMessageCreate", { client, message });
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

client.on(Events.UserUpdate, (oldUser, newUser) => {
  try {
    invokePluginsFunction("onUserUpdate", { client, oldUser, newUser });
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

    await initializePlugins();
    const body = [];

    for(const { instance } of INITIALIZED_PLUGINS) {
      if (!instance.COMMAND_INTERACTIONS) continue;
      body.push(...instance.COMMAND_INTERACTIONS.map(({ name, description }) => ({ name, description })));
    }

    const { discord_bot_client_id, discord_bot_login_token } = fs.readJsonSync("config.json");
    const rest = new REST({ version: "10" }).setToken(discord_bot_login_token);
    const data = await rest.put(Routes.applicationCommands(discord_bot_client_id), { body });

    logger.info(`Successfully reloaded ${data.length} (/) commands`);
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
