# Plex Music Downloader

## Script — [plex_music_downloader_script.js](plex_music_downloader_script.js)

This script downloads music using [yt-dlp](https://github.com/yt-dlp/yt-dlp) and post-processes it with [ffmpeg](https://github.com/FFmpeg/FFmpeg). Any user can download the transcoded MP3 file and authorized users can save the file in source quality to the Plex media library.

These metadata tags are provided by the user before starting a download:

| Tag      | Default value                                        | Required |
| -------- | ---------------------------------------------------- | -------- |
| `Title`  | The URLs [oEmbed](https://oembed.com/) `title`       | Yes      |
| `Artist` | The URLs [oEmbed](https://oembed.com/) `author_name` | Yes      |
| `Genre`  |                                                      | No       |

These metadata tags are overwrote for better library integration:

| Tag            | Value           |
| -------------- | --------------- |
| `Album`        | Downloads       |
| `Album Artist` | Various Artists |
| `Date`         |                 |
| `Track #`      |                 |

## Config — [plex_music_downloader_config.json](plex_music_downloader_config.json)

The following values should be provided before use:

| Key                   | Value                                                                                                                                                                        | Required |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `"plex_channel_ids"`  | The Discord channel IDs that this module will run in                                                                                                                         | ✔        |
| `"plex_directory"`    | The music library directory (or where you store your downloads)                                                                                                              | ✔        |
| `"plex_section_id"`   | The music library key in Plex [(instructions on how to find it here)](https://support.plex.tv/articles/201638786-plex-media-server-url-commands/)                            | ✖        |
| `"plex_server_ip"`    | The local IP of the Plex server (this should be the `ipconfig` IPv4 address)                                                                                                 | ✖        |
| `"plex_user_role_id"` | The Discord guild role ID that's authorized to make Plex server file changes                                                                                                 | ✔        |
| `"plex_x_token"`      | The Plex token for endpoint authentication [(instructions on how to find it here)](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/) | ✖        |
| `"temp_directory"`    | The temporary working directory (default is the root "temp_storage" folder)                                                                                                  | ✔        |

`"plex_section_id"`, `"plex_server_ip"`, `"plex_x_token"` are **optional** and refresh the Plex media library after a file operation is complete.
