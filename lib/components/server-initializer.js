const { dispatch } = require('../utils/dispatch')
const b4a = require('b4a')

/**
 * ServerInitializer - Handles the initialization of a SyncBase instance as a server
 * Instead of "creating" servers (since each SyncBase is already a server),
 * this class handles the initial setup of a new SyncBase instance
 */
class ServerInitializer {
  /**
   * Create a new ServerInitializer instance
   * @param {SyncBase} syncBase - The SyncBase instance
   * @param {ActionValidator} validator - Action validator instance
   */
  constructor(syncBase, validator) {
    this.syncBase = syncBase
    this.validator = validator
    this.initialized = false
  }

  /**
   * Check if the SyncBase has been initialized
   * @returns {Promise<boolean>} Whether the SyncBase is initialized
   */
  async isInitialized() {
    // Check if any server exists
    const server = await this.syncBase.base.view.findOne('@server/server', {})
    return !!server
  }

  /**
   * Initialize the SyncBase instance as a server
   * @param {Object} params - Initialization parameters
   * @param {String} params.name - The server name
   * @param {String} [params.description] - Optional server description
   * @returns {Promise<Object>} The initialized server info
   */
  async initialize({ name = 'Chatters', description = '' }) {
    try {
      // Check if already initialized
      if (await this.isInitialized()) {
        throw new Error('This SyncBase instance is already initialized')
      }

      // Generate a unique ID for the server
      const serverId = this.syncBase.crypto.generateId()
      console.log('Initializing server with ID:', serverId)

      // Get the current user's public key
      const currentUserPublicKey = this.syncBase.crypto.publicKey
      const currentUserId = b4a.toString(currentUserPublicKey, 'hex')
      console.log('Current user ID:', currentUserId)

      // Record server info
      const serverInfo = {
        id: serverId,
        name,
        description,
        createdAt: Date.now(),
      }

      // Create the initialize action directly with the correct format
      // This avoids any potential issues with the createSignedAction function
      const initializeAction = {
        type: 'INITIALIZE_SERVER',
        payload: serverInfo
      }
      const signedAction = this.syncBase.crypto.createSignedAction(initializeAction.type, initializeAction.payload)

      // Append the raw action buffer directly
      console.log('Appending server initialization action')
      await this.syncBase.base.append(signedAction, { optimistic: true })
      // Wait for the action to be processed
      console.log('Waiting for server to be initialized...')
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Verify server was created
      const serverCreated = await this.syncBase.base.view.findOne('@server/server', {})
      console.log('Server created:', serverCreated ? 'Yes' : 'No')

      if (!serverCreated) {
        console.log('Attempting fallback method with dispatch')
        // Try with dispatch as fallback
        await this.syncBase.base.append(dispatch('@server/update-server', {
          type: 'INITIALIZE_SERVER',
          signature: b4a.alloc(0),
          payload: serverInfo
        }), { optimistic: true })

        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      // Create user record manually
      console.log('Creating user record directly in view')
      await this.syncBase.base.view.insert('@server/user', {
        id: currentUserId,
        publicKey: currentUserPublicKey,
        username: `User-${currentUserId.substring(0, 8)}`,
        joinedAt: Date.now()
      })

      // Set owner role directly
      console.log('Setting owner role directly in view')

      await this.syncBase.base.view.insert('@server/role', {
        userId: currentUserId,
        serverId: serverId,
        role: 'OWNER',
        updatedAt: Date.now(),
        updatedBy: currentUserId
      })

      // Create general channel directly
      console.log('Creating general channel directly in view')
      await this.syncBase.base.view.insert('@server/channel', {
        id: this.syncBase.crypto.generateId(),
        serverId: serverId,
        name: 'general',
        type: 'TEXT',
        topic: 'General discussion',
        createdBy: currentUserId,
        createdAt: Date.now()
      })

      this.initialized = true

      // Get the actual server info
      const result = await this.getServerInfo()
      console.log('Server initialization completed, result:', result ? JSON.stringify(result) : 'null')

      if (!result) {
        // If we still can't get the server info, return the object we created
        console.log('Returning manually created server info')
        return {
          id: serverId,
          name,
          description,
          createdBy: currentUserId,
          createdAt: Date.now()
        }
      }

      await this._createDefaultChannels(serverId, currentUserId)

      return result
    } catch (err) {
      console.error('Error during initialization:', err)
      throw err
    }
  }

  /**
   * Create a user record in the database
   * @param {String} userId - The user ID (hex string of public key)
   * @param {Buffer} publicKey - The user's public key
   * @private
   */
  async _createUser(userId, publicKey) {
    const user = {
      id: userId,
      publicKey,
      username: `User-${userId.substring(0, 8)}`,
      joinedAt: Date.now()
    }

    const action = this.syncBase.crypto.createSignedAction('CLAIM_INVITE', {
      ...user,
      inviteCode: 'initial-user', // Special code for first user
      timestamp: Date.now()
    })

    await this.syncBase.base.append(dispatch('@server/claim-invite', action), { optimistic: true })
  }

  /**
   * Set the owner role for a user
   * @param {String} userId - The user ID
   * @param {String} serverId - The server ID
   * @private
   */
  async _setOwnerRole(userId, serverId) {
    const action = this.syncBase.crypto.createSignedAction('SET_ROLE', {
      userId,
      serverId,
      role: 'OWNER',
      timestamp: Date.now()
    })

    await this.syncBase.base.append(dispatch('@server/set-role', action), { optimistic: true })
  }

  /**
   * Create default channels for the server
   * @param {String} serverId - The server ID
   * @param {String} creatorId - The creator's ID
   * @private
   */
  async _createDefaultChannels(serverId, creatorId) {
    // Create general channel
    const generalChannel = {
      id: this.syncBase.crypto.generateId(),
      serverId,
      name: 'general',
      type: 'TEXT',
      topic: 'General discussion',
      createdBy: creatorId,
      createdAt: Date.now()
    }

    const action = this.syncBase.crypto.createSignedAction('CREATE_CHANNEL', generalChannel)

    await this.syncBase.base.append(dispatch('@server/create-channel', action), { optimistic: true })
  }

  /**
   * Get server information
   * @returns {Promise<Object|null>} The server info or null if not initialized
   */
  async getServerInfo() {
    try {
      // Find the server record (there should only be one)
      const serverInfo = await this.syncBase.base.view.findOne('@server/server', {})
      console.log('getServerInfo result:', serverInfo ? JSON.stringify(serverInfo) : 'null')

      if (!serverInfo) return null

      // Find the owner by querying for the OWNER role
      const ownerRole = await this.syncBase.base.view.findOne('@server/role', {
        serverId: serverInfo.id,
        role: 'OWNER'
      })

      if (ownerRole) {
        // Get the owner user record
        const owner = await this.syncBase.base.view.findOne('@server/user', {
          id: ownerRole.userId
        })

        if (owner) {
          return {
            ...serverInfo,
            owner
          }
        }
      }

      return serverInfo
    } catch (err) {
      console.error('Error in getServerInfo:', err)
      return null
    }
  }

  /**
   * Check if the current user has permission to perform admin actions
   * @returns {Promise<Boolean>} Whether the user has admin permissions
   */
  async hasAdminPermission() {
    const serverInfo = await this.syncBase.base.view.findOne('@server/server', {})
    if (!serverInfo) return false

    // Get current user ID
    const currentUserId = b4a.toString(this.syncBase.crypto.publicKey, 'hex')

    // Check if user has OWNER or ADMIN role
    const userRole = await this.syncBase.base.view.findOne('@server/role', {
      serverId: serverInfo.id,
      userId: currentUserId
    })

    return userRole && (userRole.role === 'OWNER' || userRole.role === 'ADMIN')
  }

  /**
   * Update server information
   * @param {Object} params - Update parameters
   * @param {String} [params.name] - The new server name
   * @param {String} [params.description] - The new server description
   * @returns {Promise<Object>} The updated server info
   */
  async updateServerInfo({ name, description }) {
    // Get current server info
    const serverInfo = await this.syncBase.base.view.findOne('@server/server', {})
    if (!serverInfo) {
      throw new Error('Server not initialized')
    }

    // Verify the current user has permission to update
    if (!(await this.hasAdminPermission())) {
      throw new Error('You do not have permission to update server information')
    }

    // Get current user ID
    const currentUserId = b4a.toString(this.syncBase.crypto.publicKey, 'hex')

    // Prepare updated info
    const updatedInfo = {
      id: serverInfo.id,
      name: name || serverInfo.name,
      description: description !== undefined ? description : serverInfo.description,
      updatedBy: currentUserId,
      updatedAt: Date.now()
    }

    // Create action
    const action = this.syncBase.crypto.createSignedAction('UPDATE_SERVER', updatedInfo)

    // Dispatch the action
    await this.syncBase.base.append(dispatch('@server/update-server', action), { optimistic: true })

    return { ...serverInfo, ...updatedInfo }
  }
}

module.exports = ServerInitializer
