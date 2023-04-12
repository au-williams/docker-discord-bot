# Cat Facts Module

Thanks for signing up for Cat Facts! You will now receive fun daily facts about CATS! 🐱 You cannot unsubscribe.

## Script

This script runs every morning at 0900 and fetches the [catfact.ninja](https://catfact.ninja/) API to send a new cat fact to each channel. Because each channel will have different facts based on age, the uniqueness check runs against every channels message history.

The [catfact.ninja](https://catfact.ninja/) API could use better data sanitization — eventually it would be nice to dump the facts from their API into this modules config file so they can be pre-processed at their source.

## Config

| Key           | Value                                        |
| ------------- | -------------------------------------------- |
| "channel_ids" | The channel IDs that this module will run in |
