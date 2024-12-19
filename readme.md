# docker-discord-bot

My Discord bot made with [discord.js](https://discord.js.org/) for the scalable automation of tasks. [Docker image](https://github.com/au-williams/docker-discord-bot/pkgs/container/discord-bot) is packaged using [GitHub Actions](https://github.com/au-williams/docker-discord-bot/actions) CI/CD. 🐋📦

<img style="height: 75px" src="assets/readme_logos.png"/>

## Starting the bot

🛑 **Required fields in [config.json](config.json) must be updated before the bot can start!** 🛑

<details>
  <summary>🛠️ config.json</summary>

| Key                              | Value                                                                                                                     | Required |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| `"discord_bot_client_user_id"`   | The Discord bot client ID [(how to find this)](https://support.heateor.com/discord-client-id-discord-client-secret/)      | ✔        |
| `"discord_bot_login_token"`      | The Discord bot login token [(how to find this)](https://docs.discordbotstudio.org/setting-up-dbs/finding-your-bot-token) | ✔        |
| `"discord_prefetch_channel_ids"` | The Discord channel IDs to prefetch messages for                                                                          | ✖        |
| `"discord_config_channel_id"`    | The Discord channel ID where state will be stored                                                                         | ✔        |
| `"temp_directory"`               | The directory where temporary files will be stored                                                                        | ✔        |

</details>

This project can start from CLI with [Node.js](https://nodejs.org/en) ...

```bash
$ node index.js
```

Or start with [Docker](https://www.docker.com/) using the [Docker image](https://github.com/au-williams/docker-discord-bot/pkgs/container/discord-bot) ...

```
ghcr.io/au-williams/discord-bot:master
```

⭐ **Docker is recommended so the bot can automatically start and recover from network issues.** ⭐

## Anatomy of the bot

The bot is a framework meant to automate many code-heavy tasks working with the Discord API. You simply need to add a new JavaScript file to the `plugins` folder to add functionality. You must export one or more of these objects in that script ...

<details>
  <summary>📤 export const CronJobs</summary>

---

```js
import CronJobScheduler from "../entities/CronJobScheduler.js";

export const CronJobs = new Set([
  new CronJobScheduler().setFunction(myFunction).setPattern("* * * * *")
]);
```

_[Cron](https://en.wikipedia.org/wiki/Cron#CRON_expression) is a job scheduler that runs functions on an [expression](https://devhints.io/cron), like every 20 minutes or every Saturday at 9 AM. The bot framework automatically schedules the Cron jobs you create here. You can customize the Cron job with the following setters ..._

| Setters      | Required | Purpose                                                             |
| ------------ | -------- | ------------------------------------------------------------------- |
| setEnabled   | `false`  | Sets the enabled state of the Cron job (typically for debugging).   |
| setFunction  | `true`   | Sets the function to execute when the Cron job is running.          |
| setPattern   | `true`   | Sets the Cron expression used when scheduling the Cron job.         |
| setRunOrder  | `false`  | Sets the order this Cron job runs with others to avoid race issues. |
| setTriggered | `false`  | Sets if the Cron job should run on startup and before the pattern.  |

---

</details>

<details>
  <summary>📤 export const Interactions</summary>

---

```js
export const Interactions = Object.freeze({
  ButtonComponentWave: "PLUGIN_BUTTON_COMPONENT_WAVE"
});
```

_Every action in Discord can be thought of as an interaction. Clicking buttons, submitting forms, sending messages, etc. When we create buttons to click or forms to submit we must assign them a unique ID that Discord will emit back to us when it has been interacted with. These unique IDs are set on components and used as keys in the `Listeners` object._

---

</details>

<details>
  <summary>📤 export const Listeners</summary>

---

```js
import Listener from "../entities/Listener.js";

export const Listeners = Object.freeze({
  [Interactions.ButtonComponentWave]: new Listener()
    .setDescription("Sends the wave emoji when the button is clicked.")
    .setFunction(onButtonComponentWave)
});
```

_Listeners handle actions. The property key is a Discord event or interaction from the `Interactions` object. The value is a `Listener` object that will be executed when the key is emitted by Discord. Listeners that only set a function can use that function as the value and the framework will automatically wrap it in a Listener. You can use an array to create multiple Listener values for a single key. You can customize the Listener with the following setters ..._

| Setters                | Required | Purpose                                                             |
| ---------------------- | -------- | ------------------------------------------------------------------- |
| setBusyFunction        | `false`  | Sets the function to execute when the listener is flagged as busy.  |
| setDeploymentType      | `false`  | Sets the type of POST request to use when deploying to Discord.     |
| setDescription         | `false`  | Sets the text displayed when describing functionality to the user.  |
| setEnabled             | `false`  | Sets the enabled state of the listener (typically for debugging).   |
| setFunction            | `true`   | Sets the function to execute when the listener is authorized.       |
| setLockedUserFunction  | `false`  | Sets the function to execute when the listener is not authorized.   |
| setRequiredChannels    | `false`  | Sets the channel ID(s) required for the listener to be executed.    |
| setRequiredChannelType | `false`  | Sets the channel type required for the listener to be executed.     |
| setRequiredRoles       | `false`  | Sets the role ID(s) a user must possess one of to be authorized.    |
| setRunOrder            | `false`  | Sets the order this listener runs with others to avoid race issues. |

---

</details>

These are the JavaScript files in the `plugins` folder. JSON files of the same name are their config files. These plugins may have their own config files that must be updated before they can start ...

<details>
  <summary>🧩 plugins/cat_facts_scheduler.js</summary>

---

_This script sends a new cat fact from the [catfact.ninja API](https://catfact.ninja/) every morning at 9 AM. If the schedule was missed when the bot was offline then a new cat fact will be sent on startup if the current time is determined to be close enough._

_Note: The [catfact.ninja API](https://catfact.ninja/) has awful data sanitization. API responses can have spelling and grammar mistakes or many duplicate entries. The API has been dumped and fed through ChatGPT to fix most of the problems in bulk._ 🤖

  <details>
    <summary>🛠️ plugins/cat_facts_scheduler.json</summary>

| Key                               | Required | Description     |
| --------------------------------- | -------- | --------------- |
| "announcement_cron_job_pattern"   | `true`   | "0 9 \* \* \*", |
| "announcement_discord_channel_id" | `true`   | "",             |
| "sanitized_catfact_api_responses" | `true`   | [],             |

  </details>

---

</details>

<details>
  <summary>🧩 plugins/caturday_scheduler.js</summary>

---

_This script sends a new image of a members pet every Saturday morning at 9 AM to the configured channel. If today is Saturday and the schedule was missed when the bot was offline then a new message is sent on startup. `/caturday` will show a file picker dialog to add or remove a channel image in the image pool. New members will be sent a DM on join asking them to send the bot pet images. DM images are forwarded to the bot admins for approval._

  <details>
    <summary>🛠️ plugins/cat_facts_scheduler.json</summary>

| Key                               | Required | Description |
| --------------------------------- | -------- | ----------- |
| "announcement_cron_job_pattern"   | `true`   |             |
| "announcement_discord_channel_id" | `true`   |             |
| "maintenance_cron_job_pattern"    | `true`   |             |
| "discord_admin_role_ids"          | `true`   |             |
| "discord_caturday_ids"            | `true`   |             |

  </details>

---

</details>

<details>
  <summary>🧩 plugins/deep_rock_galactic_announcer.js</summary>

---

<img src="assets/deep_rock_galactic_announcer.png" style="height: 200px;"></img>

_This script sends assignment updates for the game [Deep Rock Galactic](https://store.steampowered.com/app/548430/Deep_Rock_Galactic/) by running a Cron job that fetches the [DRG API](https://drgapi.com/) and sends changes to each configured Discord channel. `/drg` privately sends the last message to the current channel. Clicking `Deep Dive` privately sends the current in-game deep dive assignments. Clicking `Elite Deep Dive` privately sends the current in-game elite deep dive assignments._

  <details>
    <summary>🛠️ plugins/deep_rock_galactic_announcer.json</summary>

| Key                                | Required | Description |
| ---------------------------------- | -------- | ----------- |
| "announcement_cron_job_pattern"    | `true`   |             |
| "announcement_discord_channel_id"  | `true`   |             |
| "discord_emoji_deep_rock_galactic" | `true`   |             |

  </details>

---

</details>

<details>
  <summary>🧩 plugins/discord_direct_message_manager.js</summary>
</details>

<details>
  <summary>🧩 plugins/discord_guild_role_color_manager.js</summary>

---

_This script creates a guild role for each members average profile picture color and assigns it to them. When their profile picture is updated a new role will be made and the old role unassigned. The old role will be deleted if it has no members._

  <details>
    <summary>🛠️ plugins/discord_guild_role_color_manager.json</summary>

| Key                          | Required | Description |
| ---------------------------- | -------- | ----------- |
| "discord_excluded_guild_ids" | `false`  |             |
| "discord_excluded_user_ids"  | `false`  |             |

  </details>

---

</details>

<details>
  <summary>🧩 plugins/plex_music_downloader.js</summary>

---

<img src="assets/plex_music_downloader.png" style="height: 375px;"></img>

_This script downloads music and video using [yt-dlp](https://github.com/yt-dlp/yt-dlp) and post-processes it with [ffmpeg](https://github.com/FFmpeg/FFmpeg). Any guild member can download the audio or video file, and authorized guild members can import the file in source quality to the Plex media library on the host machine._

  <details>
    <summary>🛠️ plugins/plex_music_downloader.json</summary>

| Key                             | Required | Description |
| ------------------------------- | -------- | ----------- |
| "cron_job_announcement_pattern" | `true`   |             |
| "discord_admin_role_id"         | `true`   |             |
| "discord_allowed_channel_ids"   | `true`   |             |
| "discord_plex_emoji"            | `true`   |             |
| "discord_youtube_emoji"         | `true`   |             |
| "plex_authentication_token"     | `true`   |             |
| "plex_audio_download_directory" | `true`   |             |
| "plex_video_download_directory" | `true`   |             |
| "plex_example_genres"           | `true`   |             |
| "plex_library_section_id"       | `true`   |             |
| "plex_server_ip_address"        | `true`   |             |

  </details>

---

</details>

<details>
  <summary>🧩 plugins/steam_community_announcer.js</summary>

---

<img src="assets/steam_community_announcer.png" style="height: 450px;"></img>

_This script runs a Cron job and fetches the [Steamworks Web API](https://partner.steamgames.com/doc/webapi_overview) to send new game announcements to each configured Discord channel._

  <details>
    <summary>🛠️ plugins/steam_community_announcer.json</summary>

| Key                               | Required | Description |
| --------------------------------- | -------- | ----------- |
| "announcement_steam_app_ids"      |          |             |
| "announcement_cron_job_pattern"   |          |             |
| "announcement_discord_channel_id" |          |             |

  </details>

---

</details>

JavaScript files in the `services` folder operate the same as plugins but are dependencies of the bot framework. Thus when handling errors plugins will catch and release while services will throw to avoid an invalid system state. You can use these services in your plugin by referencing them ...

<details>
  <summary>⚙️ services/config.js</summary>
</details>

<details>
  <summary>⚙️ services/emitter.js</summary>
</details>

<details>
  <summary>⚙️ services/logger.js</summary>
</details>

<details>
  <summary>⚙️ services/messages.js</summary>
</details>

## Deploying the bot

<!-- ## Creating plugins

The `index.js` file handles [discord.js events](https://old.discordjs.dev/#/docs/discord.js/14.9.0/typedef/Events) and invokes the corresponding function names in `./plugins/` JavaScript files. Simply creating a new JavaScript file with an appropriately named function is enough for it to execute - but you **_should_** add the config and readme files for optimal code quality.

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

You can register slash commands for a plugin by exporting the `PLUGIN_COMMANDS` array.

```js
// define "/hello-world" slash command
export const PLUGIN_COMMANDS = [
  {
    name: "hello-world",
    description: `Prints "Hello World" to the console`,
    onInteractionCreate: () => console.log("Hello World!")
  }
];
```

**You must start the bot with the `deploy` arg for any slash command changes to take effect:**

```bash
$ node index.js deploy
```

This sends a PUT request to Discord containing the updated slash commands during startup.

## Configuration [(config.json)](config.json)

| Key                              | Value                                                                                                                     | Required |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| `"discord_bot_client_user_id"`   | The Discord bot client ID [(how to find this)](https://support.heateor.com/discord-client-id-discord-client-secret/)      | ✔        |
| `"discord_bot_login_token"`      | The Discord bot login token [(how to find this)](https://docs.discordbotstudio.org/setting-up-dbs/finding-your-bot-token) | ✔        |
| `"discord_prefetch_channel_ids"` | The Discord channel IDs to prefetch messages for                                                                          | ✖        |
| `"discord_config_channel_id"`    | The Discord channel ID where state will be stored                                                                         | ✔        |
| `"temp_directory"`               | The directory where temporary files will be stored                                                                        | ✔        | -->

<!--
TODO:
# managing state
# managing logs
# add config value ... discord_logs_channel_id
-->
