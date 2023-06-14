# Music Download Module

## Script

This script downloads music using [yt-dlp](https://github.com/yt-dlp/yt-dlp) and post-processes them with [ffmpeg](https://github.com/FFmpeg/FFmpeg). Anyone can download the audio file and authorized users can add it to the Plex media library.

These metadata tags are overwrote by [ffmpeg](https://github.com/FFmpeg/FFmpeg) for better Plex media library support:

| Tag            | Value           |
| -------------- | --------------- |
| `Album`        | Downloads       |
| `Album Artist` | Various Artists |
| `Date`         | NULL            |
| `Track #`      | NULL            |

These metadata tags are provided by the user before initiating their download:

| Tag      | Default value             | Required |
| -------- | ------------------------- | -------- |
| `Title`  | The links oembed title    | Yes      |
| `Artist` | The links oembed uploader | Yes      |
| `Genre`  |                           | No       |

## Config

The following config keys should be provided before use:

| Key                   | Value                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"channel_ids"`       | The Discord channel IDs that this module will run in                                                                                                                        |
| `"plex_directory"`    | The Plex music library directory (or where you store your downloads)                                                                                                    |
| `"plex_section_id"`   | The library key for music in Plex [(instructions on how to find here)](https://support.plex.tv/articles/201638786-plex-media-server-url-commands/)                          |
| `"plex_server_ip"`    | The local IP of the Plex server (this should be the `ipconfig` IPv4 address)                                                                                                |
| `"plex_user_role_id"` | The Discord guild role authorized to make file changes to the plex library                                                                                                  |
| `"plex_x_token"`      | The X-Token used for endpoint authentication [(instructions on how to find here)](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/) |
| `"temp_directory"`    | The temporary working directory (default is the root "temp_storage" folder)                                                                                                 |

> `"plex_section_id"`, `"plex_server_ip"`, `"plex_x_token"` keys are used to refresh the Plex media library after a change is made.
