export default class Logger {
  constructor(scriptFilename) {
    this.filename = scriptFilename;
  }

  async initialize(client) {
    // todo: send logs to channel
  }

  info(message, filename = this.filename) {
    console.log(`🟩 ${filename} → ${message}`);
  }

  warn(message, filename = this.filename) {
    console.warn(`🟨 ${filename} → ${message}`);
  }

  error(message, filename = this.filename) {
    if (message.stack) message = message.stack;
    console.error(`🟥 ${filename} → ${message}`);
  }
}
