# discord-bot

## Starting the bot

```bash
$ node --no-warnings=ExperimentalWarning index.js
```

The `--no-warnings=ExperimentalWarning` parameter suppresses Node.js warnings when using experimental features ([JSON modules](https://nodejs.org/api/esm.html#json-modules), [buffer.File](https://nodejs.org/api/buffer.html#class-file), etc).

## Creating components

The `index.js` file handles [discord.js events](https://old.discordjs.dev/#/docs/discord.js/14.9.0/typedef/Events) and invokes corresponding function names in `./components/` JavaScript files. Simply creating a new JavaScript file with an appropriately named function is enough for it to execute - but you ***should*** add its config and readme files for optimal code quality.

```
components
↳ example_component_config.json
↳ example_component_readme.md
↳ example_component_script.js
```

### Querying message history

The `index.js` file collects and maintains a message history of joined channels to reduce the overall number of API requests sent to Discord. You can import the `getChannelMessages` function or related signatures from a component script to access it. A channels message history is lazy-loaded on its first invocation and maintained with events after.

```js
import { getChannelMessages } from "../index.js";

const predicate = ({ author, content }) => author === "foo" || content === "bar";
const messages = getChannelMessages("YOUR_DISCORD_CHANNEL_ID").filter(predicate);
```

_**Note:** You can load channels on startup with the `"prefetched_channel_ids"` config value!_

### Registering slash commands

You can register slash commands from a component script by exporting the `COMMAND_INTERACTIONS` array that defines them. `deploy.js` should be executed after making any `name` or `description` changes with `node deploy.js` to send those changes to Discord with a PUT request.

```js
// define "/hello-world" slash command
export const COMMAND_INTERACTIONS = [{
  name: "hello-world",
  description: `Prints "Hello World" to the console`,
  onInteractionCreate: () => console.log("Hello World!")
}]
```
