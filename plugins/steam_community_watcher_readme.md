# Steam Community Watcher

![Image preview](../assets/documentation/steam_community_watcher.png)

Get notified of [Steam Community](https://steamcommunity.com/) announcements (configurable per game for events, updates, etc).

## Script — [steam_community_watcher_script.js](steam_community_watcher_script.js)

This script runs a Cron job and fetches the [Steamworks Web API](https://partner.steamgames.com/doc/webapi_overview) to send new announcements to each Discord channel.

## Config — [steam_community_watcher_config.json](steam_community_watcher_config.json)

| Key                                      | Value                                                                                                                                                        | Required |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `"announcement_steam_app_ids.app_id"`    | The ID of the Steam game [(instructions on how to find it here)](https://gaming.stackexchange.com/questions/149837/how-do-i-find-the-id-for-a-game-on-steam) | ✔        |
| `"announcement_steam_app_ids.feed_type"` | Filter the type of Steam announcements (`1` is for official announcements)                                                                                   | ✖        |
| `"cron_job_announcement_pattern"`        | The Cron job pattern for this plugin to process announcements                                                                                                | ✔        |
| `"discord_announcement_channel_id"`      | The Discord guild channel ID this plugin will send announcements to                                                                                          | ✔        |
