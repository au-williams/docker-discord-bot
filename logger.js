import { basename } from "path";
import getCallerFile from "get-caller-file";
import date from 'date-and-time';

const getFilename = () => {
  const filepaths = [...Array(Error.stackTraceLimit).keys()].map(i => getCallerFile(i)).slice(1);
  const filepath = filepaths.find(x => x && !x.endsWith("logger.js"));
  return filepath ? basename(filepath) : null;
};

const getTimestamp = () => {
  return date.format(new Date(), 'MM/DD HH:mm');
}

export class Logger {
  static Info(...strings) {
    const fn = getFilename();
    const ts = getTimestamp();
    strings.forEach(s => console.log(`🟩 [${ts}] ${fn} -> ${s}`));
  }
  static Warn(...strings) {
    const fn = getFilename();
    const ts = getTimestamp();
    strings.forEach(s => console.warn(`🟨 [${ts}] ${fn} -> ${s}`));
  }
  static Error(...strings) {
    const fn = getFilename();
    const ts = getTimestamp();
    strings.forEach(s => console.error(`🟥 [${ts}] ${fn} -> ${s}`));
  }
}
