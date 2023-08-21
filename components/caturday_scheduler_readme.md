# Caturday Scheduler

Welcome to Caturday, your Saturday fix of cute pet pics! 🐾📸

## Script — [caturday_scheduler_script.js](caturday_scheduler_script.js)

This script runs every Saturday morning and sends a new picture to the Discord channel. If today is Saturday and the schedule was missed when the bot was offline then a new message will be sent on startup.

## Config — [caturday_scheduler_config.json](caturday_scheduler_config.json)

| Key                         | Value                                                      | Required |
| --------------------------- | ---------------------------------------------------------- | -------- |
| `"announcement_channel_id"` | The Discord channel ID that will be sent Caturday pictures | ✔        |
| `"remove_button_role_id"`   | The Discord role ID permitted to delete Caturday pictures  | ✔        |
