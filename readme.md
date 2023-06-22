# discord-bot

## Starting the bot

`node --no-warnings=ExperimentalWarning .\index.js`

This command suppresses warnings for experimental JSON module imports, buffer.File, etc.

## Editing bot modules

`index.js` handles [discord.js events](https://old.discordjs.dev/#/docs/discord.js/14.9.0/typedef/Events) and calls the corresponding function names in `./bot_modules/` JavaScript files. Simply creating a JavaScript file in that folder is enough for it to run. You _should_ add config and readme files too but they're not required.
