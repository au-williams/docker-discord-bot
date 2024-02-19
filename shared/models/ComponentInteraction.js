export default class ComponentInteraction {
  constructor({ customId, documentation, onInteractionCreate, requiredUserRoleIds }) {
    this.customId = customId;
    this.documentation = documentation;
    this.onInteractionCreate = onInteractionCreate;
    this.requiredUserRoleIds = requiredUserRoleIds;
  }
}
