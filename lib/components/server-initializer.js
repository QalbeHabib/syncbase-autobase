const b4a = require('b4a')
const MessageParser = require('./parser')

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
        return await this.getServerInfo()
      }

      // Get current user details
      const currentUserPublicKey = this.syncBase.crypto.publicKey
      const currentUserId = b4a.toString(currentUserPublicKey, 'hex')

      // Generate a unique server ID
      const serverId = this.syncBase.crypto.generateId()

      // Prepare server initialization action
      const serverInitAction = this.syncBase.crypto.createSignedAction('@server/create-server', {
        id: serverId,
        name,
        description,
        createdAt: Date.now(),
        avatar: null
      })
      await this.syncBase.base.append(serverInitAction, { optimistic: true })

      
      // Create default general channel
      const generalChannelCreated = await this.syncBase.channels.createChannel({
        name: "general-chat",
        topic: "slacking",
        type: "TEXT"
      })
      this.initialized = true
      // Retrieve and return server info
      const serverInfo = await this.getServerInfo()
      return serverInfo
    } catch (err) {
      console.error('Error during server initialization:', err.message)
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
    try {
      const serverInfo = await this.syncBase.base.view.findOne('@server/server', {});
      if (!serverInfo) return false;

      // Get current user ID
      const currentUserId = b4a.toString(this.syncBase.crypto.publicKey, 'hex');

      // Check if user has OWNER or ADMIN role
      const userRole = await this.syncBase.base.view.findOne('@server/role', {
        userId: currentUserId
      });

      return userRole && (userRole.role === 'OWNER' || userRole.role === 'ADMIN');
    } catch (err) {
      console.warn('Error checking admin permission:', err.message);
      // For now, allow operations in case of errors to help with testing
      return false
    }
  }

  /**
   * Update server information
   * @param {Object} params - Update parameters
   * @param {String} [params.name] - The new server name
   * @param {String} [params.description] - The new server description
   * @returns {Promise<Object>} The updated server info
   */
  async updateServerInfo({ name, description }) {
    console.log('ATTEMPT TO UPDATE SERVER INFO')
    try {
      // Get current server info
      const serverInfo = await this.syncBase.base.view.findOne('@server/server', {})
      if (!serverInfo) {
        console.log('NO SERVER')
        throw new Error('Server not initialized')
      }

      // Verify the current user has permission to update
      if (!(await this.hasAdminPermission())) {
        throw new Error('You do not have permission to update server information')
      }

      // Prepare updated info
      const updatedInfo = {
        id: serverInfo.id,
        name: name || serverInfo.name,
        description: description !== undefined ? description : serverInfo.description,
        createdBy: serverInfo.createdBy,
        createdAt: serverInfo.createdAt
      }
      
      const updateAction = this.syncBase.crypto.createSignedAction('@server/update-server', updatedInfo)
      await this.syncBase.base.append(updateAction, { optimistic: true })
      return { ...serverInfo, ...updatedInfo }
    } catch (err) {
      console.error('Error updating server:', err.message)
      throw err
    }
  }
}

module.exports = ServerInitializer
