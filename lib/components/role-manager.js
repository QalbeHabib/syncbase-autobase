const b4a = require('b4a')
const { Permissions, PermissionType } = require('./permission-manager.js')

/**
 * Default role types that exist in the system
 * @enum {String}
 */
const RoleType = {
  OWNER: 'OWNER',               // Server owner - has all permissions
  ADMINISTRATOR: 'ADMINISTRATOR', // Server administrator
  MODERATOR: 'MODERATOR',       // Channel moderator
  MEMBER: 'MEMBER',             // Regular server member
  GUEST: 'GUEST'                // User with limited access
}

/**
 * ModerationAction types for user moderation
 * @enum {String}
 */
const ModerationAction = {
  KICK: 'KICK',     // Temporary removal from channel
  BAN: 'BAN',       // Permanent removal from channel
  UNBAN: 'UNBAN'    // Remove a ban
}

/**
 * Role Manager for SyncBase
 * Handles custom roles, role assignment, and user moderation
 */
class RoleManager {
  /**
   * Create a role manager
   * @param {SyncBase} syncBase - The SyncBase instance
   * @param {Permissions} permissions - The permissions manager
   */
  constructor(syncBase, permissions) {
    this.syncBase = syncBase
    this.permissions = permissions
  }

  /**
   * Initialize the role manager
   */
  async init() {
    // Initialize role storage if it doesn't exist
    if (!this.syncBase._roles) {
      this.syncBase._roles = new Map()
    }

    // Initialize banned users storage
    if (!this.syncBase._bannedUsers) {
      this.syncBase._bannedUsers = new Map()
    }

    // Initialize kicked users storage (temporary)
    if (!this.syncBase._kickedUsers) {
      this.syncBase._kickedUsers = new Map()
    }
  }

  /**
   * Create a custom role
   * @param {Object} options - Role options
   * @param {String} options.name - Role name
   * @param {String} options.color - Role color (hex)
   * @param {Array<String>} options.permissions - List of permissions for this role
   * @param {String} [options.channelId] - Channel to restrict role to, if applicable
   * @returns {Promise<Object>} The created role
   */
  async createRole(options) {
    try {
      // Verify the user has permission to create roles
      const currentUserId = b4a.toString(this.syncBase.crypto.publicKey, 'hex')
      const hasPermission = await this.permissions.hasPermission('ADMINISTRATOR', {
        userId: currentUserId,
        channelId: options.channelId
      }) || await this.syncBase.permissions.hasPermission('MANAGE_PERMISSIONS', {
        userId: currentUserId,
        channelId: options.channelId
      })

      if (!hasPermission) {
        throw new Error('You do not have permission to create roles')
      }

      // Validate role name
      if (!options.name || options.name.trim().length === 0) {
        throw new Error('Role name is required')
      }

      // Validate permissions
      if (options.permissions) {
        for (const permission of options.permissions) {
          if (!Object.values(PermissionType).includes(permission)) {
            throw new Error(`Invalid permission type: ${permission}`)
          }
        }
      }

      // Generate role ID
      const roleId = this.syncBase.crypto.generateId()

      // Create role data
      const roleData = {
        id: roleId,
        name: options.name,
        color: options.color || '#99AAB5', // Default Discord-like color
        permissions: options.permissions || [],
        channelId: options.channelId || null,
        createdBy: currentUserId,
        createdAt: Date.now()
      }

      // Store role in local map
      const roleKey = `${roleId}:${options.channelId || 'server'}`
      this.syncBase._roles.set(roleKey, roleData)

      // In a real implementation, we would also store in the database
      console.log(`Created role ${options.name} with ID ${roleId}`)

      return roleData
    } catch (err) {
      console.error('Error creating role:', err)
      throw err
    }
  }

  /**
   * Update an existing role
   * @param {String} roleId - ID of the role to update
   * @param {Object} updates - Updates to apply
   * @param {String} [updates.name] - New role name
   * @param {String} [updates.color] - New role color
   * @param {Array<String>} [updates.permissions] - New permissions list
   * @returns {Promise<Object>} The updated role
   */
  async updateRole(roleId, updates) {
    try {
      // Verify the user has permission to update roles
      const currentUserId = b4a.toString(this.syncBase.crypto.publicKey, 'hex')

      // Get the role
      const roleKeys = Array.from(this.syncBase._roles.keys())
      const roleKey = roleKeys.find(key => key.startsWith(`${roleId}:`))

      if (!roleKey) {
        throw new Error(`Role with ID ${roleId} not found`)
      }

      const role = this.syncBase._roles.get(roleKey)

      // Check permission based on channel or server role
      const hasPermission = await this.permissions.hasPermission('ADMINISTRATOR', {
        userId: currentUserId,
        channelId: role.channelId
      }) || await this.permissions.hasPermission('MANAGE_PERMISSIONS', {
        userId: currentUserId,
        channelId: role.channelId
      })

      if (!hasPermission) {
        throw new Error('You do not have permission to update roles')
      }

      // Validate permissions if provided
      if (updates.permissions) {
        for (const permission of updates.permissions) {
          if (!Object.values(PermissionType).includes(permission)) {
            throw new Error(`Invalid permission type: ${permission}`)
          }
        }
      }

      // Update role data
      const updatedRole = {
        ...role,
        name: updates.name !== undefined ? updates.name : role.name,
        color: updates.color !== undefined ? updates.color : role.color,
        permissions: updates.permissions !== undefined ? updates.permissions : role.permissions,
        updatedBy: currentUserId,
        updatedAt: Date.now()
      }

      // Store updated role
      this.syncBase._roles.set(roleKey, updatedRole)

      console.log(`Updated role ${updatedRole.name}`)

      return updatedRole
    } catch (err) {
      console.error('Error updating role:', err)
      throw err
    }
  }

  /**
   * Delete a role
   * @param {String} roleId - ID of the role to delete
   * @returns {Promise<Boolean>} Whether the role was deleted
   */
  async deleteRole(roleId) {
    try {
      // Verify the user has permission to delete roles
      const currentUserId = b4a.toString(this.syncBase.crypto.publicKey, 'hex')

      // Get the role
      const roleKeys = Array.from(this.syncBase._roles.keys())
      const roleKey = roleKeys.find(key => key.startsWith(`${roleId}:`))

      if (!roleKey) {
        throw new Error(`Role with ID ${roleId} not found`)
      }

      const role = this.syncBase._roles.get(roleKey)

      // Check if the role is a system role (cannot be deleted)
      if (Object.values(RoleType).includes(role.name)) {
        throw new Error(`Cannot delete system role: ${role.name}`)
      }

      // Check permission based on channel or server role
      const hasPermission = await this.permissions.hasPermission('ADMINISTRATOR', {
        userId: currentUserId,
        channelId: role.channelId
      }) || await this.permissions.hasPermission('MANAGE_PERMISSIONS', {
        userId: currentUserId,
        channelId: role.channelId
      })

      if (!hasPermission) {
        throw new Error('You do not have permission to delete roles')
      }

      // Delete the role
      this.syncBase._roles.delete(roleKey)

      console.log(`Deleted role ${role.name}`)

      return true
    } catch (err) {
      console.error('Error deleting role:', err)
      throw err
    }
  }

  /**
   * Assign a role to a user
   * @param {String} userId - ID of the user to assign the role to
   * @param {String} roleId - ID of the role to assign
   * @param {Object} options - Additional options
   * @param {String} [options.channelId] - Channel to restrict role to, if applicable
   * @returns {Promise<Object>} The user role assignment
   */
  async assignRole(userId, roleId, options = {}) {
    try {
      // Verify the user has permission to assign roles
      const currentUserId = b4a.toString(this.syncBase.crypto.publicKey, 'hex')

      // Get the role
      const roleKeys = Array.from(this.syncBase._roles.keys())
      const roleKey = roleKeys.find(key => key.startsWith(`${roleId}:`))

      if (!roleKey) {
        throw new Error(`Role with ID ${roleId} not found`)
      }

      const role = this.syncBase._roles.get(roleKey)

      // Check permission based on channel or server role
      const hasPermission = await this.permissions.hasPermission('ADMINISTRATOR', {
        userId: currentUserId,
        channelId: options.channelId
      }) || await this.permissions.hasPermission('MANAGE_PERMISSIONS', {
        userId: currentUserId,
        channelId: options.channelId
      })

      if (!hasPermission) {
        throw new Error('You do not have permission to assign roles')
      }

      // Check if this is a system role (special handling)
      if (role.name === RoleType.OWNER) {
        // Only an existing owner can assign the owner role
        const isOwner = await this.checkUserRole(currentUserId, RoleType.OWNER, options)
        if (!isOwner) {
          throw new Error('Only the server owner can assign the owner role')
        }
      }

      // Create user role assignment
      const assignmentData = {
        userId,
        roleId,
        channelId: options.channelId || null,
        assignedBy: currentUserId,
        assignedAt: Date.now()
      }

      // Store assignment
      const assignmentKey = `${userId}:${roleId}:${options.channelId || 'server'}`
      if (!this.syncBase._userRoles) {
        this.syncBase._userRoles = new Map()
      }
      this.syncBase._userRoles.set(assignmentKey, assignmentData)

      // Grant permissions for this role to the user
      if (role.permissions && role.permissions.length > 0) {
        for (const permission of role.permissions) {
          await this.permissions.grantPermission(userId, permission, {
            channelId: options.channelId
          })
        }
      }

      console.log(`Assigned role ${role.name} to user ${userId}`)

      return assignmentData
    } catch (err) {
      console.error('Error assigning role:', err)
      throw err
    }
  }

  /**
   * Remove a role from a user
   * @param {String} userId - ID of the user to remove the role from
   * @param {String} roleId - ID of the role to remove
   * @param {Object} options - Additional options
   * @param {String} [options.channelId] - Channel context, if applicable
   * @returns {Promise<Boolean>} Whether the role was removed
   */
  async removeRole(userId, roleId, options = {}) {
    try {
      // Verify the user has permission to remove roles
      const currentUserId = b4a.toString(this.syncBase.crypto.publicKey, 'hex')

      // Check permission based on channel or server context
      const hasPermission = await this.permissions.hasPermission('ADMINISTRATOR', {
        userId: currentUserId,
        channelId: options.channelId
      }) || await this.permissions.hasPermission('MANAGE_PERMISSIONS', {
        userId: currentUserId,
        channelId: options.channelId
      })

      if (!hasPermission) {
        throw new Error('You do not have permission to remove roles')
      }

      // Get role information
      const roleKeys = Array.from(this.syncBase._roles.keys())
      const roleKey = roleKeys.find(key => key.startsWith(`${roleId}:`))

      if (!roleKey) {
        throw new Error(`Role with ID ${roleId} not found`)
      }

      const role = this.syncBase._roles.get(roleKey)

      // Check if this is a protected role (owner)
      if (role.name === RoleType.OWNER) {
        // Only an existing owner can remove the owner role
        const isOwner = await this.checkUserRole(currentUserId, RoleType.OWNER, options)
        if (!isOwner) {
          throw new Error('Only the server owner can remove the owner role')
        }
      }

      // Remove role assignment
      if (!this.syncBase._userRoles) {
        return false // No user roles exist
      }

      const assignmentKey = `${userId}:${roleId}:${options.channelId || 'server'}`
      const hadRole = this.syncBase._userRoles.has(assignmentKey)
      this.syncBase._userRoles.delete(assignmentKey)

      // Revoke permissions associated with this role
      if (role.permissions && role.permissions.length > 0) {
        for (const permission of role.permissions) {
          // Check if user has this permission from another role first
          const shouldRevoke = !await this.userHasPermissionFromOtherRoles(
            userId, permission, roleId, options.channelId
          )

          if (shouldRevoke) {
            await this.permissions.revokePermission(userId, permission, {
              channelId: options.channelId
            })
          }
        }
      }

      if (hadRole) {
        console.log(`Removed role ${role.name} from user ${userId}`)
      }

      return hadRole
    } catch (err) {
      console.error('Error removing role:', err)
      throw err
    }
  }

  /**
   * Check if a user has a specific role
   * @param {String} userId - The user ID to check
   * @param {String} roleNameOrId - The role name or ID to check for
   * @param {Object} options - Additional options
   * @param {String} [options.channelId] - Channel to check in, if applicable
   * @returns {Promise<Boolean>} Whether the user has the role
   */
  async checkUserRole(userId, roleNameOrId) {
    try {
      await this.syncBase.base.ready()
      const userRole = await this.syncBase.base.view.findOne('@server/role', { userId })
      if (userRole && userRole.role == roleNameOrId) return true;
      return false
    } catch (err) {
      console.error('Error checking user role:', err)
      return false
    }
  }

  /**
   * Get all roles for a user
   * @param {String} userId - The user ID to get roles for
   * @param {Object} options - Additional options
   * @param {String} [options.channelId] - Channel context, if applicable
   * @returns {Promise<Array<Object>>} List of user roles
   */
  async getUserRoles(userId, options = {}) {
    try {
      if (!this.syncBase._userRoles) {
        return []
      }

      const userRoles = []
      const channelContext = options.channelId || 'server'

      // Find all role assignments for this user
      for (const [key, assignment] of this.syncBase._userRoles.entries()) {
        if (key.startsWith(`${userId}:`) && key.endsWith(`:${channelContext}`)) {
          // Get the role details
          const roleId = assignment.roleId
          const roleKeys = Array.from(this.syncBase._roles.keys())
          const roleKey = roleKeys.find(k => k.startsWith(`${roleId}:`))

          if (roleKey) {
            const role = this.syncBase._roles.get(roleKey)
            userRoles.push({
              ...role,
              assignedAt: assignment.assignedAt,
              assignedBy: assignment.assignedBy
            })
          }
        }
      }

      return userRoles
    } catch (err) {
      console.error('Error getting user roles:', err)
      return []
    }
  }

  /**
   * Check if a user has a permission from any role other than the specified role
   * @param {String} userId - The user ID to check
   * @param {String} permission - The permission to check for
   * @param {String} excludeRoleId - Role ID to exclude from check
   * @param {String} [channelId] - Channel context, if applicable
   * @returns {Promise<Boolean>} Whether the user has the permission from another role
   * @private
   */
  async userHasPermissionFromOtherRoles(userId, permission, excludeRoleId, channelId) {
    if (!this.syncBase._userRoles || !this.syncBase._roles) {
      return false
    }

    // Get all roles for this user
    const userRoles = await this.getUserRoles(userId, { channelId })

    // Check if any role other than the excluded one grants this permission
    for (const role of userRoles) {
      if (role.id !== excludeRoleId && role.permissions.includes(permission)) {
        return true
      }
    }

    return false
  }

  /**
   * Kick a user from a channel
   * @param {String} userId - The user ID to kick
   * @param {Object} options - Kick options
   * @param {String} options.channelId - The channel to kick from
   * @param {String} [options.reason] - Reason for kicking
   * @param {Number} [options.duration] - Duration in milliseconds (temporary)
   * @returns {Promise<Object>} Kick information
   */
  async kickUser(userId, options) {
    try {
      if (!options.channelId) {
        throw new Error('Channel ID is required for kicking a user')
      }

      // Verify the user has permission to kick
      const currentUserId = b4a.toString(this.syncBase.crypto.publicKey, 'hex')

      // Check for admin or mod permission
      const hasKickPermission = await this.permissions.hasPermission('ADMINISTRATOR', {
        userId: currentUserId,
        channelId: options.channelId
      })

      // Check if current user is a moderator
      const isChannelMod = await this.checkUserRole(currentUserId, RoleType.MODERATOR, {
        channelId: options.channelId
      })

      if (!hasKickPermission && !isChannelMod) {
        throw new Error('You do not have permission to kick users from this channel')
      }

      // Verify the target user isn't a higher role
      const targetRoles = await this.getUserRoles(userId, { channelId: options.channelId })
      const currentUserRoles = await this.getUserRoles(currentUserId, { channelId: options.channelId })

      // Calculate highest role levels
      const getHighestRoleLevel = (roles) => {
        let highest = -1
        for (const role of roles) {
          const roleLevel = Object.keys(RoleType).findIndex(key => RoleType[key] === role.name)
          if (roleLevel > highest) {
            highest = roleLevel
          }
        }
        return highest
      }

      const targetLevel = getHighestRoleLevel(targetRoles)
      const currentLevel = getHighestRoleLevel(currentUserRoles)

      if (targetLevel >= currentLevel && targetLevel >= 0) {
        throw new Error('Cannot kick a user with equal or higher role')
      }

      // Create kick record
      const kickData = {
        userId,
        channelId: options.channelId,
        reason: options.reason || 'No reason provided',
        kickedBy: currentUserId,
        kickedAt: Date.now(),
        duration: options.duration || null, // null = indefinite until manual reinstatement
        expires: options.duration ? Date.now() + options.duration : null
      }

      // Store kick record
      const kickKey = `${userId}:${options.channelId}`
      this.syncBase._kickedUsers.set(kickKey, kickData)

      // Revoke channel permissions temporarily (but keep them for reinstatement)
      // In a real implementation, we'd store them in the kick record
      console.log(`Kicked user ${userId} from channel ${options.channelId}`)

      return kickData
    } catch (err) {
      console.error('Error kicking user:', err)
      throw err
    }
  }

  /**
   * Reinstate a kicked user to a channel
   * @param {String} userId - The user ID to reinstate
   * @param {String} channelId - The channel to reinstate to
   * @returns {Promise<Boolean>} Whether the user was reinstated
   */
  async reinstateUser(userId, channelId) {
    try {
      // Verify the user has permission to reinstate
      const currentUserId = b4a.toString(this.syncBase.crypto.publicKey, 'hex')

      // Check for admin or mod permission
      const hasAdminPermission = await this.permissions.hasPermission('ADMINISTRATOR', {
        userId: currentUserId,
        channelId: channelId
      })

      // Check if current user is a moderator
      const isChannelMod = await this.checkUserRole(currentUserId, RoleType.MODERATOR, {
        channelId: channelId
      })

      if (!hasAdminPermission && !isChannelMod) {
        throw new Error('You do not have permission to reinstate users to this channel')
      }

      // Check if user is kicked
      const kickKey = `${userId}:${channelId}`
      if (!this.syncBase._kickedUsers.has(kickKey)) {
        return false // User is not kicked
      }

      // Remove kick record
      this.syncBase._kickedUsers.delete(kickKey)

      // Restore permissions (in real implementation)
      console.log(`Reinstated user ${userId} to channel ${channelId}`)

      return true
    } catch (err) {
      console.error('Error reinstating user:', err)
      throw err
    }
  }

  /**
   * Ban a user from a channel or server
   * @param {String} userId - The user ID to ban
   * @param {Object} options - Ban options
   * @param {String} [options.channelId] - The channel to ban from (null for server-wide)
   * @param {String} [options.reason] - Reason for banning
   * @param {Number} [options.duration] - Duration in milliseconds (null = permanent)
   * @returns {Promise<Object>} Ban information
   */
  async banUser(userId, options = {}) {
    try {
      // Verify the user has permission to ban
      const currentUserId = b4a.toString(this.syncBase.crypto.publicKey, 'hex')

      // Check for admin permission (for server ban) or channel-specific permission
      let hasBanPermission = false

      if (!options.channelId) {
        // Server-wide ban requires admin
        hasBanPermission = await this.permissions.hasPermission('ADMINISTRATOR', {
          userId: currentUserId
        })
      } else {
        // Channel ban can be done by admin or mod
        hasBanPermission = await this.permissions.hasPermission('ADMINISTRATOR', {
          userId: currentUserId,
          channelId: options.channelId
        })

        // Check if current user is a moderator of this channel
        const isChannelMod = await this.checkUserRole(currentUserId, RoleType.MODERATOR, {
          channelId: options.channelId
        })

        hasBanPermission = hasBanPermission || isChannelMod
      }

      if (!hasBanPermission) {
        throw new Error('You do not have permission to ban users')
      }

      // Verify the target user isn't a higher role
      // For server ban or channel ban, check respective context
      const targetRoles = await this.getUserRoles(userId, {
        channelId: options.channelId
      })
      const currentUserRoles = await this.getUserRoles(currentUserId, {
        channelId: options.channelId
      })

      // Calculate highest role levels
      const getHighestRoleLevel = (roles) => {
        let highest = -1
        for (const role of roles) {
          const roleLevel = Object.keys(RoleType).findIndex(key => RoleType[key] === role.name)
          if (roleLevel > highest) {
            highest = roleLevel
          }
        }
        return highest
      }

      const targetLevel = getHighestRoleLevel(targetRoles)
      const currentLevel = getHighestRoleLevel(currentUserRoles)

      if (targetLevel >= currentLevel && targetLevel >= 0) {
        throw new Error('Cannot ban a user with equal or higher role')
      }

      // Create ban record
      const banData = {
        userId,
        channelId: options.channelId || null, // null = server-wide ban
        reason: options.reason || 'No reason provided',
        bannedBy: currentUserId,
        bannedAt: Date.now(),
        duration: options.duration, // null = permanent
        expires: options.duration ? Date.now() + options.duration : null
      }

      // Store ban record
      const banKey = `${userId}:${options.channelId || 'server'}`
      this.syncBase._bannedUsers.set(banKey, banData)

      // If it's a server-wide ban, kick from all channels too
      if (!options.channelId) {
        // In a real implementation, we'd iterate through all channels
        console.log(`Banned user ${userId} from the entire server`)
      } else {
        console.log(`Banned user ${userId} from channel ${options.channelId}`)
      }

      return banData
    } catch (err) {
      console.error('Error banning user:', err)
      throw err
    }
  }

  /**
   * Unban a user from a channel or server
   * @param {String} userId - The user ID to unban
   * @param {Object} options - Unban options
   * @param {String} [options.channelId] - The channel to unban from (null for server-wide)
   * @returns {Promise<Boolean>} Whether the user was unbanned
   */
  async unbanUser(userId, options = {}) {
    try {
      // Verify the user has permission to unban
      const currentUserId = b4a.toString(this.syncBase.crypto.publicKey, 'hex')

      // Check for admin permission (for server unban) or channel-specific permission
      let hasUnbanPermission = false

      if (!options.channelId) {
        // Server-wide unban requires admin
        hasUnbanPermission = await this.permissions.hasPermission('ADMINISTRATOR', {
          userId: currentUserId
        })
      } else {
        // Channel unban can be done by admin or mod
        hasUnbanPermission = await this.permissions.hasPermission('ADMINISTRATOR', {
          userId: currentUserId,
          channelId: options.channelId
        })

        // Check if current user is a moderator of this channel
        const isChannelMod = await this.checkUserRole(currentUserId, RoleType.MODERATOR, {
          channelId: options.channelId
        })

        hasUnbanPermission = hasUnbanPermission || isChannelMod
      }

      if (!hasUnbanPermission) {
        throw new Error('You do not have permission to unban users')
      }

      // Check if user is banned
      const banKey = `${userId}:${options.channelId || 'server'}`
      if (!this.syncBase._bannedUsers.has(banKey)) {
        return false // User is not banned
      }

      // Remove ban record
      this.syncBase._bannedUsers.delete(banKey)

      if (!options.channelId) {
        console.log(`Unbanned user ${userId} from the entire server`)
      } else {
        console.log(`Unbanned user ${userId} from channel ${options.channelId}`)
      }

      return true
    } catch (err) {
      console.error('Error unbanning user:', err)
      throw err
    }
  }

  /**
   * Check if a user is banned from a channel or server
   * @param {String} userId - The user ID to check
   * @param {Object} options - Check options
   * @param {String} [options.channelId] - The channel to check (null for server-wide)
   * @returns {Promise<Boolean>} Whether the user is banned
   */
  async isUserBanned(userId, options = {}) {
    try {
      // Check for channel-specific ban
      if (options.channelId) {
        const channelBanKey = `${userId}:${options.channelId}`
        if (this.syncBase._bannedUsers.has(channelBanKey)) {
          const banInfo = this.syncBase._bannedUsers.get(channelBanKey)

          // Check if the ban has expired
          if (banInfo.expires && banInfo.expires < Date.now()) {
            // Ban has expired, remove it
            this.syncBase._bannedUsers.delete(channelBanKey)
            return false
          }

          return true
        }
      }

      // Check for server-wide ban
      const serverBanKey = `${userId}:server`
      if (this.syncBase._bannedUsers.has(serverBanKey)) {
        const banInfo = this.syncBase._bannedUsers.get(serverBanKey)

        // Check if the ban has expired
        if (banInfo.expires && banInfo.expires < Date.now()) {
          // Ban has expired, remove it
          this.syncBase._bannedUsers.delete(serverBanKey)
          return false
        }

        return true
      }

      return false
    } catch (err) {
      console.error('Error checking if user is banned:', err)
      return false
    }
  }

  /**
   * Check if a user is kicked from a channel
   * @param {String} userId - The user ID to check
   * @param {String} channelId - The channel to check
   * @returns {Promise<Boolean>} Whether the user is kicked
   */
  async isUserKicked(userId, channelId) {
    try {
      const kickKey = `${userId}:${channelId}`
      if (this.syncBase._kickedUsers.has(kickKey)) {
        const kickInfo = this.syncBase._kickedUsers.get(kickKey)

        // Check if the kick has expired
        if (kickInfo.expires && kickInfo.expires < Date.now()) {
          // Kick has expired, remove it
          this.syncBase._kickedUsers.delete(kickKey)
          return false
        }

        return true
      }

      return false
    } catch (err) {
      console.error('Error checking if user is kicked:', err)
      return false
    }
  }
}

module.exports = { RoleManager, RoleType, ModerationAction } 
