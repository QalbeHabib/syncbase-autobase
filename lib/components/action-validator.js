const b4a = require('b4a')
const DatabaseManager = require('./database-manager')

/**
 * ActionValidator - Validates user actions before they're applied
 */
class ActionValidator {
  /**
   * Create a new ActionValidator instance
   * @param {CryptoManager} crypto - Crypto manager instance
   */
  constructor(crypto) {
    this.crypto = crypto
  }

  /**
   * Validate an action
   * @param {Object} action - The action to validate
   * @param {Buffer} authorKey - The public key of the author
   * @param {Object} view - The database view
   * @param {Boolean} optimistic - Whether this is an optimistic operation
   * @returns {Promise<Boolean>} Whether the action is valid
   */
  async validateAction(action, authorKey, view, optimistic) {
    // Verify the signature first
    if (!this._verifySignature(action, authorKey)) {
      return false
    }

    // Get the author ID (hex string of the public key)
    const authorId = b4a.toString(authorKey, 'hex')

    // Check if this is a CLAIM_INVITE, which is the only action allowed optimistically
    if (optimistic && action.type !== 'CLAIM_INVITE') {
      return false
    }

    // Handle different action types
    switch (action.type) {
      case 'CREATE_SERVER':
        return optimistic ? false : this._validateCreateServer(action, authorId, view)

      case 'CREATE_CHANNEL':
        return optimistic ? false : this._validateCreateChannel(action, authorId, view)

      case 'SEND_MESSAGE':
        return optimistic ? false : this._validateSendMessage(action, authorId, view)

      case 'SET_ROLE':
        return optimistic ? false : this._validateSetRole(action, authorId, view)

      case 'CLAIM_INVITE':
        return this._validateClaimInvite(action, authorKey, view)

      case 'CREATE_INVITE':
        return optimistic ? false : this._validateCreateInvite(action, authorId, view)

      case 'DELETE_MESSAGE':
        return optimistic ? false : this._validateDeleteMessage(action, authorId, view)

      default:
        return false
    }
  }

  /**
   * Verify the signature of an action
   * @param {Object} action - The action to verify
   * @param {Buffer} publicKey - The public key to verify against
   * @returns {Boolean} Whether the signature is valid
   * @private
   */
  _verifySignature(action, publicKey) {
    // Skip signature verification if not present (for testing/development)
    if (!action.signature || action.signature.length === 0) {
      return process.env.NODE_ENV === 'development'
    }

    try {
      // Create a canonical representation of the payload for verification
      const message = JSON.stringify(action.payload, Object.keys(action.payload).sort())

      // Verify the signature
      return this.crypto.verify(action.signature, message, publicKey)
    } catch (err) {
      console.error('Error verifying signature:', err)
      return false
    }
  }

  /**
   * Validate CREATE_SERVER action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateCreateServer(action, authorId, view) {
    // Check if the server ID is already taken
    const existingServer = await DatabaseManager.getOne(view, '@server/server', { id: action.payload.id })
    if (existingServer) {
      return false
    }

    // Basic validation of required fields
    return !!(
      action.payload.id &&
      action.payload.name &&
      action.payload.timestamp
    )
  }

  /**
   * Validate CREATE_CHANNEL action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateCreateChannel(action, authorId, view) {
    // Check if the server exists
    const server = await DatabaseManager.getOne(view, '@server/server', { id: action.payload.serverId })
    if (!server) {
      return false
    }

    // Check if the user has permission to create channels
    const userRole = await DatabaseManager.getOne(view, '@server/role', {
      userId: authorId,
      serverId: action.payload.serverId
    })

    if (!userRole || !this._hasPermission(userRole.role, 'CREATE_CHANNEL')) {
      return false
    }

    // Check if the channel ID is already taken
    const existingChannelById = await DatabaseManager.getOne(view, '@server/channel', {
      id: action.payload.id
    })

    if (existingChannelById) {
      return false
    }

    // Check if the channel name is already taken in this server
    const allChannelsInServer = await DatabaseManager.getAll(view, '@server/channel', {
      serverId: action.payload.serverId
    })

    const existingChannelByName = allChannelsInServer.find(channel =>
      channel.name === action.payload.name
    )

    if (existingChannelByName) {
      return false
    }

    // Basic validation of required fields
    return !!(
      action.payload.id &&
      action.payload.serverId &&
      action.payload.name &&
      action.payload.type &&
      action.payload.timestamp
    )
  }

  /**
   * Validate SEND_MESSAGE action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateSendMessage(action, authorId, view) {
    // Check if the channel exists
    const channel = await DatabaseManager.getOne(view, '@server/channel', { id: action.payload.channelId })
    if (!channel) {
      return false
    }

    // Check if the user has permission to send messages in this channel
    const userRole = await DatabaseManager.getOne(view, '@server/role', {
      userId: authorId,
      serverId: channel.serverId
    })

    if (!userRole || !this._hasPermission(userRole.role, 'SEND_MESSAGE')) {
      return false
    }

    // Basic validation of required fields
    return !!(
      action.payload.id &&
      action.payload.channelId &&
      action.payload.content &&
      action.payload.timestamp
    )
  }

  /**
   * Validate SET_ROLE action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateSetRole(action, authorId, view) {
    // Check if the server exists
    const server = await DatabaseManager.getOne(view, '@server/server', { id: action.payload.serverId })
    if (!server) {
      return false
    }

    // Check if the author has permission to set roles
    const authorRole = await DatabaseManager.getOne(view, '@server/role', {
      userId: authorId,
      serverId: action.payload.serverId
    })

    if (!authorRole) {
      return false
    }

    // Only OWNER can set ADMIN roles
    if (
      action.payload.role === 'ADMIN' &&
      authorRole.role !== 'OWNER'
    ) {
      return false
    }

    // ADMINs and OWNERs can set MODERATOR and MEMBER roles
    if (
      (action.payload.role === 'MODERATOR' || action.payload.role === 'MEMBER') &&
      (authorRole.role !== 'ADMIN' && authorRole.role !== 'OWNER')
    ) {
      return false
    }

    // Basic validation of required fields
    return !!(
      action.payload.userId &&
      action.payload.serverId &&
      action.payload.role &&
      action.payload.timestamp
    )
  }

  /**
   * Validate CLAIM_INVITE action
   * @param {Object} action - The action to validate
   * @param {Buffer} authorKey - The public key of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateClaimInvite(action, authorKey, view) {
    // Check if the invite exists and is valid
    const allInvites = await DatabaseManager.getAll(view, '@server/invite', {})
    const invite = allInvites.find(inv => inv.code === action.payload.inviteCode)

    if (!invite) {
      return false
    }

    // Check if the invite has expired
    if (invite.expiresAt && invite.expiresAt < action.payload.timestamp) {
      return false
    }

    // Check if the user already exists
    const authorId = b4a.toString(authorKey, 'hex')
    const allUsers = await DatabaseManager.getAll(view, '@server/user', {})
    const existingUser = allUsers.find(user => user.id === authorId)

    // Allow only if the user doesn't exist yet
    return !existingUser
  }

  /**
   * Validate CREATE_INVITE action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateCreateInvite(action, authorId, view) {
    // Check if the server exists
    const server = await DatabaseManager.getOne(view, '@server/server', { id: action.payload.serverId })
    if (!server) {
      return false
    }

    // Check if the user has permission to create invites
    const userRole = await DatabaseManager.getOne(view, '@server/role', {
      userId: authorId,
      serverId: action.payload.serverId
    })

    if (!userRole || !this._hasPermission(userRole.role, 'CREATE_INVITE')) {
      return false
    }

    // Check if the invite ID is already taken
    const allInvites = await DatabaseManager.getAll(view, '@server/invite', {})
    const existingInvite = allInvites.find(invite => invite.id === action.payload.id)

    if (existingInvite) {
      return false
    }

    // Basic validation of required fields
    return !!(
      action.payload.id &&
      action.payload.code &&
      action.payload.serverId &&
      action.payload.timestamp
    )
  }

  /**
   * Validate DELETE_MESSAGE action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateDeleteMessage(action, authorId, view) {
    // Check if the message exists
    const message = await DatabaseManager.getOne(view, '@server/message', { id: action.payload.id })
    if (!message) {
      return false
    }

    // Find the channel for this message
    const channel = await DatabaseManager.getOne(view, '@server/channel', { id: message.channelId })
    if (!channel) {
      return false
    }

    // Users can delete their own messages
    if (message.author === authorId) {
      return true
    }

    // Check if the user has permission to delete messages
    const userRole = await DatabaseManager.getOne(view, '@server/role', {
      userId: authorId,
      serverId: channel.serverId
    })

    if (!userRole || !this._hasPermission(userRole.role, 'DELETE_MESSAGE')) {
      return false
    }

    // Basic validation of required fields
    return !!(
      action.payload.id &&
      action.payload.timestamp
    )
  }

  /**
   * Check if a role has a specific permission
   * @param {String} role - The role to check
   * @param {String} permission - The permission to check for
   * @returns {Boolean} Whether the role has the permission
   * @private
   */
  _hasPermission(role, permission) {
    const rolePermissions = {
      'OWNER': [
        'CREATE_CHANNEL', 'SEND_MESSAGE', 'DELETE_MESSAGE', 'SET_ROLE',
        'CREATE_INVITE', 'EDIT_SERVER', 'EDIT_CHANNEL'
      ],
      'ADMIN': [
        'CREATE_CHANNEL', 'SEND_MESSAGE', 'DELETE_MESSAGE', 'SET_ROLE',
        'CREATE_INVITE', 'EDIT_CHANNEL'
      ],
      'MODERATOR': [
        'SEND_MESSAGE', 'DELETE_MESSAGE', 'CREATE_INVITE'
      ],
      'MEMBER': [
        'SEND_MESSAGE'
      ]
    }

    const permissions = rolePermissions[role] || []
    return permissions.includes(permission)
  }
}

module.exports = ActionValidator
