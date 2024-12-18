export const DeploymentTypes = Object.freeze({
  ChatInputCommand: "ChatInputCommand",
  UserContextMenuCommand: "UserContextMenuCommand",
});

export const IsDeploymentType = input => {
  return Object.values(DeploymentTypes).includes(input);
}
