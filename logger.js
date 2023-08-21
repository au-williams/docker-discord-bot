import { basename } from "path";
import { readdirSync } from "fs";
import getCallerFile from "get-caller-file";
import date from 'date-and-time';

const getFilename = () => {
  const scriptFilenames = ["index.js", ...readdirSync("./components/").filter(fn => fn.endsWith("_script.js"))];
  const stackFilepaths = [...Array(Error.stackTraceLimit).keys()].map(i => getCallerFile(i)).slice(1);
  const filepath = stackFilepaths.find(fp => fp && scriptFilenames.some(fn => fp.endsWith(fn)));
  return filepath ? basename(filepath) : null;
};

const getFormattedTimestamp = () => {
  return date.format(new Date(), 'MM/DD HH:mm:ss');
}

export class Logger {
  static Info(message, filename) {
    const fn = filename ?? getFilename();
    const ts = getFormattedTimestamp();
    console.log(`🟩 [${ts}] ${fn} → ${message}`);
  }
  static Warn(message, filename) {
    const fn = filename ?? getFilename();
    const ts = getFormattedTimestamp();
    console.warn(`🟨 [${ts}] ${fn} → ${message}`);
  }
  static Error(message, filename) {
    const fn = filename ?? getFilename();
    const ts = getFormattedTimestamp();
    console.error(`🟥 [${ts}] ${fn} → ${message}`);
  }
}

// `🟩 [07/25 16:27] <plex_music_downloader_script.js> interaction "music_download_script_plex_import_button" from mutiny.exe`
// `🟩 [07/25 16:27] <plex_music_downloader_script.js> "[c] - Star Fox 2: Planet Eladard - Synth Cover.mp3" into Plex" imported for mutiny.exe`
