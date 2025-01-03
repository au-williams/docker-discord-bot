import { Config } from "../services/config.js";
import { Events } from "discord.js";
import { Logger } from "../services/logger.js";
import { Utilities } from "../services/utilities.js";

const config = new Config(import.meta.filename);
const logger = new Logger(import.meta.filename);

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region EMITTER.JS LISTENERS                                              //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * The event listeners handled by this script. The key is a Discord event or an
 * interaction property from the `Interactions<object>` variable. The value is
 * a `Listener` object and requires a function to be set. Listeners that only
 * set a function can use the function as the value and it will be wrapped in
 * a Listener by the framework for you automatically. When the key is emitted
 * by Discord then the value will be executed. You may use an array to define
 * multiple Listeners for a single key.
 */
export const Listeners = Object.freeze({
  [Events.ClientReady]: checkAndUpdateMemberRoles,
  [Events.GuildMemberAdd]: onGuildMemberAdd,
  [Events.GuildMemberUpdate]: onGuildMemberUpdate,
  [Events.UserUpdate]: onUserUpdate,
});

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS LISTENERS                                           //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region PLUGIN LOGIC                                                      //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * Initialize the plugin and evaluate all member roles to catch up on any changes
 * @async
 * @param {object} param
 * @param {Client} param.client
 * @param {Listener} param.listener
 */
async function checkAndUpdateMemberRoles({ client, listener }) {
  let validatedGuildCount = 0;
  let validatedMemberCount = 0;

  for (const guild of [...client.guilds.cache.values()]) {
    // verify the guild is not excluded
    if (config.discord_excluded_guild_ids.includes(guild.id)) continue;
    validatedGuildCount += 1;

    for (const member of [...(await guild.members.fetch()).values()]) {
      // verify the user is not excluded
      if (member.user.id === client.user.id) continue;
      validatedMemberCount += 1;

      // execute updating the members guild roles
      const hex = await Utilities.getVibrantColorFromUrl(member.displayAvatarURL());
      const newGuildRole = await createAssignNewGuildRole(client, hex, member);
      if (newGuildRole) await deleteUnassignGuildRoles(member, newGuildRole);
    }
  }

  const checksLabel = Utilities.getPluralizedString("check", validatedMemberCount);
  const membersLabel = Utilities.getPluralizedString("member", validatedMemberCount);
  const guildsLabel = Utilities.getPluralizedString("guild", validatedGuildCount);

  // logger.info(`Validated member ${rolesLabel} for ${validatedMemberCount} ${membersLabel} in ${validatedGuildCount} ${guildsLabel}.`, listener);
  logger.info(`Completed guild member role ${checksLabel} for ${validatedMemberCount} ${membersLabel} in ${validatedGuildCount} ${guildsLabel}.`, listener);
}

/**
 * Update the members role when they join the server
 * @param {object} param
 * @param {Client} param.client
 * @param {GuildMember} param.member
 */
export async function onGuildMemberAdd({ client, member }) {
  // verify the guild is not excluded
  if (config.discord_excluded_guild_ids.includes(member.guild.id)) return;

  // verify the user is not excluded
  if (member.user.id === client.user.id) return;

  // execute updating the members guild roles
  const hex = await Utilities.getVibrantColorFromUrl(member.displayAvatarURL());
  await createAssignNewGuildRole(client, hex, member);
}

/**
 * Update a members role if their server avatar has been updated
 * @param {object} param
 * @param {Client} param.client
 * @param {GuildMember} param.oldMember
 * @param {GuildMember} param.newMember
 */
export async function onGuildMemberUpdate({ client, oldMember, newMember }) {
  // verify the user is not excluded
  if (newMember.user.id === client.user.id) return;

  // verify the members server avatar was updated
  const oldMemberDisplayAvatarURL = oldMember.displayAvatarURL();
  const newMemberDisplayAvatarURL = newMember.displayAvatarURL();
  if (oldMemberDisplayAvatarURL === newMemberDisplayAvatarURL) return;

  // get the hex color of their avatar
  const hex = await Utilities.getVibrantColorFromUrl(newMemberDisplayAvatarURL);

  // execute updating the members guild roles
  const whitelistRole = await createAssignNewGuildRole(client, hex, newMember);
  if (whitelistRole) await deleteUnassignGuildRoles(newMember, whitelistRole);
}

/**
 * Update a users role across guilds if their avatar has been updated
 * @param {object} param
 * @param {Client} param.client
 * @param {User} param.oldUser
 * @param {User} param.newUser
 */
export async function onUserUpdate({ client, oldUser, newUser }) {
  // verify the user is not excluded
  if (config.discord_excluded_user_ids.includes(newUser.id)) return;

  // verify the users avatar was updated
  const oldUserDisplayAvatarURL = oldUser.displayAvatarURL();
  const newUserDisplayAvatarURL = newUser.displayAvatarURL();
  if (oldUserDisplayAvatarURL === newUserDisplayAvatarURL) return;

  // get the hex color of their avatar
  const hex = await Utilities.getVibrantColorFromUrl(newUserDisplayAvatarURL);

  for (const guild of [...client.guilds.cache.values()]) {
    // verify the guild is not excluded
    if (config.discord_excluded_guild_ids.includes(guild.id)) continue;

    // verify the member exists in the guild
    const member = await guild.members.fetch(newUser.id);
    if (!member) continue;

    // execute updating the members guild roles
    const whitelistRole = await createAssignNewGuildRole(client, hex, member);
    if (whitelistRole) await deleteUnassignGuildRoles(member, whitelistRole);
  }
}

/**
 * If the hex role named after its value doesn't exist ('#FFFFFF') then create
 * it. And if the hex role isn't assigned to the guild member then assign it.
 * @param {Client} client
 * @param {string} hex
 * @param {GuildMember} member
 * @returns {GuildRole}
 */
async function createAssignNewGuildRole(client, hex, member) {
  if (member.guild.roles.cache.size === 250) {
    logger.warn(`Maximum of 250 roles has been reached in ${member.guild.name}.`);
    return;
  }

  // find the existing guild role for this hex ('#FFFFFF')
  const findRole = ({ name }) => name === hex.toUpperCase();
  let role = member.guild.roles.cache.find(findRole);

  // create the guild role if it doesn't exist
  if (!role) {
    role = await member.guild.roles.create({ color: hex, name: hex.toUpperCase(), reason: logger.filename });
    logger.info(`Created role '${role.name}' in ${member.guild.name} for ${member.displayName}`);

    // bots are only allowed to set role positions less than their own highest positioned role
    const { roles } = await member.guild.members.fetch(client.user);
    const positions = roles.cache.map(({ position }) => position);
    await role.setPosition(Math.max(...positions) - 1);
  }

  // assign the guild role if it's unassigned
  if (!member.roles.cache.find(findRole)) {
    await member.roles.add(role);
  }

  return role;
}

/**
 * Unassign all hex roles ('#FFFFFF') from the member besides the whitelist role.
 * If the unassigned role has no other assigned members delete it from the guild.
 * @param {Member} member
 * @param {Role} whitelistRole
 */
async function deleteUnassignGuildRoles(member, whitelistRole) {
  for (const role of [...member.roles.cache.values()].filter(({ name }) => name !== whitelistRole?.name)) {
    if (!/^#([A-Fa-f0-9]{6})$/.test(role.name)) continue;
    if (role.members.size == 1) await role.delete();
    else await member.roles.remove(role);
  }
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion PLUGIN LOGIC                                                   //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
