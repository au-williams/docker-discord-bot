import { getAverageColorFromUrl } from "../shared/helpers/utilities.js";
import Config from "../shared/config.js";
import Logger from "../shared/logger.js";

const config = new Config("discord_guild_role_color_manager_config.json");
const logger = new Logger("discord_guild_role_color_manager_script.js");

// ------------------------------------------------------------------------- //
// >> DISCORD EVENT HANDLERS                                              << //
// ------------------------------------------------------------------------- //

/**
 * Initialize the plugin and evaluate all member roles to catch up on any changes
 * @param {Object} param
 * @param {Client} param.client
 */
export const onClientReady = async ({ client }) => {
  try {
    await config.initialize(client);
    await logger.initialize(client);

    for (const guild of [...client.guilds.cache.values()]) {
      // verify the guild is not excluded
      if (config.discord_excluded_guild_ids.includes(guild.id)) continue;

      for (const member of [...(await guild.members.fetch()).values()]) {
        // verify the user is not excluded
        if (config.discord_excluded_user_ids.includes(member.user.id)) continue;

        // execute updating the members guild roles
        const { hex } = await getAverageColorFromUrl(member.displayAvatarURL());
        const whitelistRole = await createAssignNewGuildRole(client, hex, member);
        await deleteUnassignGuildRoles(member, whitelistRole);
      }
    }
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Update the members role when they join the server
 * @param {Object} param
 * @param {Client} param.client
 * @param {GuildMember} param.member
 */
export const onGuildMemberAdd = async ({ client, member }) => {
  try {
    // verify the guild is not excluded
    if (config.discord_excluded_guild_ids.includes(member.guild.id)) return;

    // verify the user is not excluded
    if (config.discord_excluded_user_ids.includes(member.user.id)) return;

    // execute updating the members guild roles
    const { hex } = await getAverageColorFromUrl(member.displayAvatarURL());
    await createAssignNewGuildRole(client, hex, member);
  }
  catch(e) {
    logger.error(e);
  }
}

/**
 * Update a users role across guilds if their avatar has been updated
 * @param {Object} param
 * @param {Client} param.client
 * @param {User} param.oldUser
 * @param {User} param.newUser
 */
export const onUserUpdate = async ({ client, oldUser, newUser }) => {
  try {
    // verify the user is not excluded
    if (config.discord_excluded_user_ids.includes(newUser.id)) return;

    // verify the users avatar was updated
    const oldUserDisplayAvatarURL = oldUser.displayAvatarURL();
    const newUserDisplayAvatarURL = newUser.displayAvatarURL();
    if (oldUserDisplayAvatarURL === newUserDisplayAvatarURL) return;

    // get the hex color of their profile picture
    const { hex } = await getAverageColorFromUrl(newUserDisplayAvatarURL);

    for (const guild of [...client.guilds.cache.values()]) {
      // verify the guild is not excluded
      if (config.discord_excluded_guild_ids.includes(guild.id)) continue;

      // verify the member exists in the guild
      const member = await guild.members.fetch(newUser.id);
      if (!member) continue;

      // execute updating the members guild roles
      const whitelistRole = await createAssignNewGuildRole(client, hex, member);
      await deleteUnassignGuildRoles(member, whitelistRole);
    }
  }
  catch(e) {
    logger.error(e);
  }
}

// ------------------------------------------------------------------------- //
// >> PLUGIN FUNCTIONS                                                    << //
// ------------------------------------------------------------------------- //

/**
 * If the hex role named after its value doesn't exist ('#FFFFFF') then create it.
 * If the hex role isn't assigned to the guild member then assign it to them.
 * @param {Client} client
 * @param {String} hex
 * @param {GuildMember} member
 * @returns {GuildRole}
 */
async function createAssignNewGuildRole(client, hex, member) {
  try {
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
  catch(e) {
    logger.error(e);
  }
}

/**
 * Unassign all hex roles ('#FFFFFF') from the member besides the whitelist role.
 * If the unassigned role has no other assigned members delete it from the guild.
 * @param {Member} member
 * @param {Role} whitelistRole
 */
async function deleteUnassignGuildRoles(member, whitelistRole) {
  try {
    for (const role of [...member.roles.cache.values()].filter(({ name }) => name !== whitelistRole?.name)) {
      if (!/^#([A-Fa-f0-9]{6})$/.test(role.name)) continue;
      if (role.members.size == 1) await role.delete();
      else await member.roles.remove(role);
    }
  }
  catch(e) {
    logger.error(e);
  }
}

// ------------------------------------------------------------------------- //
// >> CODE GRAVEYARD o7                                                   << //
// ------------------------------------------------------------------------- //

// deprecated because Discord API doesn't call onGuildMemberUpdate (which would have been convenient)
// ...
// export const onGuildMemberUpdate = async ({ client, oldMember, newMember }) => {
//   try {
//     if (config.discord_excluded_user_ids.includes(newMember.user.id)) return;

//     // update the role color if the avatar has been updated
//     const oldMemberDisplayAvatarURL = oldMember.displayAvatarURL();
//     const newMemberDisplayAvatarURL = newMember.displayAvatarURL();
//     if (oldMemberDisplayAvatarURL === newMemberDisplayAvatarURL) return;

//     const { hex } = await getAverageColorFromUrl(newMemberDisplayAvatarURL);
//     const whitelistRole = await createAssignNewGuildRole(client, hex, newMember);
//     await deleteUnassignGuildRoles(newMember, whitelistRole);
//   }
//   catch(e) {
//     logger.error(e);
//   }
// }
