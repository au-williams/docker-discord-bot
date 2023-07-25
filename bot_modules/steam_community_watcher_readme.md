# Steam Community Watcher

![Image preview](../assets/documentation/steam_community_watcher.png)

Get notified of [Steam Community](https://steamcommunity.com/) announcements (configurable per game for events, updates, etc).

## Script — `steam_community_watcher_script.js`

This script runs every waking hour and fetches the [Steamworks Web API](https://partner.steamgames.com/doc/webapi_overview) to send new announcements to each Discord channel.

## Config — `steam_community_watcher_config.json`

| Key                           | Value                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"channel_ids"`               | The Discord channel IDs that this module will run in                                                                                                             |
| `"steam_apps.app_id"`         | The ID of the Steam game [(instructions on how to find it here)](https://gaming.stackexchange.com/questions/149837/how-do-i-find-the-id-for-a-game-on-steam) |
| `"steam_apps.feed_type"`      | The announcement feed to restrict results to (`1` is recommended for official announcements)                                                                                                                    |
| `"steam_apps.title_keywords"` | The keywords in a title to restrict results to                                                                                                                   |

`"steam_apps.feed_type"` and `"steam_apps.title_keywords"` are **optional** and are used to filter the API response. Omitting these keys will post all community announcements such as news articles and unofficial marketing that may be considered spam.
