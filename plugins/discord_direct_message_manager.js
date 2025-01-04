import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Events, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from "discord.js";
import { Config } from "../services/config.js";
import { Emitter } from "../services/emitter.js";
import { Logger } from "../services/logger.js";
import { Messages } from "../services/messages.js";
import { Utilities } from "../services/utilities.js";
import date from "date-and-time";
import Listener from "../entities/Listener.js";
import meridiem from "date-and-time/plugin/meridiem";
date.plugin(meridiem);

// TODO: Lowest priority, send if no message was sent (obj to json, check if contains?)
// TODO: Context menu command

// TODO: This should send messages received while offline

const config = new Config(import.meta.filename);
const logger = new Logger(import.meta.filename);

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region EMITTER.JS IMPORTS                                                //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

export const Interactions = Object.freeze({
  ButtonComponentHideMessage: "DM_MANAGER_BUTTON_COMPONENT_HIDE_MESSAGE",
  ButtonComponentSendReply: "DM_MANAGER_BUTTON_COMPONENT_SEND_REPLY",
  ModalSubmitSendReply: "DM_MANAGER_MODAL_SUBMIT_SEND_REPLY",
});

export const Listeners = Object.freeze({
  [Events.MessageCreate]: new Listener()
    .setFunction(onDirectMessageCreate)
    .setRequiredChannelType(ChannelType.DM),
  [Interactions.ButtonComponentHideMessage]: new Listener()
    .setDescription("Hides / deletes the message from your direct messages.")
    .setFunction(({ interaction, listener }) => interaction.message.delete().catch(error => logger.error(error, listener)))
    .setRequiredChannelType(ChannelType.DM),
  [Interactions.ButtonComponentSendReply]: new Listener()
    .setDescription("Sends a reply as the bot to the message author.")
    .setEnabled(Messages.isServiceEnabled)
    .setFunction(onButtonComponentSendReply)
    .setRequiredChannelType(ChannelType.DM),
  [Interactions.ModalSubmitSendReply]: new Listener()
    .setFunction(onModalSubmitSendReply)
});

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS IMPORTS                                             //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region PLUGIN COMPONENTS                                                 //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

const hideMessageButton = new ButtonBuilder()
  .setCustomId(Interactions.ButtonComponentHideMessage)
  .setEmoji("🧹")
  .setLabel("Hide message")
  .setStyle(ButtonStyle.Secondary);

const sendReplyButton = new ButtonBuilder()
  .setCustomId(Interactions.ButtonComponentSendReply)
  .setEmoji("📬")
  .setLabel("Send reply")
  .setStyle(ButtonStyle.Success);

const replyTextInput = new TextInputBuilder()
  .setCustomId("content")
  .setLabel("Message content")
  .setRequired(true)
  .setStyle(TextInputStyle.Paragraph);

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN COMPONENTS                                              //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region PLUGIN LOGIC                                                      //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * Send the direct message contents to the bot admins on message create.
 * @param {object} param
 * @param {Client} param.client
 * @param {Listener} param.listener
 * @param {Message} param.message
 */
async function onDirectMessageCreate({ client, listener, message }) {
  if (message.attachments.size) return; // Image DMs are handled by Caturday
  if (config.discord_bot_admin_user_ids.includes(message.author.id)) return;
  if (client.user.id === message.author.id) return;

  const iconURL = message.author.displayAvatarURL();
  const id = message.author.id;
  const createdAtDate = new Date(message.createdAt);
  const name = date.format(createdAtDate, "M/D/YYYY h:mm AA").replaceAll(".", "")

  const embeds = [new EmbedBuilder()
    .setAuthor({ iconURL, name, url: `https://discordapp.com/users/${id}` })
    .setColor((await Utilities.getVibrantColorFromUrl(iconURL)))
    .setDescription(message.content)
  ];

  const components = [new ActionRowBuilder().addComponents(sendReplyButton, hideMessageButton, Emitter.moreInfoButton)];
  const content = `${message.author} [**sent a direct message.**](${message.url})`;

  config.discord_bot_admin_user_ids.forEach(userId =>
    client.users.cache.get(userId)
      .send({ components, content, embeds })
      .then(result => Utilities.LogPresets.SentMessage(result, listener))
      .catch(error => logger.error(error, listener))
  );
}

/**
 * Show the send reply modal when the send reply button is pressed.
 * @param {object} param
 * @param {Client} param.client
 * @param {ButtonInteraction} param.interaction
 * @param {Listener} param.listener
 */
async function onButtonComponentSendReply({ client, interaction, listener}) {
  const userId = Utilities.getUserIdFromString(interaction.message.content);
  const user = client.users.cache.get(userId);

  const modal = new ModalBuilder()
    .addComponents(new ActionRowBuilder().addComponents(replyTextInput))
    .setCustomId(Interactions.ModalSubmitSendReply)
    .setTitle(`Send reply to ${user.displayName}`);

  interaction
    .showModal(modal)
    .then(() => Utilities.LogPresets.ShowedModal(interaction, listener))
    .catch(error => logger.error(error, listener));
}

/**
 * Send a reply to the authors DMs when the reply modal is submitted.
 * @param {object} param
 * @param {Client} param.client
 * @param {ModalSubmitInteraction} param.interaction
 * @param {Listener} param.listener
 */
export async function onModalSubmitSendReply({ client, interaction, listener}) {
  await interaction.deferUpdate();

  const content = interaction.fields.getTextInputValue("content")?.trim();
  const userId = Utilities.getUserIdFromString(interaction.message.content);
  const user = client.users.cache.get(userId);

  if (!content) {
    interaction
      .reply({ content: `I can't send ${user.displayName} an empty reply. Try again.`, ephemeral: true })
      .then(result => Utilities.LogPresets.SentReply(result, listener))
      .catch(error => logger.error(error, listener));
    return;
  }

  const messageUrl = Utilities.getLinkFromString(interaction.message.content);
  const message = Messages.get({ messageUrl });

  if (!message) {
    interaction
      .reply({ content: `I can't find the message sent by ${user.displayName} to reply to.`, ephemeral: true })
      .then(result => Utilities.LogPresets.SentReply(result, listener))
      .catch(error => logger.error(error, listener));
    return;
  }

  message
    .reply(content)
    .then(result => Utilities.LogPresets.SentReply(result, listener))
    .catch(error => logger.error(error, listener));

  interaction
    .followUp({ content: `I sent this reply: ${content}`, ephemeral: true })
    .then(result => Utilities.LogPresets.SentFollowUp(result, listener))
    .catch(error => logger.error(error, listener));
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN LOGIC                                                   //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
