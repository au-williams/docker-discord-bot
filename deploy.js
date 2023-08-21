import { Logger } from "./logger.js";
import { REST, Routes } from "discord.js";
import fs from "fs-extra";

try {
  const filenames = fs.readdirSync(`./components/`).filter(x => x.endsWith("_script.js"));
  const body = [];

  for await (const filename of filenames) {
    const instance = await import(`./components/${filename}`);
    const predicate = (({ name, description }) => ({ name, description }));
    if (instance.COMMAND_INTERACTIONS) body.push(...instance.COMMAND_INTERACTIONS.map(predicate));
  }

  const { client_id, login_token } = fs.readJsonSync("config.json");
  const rest = new REST({ version: "10" }).setToken(login_token);
  const data = await rest.put(Routes.applicationCommands(client_id), { body });

  Logger.Info(`Successfully reloaded ${data.length} (/) commands`, "deploy.js");
}
catch({ stack }) {
  Logger.Error(stack, "deploy.js");
}

process.exit();
