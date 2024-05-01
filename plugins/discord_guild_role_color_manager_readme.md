# Discord Guild Role Color Manager

## Script — [discord_guild_role_color_manager_script.js](discord_guild_role_color_manager_script.js)

This script creates a guild role for each members average profile picture color and assigns it to them. When their profile picture is updated a new role will be made and the old role deleted.

## Config — [discord_guild_role_color_manager_config.json](discord_guild_role_color_manager_config.json)

| Key                            | Value                                                          | Required |
| ------------------------------ | -------------------------------------------------------------- | -------- |
| `"discord_excluded_guild_ids"` | The array of Discord guild IDs this plugin will not execute in | ✖        |
| `"discord_excluded_user_ids"`  | The array of Discord user IDs this plugin will not execute for | ✖        |
