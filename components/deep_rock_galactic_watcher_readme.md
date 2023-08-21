# Deep Rock Galactic Watcher

![Image preview](../assets/documentation/deep_rock_galactic_watcher.png)

Get weekly assignment updates for [Deep Rock Galactic](https://store.steampowered.com/app/548430/Deep_Rock_Galactic/). **_Rock and Stone!_** 🍺

## Script — [deep_rock_galactic_watcher_script.js](deep_rock_galactic_watcher_script.js)

This script runs every waking hour and fetches the [DRG API](https://drgapi.com/) to send new weekly assignment to each Discord channel.

## Config — [deep_rock_galactic_watcher_config.json](deep_rock_galactic_watcher_config.json)

| Key                          | Value                                                                    | Required |
| ---------------------------- | ------------------------------------------------------------------------ | -------- |
| `"announcement_channel_ids"` | The Discord channel IDs that will be sent new weekly assignment messages | ✔        |
