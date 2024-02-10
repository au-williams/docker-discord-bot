# Caturday Scheduler

![Image preview](../assets/documentation/caturday_watcher_announcement.gif)

Caturday sends weekly pet pictures to brighten everyone's weekend.

## Script — [caturday_scheduler_script.js](caturday_scheduler_script.js)

This script runs every Saturday morning and sends a new picture to the Discord channel. If today is Saturday and the schedule was missed when the bot was offline then a new message will be sent on startup.

## Config — [caturday_scheduler_config.json](caturday_scheduler_config.json)

| Key                                 | Value                                                               | Required |
| ----------------------------------- | ------------------------------------------------------------------- | -------- |
| `"discord_admin_role_id"`           | The Discord member role ID permitted to delete Caturday pictures    | ✔        |
| `"discord_announcement_channel_id"` | The Discord guild channel ID this plugin will send announcements to | ✔        |

<!-- todo: -->
<!-- | `"cron_job_announcement_pattern"`   | The Cron job pattern for this plugin to process announcements                    | ✔        | -->
