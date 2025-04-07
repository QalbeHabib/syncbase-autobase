const { dispatch } = require('./spec/hyperdispatch/')
const b4a = require('b4a')

/**
 * PermissionManager - Handles user roles and permissions
 */
class PermissionManager {
  /**
   * Create a new PermissionManager instance
   * @param {SyncBase} syncBase - The SyncBase instance
   * @param {ActionValidator} validator - Action validator instance
   */
  constructor(syncBase, validator) {
    this.syncBase = syncBase
    this.validator = validator

    // Define available roles and their hierarchy
    this.ROLES = {
      OWNER: 4,
      ADMIN: 3,
      MODERATOR: 2,
      MEMBER: 1,
      GUEST: 0
    }

    // Define permissions for each role
    this.PERMISSIONS = {
      OWNER: [
        'MANAGE_SERVER',
        'MANAGE_CHANNELS',
        'MANAGE_ROLES',
        'MANAGE_INVITES',
        'KICK_MEMBERS',
        'BAN_MEMBERS',
        'CREATE_INVITES',
        'SEND_MESSAGES',
        'DELETE_MESSAGES',
        'PIN_MESSAGES',
        'EMBED_LINKS',
        'ATTACH_FILES',
        'READ_MESSAGE_HISTORY'
      ],
      ADMIN: [
        'MANAGE_CHANNELS',
        'MANAGE_ROLES',
        'MANAGE_INVITES',
        'KICK_MEMBERS',
        'BAN_MEMBERS',
        'CREATE_INVITES',
        'SEND_MESSAGES',
        'DELETE_MESSAGES',
        'PIN_MESSAGES',
        'EMBED_LINKS',
        'ATTACH_FILES',
        'READ_MESSAGE_HISTORY'
      ],
      MODERATOR: [
        'KICK_MEMBERS',
        'CREATE_INVITES',
        'SEND_MESSAGES',
        'DELETE_MESSAGES',
        'PIN_MESSAGES',
        'EMBED_LINKS',
        'ATTACH_FILES',
        'READ_MESSAGE_HISTORY'
      ],
      MEMBER: [
        'SEND_MESSAGES',
        'EMBED_LINKS',
        'ATTACH_FILES',
        'READ_MESSAGE_HISTORY'
      ],
      GUEST: [
        'READ_MESSAGE_HISTORY'
      ]
    }
  }

  /**
   * Initialize permission manager
   * @returns {Promise<void>}
   */
  async init() {
    // Nothing to initialize for now
  }

  /**
   * Set a user's role in a server
   * @param {Object} params - Role parameters
   * @param {String} params.userId - The user ID
   * @param {String} params.serverId - The server ID
   * @param {String} params.role - The role to set
   * @param {Number} [params.timestamp] - Optional timestamp
   * @returns {Promise<Object>} The updated role
   */
  async setRole({ userId, serverId, role, timestamp = Date.now() }) {
    // Validate the role
    if (!this.ROLES[role]) {
      throw new Error(`Invalid role: ${role}`)
    }

    // Create the set role action
    const action = this.syncBase.crypto.createSignedAction('@server/set-role', {
      userId,
      serverId,
      role,
      timestamp
    })

    // Dispatch the action
    await this.syncBase.base.append(dispatch('@server/set-role', action))

    return { userId, serverId, role }
  }

  /**
   * Get a user's role in a server
   * @param {String} userId - The user ID
   * @param {String} serverId - The server ID
   * @returns {Promise<String>} The user's role
   */
  async getUserRole(userId, serverId) {
    const roleRecord = await this.syncBase.base.view.findOne('@server/role', { userId, serverId })
    return roleRecord ? roleRecord.role : 'GUEST'
  }

  /**
   * Check if a user has a specific permission in a server
   * @param {String} userId - The user ID
   * @param {String} serverId - The server ID
   * @param {String} permission - The permission to check
   * @returns {Promise<Boolean>} Whether the user has the permission
   */
  async hasPermission(userId, serverId, permission) {
    // Get the user's role
    const role = await this.getUserRole(userId, serverId)

    // Check if the role has the permission
    return this.PERMISSIONS[role]?.includes(permission) || false
  }

  /**
   * Check if a user has a higher role than another user
   * @param {String} userId - The user ID
   * @param {String} targetUserId - The target user ID
   * @param {String} serverId - The server ID
   * @returns {Promise<Boolean>} Whether the user has a higher role
   */
  async hasHigherRole(userId, targetUserId, serverId) {
    // Get both users' roles
    const userRole = await this.getUserRole(userId, serverId)
    const targetRole = await this.getUserRole(targetUserId, serverId)

    // Compare role levels
    return this.ROLES[userRole] > this.ROLES[targetRole]
  }

  /**
   * Get all users with a specific role in a server
   * @param {String} serverId - The server ID
   * @param {String} role - The role to filter by
   * @returns {Promise<Array<Object>>} The users with the role
   */
  async getUsersWithRole(serverId, role) {
    const roleRecords = await this.syncBase.base.view.find('@server/role', { serverId, role })

    // Get the full user objects
    const users = []
    for (const record of roleRecords) {
      const user = await this.syncBase.base.view.findOne('@server/user', { id: record.userId })
      if (user) {
        users.push(user)
      }
    }

    return users
  }

  /**
   * Get the server owner
   * @param {String} serverId - The server ID
   * @returns {Promise<Object|null>} The owner user or null if not found
   */
  async getServerOwner(serverId) {
    const ownerRole = await this.syncBase.base.view.findOne('@server/role', { serverId, role: 'OWNER' })
    if (!ownerRole) return null

    return this.syncBase.base.view.findOne('@server/user', { id: ownerRole.userId })
  }

  /**
   * Check if the current user is the server owner
   * @param {String} serverId - The server ID
   * @returns {Promise<Boolean>} Whether the current user is the owner
   */
  async isServerOwner(serverId) {
    const currentUserId = b4a.toString(this.syncBase.writerKey, 'hex')
    const ownerRole = await this.syncBase.base.view.findOne('@server/role', { serverId, role: 'OWNER' })

    return ownerRole && ownerRole.userId === currentUserId
  }
}

module.exports = PermissionManager
