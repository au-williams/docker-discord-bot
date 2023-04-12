# Music Download Module

## Script

This script downloads music links with [yt-dlp](https://github.com/yt-dlp/yt-dlp) and post-processes them with [ffmpeg](https://github.com/FFmpeg/FFmpeg). The result is uploaded to Discord and can be imported into the file servers music library by authorized users in the Discord guild.

These metadata tags are overwrote by [ffmpeg](https://github.com/FFmpeg/FFmpeg) for better Plex library support:

| Tag          | Value           |
| ------------ | --------------- |
| Album        | Downloads       |
| Album Artist | Various Artists |
| Date         | NULL            |
| Track #      | NULL            |

## Config

| Key                 | Value                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| "channel_ids"       | The channel IDs that this module will run in                                       |
| "temp_directory"    | The scripts working directory (recommended somewhere in the "temp_storage" folder) |
| "plex_directory"    | The destination music library (recommended somewhere in a "Downloads"-like folder) |
| "plex_user_role_id" | The Discord guild member role authorized to import downloads into the plex library |
