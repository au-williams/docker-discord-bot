# discord-bot

## Starting the bot

`node --no-warnings=ExperimentalWarning .\index.js`

## Editing bot modules

`Index.js` handles [discord.js events](https://old.discordjs.dev/#/docs/discord.js/14.9.0/typedef/Events) and invokes the corresponding hooks in `./bot_modules/` JavaScript files. Simply creating a JavaScript file in that folder is enough for it to run. You _should_ add config and readme files too but they're not required.
