# Music Download

- [Music Download](#music-download)
  - [Information](#information)
  - [Configuration](#configuration)

## Information

This module parses links to download with yt-dlp and post-process with ffmpeg. The output is moved to the servers media library with a copy uploaded to the originating channel.

These tags are overwrote for Plex library support:

| Tag          | Value           |
| ------------ | --------------- |
| Album        | Downloads       |
| Album Artist | Various Artists |

## Configuration

| Key              | Value                                                                              |
| ---------------- | ---------------------------------------------------------------------------------- |
| "channel_ids"    | The channel IDs that this script will run in                                       |
| "temp_directory" | The scripts working directory (recommended somewhere in the "temp_storage" folder) |
| "plex_directory" | The destination music library (recommended somewhere in a "Downloads"-like folder) |
