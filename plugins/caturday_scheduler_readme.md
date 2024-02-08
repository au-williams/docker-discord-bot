# Caturday Scheduler

![Image preview](../assets/documentation/caturday_watcher_announcement.gif)

Caturday sends weekly pet pictures to brighten everyone's weekend.

## Script — [caturday_scheduler_script.js](caturday_scheduler_script.js)

This script runs every Saturday morning and sends a new picture to the Discord channel. If today is Saturday and the schedule was missed when the bot was offline then a new message will be sent on startup.

## Config — [caturday_scheduler_config.json](caturday_scheduler_config.json)

| Key                                 | Value                                                      | Required |
| ----------------------------------- | ---------------------------------------------------------- | -------- |
| `"discord_announcement_channel_id"` | The Discord channel ID that will be sent Caturday pictures | ✔        |
| `"discord_member_role_id"`          | The Discord role ID permitted to delete Caturday pictures  | ✔        |
