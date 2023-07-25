# discord-bot

## Starting the bot

```bash
$ node --no-warnings=ExperimentalWarning index.js
```

The `--no-warnings=ExperimentalWarning` parameter suppresses Node.js warnings when using experimental features ([JSON modules](https://nodejs.org/api/esm.html#json-modules), [buffer.File](https://nodejs.org/api/buffer.html#class-file), etc).

## Creating modules

The `index.js` file handles [discord.js events](https://old.discordjs.dev/#/docs/discord.js/14.9.0/typedef/Events) and invokes corresponding function names in `./bot_modules/` JavaScript files. Simply creating a new JavaScript file with an appropriately named function is enough for it to execute — but you ***should*** add its associated config and readme files for optimal code health.

```
bot_modules
↳ example_config.json
↳ example_readme.md
↳ example_script.js
```

Additionally, `index.js` collects and maintains a complete message history of channels defined as `channel_ids` in `./bot_module/` config files to reduce the overall number of API requests modules send to Discord. You can import the `getChannelMessages` function or its related signatures from a modules JavaScript file to access it.

```js
import { getChannelMessages } from "../index.js";

const predicate = ({ author, content }) => author === "foo" || content === "bar";
const messages = getChannelMessages("YOUR_DISCORD_CHANNEL_ID").filter(predicate);
```