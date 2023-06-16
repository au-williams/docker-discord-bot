import { basename } from "path";
import getCallerFile from "get-caller-file";

const getFilename = () => {
  const filepaths = [...Array(Error.stackTraceLimit).keys()].map(i => getCallerFile(i)).slice(1);
  const filepath = filepaths.find(x => x && !x.endsWith("logger.js"));
  return filepath ? basename(filepath) : null;
};

export class Logger {
  static Info(...strings) {
    strings.forEach(s => console.log(`🟩 ${getFilename()} -> ${s}`));
  }
  static Warn(...strings) {
    strings.forEach(s => console.warn(`🟨 ${getFilename()} -> ${s}`));
  }
  static Error(...strings) {
    strings.forEach(s => console.error(`🟥 ${getFilename()} -> ${s}`));
  }
}
