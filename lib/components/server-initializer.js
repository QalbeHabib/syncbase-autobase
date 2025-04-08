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

      console.log({ serverInitAction })
      
      // Use direct dispatch instead of encoding
      try {
        // Create server directly using the router
        const result = await this.syncBase.router.router.dispatch('@server/create-server', serverInitAction.payload, {
          view: this.syncBase.base.view,
          base: this.syncBase.base,
          authorKey: currentUserPublicKey
        })
        
        console.log('Server creation result:', result)
        
        // Create owner role directly
        await this.syncBase.router.router.dispatch('@server/set-role', {
          userId: currentUserId,
          serverId,
          role: 'OWNER',
          updatedAt: Date.now(),
          updatedBy: currentUserId
        }, {
          view: this.syncBase.base.view,
          base: this.syncBase.base,
          authorKey: currentUserPublicKey
        })
        
        // Create default general channel directly
        await this.syncBase.router.router.dispatch('@server/create-channel', {
          id: this.syncBase.crypto.generateId(),
          serverId,
          name: 'general',
          type: 'TEXT',
          topic: 'General discussion',
          createdBy: currentUserId,
          createdAt: Date.now()
        }, {
          view: this.syncBase.base.view,
          base: this.syncBase.base,
          authorKey: currentUserPublicKey
        })
        
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
        console.error('Error using direct dispatch:', err)
        
        // Fallback to the original method if direct dispatch fails
        // Dispatch server initialization
        const encodedAction = MessageParser.encodeAction(serverInitAction)
        if (!encodedAction) {
          throw new Error('Failed to encode server initialization action')
        }
        
        console.log({ encodedAction })
        
        // Dispatch the action
        await this.syncBase.base.append(encodedAction, { optimistic: true })

        // Create owner role
        const ownerRoleAction = this.syncBase.crypto.createSignedAction('@server/set-role', {
          userId: currentUserId,
          serverId,
          role: 'OWNER',
          updatedAt: Date.now(),
          updatedBy: currentUserId
        })

        // Dispatch owner role
        const encodedOwnerAction = MessageParser.encodeAction(ownerRoleAction)
        if (encodedOwnerAction) {
          await this.syncBase.base.append(encodedOwnerAction, { optimistic: true })
        }

        // Create default general channel
        const generalChannelAction = this.syncBase.crypto.createSignedAction('@server/create-channel', {
          id: this.syncBase.crypto.generateId(),
          serverId,
          name: 'general',
          type: 'TEXT',
          topic: 'General discussion',
          createdBy: currentUserId,
          createdAt: Date.now()
        })

        // Dispatch channel creation
        const encodedChannelAction = MessageParser.encodeAction(generalChannelAction)
        if (encodedChannelAction) {
          await this.syncBase.base.append(encodedChannelAction, { optimistic: true })
        }
        
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
    try {
      // In development environment, always grant permission for testing
      if (process.env.NODE_ENV === 'development') {
        return true;
      }
      
      const serverInfo = await this.syncBase.base.view.findOne('@server/server', {});
      if (!serverInfo) return false;

      // Get current user ID
      const currentUserId = b4a.toString(this.syncBase.crypto.publicKey, 'hex');

      // Check if user has OWNER or ADMIN role
      const userRole = await this.syncBase.base.view.findOne('@server/role', {
        serverId: serverInfo.id,
        userId: currentUserId
      });

      return userRole && (userRole.role === 'OWNER' || userRole.role === 'ADMIN');
    } catch (err) {
      console.warn('Error checking admin permission:', err.message);
      // For now, allow operations in case of errors to help with testing
      return process.env.NODE_ENV === 'development';
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
    try {
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

      // Instead of using dispatch, use direct database update
      try {
        // Try direct update first
        await this.syncBase.base.view.update('@server/server', updatedInfo)
        console.log('Server updated using direct database update')
      } catch (err) {
        console.warn('Error using direct update:', err.message)
        
        // Try inserting with merge as fallback
        await this.syncBase.base.view.insert('@server/server', {
          ...serverInfo,
          ...updatedInfo
        })
        console.log('Server updated using insert with merge')
      }

      return { ...serverInfo, ...updatedInfo }
    } catch (err) {
      console.error('Error updating server:', err.message)
      throw err
    }
  }
}

module.exports = ServerInitializer
