# Cat Facts Scheduler

Thanks for signing up for Cat Facts! You will now receive fun daily facts about CATS! 🐱

Example facts about cats:

- _"Cats have the largest eyes of any mammal."_
- _"A cat can sprint at about thirty-one miles per hour."_
- _"Like humans, cats tend to favor one paw over another."_
- _"Cats only sweat through their paws and nowhere else on their body."_

## Script — [cat_facts_scheduler_script.js](cat_facts_scheduler_script.js)

This script sends a new cat fact from the [catfact.ninja API](https://catfact.ninja/) every morning. If the schedule was missed when the bot was offline then a new cat fact will be sent on startup.

_Note: The [catfact.ninja API](https://catfact.ninja/) has awful data sanitization. API responses can have spelling and grammar mistakes or many duplicate entries. The API has been dumped and fed through ChatGPT to fix most of the problems in bulk._

## Config — [cat_facts_scheduler_config.json](cat_facts_scheduler_config.json)

| Key                                 | Value                                                                            | Required |
| ----------------------------------- | -------------------------------------------------------------------------------- | -------- |
| `"cron_job_pattern"`                | The Cron pattern for this plugins job                                            | ✔        |
| `"discord_announcement_channel_id"` | The Discord guild channel ID this plugin will run in                             | ✔        |
| `"sanitized_catfact_api_responses"` | The sanitized API responses from the [catfact.ninja API](https://catfact.ninja/) | ✔        |
