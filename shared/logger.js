import { basename } from "path";
import { readdirSync } from "fs";
import getCallerFile from "get-caller-file";

const getFilename = () => {
  const scriptFilenames = ["index.js", ...readdirSync("./plugins/").filter(fn => fn.endsWith("_script.js"))];
  const stackFilepaths = [...Array(Error.stackTraceLimit).keys()].map(i => getCallerFile(i)).slice(1);
  const filepath = stackFilepaths.find(fp => fp && scriptFilenames.some(fn => fp.endsWith(fn)));
  return filepath ? basename(filepath) : null;
};

// deprecated with PM2 log timestamps
// const getFormattedTimestamp = () => date.format(new Date(), 'MM/DD HH:mm:ss');

export default class Logger {
  static info(message, filename) {
    console.log(`🟩 ${filename ?? getFilename()} → ${message}`);
  }

  static warn(message, filename) {
    console.warn(`🟨 ${filename ?? getFilename()} → ${message}`);
  }

  static error(message, filename) {
    console.error(`🟥 ${filename ?? getFilename()} → ${message}`);
  }
}
