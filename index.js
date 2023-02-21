const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require("discord.js");
const { guilds, token, user_id } = require("./config.json");

const fs = require("fs");
const configFileName = "./config.json";
const configFile = require(configFileName);

const cron = require("cron");
const catFactJob = new cron.CronJob("0 9 * * *", async () => SendCatFact());
catFactJob.start();

async function SendCatFact() {
  const message = await fetch("https://catfact.ninja/fact?max_length=256")
    .then(response => response.json())
    .then(data => data.fact);

  for(const guildId in guilds) {
    const { cat_facts_channel_id } = guilds[guildId];
    const channel = cat_facts_channel_id && client.channels.cache.get(cat_facts_channel_id);
    channel?.send(message)
      .then(_ => Log.Success(`A cat fact was sent to ${channel.guild.name} #${channel.name}!`))
      .catch(e => Log.Warning(`Could not send cat fact to ${channel.guild.name} #${channel.name}! ${e}`))
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

class Log {
  static Pending = message => console.log("\x1b[43m", "PENDING", `\x1b[0m ${message}`);
  static Startup = message => console.log("\x1b[100m", "STARTUP", `\x1b[0m ${message}`);
  static Success = message => console.log("\x1b[42m", "SUCCESS", `\x1b[0m ${message}`);
  static Warning = message => console.warn("\x1b[41m", "WARNING", `\x1b[0m ${message}`);
}

client.on("ready", async () => {
  SendStartupLog();
  await ValidateRoleMessages();
});

const SendStartupLog = () => {
  const username = client.users.cache.get(user_id)?.username;

  Log.Startup(
    `Client "${username}" started` +
      ` with ${client.users.cache.size} user${client.users.cache.size == 1 ? "" : "s"}` +
      ` in ${client.channels.cache.size} channel${client.channels.cache.size == 1 ? "" : "s"}` +
      ` of ${client.guilds.cache.size} guild${client.guilds.cache.size == 1 ? "" : "s"}.`
  );

  if (!username) Log.Warning(`Could not fetch username for user id ${user_id}!`);

  client.guilds.cache.forEach(guild => {
    const configGuildRoleNames = guilds[guild.id].role_message_buttons.map(role => role.role_name);
    const missingGuildRoleNames = configGuildRoleNames.filter(roleName => !guild.roles.cache.some(({ name }) => name === roleName));

    if (missingGuildRoleNames.length) {
      if (missingGuildRoleNames.length == 1) Log.Warning(`The "${missingGuildRoleNames[0]}" role defined in ${configFileName} was not found in ${guild.name}!`);
      else Log.Warning(`The "${missingGuildRoleNames.join('", "')}" roles defined in ${configFileName} were not found in ${guild.name}!`);
    }
  });
};

async function ValidateRoleMessages() {
  for (const guild_id in guilds) {
    const { role_channel_id, role_message_buttons, role_message_content, role_message_id } = guilds[guild_id];
    const channel = client.channels.cache.get(role_channel_id);
    const clientGuild = client.guilds.cache.get(guild_id);
    const message = role_message_id && await channel.messages.fetch(role_message_id).catch(_ => null);

    if (!message) {
      Log.Pending(`The role message for ${clientGuild.name} #${channel.name} was not found and will be resent!`);
      SendRoleMessage(guild_id);
      return;
    }

    const messageButtons = message.components[0].components.map(({ data }) => ({
      role_name: data.custom_id,
      emoji_id: data.emoji?.id
    }));

    const isMessageContentUpdate = message.content !== role_message_content;
    const isMessageButtonsUpdate = role_message_buttons.some((configButton, i) => {
      const { role_name, emoji_id } = messageButtons[i];
      const isRoleNameUpdate = role_name !== configButton.role_name;
      const isEmojiIdUpdate = emoji_id !== configButton.emoji_id && channel.guild.emojis.cache.some(({ id }) => id === configButton.emoji_id);
      return isRoleNameUpdate || isEmojiIdUpdate;
    });

    if (isMessageContentUpdate || isMessageButtonsUpdate) {
      Log.Pending(`The role message for ${clientGuild.name} #${channel.name} has updated and will be resent.`);
      await channel.messages.delete(role_message_id);
      Log.Success(`... The outdated role message was deleted!`);
      SendRoleMessage(guild_id);
      return;
    }

    Log.Success(`The role message in ${clientGuild.name} #${channel.name} channel has been validated.`);
  }
}

async function SendRoleMessage(guildId) {
  const { role_message_buttons, role_channel_id, role_message_content } = guilds[guildId];
  const channel = client.channels.cache.get(role_channel_id);
  const actions = new ActionRowBuilder();

  for (const { role_name, emoji_id } of role_message_buttons) {
    const button = new ButtonBuilder().setCustomId(role_name).setLabel(role_name).setStyle(ButtonStyle.Secondary);
    const isInvalidEmoji = emoji_id && !channel.guild.emojis.cache.some(guildEmoji => guildEmoji.id == emoji_id);
    if (isInvalidEmoji) Log.Warning( `... The emoji_id "${emoji_id}" was not found in ${channel.guild.name}!`);
    else if (emoji_id) button.setEmoji(emoji_id);
    actions.addComponents(button);
  }

  channel.send({ content: role_message_content, components: [actions] }).then(({ content, id }) => {
    Log.Success(`... "${content}" was sent!`);
    configFile.guilds[guildId].role_message_id = id;
    fs.writeFile(configFileName, JSON.stringify(configFile, null, 2), _ => null);
    Log.Success(`... "${id}" was saved to guilds[${guildId}].role_message_id in ${configFileName}!`);
  });
}

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  Log.Pending(`${interaction.member.nickname} pushed the "${interaction.customId}" button in ${interaction.guild.name} #${interaction.channel.name}.`);

  const guildRole = interaction.guild.roles.cache.find(({ name }) => name === interaction.customId);
  if (guildRole === undefined) {
    Log.Warning(`... "${interaction.customId}" is not a role in ${interaction.guild.name}! Operation aborted.`);
    return interaction.deferUpdate();
  }

  const grantedConfigRoles = interaction.member.roles.cache.filter(({ name }) => guilds[interaction.guild.id].role_message_buttons.map(x => x.role_name).includes(name));
  grantedConfigRoles.forEach(memberRole => interaction.member.roles.remove(memberRole)
    .then(_ => Log.Success(`... Their "${memberRole.name}" role was removed!`))
    .catch(e => Log.Warning(`... Their "${memberRole.name}" role was not removed! ${e}`))
  );

  const isAddingMemberRole = !grantedConfigRoles.some(({ name }) => name === guildRole.name);
  if (isAddingMemberRole) interaction.member.roles.add(guildRole)
    .then(_ => Log.Success(`... Their "${guildRole.name}" role was granted!`))
    .catch(e => Log.Warning(`... Their "${guildRole.name}" role was not granted! ${e}`)
  );

  return interaction.deferUpdate();
});

client.login(token);
