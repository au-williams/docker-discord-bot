# discord-bot

My Discord bot made with [discord.js](https://discord.js.org/) for scalable automation of local and remote tasks.

## Starting the bot

**I recommend using the [PM2](https://pm2.keymetrics.io/) process manager so the bot may recover from network issues:**

```bash
$ pm2 start --no-daemon index.js --exp-backoff-restart-delay=100
```

- _`--no-daemon` prints logs to the console window instead of a log file_
- _`--exp-backoff-restart-delay` slows the restart policy during repeat failures_

... Or if you would rather use [Node.js](https://nodejs.org/en):

```bash
$ node index.js
```

## Creating plugins

The `index.js` file handles [discord.js events](https://old.discordjs.dev/#/docs/discord.js/14.9.0/typedef/Events) and invokes the corresponding function names in `./plugins/` JavaScript files. Simply creating a new JavaScript file with an appropriately named function is enough for it to execute - but you ***should*** add the config and readme files for optimal code quality.

```
./plugins/
↳ example_plugin_config.json
↳ example_plugin_readme.md
↳ example_plugin_script.js
```

### Querying message history

The `index.js` file maintains the message history of guild channels to reduce the overall number of API requests sent to Discord. A channels message history is lazy-loaded on the first invocation and automatically kept up-to-date after.

```js
import { getChannelMessages } from "../index.js";

const predicate = ({ author, content }) => author === "foo" || content === "bar";
const messages = getChannelMessages("YOUR_DISCORD_CHANNEL_ID").filter(predicate);
```

_**Note:** You can load channels on startup with the `"discord_prefetch_channel_ids"` config value! This is useful when there's noticeable delay lazy-loading a channel with a large number of messages._

### Registering slash commands

You can register slash commands for a plugin by exporting the `COMMAND_INTERACTIONS` array.

```js
// define "/hello-world" slash command
export const COMMAND_INTERACTIONS = [{
  name: "hello-world",
  description: `Prints "Hello World" to the console`,
  onInteractionCreate: () => console.log("Hello World!")
}]
```

**You must start the bot with the `deploy` arg for any slash command changes to take effect:**

```bash
$ node index.js deploy
```

This sends a PUT request to Discord containing the updated slash commands during startup.

## Configuration [(config.json)](config.json)

| Key                              | Value                                                                                                                     | Required |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| `"discord_bot_client_id"`        | The Discord bot client ID [(how to find this)](https://support.heateor.com/discord-client-id-discord-client-secret/)      | ✔        |
| `"discord_bot_login_token"`      | The Discord bot login token [(how to find this)](https://docs.discordbotstudio.org/setting-up-dbs/finding-your-bot-token) | ✔        |
| `"discord_prefetch_channel_ids"` | The Discord channel IDs to prefetch messages for                                                                          | ✖        |
| `"discord_state_channel_id"`     | The Discord channel ID where state will be stored                                                                         | ✔        |
| `"temp_directory"`               | The directory where temporary files will be stored                                                                        | ✔        |

<!--
todo:
# managing state
# managing logs
# add config value ... discord_logs_channel_id
-->
