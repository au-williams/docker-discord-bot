import { Emitter, getBusyInteractionCompositeKey, importCronJob } from "./emitter.js";
// import { jest } from '@jest/globals'
import CronJob from "../entities/CronJob.js";

describe("getBusyInteractionCompositeKey", () => {
  it("returns the expected composite key format", () => {
    const customId = "customId";
    const message = { id: "messageId" };
    const user = { id: "userId" };

    const result = getBusyInteractionCompositeKey({ customId, message, user });
    expect(result).toBe("customId|messageId|userId");
  });
});

describe("importCronJob", () => {
  it("correctly maps a disabled service cron job", () => {
    const cronJob = new CronJob().setEnabled(false);
    const filepath = "./services/test_service.js";
    const isService = true;

    Emitter._importedListeners = new Map();
    importCronJob(cronJob, filepath, isService);

    expect(Emitter.listeners.some(item =>
      item.filename === "test_service.js"
      && item.filepath === filepath
      && item.id === "ready"
      && item.isEnabled === false
      && item.isService === true
      && item.runOrder === cronJob.runOrder
    )).toBe(true);

    // Emitter.scheduleCronJob = jest.fn();
    // Emitter.listeners[0].func();
    // expect(Emitter.scheduleCronJob).toHaveBeenCalledTimes(1);
  });

  it("correctly maps an enabled plugin cron job", () => {
    const cronJob = new CronJob().setEnabled(true);
    const filepath = "./plugins/test_plugin.js";
    const isService = false;

    Emitter._importedListeners = new Map();
    importCronJob(cronJob, filepath, isService);

    expect(Emitter.listeners.some(item =>
      item.filename === "test_plugin.js"
      && item.filepath === filepath
      && item.id === "ready"
      && item.isEnabled === true
      && item.isService === false
      && item.runOrder === cronJob.runOrder
    )).toBe(true);
  });
});