const { dispatch } = require('./spec/hyperdispatch')
const b4a = require('b4a')

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
    try {
      const server = await this.syncBase.base.view.findOne('@server/server', {})
      return !!server
    } catch (error) {
      console.error('Error checking initialization:', error)
      return false
    }
  }

  /**
   * Initialize the SyncBase instance as a server
   * @param {Object} params - Initialization parameters
   * @param {String} [params.name='My SyncBase Server'] - The server name
   * @param {String} [params.description=''] - Optional server description
   * @returns {Promise<Object>} The initialized server info
   */
  async initialize({
    name = 'My SyncBase Server',
    description = ''
  }) {
    try {
      // Check if already initialized
      if (await this.isInitialized()) {
        throw new Error('This SyncBase instance is already initialized')
      }

      // Get current user details
      const currentUserPublicKey = this.syncBase.crypto.publicKey
      const currentUserId = b4a.toString(currentUserPublicKey, 'hex')

      // Generate a unique server ID
      const serverId = this.syncBase.crypto.generateId()

      // Prepare server initialization action
      const serverInitAction = this.syncBase.crypto.createSignedAction('INITIALIZE_SERVER', {
        id: serverId,
        name,
        description,
        createdAt: Date.now(),
        createdBy: currentUserId
      })

      // Dispatch server initialization
      await this.syncBase.base.append(
        dispatch('@server/create-server', serverInitAction),
        { optimistic: true }
      )

      // Create owner role
      const ownerRoleAction = this.syncBase.crypto.createSignedAction('SET_ROLE', {
        userId: currentUserId,
        serverId,
        role: 'OWNER',
        updatedAt: Date.now(),
        updatedBy: currentUserId
      })

      // Dispatch owner role
      await this.syncBase.base.append(
        dispatch('@server/set-role', ownerRoleAction),
        { optimistic: true }
      )

      // Create user record
      const userAction = this.syncBase.crypto.createSignedAction('CLAIM_INVITE', {
        id: currentUserId,
        publicKey: currentUserPublicKey,
        username: `User-${currentUserId.substring(0, 8)}`,
        joinedAt: Date.now(),
        inviteCode: 'initial-server-owner'
      })

      // Dispatch user creation
      await this.syncBase.base.append(
        dispatch('@server/claim-invite', userAction),
        { optimistic: true }
      )

      // Create default general channel
      const generalChannelAction = this.syncBase.crypto.createSignedAction('CREATE_CHANNEL', {
        id: this.syncBase.crypto.generateId(),
        serverId,
        name: 'general',
        type: 'TEXT',
        topic: 'General discussion',
        createdBy: currentUserId,
        createdAt: Date.now()
      })

      // Dispatch channel creation
      await this.syncBase.base.append(
        dispatch('@server/create-channel', generalChannelAction),
        { optimistic: true }
      )

      // Mark as initialized
      this.initialized = true

      // Retrieve and return server info
      const serverInfo = await this.getServerInfo()
      return serverInfo || {
        id: serverId,
        name,
        description,
        createdBy: currentUserId,
        createdAt: Date.now()
      }
    } catch (err) {
      console.error('Error during server initialization:', err)
      throw err
    }
  }

  /**
   * Get server information
   * @returns {Promise<Object|null>} The server info or null if not initialized
   */
  async getServerInfo() {
    try {
      // Find the server record (there should only be one)
      const serverInfo = await this.syncBase.base.view.findOne('@server/server', {})

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
