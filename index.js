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
  catch({ stack }) {
    logger.error(stack);
  }
});

client.on(Events.MessageCreate, message => {
  try {
    // add message to lazy-loaded message history
    CHANNEL_MESSAGES[message.channel.id]?.unshift(message);
    invokePluginsFunction("onMessageCreate", { client, message });
  }
  catch({ stack }) {
    logger.error(stack);
  }
});

client.on(Events.MessageDelete, async message => {
  try {
    await invokePluginsFunction("onMessageDelete", { client, message });
    // todo: instead of deleting message from memory, we should just flag it as deleted instead
    const index = CHANNEL_MESSAGES[message.channel.id]?.map(({ id }) => id).indexOf(message.id);
    if (index != null && index > -1) CHANNEL_MESSAGES[message.channel.id].splice(index, 1); // remove from lazy-loaded message history
  }
  catch({ stack }) {
    logger.error(stack);
  }
});

client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
  try {
    invokePluginsFunction("onMessageUpdate", { client, newMessage, oldMessage });
  }
  catch({ stack }) {
    logger.error(stack);
  }
});

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
      INITIALIZED_PLUGINS.filter(filter).map(map).forEach(({ filename, onInteractionCreate, requiredChannelIds, requiredRoleIds }) => {
        const { channel, member: { roles }, user: { username } } = interaction;
        const isRequiredChannelId = !Array.isArray(requiredChannelIds) || requiredChannelIds.includes(channel.id);
        const isRequiredRoleId = !Array.isArray(requiredRoleIds) || requiredRoleIds.some(requiredId => roles.cache.some(({ id }) => id === requiredId));

        const formatContent = (message, valueStart, values, valueEnd) => {
          const predicate = (p, c, i) => `${p}${i && i === values.length - 1 ? " and " : " "}${valueStart}${c}${valueEnd}`;
          return values.reduce(predicate, message);
        }

        if (isRequiredChannelId && isRequiredRoleId) {
          onInteractionCreate({ client, interaction });
          logger.info(`${username} used ${interactionType} interaction "${interactionName}"`, filename);
        }

        else if (!isRequiredRoleId) {
          const uniqueRequiredRoleIds = [...new Set(requiredRoleIds)];
          const content = formatContent(`\`🔒Locked\` This can only be used by the`, "<@&", uniqueRequiredRoleIds, ">") + ` role${uniqueRequiredRoleIds.length === 1 ? "" : "s"}!`;
          interaction.reply({ content, ephemeral: true }).then(() => logger.info(`${username} tried ${interactionType} interaction "${interactionName}"`, filename));
        }

        else if (!isRequiredChannelId) {
          const uniqueRequiredChannelIds = [...new Set(requiredChannelIds)];
          const content = formatContent(`This can only be used in the`, "<#", uniqueRequiredChannelIds, ">") + ` channel${uniqueRequiredChannelIds.length === 1 ? "" : "s"}!`;
          interaction.reply({ content, ephemeral: true }).then(() => logger.info(`${username} tried ${interactionType} interaction "${interactionName}"`, filename));
        }
      });
    }
  }
  catch({ stack }) {
    logger.error(stack);
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
  catch({ stack }) {
    logger.error(stack);
  }
}

export const filterChannelMessages = async (channelId, filter) => {
  try {
    const channelMessages = CHANNEL_MESSAGES[channelId] ?? await getChannelMessages(channelId);
    return channelMessages.filter(filter);
  }
  catch({ stack }) {
    logger.error(stack);
  }
}

export const findChannelMessage = async (channelId, find) => {
  try {
    const channelMessages = CHANNEL_MESSAGES[channelId] ?? await getChannelMessages(channelId);
    return channelMessages.find(find);
  }
  catch({ stack }) {
    logger.error(stack);
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
  catch({ stack }) {
    logger.error(stack);
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
  catch({ stack }) {
    logger.error(stack);
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
    catch({ stack }) {
      logger.error(`"${filename}" ${stack}`);
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
    catch ({ stack }) {
      logger.error(`${filename} ${functionName} threw an uncaught error`);
      logger.error(filename, stack);
    }
  }
}

process.argv.includes("deploy")
  ? deploy().then(() => client.login(discord_bot_login_token))
  : client.login(discord_bot_login_token);
