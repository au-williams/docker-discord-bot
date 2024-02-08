export default class ComponentInteraction {
  constructor({ customId, documentation, onInteractionCreate, requiredRoleIds }) {
    this.customId = customId;
    this.documentation = documentation;
    this.onInteractionCreate = onInteractionCreate;
    this.requiredRoleIds = requiredRoleIds;
  }
}
