# Cat Facts Scheduler

Thanks for signing up for Cat Facts! You will now receive fun daily facts about CATS! 🐱

Example facts about cats:

- _"Cats have the largest eyes of any mammal."_
- _"A cat can sprint at about thirty-one miles per hour."_
- _"Like humans, cats tend to favor one paw over another."_
- _"Cats only sweat through their paws and nowhere else on their body."_

## Script — [cat_facts_scheduler_script.js](cat_facts_scheduler_script.js)

This script runs every morning and fetches the [catfact.ninja API](https://catfact.ninja/) to send a new cat fact to each Discord channel. If todays schedule was missed when the bot was offline then a new cat fact will be sent on startup.

_Note: The [catfact.ninja API](https://catfact.ninja/) could use better data sanitization. It would be nice to dump the API responses into this modules config and pre-process them with a local LLM to fix grammatical errors and remove duplicate facts of different phrasing._

## Config — [cat_facts_scheduler_config.json](cat_facts_scheduler_config.json)

| Key                          | Value                                                     | Required |
| ---------------------------- | --------------------------------------------------------- | -------- |
| `"announcement_channel_ids"` | The Discord channel IDs that will be sent daily cat facts | ✔        |
