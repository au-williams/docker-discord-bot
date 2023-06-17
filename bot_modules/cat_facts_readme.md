# Cat Facts Readme

Thanks for signing up for Cat Facts! You will now receive fun daily facts about CATS! 🐱 You cannot unsubscribe.

## Script — `cat_facts_script.js`

This script runs every morning at 0900 and fetches the [catfact.ninja](https://catfact.ninja/) API to send a new cat fact to each Discord channel.

Note: The [catfact.ninja](https://catfact.ninja/) API could use much better data sanitization. It would be nice to dump the API data into this modules config file and pre-process them using a local LLM to fix grammatical errors and remove duplicate facts with different phrasing.

## Config — `cat_facts_config.json`

| Key             | Value                                                |
| --------------- | ---------------------------------------------------- |
| `"channel_ids"` | The Discord channel IDs that this module will run in |
