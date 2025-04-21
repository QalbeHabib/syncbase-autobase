/**
 * Permission types that can be granted to users
 * @enum {String}
 */
const PermissionType = {
  ADMINISTRATOR: "ADMINISTRATOR", // Full control over server
  CREATE_CHANNEL: "CREATE_CHANNEL", // Ability to create channels
  SEND_MESSAGES: "SEND_MESSAGES", // Ability to send messages
  READ_MESSAGES: "READ_MESSAGES", // Ability to read messages
  DELETE_MESSAGES: "DELETE_MESSAGES", // Ability to delete messages
  DELETE_CHANNELS: "DELETE_CHANNELS", // Ability to delete channels
  MANAGE_INVITES: "MANAGE_INVITES", // Ability to invite others
  MANAGE_PERMISSIONS: "MANAGE_PERMISSIONS", // Ability to modify permissions
};

/**
 * Permissions manager for SyncBase
 * Handles checking and assigning permissions to users
 */
class Permissions {
  constructor(syncBase) {
    this.syncBase = syncBase;
  }
}

module.exports = { Permissions, PermissionType };
