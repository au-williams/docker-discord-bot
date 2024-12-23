# docker-discord-bot

My Discord bot made with [discord.js](https://discord.js.org/) for the scalable automation of tasks. [Docker image](https://github.com/au-williams/docker-discord-bot/pkgs/container/discord-bot) is packaged using [GitHub Actions](https://github.com/au-williams/docker-discord-bot/actions) CI/CD. 🐋📦

<img style="height: 75px" src="assets/readme_logos.png"/>

## Starting the bot

🛑 **Required fields in [config.json](config.json) must be updated before the bot can start!** 🛑

<details>
  <summary>🛠️ config.json</summary>

---

| Key                          | Description                                                                                                               | Required |
| :--------------------------- | :------------------------------------------------------------------------------------------------------------------------ | :------- |
| "discord_bot_admin_role_id"  |                                                                                                                           | `true`   |
| "discord_bot_client_user_id" | The Discord bot client ID [(how to find this)](https://support.heateor.com/discord-client-id-discord-client-secret/)      | `true`   |
| "discord_bot_login_token"    | The Discord bot login token [(how to find this)](https://docs.discordbotstudio.org/setting-up-dbs/finding-your-bot-token) | `true`   |
| "discord_config_channel_id"  | The Discord channel ID where plugin config files will be backed up                                                        | `false`  |
| "enable_debug_logs"          |                                                                                                                           | `true`   |
| "enable_message_fetch"       |                                                                                                                           | `true`   |
| "temp_directory"             | The directory where temporary files will be stored                                                                        | `true`   |

---

</details>

This project can be started from CLI with [Node.js](https://nodejs.org/en) ...

```bash
$ node index.js
```

Or be started with [Docker](https://www.docker.com/) using the [Docker image](https://github.com/au-williams/docker-discord-bot/pkgs/container/discord-bot) ...

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
import CronJob from "../entities/CronJob.js";

export const CronJobs = new Set([
  new CronJob()
    .setExpression("* * * * *")
    .setFunction(myFunction)
]);
```

_[Cron](https://en.wikipedia.org/wiki/Cron#CRON_expression) is a job scheduler that runs functions on an [expression](https://devhints.io/cron), like every 20 minutes or every Saturday at 9 AM. The bot framework will automatically schedule the Cron jobs you create here. You can extend the Cron jobs with the following setters ..._

| Name          | Description                                                         | Required |
| :------------ | :------------------------------------------------------------------ | :------- |
| setEnabled    | Sets the enabled state of the Cron job (used for debugging).        | `false`  |
| setExpression | Sets the Cron expression used when scheduling the Cron job.         | `true`   |
| setFunction   | Sets the function to execute when the Cron job is running.          | `true`   |
| setRunOrder   | Sets the order this Cron job runs with others to avoid race issues. | `false`  |
| setTriggered  | Sets if the Cron job should run on startup and before the pattern.  | `false`  |

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

_Every action in Discord can be thought of as an interaction. Clicking buttons, submitting forms, using slash commands, etc. When we create buttons to click or forms to submit we will assign them a unique ID that Discord emits back to us when a user interacts with it. These unique IDs are set on components and used as keys in the `Listeners` object._

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

| Name                   | Description                                                         | Required |
| :--------------------- | :------------------------------------------------------------------ | :------- |
| setBusyFunction        | Sets the function to execute when the listener is flagged as busy.  | `false`  |
| setDeploymentType      | Sets the type of POST request to use when deploying to Discord.     | `false`  |
| setDescription         | Sets the text displayed when describing functionality to the user.  | `false`  |
| setEnabled             | Sets the enabled state of the listener (typically for debugging).   | `false`  |
| setFunction            | Sets the function to execute when the listener is authorized.       | `true`   |
| setLockedUserFunction  | Sets the function to execute when the listener is not authorized.   | `false`  |
| setRequiredChannels    | Sets the channel ID(s) required for the listener to be executed.    | `false`  |
| setRequiredChannelType | Sets the channel type required for the listener to be executed.     | `false`  |
| setRequiredRoles       | Sets the role ID(s) a user must possess one of to be authorized.    | `false`  |
| setRunOrder            | Sets the order this listener runs with others to avoid race issues. | `false`  |

---

</details>

These are the JavaScript files in the `plugins` folder. JSON files of the same name are their config files. These plugins may have their own config files that must be updated before they can start ...

<details>
  <summary>🧩 plugins/cat_facts_scheduler.js</summary>

---

📜 [plugins/cat_facts_scheduler.js](https://github.com/au-williams/docker-discord-bot/blob/master/plugins/cat_facts_scheduler.js)

_This JavaScript file sends a new cat fact from the [catfact.ninja API](https://catfact.ninja/) to the announcement channel every morning at 9 AM. If the jobs schedule was missed while the bot was offline then a new cat fact will be sent on startup if the current time is determined to be close enough._

_Note: The [catfact.ninja API](https://catfact.ninja/) has awful data sanitization practices... API responses have spelling or grammar mistakes and duplicate entries. I dumped the API responses and fed them through ChatGPT to fix most of them in bulk._ 🤖

🛠️ [plugins/cat_facts_scheduler.json](https://github.com/au-williams/docker-discord-bot/blob/master/plugins/cat_facts_scheduler.json)

| Key                                | Description | Required |
| :--------------------------------- | :---------- | :------- |
| "announcement_cron_job_expression" |             | `true`   |
| "announcement_discord_channel_id"  |             | `true`   |
| "catfact_responses"                |             | `true`   |

---

</details>

<details>
  <summary>🧩 plugins/caturday_scheduler.js</summary>

---

<img src="assets/caturday.png" style="height: 375px;"></img>

📜 [plugins/caturday_scheduler.js](https://github.com/au-williams/docker-discord-bot/blob/master/plugins/caturday_scheduler.js)

_This JavaScript file sends a picture of someones pet to the announcement channel every Saturday morning at 9 AM. If the jobs schedule was missed while the bot was offline then a new picture will be sent on startup if the day is Saturday. `/caturday` shows a file picker to update channel images in the image pool. New members are sent a DM asking them to reply with their pets pictures. DM pictures are forwarded to the bot admins for approval._

🛠️ [plugins/caturday_scheduler.json](https://github.com/au-williams/docker-discord-bot/blob/master/plugins/caturday_scheduler.json)

| Key                                | Description | Required |
| :--------------------------------- | :---------- | :------- |
| "announcement_cron_job_expression" |             | `true`   |
| "announcement_discord_channel_id"  |             | `true`   |
| "maintenance_cron_job_expression"  |             | `true`   |
| "discord_admin_role_ids"           |             | `true`   |
| "discord_caturday_ids"             |             | `true`   |

<!-- (TODO: Rename plugin admin roles and use bot admins) -->

---

</details>

<details>
  <summary>🧩 plugins/deep_rock_galactic_announcer.js</summary>

---

<img src="assets/deep_rock_galactic_announcer.png" style="height: 200px; pointer-events:none;"></img>

📜 [plugins/deep_rock_galactic_announcer.js](https://github.com/au-williams/docker-discord-bot/blob/master/plugins/deep_rock_galactic_announcer.js)

_This JavaScript file sends assignment updates for the video game [Deep Rock Galactic](https://store.steampowered.com/app/548430/Deep_Rock_Galactic/) to the announcement channel by running a Cron job that fetches the [DRG API](https://drgapi.com/). `/drg` privately sends the announcement message to the current channel. Clicking `Deep Dive` privately sends the in-game deep dive assignments. Clicking `Elite Deep Dive` privately sends the in-game elite deep dive assignments._

🛠️ [plugins/deep_rock_galactic_announcer.json](https://github.com/au-williams/docker-discord-bot/blob/master/plugins/deep_rock_galactic_announcer.json)

| Key                                | Description | Required |
| :--------------------------------- | :---------- | :------- |
| "announcement_cron_job_expression" |             | `true`   |
| "announcement_discord_channel_id"  |             | `true`   |
| "discord_emoji_deep_rock_galactic" |             | `true`   |

---

</details>

<details>
  <summary>🧩 plugins/discord_direct_message_manager.js</summary>
</details>

<details>
<summary>🧩 plugins/discord_guild_role_color_manager.js</summary>

---

📜 [plugins/discord_guild_role_color_manager.js](https://github.com/au-williams/docker-discord-bot/blob/master/plugins/discord_guild_role_color_manager.js)

_This JavaScript file creates a guild role for each member based on their profile pictures average color and assigns it to them. When their profile picture is changed a new role will be made and the old role unassigned. The old role will be deleted if it has no members. Role names are in hexadecimal format._

🛠️ [plugins/discord_guild_role_color_manager.json](https://github.com/au-williams/docker-discord-bot/blob/master/plugins/discord_guild_role_color_manager.json)

| Key                          | Description | Required |
| :--------------------------- | :---------- | :------- |
| "discord_excluded_guild_ids" |             | `false`  |
| "discord_excluded_user_ids"  |             | `false`  |

---

</details>

<details>
  <summary>🧩 plugins/plex_music_downloader.js</summary>

---

<img src="assets/plex_music_downloader.png" style="height: 375px;"></img>

📜 [plugins/plex_music_downloader.js](https://github.com/au-williams/docker-discord-bot/blob/master/plugins/plex_music_downloader.js)

_This JavaScript file sends a message reply in response to a media link with its oembed data. Clicking `Download audio` or `Download video` will download its content using [yt-dlp](https://github.com/yt-dlp/yt-dlp) and post-process it with [ffmpeg](https://github.com/FFmpeg/FFmpeg) before reuploading it to Discord for the user to download. Any guild member can download the resulting files and authorized guild members can import them in source quality to the Plex media library on the host machine._

🛠️ [plugins/plex_music_downloader.json](https://github.com/au-williams/docker-discord-bot/blob/master/plugins/plex_music_downloader.json)

| Key                                | Description | Required |
| :--------------------------------- | :---------- | :------- |
| "cron_job_announcement_expression" |             | `true`   |
| "discord_admin_role_id"            |             | `true`   |
| "discord_allowed_channel_ids"      |             | `true`   |
| "discord_plex_emoji"               |             | `true`   |
| "discord_youtube_emoji"            |             | `true`   |
| "plex_authentication_token"        |             | `true`   |
| "plex_audio_download_directory"    |             | `true`   |
| "plex_video_download_directory"    |             | `true`   |
| "plex_example_genres"              |             | `true`   |
| "plex_library_section_id"          |             | `true`   |
| "plex_server_ip_address"           |             | `true`   |

---

</details>

<details>
  <summary>🧩 plugins/steam_community_announcer.js</summary>

---

<img src="assets/steam_community_announcer.png" style="height: 450px;"></img>

📜 [plugins/steam_community_announcer.js](https://github.com/au-williams/docker-discord-bot/blob/master/plugins/steam_community_announcer.js)

_This JavaScript file sends [Steam](https://store.steampowered.com/) game news and updates to the announcement channel by running a Cron job that fetches the [Steamworks Web API](https://partner.steamgames.com/doc/webapi_overview). Descriptions and images of the announcement are sourced from its content body._

🛠️ [plugins/steam_community_announcer.json](https://github.com/au-williams/docker-discord-bot/blob/master/plugins/steam_community_announcer.json)

| Key                                | Description | Required |
| :--------------------------------- | :---------- | :------- |
| "announcement_steam_app_ids"       |             |          |
| "announcement_cron_job_expression" |             |          |
| "announcement_discord_channel_id"  |             |          |

---

</details>

JavaScript files in the `services` folder operate the same as plugins but are dependencies of the bot framework. Thus when handling errors plugins will catch and release while services will throw to avoid an invalid system state. You can use these services in your plugin by referencing them ...

<details>
  <summary>⚙️ services/config.js</summary>

---

```js
import { Config } from "../services/config.js";

const config = new Config(import.meta.filename);
```

_This JavaScript file manages the config service state. You can create a `Config` object in your plugin using the plugins filename as a parameter - provided by Node.js as `import.meta.filename`. This `Config` object has the file contents of [config.json](config.json) and the JSON file of the plugin filename if it exists. After updating data stored in the JSON file you can use `config.save()` to update the file locally._

_If `discord_config_channel_id` is set in [config.json](config.json) then your JSON file of the plugin filename will be backed up to that channel on startup. You'll be warned if your backup is out of sync thereafter so it can be reuploaded. Reuploading your JSON is done by clicking the `Reupload` button - backing up your current file and saving the previous file to the version history. Clicking `Restore` on a backup will rename your JSON file before downloading and replacing with the backup._

<!-- TODO: add config key to not be backed up? "enable_backup": false? -->

---

</details>

<details>
  <summary>⚙️ services/emitter.js</summary>

---

```js
import { Emitter } from "../services/emitter.js";

Emitter.emit({ event });
```

_This JavaScript file manages routing events and interactions to plugins and other services. If you're listening for a Discord event that's not working, [index.js](index.js) may need to be updated to pass that event to `Emitter.emit({ event })`. Plugins don't have a use for the `Emitter` class unless displaying buttons or other components. Attaching `Emitter.moreInfoButton` to your [ActionRow](https://discordjs.guide/message-components/action-rows.html#building-action-rows) adds a premade button providing descriptions of those components when clicked._

---

</details>

<details>
  <summary>⚙️ services/logger.js</summary>

---

```js
import { Logger } from "../services/logger.js";

const logger = new Logger(import.meta.filename);
```

---

</details>

<details>
  <summary>⚙️ services/messages.js</summary>

---

```js
import { Messages } from "../services/messages.js";

const messages = Messages.get({ channelId });
```

_This JavaScript file manages the message history. If `enable_message_fetch` is set as `true` in [config.json](config.json) then on startup the bot creates a collection of all messages it can access. This lets us quickly and easily sort them using ES6 functions. If `enable_message_fetch` is set as `false` then the collection won't be created. This saves a significant amount of time on startup at the expense of disabling all plugins that rely on the message history to function. Setting this value as `false` typically is done during local development of other plugins._

---

</details>

## Deploying the bot

Discord updates context menus and slash commands using a POST request. This typically requires each command to create a [builder](https://discordjs.guide/slash-commands/advanced-creation.html#adding-options) before submitting the POST request but most of this has been automated. Your commands must use the `setDeploymentType` setter on their `Listener` objects. Starting the bot with the `deploy` argument will deploy the commands to Discord ...

```cmd
$ node index.js deploy
```

⚠️ **Discord API requires a deployment each time a command is created or changed for it to update!** ⚠️
