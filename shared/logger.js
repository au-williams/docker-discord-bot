export default class Logger {
  constructor(scriptFilename) {
    this.filename = scriptFilename;
  }

  async initialize(client) {
    // todo: send logs to channel
  }

  info(message) {
    console.log(`🟩 ${this.filename} → ${message}`);
  }

  warn(message) {
    console.warn(`🟨 ${this.filename} → ${message}`);
  }

  error(message) {
    console.error(`🟥 ${this.filename} → ${message}`);
  }
}
