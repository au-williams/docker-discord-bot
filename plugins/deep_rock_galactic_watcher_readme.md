# Deep Rock Galactic Watcher

![Image preview](../assets/documentation/deep_rock_galactic_watcher.png)

Get weekly assignment updates for [Deep Rock Galactic](https://store.steampowered.com/app/548430/Deep_Rock_Galactic/). **_"Rock and Stone!"_** 🍺

## Script — [deep_rock_galactic_watcher_script.js](deep_rock_galactic_watcher_script.js)

This script runs a Cron job and fetches the [DRG API](https://drgapi.com/) to send new weekly assignment to each Discord channel.

## Config — [deep_rock_galactic_watcher_config.json](deep_rock_galactic_watcher_config.json)

| Key                                 | Value                                                               | Required |
| ----------------------------------- | ------------------------------------------------------------------- | -------- |
| `"cron_job_announcement_pattern"`   | The Cron job pattern for this plugin to process announcements       | ✔        |
| `"discord_announcement_channel_id"` | The Discord guild channel ID this plugin will send announcements to | ✔        |
