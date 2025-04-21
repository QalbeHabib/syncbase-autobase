/**
 * RoleInterface - User interface functions for role management and moderation
 * Provides a simplified API for the RoleManager operations
 */
class RoleInterface {
  /**
   * Create a new RoleInterface
   * @param {SyncBase} syncBase - The SyncBase instance
   */
  constructor(syncBase) {
    this.syncBase = syncBase;
  }

  /**
   * Initialize the role interface
   */
  async init() {
    // Ensure the role manager is initialized
    if (!this.syncBase.roleManager) {
      throw new Error("RoleManager not available");
    }

    await this.syncBase.roleManager.init();
  }

  /**
   * List all roles on the server
   * @param {Object} options - Options
   * @param {String} [options.channelId] - Optional channel ID to list channel-specific roles
   * @returns {Promise<Array>} List of roles
   */
  async listRoles(options = {}) {
    try {
      const roles = [];

      if (!this.syncBase._roles) {
        return roles;
      }

      // Filter roles based on channel
      for (const [key, role] of this.syncBase._roles.entries()) {
        if (!options.channelId) {
          // List all roles or only server-wide roles
          if (!role.channelId || options.includeChannelRoles) {
            roles.push(role);
          }
        } else if (role.channelId === options.channelId) {
          // Only include roles for the specified channel
          roles.push(role);
        }
      }

      return roles;
    } catch (err) {
      console.error("Error listing roles:", err);
      throw err;
    }
  }

  /**
   * Create a new role
   * @param {Object} roleOptions - Role configuration
   * @param {String} roleOptions.name - Role name
   * @param {String} [roleOptions.color] - Role color (hex)
   * @param {Array<String>} [roleOptions.permissions] - Permissions to grant
   * @param {String} [roleOptions.channelId] - Channel ID for channel-specific roles
   * @returns {Promise<Object>} Created role
   */
  async createRole(roleOptions) {
    try {
      return await this.syncBase.roleManager.createRole(roleOptions);
    } catch (err) {
      console.error("Error creating role:", err);
      throw err;
    }
  }

  /**
   * Update an existing role
   * @param {String} roleId - ID of the role to update
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} Updated role
   */
  async updateRole(roleId, updates) {
    try {
      return await this.syncBase.roleManager.updateRole(roleId, updates);
    } catch (err) {
      console.error("Error updating role:", err);
      throw err;
    }
  }

  /**
   * Delete a role
   * @param {String} roleId - ID of the role to delete
   * @returns {Promise<Boolean>} Whether the role was deleted
   */
  async deleteRole(roleId) {
    try {
      return await this.syncBase.roleManager.deleteRole(roleId);
    } catch (err) {
      console.error("Error deleting role:", err);
      throw err;
    }
  }

  /**
   * Assign a role to a user
   * @param {String} userId - User ID to assign the role to
   * @param {String} roleId - Role ID to assign
   * @param {Object} [options] - Assignment options
   * @param {String} [options.channelId] - Channel ID for channel-specific role assignment
   * @returns {Promise<Object>} Assignment result
   */
  async assignRole(userId, roleId, options = {}) {
    try {
      return await this.syncBase.roleManager.assignRole(
        userId,
        roleId,
        options
      );
    } catch (err) {
      console.error("Error assigning role:", err);
      throw err;
    }
  }

  /**
   * Remove a role from a user
   * @param {String} userId - User ID to remove the role from
   * @param {String} roleId - Role ID to remove
   * @param {Object} [options] - Removal options
   * @param {String} [options.channelId] - Channel ID for channel-specific role removal
   * @returns {Promise<Boolean>} Whether the role was removed
   */
  async removeRole(userId, roleId, options = {}) {
    try {
      return await this.syncBase.roleManager.removeRole(
        userId,
        roleId,
        options
      );
    } catch (err) {
      console.error("Error removing role:", err);
      throw err;
    }
  }

  /**
   * Get all roles for a user
   * @param {String} userId - User ID to get roles for
   * @param {Object} [options] - Options
   * @param {String} [options.channelId] - Channel ID for channel-specific roles
   * @returns {Promise<Array>} User's roles
   */
  async getUserRoles(userId, options = {}) {
    try {
      return await this.syncBase.roleManager.getUserRoles(userId, options);
    } catch (err) {
      console.error("Error getting user roles:", err);
      throw err;
    }
  }

  /**
   * Kick a user from a channel
   * @param {String} userId - User ID to kick
   * @param {Object} options - Kick options
   * @param {String} options.channelId - Channel to kick from
   * @param {String} [options.reason] - Reason for the kick
   * @param {Number} [options.duration] - Duration in milliseconds (temporary)
   * @returns {Promise<Object>} Kick information
   */
  async kickUser(userId, options) {
    try {
      return await this.syncBase.roleManager.kickUser(userId, options);
    } catch (err) {
      console.error("Error kicking user:", err);
      throw err;
    }
  }

  /**
   * Reinstate a kicked user
   * @param {String} userId - User ID to reinstate
   * @param {String} channelId - Channel to reinstate to
   * @returns {Promise<Boolean>} Whether the user was reinstated
   */
  async reinstateUser(userId, channelId) {
    try {
      return await this.syncBase.roleManager.reinstateUser(userId, channelId);
    } catch (err) {
      console.error("Error reinstating user:", err);
      throw err;
    }
  }

  /**
   * Ban a user
   * @param {String} userId - User ID to ban
   * @param {Object} [options] - Ban options
   * @param {String} [options.channelId] - Channel to ban from (null for server-wide)
   * @param {String} [options.reason] - Reason for the ban
   * @param {Number} [options.duration] - Duration in milliseconds (null for permanent)
   * @returns {Promise<Object>} Ban information
   */
  async banUser(userId, options = {}) {
    try {
      return await this.syncBase.roleManager.banUser(userId, options);
    } catch (err) {
      console.error("Error banning user:", err);
      throw err;
    }
  }

  /**
   * Unban a user
   * @param {String} userId - User ID to unban
   * @param {Object} [options] - Unban options
   * @param {String} [options.channelId] - Channel to unban from (null for server-wide)
   * @returns {Promise<Boolean>} Whether the user was unbanned
   */
  async unbanUser(userId, options = {}) {
    try {
      return await this.syncBase.roleManager.unbanUser(userId, options);
    } catch (err) {
      console.error("Error unbanning user:", err);
      throw err;
    }
  }

  /**
   * Check if a user is banned
   * @param {String} userId - User ID to check
   * @param {Object} [options] - Check options
   * @param {String} [options.channelId] - Channel to check (null for server-wide)
   * @returns {Promise<Boolean>} Whether the user is banned
   */
  async isUserBanned(userId, options = {}) {
    try {
      return await this.syncBase.roleManager.isUserBanned(userId, options);
    } catch (err) {
      console.error("Error checking user ban status:", err);
      return false;
    }
  }

  /**
   * Check if a user is kicked from a channel
   * @param {String} userId - User ID to check
   * @param {String} channelId - Channel to check
   * @returns {Promise<Boolean>} Whether the user is kicked
   */
  async isUserKicked(userId, channelId) {
    try {
      return await this.syncBase.roleManager.isUserKicked(userId, channelId);
    } catch (err) {
      console.error("Error checking user kick status:", err);
      return false;
    }
  }

  /**
   * List all banned users
   * @param {Object} [options] - List options
   * @param {String} [options.channelId] - Channel to list bans for (null for server-wide)
   * @returns {Promise<Array>} List of banned users with reasons
   */
  async listBannedUsers(options = {}) {
    try {
      const bannedUsers = [];

      if (!this.syncBase._bannedUsers) {
        return bannedUsers;
      }

      // Filter based on channel
      for (const [key, banInfo] of this.syncBase._bannedUsers.entries()) {
        if (!options.channelId && banInfo.channelId === null) {
          // Server-wide bans when no channelId specified
          bannedUsers.push(banInfo);
        } else if (
          options.channelId &&
          banInfo.channelId === options.channelId
        ) {
          // Channel-specific bans
          bannedUsers.push(banInfo);
        }
      }

      return bannedUsers;
    } catch (err) {
      console.error("Error listing banned users:", err);
      return [];
    }
  }

  /**
   * List all kicked users from a channel
   * @param {String} channelId - Channel to list kicks for
   * @returns {Promise<Array>} List of kicked users with reasons
   */
  async listKickedUsers(channelId) {
    try {
      const kickedUsers = [];

      if (!this.syncBase._kickedUsers) {
        return kickedUsers;
      }

      // Filter for this channel
      for (const [key, kickInfo] of this.syncBase._kickedUsers.entries()) {
        if (kickInfo.channelId === channelId) {
          kickedUsers.push(kickInfo);
        }
      }

      return kickedUsers;
    } catch (err) {
      console.error("Error listing kicked users:", err);
      return [];
    }
  }
}

module.exports = RoleInterface;
