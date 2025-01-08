import { checkAllowedChannel, checkAllowedChannelType, checkAllowedUser, Emitter, getBusyInteractionCompositeKey, importCronJob } from "./emitter.js";
import CronJob from "../entities/CronJob.js";
import Listener from "../entities/Listener.js";
import { jest } from "@jest/globals"
import { ChannelType } from "discord.js";


describe("checkAllowedChannel", () => {
  it("returns true when listener has no requiredChannelIds", async () => {
    const listener = new Listener();
    const result = await checkAllowedChannel(listener, null);
    expect(result).toBe(true);
  });

  it("returns false when listener has unmet requiredChannelIds", async () => {
    const listener = new Listener().setRequiredChannels("1");
    const result = await checkAllowedChannel(listener, { id: "0" });
    expect(result).toBe(false);
  });

  it("returns true when listener has met requiredChannelIds <string>", async () => {
    const listener = new Listener().setRequiredChannels("1");
    const result = await checkAllowedChannel(listener, { id: "1" });
    expect(result).toBe(true);
  });

  it("returns true when listener has met requiredChannelIds <string[]>", async () => {
    const listener = new Listener().setRequiredChannels(["1", "2", "3"]);
    const result = await checkAllowedChannel(listener, { id: "2" });
    expect(result).toBe(true);
  });
});

describe("checkAllowedChannelType", () => {
  it("returns true if requiredChannelTypes is not an array", () => {
    const listener = new Listener();
    const result = checkAllowedChannelType(listener, null);
    expect(result).toBe(true);
  });

  it("returns true if channel type matches one in requiredChannelTypes <...string>", () => {
    const listener = new Listener().setRequiredChannelTypes(ChannelType.DM, ChannelType.GuildText);
    const channel = { type: ChannelType.GuildText }
    const result = checkAllowedChannelType(listener, channel);
    expect(result).toBe(true);
  });

  it("returns true if channel type matches one in requiredChannelTypes <string[]>", () => {
    const listener = new Listener().setRequiredChannelTypes([ChannelType.DM, ChannelType.GuildText]);
    const channel = { type: ChannelType.GuildText }
    const result = checkAllowedChannelType(listener, channel);
    expect(result).toBe(true);
  });

  test("returns false if channel type does not match any in requiredChannelTypes <...string>", () => {
    const listener = new Listener().setRequiredChannelTypes(ChannelType.DM, ChannelType.GuildText);
    const channel = { type: ChannelType.PrivateThread };
    const result = checkAllowedChannelType(listener, channel);
    expect(result).toBe(false);
  });

  test("returns false if channel type does not match any in requiredChannelTypes <string[]>", () => {
    const listener = new Listener().setRequiredChannelTypes([ChannelType.DM, ChannelType.GuildText]);
    const channel = { type: ChannelType.PrivateThread };
    const result = checkAllowedChannelType(listener, channel);
    expect(result).toBe(false);
  });

  test("returns false if setRequiredChannelType is an empty array", () => {
    const listener = new Listener().setRequiredChannelTypes([]);
    const channel = { type: ChannelType.PrivateThread };
    const result = checkAllowedChannelType(listener, channel);
    expect(result).toBe(false);
  });

  test("returns false if setRequiredChannelType has no parameter", () => {
    const listener = new Listener().setRequiredChannelTypes();
    const channel = { type: ChannelType.PrivateThread };
    const result = checkAllowedChannelType(listener, channel);
    expect(result).toBe(false);
  });
});

describe("checkAllowedUser", () => {
  it("returns true if no requiredRoleIds or requiredUserIds", async () => {
    const listener = new Listener();
    const result = await checkAllowedUser(listener, null);
    expect(result).toBe(true);
  });

  it("returns false if unmet requiredRoleIds", async () => {
    const listener = new Listener().setRequiredRoles("2");
    const roles = { cache: new Map([["1", "_"]]) };
    const members = { fetch: jest.fn().mockResolvedValue({ roles }) };
    const guilds = { cache: new Map([["_", { members }]]) };
    const user = { id: "0", client: { guilds } };
    const result = await checkAllowedUser(listener, user);
    expect(result).toBe(false);
  });

  it("returns true if met requiredRoleIds <string>", async () => {
    const listener = new Listener().setRequiredRoles("2");
    const roles = { cache: new Map([["2", "_"]]) };
    const members = { fetch: jest.fn().mockResolvedValue({ roles }) };
    const guilds = { cache: new Map([["_", { members }]]) };
    const user = { id: "0", client: { guilds } };
    const result = await checkAllowedUser(listener, user);
    expect(result).toBe(true);
  });

  it("returns true if met requiredRoleIds <string[]>", async () => {
    const listener = new Listener().setRequiredRoles(["1", "2"]);
    const roles = { cache: new Map([["2", "_"]]) };
    const members = { fetch: jest.fn().mockResolvedValue({ roles }) };
    const guilds = { cache: new Map([["_", { members }]]) };
    const user = { id: "0", client: { guilds } };
    const result = await checkAllowedUser(listener, user);
    expect(result).toBe(true);
  });

  it("returns false if unmet requiredUserIds", async () => {
    const listener = new Listener().setRequiredUsers("2");
    const cache = new Map([["guild_id", "guild_object"]]);
    const user = { id: "1", client: { guilds: { cache } } };
    const result = await checkAllowedUser(listener, user);
    expect(result).toBe(false);
  });

  it("returns true if met requiredUserIds <string>", async () => {
    const listener = new Listener().setRequiredUsers("2");
    const user = { id: "2" };
    const result = await checkAllowedUser(listener, user);
    expect(result).toBe(true);
  });

  it("returns true if met requiredUserIds <string[]>", async () => {
    const listener = new Listener().setRequiredUsers(["1", "2"]);
    const user = { id: "2" };
    const result = await checkAllowedUser(listener, user);
    expect(result).toBe(true);
  });
})

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