const b4a = require('b4a')

/**
 * ActionValidator - Validates user actions before they're applied
 * Updated to work with the "SyncBase is a server" paradigm
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
  async validateAction(action, authorKey, view, optimistic = true) {
    console.log('VERIFYING', action)
    console.log('VERIFYING', action)
    console.log('VERIFYING', action)
    console.log('VERIFYING', action)
    // Verify the signature first
    if (!(await this._verifySignature(action, authorKey))) {
      return false
    }

    console.log('Signature passed')

    // Get the author ID (hex string of the public key)
    const authorId = b4a.toString(authorKey, 'hex')

    // Check if this is a CLAIM_INVITE, which is the only action allowed optimistically
    if (optimistic && action.type !== 'CLAIM_INVITE') {
      return false
    }

    // Handle different action types
    switch (action.type) {
      case 'INITIALIZE_SERVER':
        return this._validateServerAction(action, authorId, view)
      case 'UPDATE_SERVER':
        return optimistic ? false : this._validateServerAction(action, authorId, view)

      case 'CREATE_CHANNEL':
        return optimistic ? false : this._validateCreateChannel(action, authorId, view)

      case 'UPDATE_CHANNEL':
        return optimistic ? false : this._validateUpdateChannel(action, authorId, view)

      case 'DELETE_CHANNEL':
        return optimistic ? false : this._validateDeleteChannel(action, authorId, view)

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

      case 'EDIT_MESSAGE':
        return optimistic ? false : this._validateEditMessage(action, authorId, view)

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
      console.log({ message })
      console.log({ message })
      console.log({ message })
      console.log({ message })
      console.log({ message })

      // Verify the signature
      return this.crypto.verify(action.signature, message, publicKey)
    } catch (err) {
      console.error('Error verifying signature:', err)
      return false
    }
  }

  /**
   * Validate INITIALIZE_SERVER action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateServerAction(action, authorId, view) {
    // For initialization, always allow it if no server exists yet
    if (action.type === 'INITIALIZE_SERVER') {
      // Check if a server already exists
      const serverInfo = await view.findOne('@server/server', {})
      if (serverInfo) {
        console.warn('Server already initialized, rejecting initialization')
        return false
      }

      // Basic validation of required fields for initialization
      return !!(
        action.payload.id &&
        action.payload.name &&
        (action.payload.timestamp || action.payload.createdAt)
      )
    }

    // For updates, ensure server exists and author has permission
    if (action.type === 'UPDATE_SERVER') {
      const serverInfo = await view.findOne('@server/server', {})
      if (!serverInfo) {
        console.warn('Cannot update server - not initialized')
        return false
      }

      // Check if the user has OWNER or ADMIN role
      const userRole = await view.findOne('@server/role', {
        serverId: serverInfo.id,
        userId: authorId
      })

      if (!userRole || (userRole.role !== 'OWNER' && userRole.role !== 'ADMIN')) {
        console.warn('User does not have permission to update server')
        return false
      }

      // Basic validation for update
      return !!(
        action.payload.id &&
        action.payload.name &&
        (action.payload.timestamp || action.payload.updatedAt)
      )
    }

    return false
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
    const server = await view.findOne('@server/server', {})
    if (!server) {
      return false
    }

    // Check if the user has permission to create channels
    const userRole = await view.findOne('@server/role', {
      userId: authorId
    })

    if (!userRole || !this._hasPermission(userRole.role, 'CREATE_CHANNEL')) {
      return false
    }

    // Check if the channel ID is already taken
    const existingChannelById = await view.findOne('@server/channel', {
      id: action.payload.id
    })

    if (existingChannelById) {
      return false
    }

    // Check if the channel name is already taken in this server
    const existingChannelByName = await view.findOne('@server/channel', {
      name: action.payload.name,
      serverId: action.payload.serverId
    })

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
   * Validate UPDATE_CHANNEL action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateUpdateChannel(action, authorId, view) {
    // Check if the channel exists
    const channel = await view.findOne('@server/channel', { id: action.payload.id })
    if (!channel) {
      return false
    }

    // Check if the user has permission to update channels
    const userRole = await view.findOne('@server/role', {
      userId: authorId
    })

    if (!userRole || !this._hasPermission(userRole.role, 'MANAGE_CHANNELS')) {
      return false
    }

    // If changing name, check if the name is already taken
    if (action.payload.name && action.payload.name !== channel.name) {
      const existingChannelByName = await view.findOne('@server/channel', {
        name: action.payload.name,
        serverId: action.payload.serverId
      })

      if (existingChannelByName && existingChannelByName.id !== action.payload.id) {
        return false
      }
    }

    // Basic validation of required fields
    return !!(
      action.payload.id &&
      action.payload.timestamp
    )
  }

  /**
   * Validate DELETE_CHANNEL action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateDeleteChannel(action, authorId, view) {
    // Check if the channel exists
    const channel = await view.findOne('@server/channel', { id: action.payload.id })
    if (!channel) {
      return false
    }

    // Check if the user has permission to delete channels
    const userRole = await view.findOne('@server/role', {
      userId: authorId
    })

    if (!userRole || !this._hasPermission(userRole.role, 'MANAGE_CHANNELS')) {
      return false
    }

    // Basic validation of required fields
    return !!(
      action.payload.id &&
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
    const channel = await view.findOne('@server/channel', { id: action.payload.channelId })
    if (!channel) {
      return false
    }

    // Check if the user has permission to send messages in this channel
    const userRole = await view.findOne('@server/role', {
      userId: authorId
    })

    if (!userRole || !this._hasPermission(userRole.role, 'SEND_MESSAGES')) {
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
    const server = await view.findOne('@server/server', {})
    if (!server) {
      return false
    }

    // Check if the author has permission to set roles
    const authorRole = await view.findOne('@server/role', {
      userId: authorId
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
    const invite = await view.findOne('@server/invite', { code: action.payload.inviteCode })

    if (!invite) {
      return false
    }

    // Check if the invite has expired
    if (invite.expiresAt && invite.expiresAt < action.payload.timestamp) {
      return false
    }

    // Check if the user already exists
    const authorId = b4a.toString(authorKey, 'hex')
    const existingUser = await view.findOne('@server/user', { id: authorId })

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
    const server = await view.findOne('@server/server', {})
    if (!server) {
      return false
    }

    // Check if the user has permission to create invites
    const userRole = await view.findOne('@server/role', {
      userId: authorId
    })

    if (!userRole || !this._hasPermission(userRole.role, 'CREATE_INVITES')) {
      return false
    }

    // Check if the invite ID is already taken
    const existingInvite = await view.findOne('@server/invite', { id: action.payload.id })
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
    const message = await view.findOne('@server/message', { id: action.payload.id })
    if (!message) {
      return false
    }

    // Find the channel for this message
    const channel = await view.findOne('@server/channel', { id: message.channelId })
    if (!channel) {
      return false
    }

    // Users can delete their own messages
    if (message.author === authorId) {
      return true
    }

    // Check if the user has permission to delete messages
    const userRole = await view.findOne('@server/role', {
      userId: authorId
    })

    if (!userRole || !this._hasPermission(userRole.role, 'DELETE_MESSAGES')) {
      return false
    }

    // Basic validation of required fields
    return !!(
      action.payload.id &&
      action.payload.timestamp
    )
  }

  /**
   * Validate EDIT_MESSAGE action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateEditMessage(action, authorId, view) {
    // Check if the message exists
    const message = await view.findOne('@server/message', { id: action.payload.id })
    if (!message) {
      return false
    }

    // Users can only edit their own messages
    if (message.author !== authorId) {
      return false
    }

    // Basic validation of required fields
    return !!(
      action.payload.id &&
      action.payload.content &&
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
        'MANAGE_SERVER', 'MANAGE_CHANNELS', 'SEND_MESSAGES', 'DELETE_MESSAGES', 'SET_ROLE',
        'CREATE_INVITES', 'EDIT_SERVER', 'EDIT_CHANNEL', 'DELETE_CHANNEL'
      ],
      'ADMIN': [
        'MANAGE_CHANNELS', 'SEND_MESSAGES', 'DELETE_MESSAGES', 'SET_ROLE',
        'CREATE_INVITES', 'EDIT_CHANNEL'
      ],
      'MODERATOR': [
        'SEND_MESSAGES', 'DELETE_MESSAGES', 'CREATE_INVITES'
      ],
      'MEMBER': [
        'SEND_MESSAGES'
      ]
    }

    const permissions = rolePermissions[role] || []
    return permissions.includes(permission)
  }
}

module.exports = ActionValidator
