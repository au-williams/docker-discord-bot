import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, SlashCommandBuilder } from "discord.js";
import { Cron } from "croner";
import { filterChannelMessages, findChannelMessage } from "../index.js";
import { Logger } from "../logger.js";
import { State } from "../state.js";
import date from 'date-and-time';
import fs from "fs-extra";
import randomItem from "random-item";

const {
  announcement_channel_id,
  remove_button_role_id
} = fs.readJsonSync("./components/caturday_scheduler_config.json");

// ----------------------- //
// Interaction definitions //
// ----------------------- //

export const COMMAND_INTERACTIONS = [{
  name: "caturday",
  description: "Privately shows a file selector to submit uploaded pictures for #caturday 🐱",
  onInteractionCreate: ({ interaction }) => onCommandInteraction({ interaction })
}]

export const COMPONENT_INTERACTIONS = [
  { customId: "CATURDAY_OLDER_BUTTON", onInteractionCreate: ({ interaction }) => onOlderButtonInteraction({ interaction }) },
  { customId: "CATURDAY_NEWER_BUTTON", onInteractionCreate: ({ interaction }) => onNewerButtonInteraction({ interaction }) },
  { customId: "CATURDAY_SELECT_BUTTON", onInteractionCreate: ({ interaction }) => onSelectButtonInteraction({ interaction }) },
  { customId: "CATURDAY_REMOVE_BUTTON", onInteractionCreate: ({ interaction }) => onRemoveButtonInteraction({ interaction }), requiredRoleIds: [remove_button_role_id] }
]

export const onClientReady = async ({ client }) => {
  const onError = ({ stack }) => Logger.Error(stack, "caturday_scheduler_script.js");
  const cron = Cron("0 9 * * SAT", { catch: onError }, async job => {
    Logger.Info(`Triggered job pattern "${job.getPattern()}"`);
    const channel = await client.channels.fetch(announcement_channel_id);
    const channelMessages = await filterChannelMessages(announcement_channel_id, message => getPictureUrlsFromMessage(message).length);
    const channelMessagesPictureUrls = channelMessages.map(message => getPictureUrlsFromMessage(message)[0]);
    const stateMessages = await State.filter("caturday", message => getPictureUrlsFromMessage(message).length);
    const stateMessagesPictureUrls = stateMessages.map(message => getPictureUrlsFromMessage(message)[0]);

    const getLeastFrequentUrls = () => {
      const frequency = {};
      for (const url of channelMessagesPictureUrls) frequency[url] = (frequency[url] || 0) + 1;
      const min = Math.min(...Object.values(frequency));
      const result = [];
      for (const [url, freq] of Object.entries(frequency)) if (freq === min) result.push(url);
      return result;
    }

    // get a collection of state URLs that have been sent the least
    const potentialPictureUrls = stateMessagesPictureUrls.some(url => !channelMessagesPictureUrls.includes(url))
      ? stateMessagesPictureUrls.filter(url => !channelMessagesPictureUrls.includes(url))
      : getLeastFrequentUrls();

    // get a collection of embeds from the least posted state URLs
    const potentialEmbeds = stateMessages
      .filter(message => potentialPictureUrls.includes(getPictureUrlsFromMessage(message)[0]))
      .map(({ embeds }) => embeds);

    const randomEmbed = randomItem(potentialEmbeds)[0];
    const sourceChannelId = randomEmbed.data.author.url.split("/").slice(-2)[0];
    const sourceChannelMessageId = randomEmbed.data.author.url.split("/").slice(-1)[0];
    const sourceChannelMessageAuthor = await findChannelMessage(sourceChannelId, ({ id }) => id === sourceChannelMessageId).then(({ author }) => author);
    const sourceChannelMessageMember = await channel.guild.members.fetch(sourceChannelMessageAuthor.id); // this is sometimes null - thanks, Discord API!
    const iconURL = (sourceChannelMessageMember ?? sourceChannelMessageAuthor).displayAvatarURL();
    const name = sourceChannelMessageMember?.displayName ?? sourceChannelMessageAuthor.username;
    const text = "Happy Caturday! 🐱";
    const embedBuilder = EmbedBuilder.from(randomEmbed).setAuthor({ iconURL, name }).setFooter({ text });
    await channel.send({ embeds: [embedBuilder] });
    Logger.Info(`Sent caturday message to ${channel.guild.name} #${channel.name}`);
    Logger.Info(`Scheduled next job on "${date.format(job.nextRun(), "YYYY-MM-DDTHH:mm")}"`);
  });

  const now = new Date();
  const today9am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
  const lastChannelMessage = await findChannelMessage(announcement_channel_id, ({ author }) => author.id === client.user.id);
  const isMissedJob = now.getDay() === 6 && now.getHours() >= 9 && (lastChannelMessage ? lastChannelMessage.createdAt < today9am : true);
  if (isMissedJob) cron.trigger();
};

// ------------------- //
// Component functions //
// ------------------- //

async function onCommandInteraction({ interaction }) {
  try {
    await interaction.deferReply({ ephemeral: true });
    const messageWithNestedUrl = await findChannelMessage(interaction.channel.id, message => !message.author.bot && getPictureUrlsFromMessage(message).length);
    const nestedUrls = messageWithNestedUrl && getPictureUrlsFromMessage(messageWithNestedUrl);

    if (!nestedUrls) {
      await interaction.editReply({ content: "I couldn't find any message attachments in this channel." });
      return;
    }

    const components = await getPictureSelectReplyComponents({ interaction, nestedUrlIndex: nestedUrls.length - 1, nextSourceChannelMessage: messageWithNestedUrl })
    const content = `Select a picture from this channel to be included in <#${announcement_channel_id}>`;
    const embeds = await getPictureSelectReplyEmbeds({ message: messageWithNestedUrl, url: nestedUrls[nestedUrls.length - 1] });
    await interaction.editReply({ components, content, embeds });
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function onOlderButtonInteraction({ interaction }) {
  try {
    await interaction.deferUpdate();

    const channelMessages = await filterChannelMessages(interaction.channel.id, ({ author }) => !author.bot);
    const sourceChannelMessageIndex = channelMessages.map(({ url }) => url).indexOf(interaction.message.embeds[0].author.url);

    const interactionEmbedImageUrl = getPictureUrlsFromMessage(interaction.message)[0];
    const sourceChannelMessageAttachmentIndex = getPictureUrlsFromMessage(channelMessages[sourceChannelMessageIndex]).indexOf(interactionEmbedImageUrl);

    const nextSourceChannelMessage = sourceChannelMessageAttachmentIndex > 0
      ? channelMessages[sourceChannelMessageIndex] // source message has more attachments so don't find an older message
      : channelMessages.find((message, index) => index > sourceChannelMessageIndex && getPictureUrlsFromMessage(message).length);

    const nextSourceChannelMessagePictureUrls = getPictureUrlsFromMessage(nextSourceChannelMessage);
    const nextEmbedImageUrlIndex = (sourceChannelMessageAttachmentIndex > 0 ? sourceChannelMessageAttachmentIndex : nextSourceChannelMessagePictureUrls.length) - 1;
    const nextEmbedImageUrl = nextSourceChannelMessagePictureUrls[nextEmbedImageUrlIndex];

    const embeds = await getPictureSelectReplyEmbeds({ message: nextSourceChannelMessage, url: nextEmbedImageUrl });
    const components = await getPictureSelectReplyComponents({ interaction, nestedUrlIndex: nextEmbedImageUrlIndex, nextSourceChannelMessage });
    await interaction.editReply({ components, embeds });
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function onNewerButtonInteraction({ interaction }) {
  try {
    await interaction.deferUpdate();

    const channelMessages = await filterChannelMessages(interaction.channel.id, ({ author }) => !author.bot);
    const sourceChannelMessageIndex = channelMessages.map(message => message.url).indexOf(interaction.message.embeds[0].author.url);

    const interactionEmbedImageUrl = getPictureUrlsFromMessage(interaction.message)[0];
    const sourceChannelMessageAttachmentIndex = getPictureUrlsFromMessage(channelMessages[sourceChannelMessageIndex]).indexOf(interactionEmbedImageUrl);

    const getNewerChannelMessage = () => channelMessages[channelMessages.reduce((total, current, index) => {
      const isUrlMessage = getPictureUrlsFromMessage(current).length;
      const isNewerMessage = index < sourceChannelMessageIndex;
      const isFurtherIndex = index > total; // we want the largest index possible
      if (isUrlMessage && isNewerMessage && isFurtherIndex) return total = index;
      else return total;
    }, 0)];

    const nextSourceChannelMessage = sourceChannelMessageAttachmentIndex === getPictureUrlsFromMessage(channelMessages[sourceChannelMessageIndex]).length - 1
      ? getNewerChannelMessage()
      : channelMessages[sourceChannelMessageIndex];

    const nextSourceChannelMessagePictureUrls = getPictureUrlsFromMessage(nextSourceChannelMessage);
    const nextEmbedImageUrlIndex = nextSourceChannelMessage.id === channelMessages[sourceChannelMessageIndex].id ? sourceChannelMessageAttachmentIndex + 1 : 0;
    const nextEmbedImageUrl = nextSourceChannelMessagePictureUrls[nextEmbedImageUrlIndex];

    const embeds = await getPictureSelectReplyEmbeds({ message: nextSourceChannelMessage, url: nextEmbedImageUrl });
    const components = await getPictureSelectReplyComponents({ interaction, nestedUrlIndex: nextEmbedImageUrlIndex, nextSourceChannelMessage: nextSourceChannelMessage });
    await interaction.editReply({ components, embeds });
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function onSelectButtonInteraction({ interaction }) {
  try {
    await interaction.deferUpdate();

    const components = [ActionRowBuilder.from(interaction.message.components[0])];
    components[0].components[0].setDisabled(true);
    components[0].components[1].setDisabled(true);
    components[0].components[2].setDisabled(true);
    await interaction.editReply({ components });

    const interactionEmbedImageUrl = getPictureUrlsFromMessage(interaction.message)[0];
    const sourceChannelMessageId = interaction.message.embeds[0].author.url.split("/").slice(-1)[0];
    const sourceChannelMessage = await findChannelMessage(interaction.channel.id, ({ id }) => id === sourceChannelMessageId);

    const exists = await State.find("caturday", message => getPictureUrlsFromMessage(message).includes(interactionEmbedImageUrl));
    const success = !exists && await State.add("caturday", { embeds: await getPictureSelectReplyEmbeds({ message: sourceChannelMessage, url: interactionEmbedImageUrl }) });

    if (success) {
      await interaction.followUp({ content: `${sourceChannelMessage.url} was added to <#${announcement_channel_id}>!`, ephemeral: true });
    }

    await interaction.editReply({
      components: await getPictureSelectReplyComponents({
        interaction,
        nestedUrlIndex: getPictureUrlsFromMessage(sourceChannelMessage).indexOf(interactionEmbedImageUrl),
        nextSourceChannelMessage: sourceChannelMessage
      })
    });
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function onRemoveButtonInteraction({ interaction }) {
  try {
    await interaction.deferUpdate();

    const components = [ActionRowBuilder.from(interaction.message.components[0])];
    components[0].components[0].setDisabled(true);
    components[0].components[1].setDisabled(true);
    components[0].components[2].setDisabled(true);
    await interaction.editReply({ components });

    const interactionEmbedImageUrl = getPictureUrlsFromMessage(interaction.message)[0];
    const sourceChannelMessageId = interaction.message.embeds[0].author.url.split("/").slice(-1)[0];
    const sourceChannelMessage = await findChannelMessage(interaction.channel.id, ({ id }) => id === sourceChannelMessageId);

    const exists = await State.find("caturday", message => getPictureUrlsFromMessage(message).includes(interactionEmbedImageUrl));
    const success = exists && await State.remove("caturday", message => getPictureUrlsFromMessage(message).includes(interactionEmbedImageUrl));

    if (success) {
      await interaction.followUp({ content: `${sourceChannelMessage.url} was removed from <#${announcement_channel_id}>.`, ephemeral: true });
    }

    await interaction.editReply({
      components: await getPictureSelectReplyComponents({
        interaction,
        nestedUrlIndex: getPictureUrlsFromMessage(sourceChannelMessage).indexOf(interactionEmbedImageUrl),
        nextSourceChannelMessage: sourceChannelMessage
      })
    });
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

function getPictureUrlsFromMessage({ attachments, embeds }) {
  try {
    const isDiscordUrl = url => typeof url === "string" && (url.includes("cdn.discordapp.com") || url.includes("media.discordapp.net"));
    const nestedPictureUrls = [];

    if (attachments.size) {
      const imageAttachments = attachments.filter(({ contentType }) => contentType.includes("image"));
      nestedPictureUrls.push(...imageAttachments.map(({ url }) => url));
    }

    if (embeds.length) {
      const imageEmbeds = embeds.filter(({ data }) => isDiscordUrl(data?.image?.url));
      if (imageEmbeds.length) nestedPictureUrls.push(...imageEmbeds.map(({ data }) => data.image.url));

      const thumbnailEmbeds = embeds.filter(({ data }) => data?.type?.includes("image") && isDiscordUrl(data?.thumbnail?.url));
      if (thumbnailEmbeds.length) nestedPictureUrls.push(...thumbnailEmbeds.map(({ data }) => data.thumbnail.url));
    }

    return [...new Set(nestedPictureUrls)];
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function getPictureSelectReplyComponents({ interaction, nestedUrlIndex, nextSourceChannelMessage }) {
  try {
    const components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("_").setLabel("_").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("CATURDAY_OLDER_BUTTON")
          .setLabel("← Older Picture")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("CATURDAY_NEWER_BUTTON")
          .setLabel("Newer Picture →")
          .setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
         new StringSelectMenuBuilder()
           .setCustomId("starter")
           .setPlaceholder("Make a selection!")
      )
    ];

    const nextSourceChannelMessageImageUrl = getPictureUrlsFromMessage(nextSourceChannelMessage)[nestedUrlIndex];
    const nextSourceChannelMessageImageUrlExists = await State.find("caturday", message => getPictureUrlsFromMessage(message).includes(nextSourceChannelMessageImageUrl));

    components[0].components[0]
      .setCustomId(`CATURDAY_${(nextSourceChannelMessageImageUrlExists ? "REMOVE" : "SELECT")}_BUTTON`)
      .setDisabled(false)
      .setLabel(`${(nextSourceChannelMessageImageUrlExists ? "Remove" : "Select")} Picture`)
      .setStyle(nextSourceChannelMessageImageUrlExists ? ButtonStyle.Danger : ButtonStyle.Success);

    const channelMessages = await filterChannelMessages(interaction.channel.id, ({ author }) => !author.bot);
    const nextSourceChannelMessageIndex = channelMessages.map(({ id }) => id).indexOf(nextSourceChannelMessage.id);

    const olderChannelMessageWithUrlExists = channelMessages.some((item, index) => index > nextSourceChannelMessageIndex && getPictureUrlsFromMessage(item).length);
    const olderChannelMessageAttachmentExists = nestedUrlIndex > 0;
    components[0].components[1].setDisabled(!olderChannelMessageWithUrlExists && !olderChannelMessageAttachmentExists);

    const newerChannelMessageWithUrlExists = channelMessages.some((item, index) => index < nextSourceChannelMessageIndex && getPictureUrlsFromMessage(item).length);
    const newerChannelMessageAttachmentExists = nestedUrlIndex < getPictureUrlsFromMessage(channelMessages[nextSourceChannelMessageIndex]).length - 1;
    components[0].components[2].setDisabled(!newerChannelMessageWithUrlExists && !newerChannelMessageAttachmentExists);

    const members = await interaction.guild.members.fetch();

    const options = members.map(member => new StringSelectMenuOptionBuilder()
      .setDescription(member.user.username)
      .setDefault(member.user.id === nextSourceChannelMessage.author.id)
      .setLabel(member.nickname || member.user.username)
      .setValue(member.user.username));

    components[1].components[0].setOptions(options);

    return components;
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}

async function getPictureSelectReplyEmbeds({ message, url }) {
  try {
    const { author, member } = message;
    const embeds = [new EmbedBuilder().setImage(url)];
    embeds[0].setAuthor({ iconURL: author.displayAvatarURL(), name: member?.nickname ?? author.username, url: message.url });
    return embeds;
  }
  catch({ stack }) {
    Logger.Error(stack);
  }
}
