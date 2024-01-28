import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { Logger } from "./logger.js";
import { State } from "./state.js";
import fs from "fs-extra";

const {
  login_token, prefetched_channel_ids, temp_directory
} = fs.readJsonSync("./config.json");

// ---------------------------- //
// Create the discord.js client //
// ---------------------------- //

const { DirectMessages, Guilds, GuildMembers, GuildMessages, MessageContent } = GatewayIntentBits;
const intents = [ DirectMessages, Guilds, GuildMembers, GuildMessages, MessageContent ];
const partials = [ Partials.Channel, Partials.Message ];
const client = new Client({ intents, partials, rest: { timeout: 60000 } });

// --------------------------- //
// Announce the event handlers //
// --------------------------- //

client.on(Events.ClientReady, async () => {
  await initializeMessages();
  await initializeComponents();
  await State.initialize(client);
  invokeComponentsFunction("onClientReady", { client });
});

client.on(Events.MessageCreate, message => {
  CHANNEL_MESSAGES[message.channel.id]?.unshift(message);
  invokeComponentsFunction("onMessageCreate", { client, message });
});

client.on(Events.MessageDelete, async message => {
  const index = CHANNEL_MESSAGES[message.channel.id]?.map(({ id }) => id).indexOf(message.id);
  await invokeComponentsFunction("onMessageDelete", { client, message });
  if (index != null && index > -1) CHANNEL_MESSAGES[message.channel.id].splice(index, 1);
});

client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
  invokeComponentsFunction("onMessageUpdate", { client, newMessage, oldMessage });
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
      LOADED_COMPONENTS.filter(filter).map(map).forEach(({ filename, onInteractionCreate, requiredChannelIds, requiredRoleIds }) => {
        const { channel, member: { roles }, user: { username } } = interaction;
        const isRequiredChannelId = !Array.isArray(requiredChannelIds) || requiredChannelIds.includes(channel.id);
        const isRequiredRoleId = !Array.isArray(requiredRoleIds) || requiredRoleIds.some(requiredId => roles.cache.some(({ id }) => id === requiredId));

        const formatContent = (message, valueStart, values, valueEnd) => {
          const predicate = (p, c, i) => `${p}${i && i === values.length - 1 ? " and " : " "}${valueStart}${c}${valueEnd}`;
          return values.reduce(predicate, message);
        }

        if (isRequiredChannelId && isRequiredRoleId) {
          onInteractionCreate({ client, interaction });
          Logger.Info(`${username} used ${interactionType} interaction "${interactionName}"`, filename);
        }

        else if (!isRequiredRoleId) {
          const uniqueRequiredRoleIds = [...new Set(requiredRoleIds)];
          const content = formatContent(`\`🔒Locked\` This can only be used by the`, "<@&", uniqueRequiredRoleIds, ">") + ` role${uniqueRequiredRoleIds.length === 1 ? "" : "s"}!`;
          interaction.reply({ content, ephemeral: true }).then(() => Logger.Info(`${username} tried ${interactionType} interaction "${interactionName}"`, filename));
        }

        else if (!isRequiredChannelId) {
          const uniqueRequiredChannelIds = [...new Set(requiredChannelIds)];
          const content = formatContent(`This can only be used in the`, "<#", uniqueRequiredChannelIds, ">") + ` channel${uniqueRequiredChannelIds.length === 1 ? "" : "s"}!`;
          interaction.reply({ content, ephemeral: true }).then(() => Logger.Info(`${username} tried ${interactionType} interaction "${interactionName}"`, filename));
        }
      });
    }
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
});

// --------------------------------- //
// Exported channel message handlers //
// --------------------------------- //

const CHANNEL_MESSAGES = {};
const LOADED_COMPONENTS = [];

export const getChannelMessages = async channelId => {
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

export const filterChannelMessages = async (channelId, filter) => {
  const channelMessages = CHANNEL_MESSAGES[channelId] ?? await getChannelMessages(channelId);
  return channelMessages.filter(filter);
}

export const findChannelMessage = async (channelId, find) => {
  const channelMessages = CHANNEL_MESSAGES[channelId] ?? await getChannelMessages(channelId);
  return channelMessages.find(find);
}

// ------------------------ //
// Component function logic //
// ------------------------ //

async function initializeComponents() {
  const scriptFilenames = fs
    .readdirSync(`./components/`)
    .filter(filename => filename.endsWith("_script.js"));

  for await (const filename of scriptFilenames)
    await import(`./components/${filename}`).then(instance => LOADED_COMPONENTS.push({ filename, instance }));

  await fs.emptyDir(temp_directory); // delete last sessions temp data from ./temp/
  const channelMessageCount = Object.keys(CHANNEL_MESSAGES).reduce((total, current) => total += CHANNEL_MESSAGES[current].length, 0);
  Logger.Info(`${client.user.username} started with ${LOADED_COMPONENTS.length} of ${scriptFilenames.length} components and ${channelMessageCount} prefetched messages`);
}

async function initializeMessages() {
  try {
    for await (const channel_id of prefetched_channel_ids.filter(channel_id => channel_id)) {
      await getChannelMessages(channel_id);
    }
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function invokeComponentsFunction(functionName, params) {
  for (const { filename, instance } of LOADED_COMPONENTS.filter(({ instance }) => instance[functionName])) {
    try {
      await instance[functionName](params);
    }
    catch ({ stack }) {
      Logger.Error(`${filename} ${functionName} threw an uncaught error`);
      Logger.Error(filename, stack);
    }
  }
}

client.login(login_token);
