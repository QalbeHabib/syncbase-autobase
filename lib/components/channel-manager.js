const { dispatch } = require('./spec/hyperdispatch/')
const b4a = require('b4a')

/**
 * ChannelManager - Handles channel operations for the SyncBase server
 */
class ChannelManager {
  /**
   * Create a new ChannelManager instance
   * @param {SyncBase} syncBase - The SyncBase instance
   * @param {ActionValidator} validator - Action validator instance
   */
  constructor(syncBase, validator) {
    this.syncBase = syncBase
    this.validator = validator
  }

  /**
   * Initialize channel manager
   * @returns {Promise<void>}
   */
  async init() {
    // Nothing to initialize for now
  }

  /**
   * Create a new channel
   * @param {Object} params - Channel parameters
   * @param {String} params.name - The channel name
   * @param {String} [params.type='TEXT'] - The channel type (TEXT, VOICE, etc.)
   * @param {String} [params.topic=''] - The channel topic
   * @param {Number} [params.timestamp] - Optional timestamp
   * @returns {Promise<Object>} The created channel
   */
  async createChannel({ name, type = 'TEXT', topic = '', timestamp = Date.now() }) {
    try {
      // Generate a unique ID for the channel
      const channelId = this.syncBase.crypto.generateId()

      // Get the server owner ID (which is this instance's public key)
      const serverId = b4a.toString(this.syncBase.writerKey, 'hex')
      
      // Get current user ID for creator tracking
      const creatorId = b4a.toString(this.syncBase.crypto.publicKey, 'hex')

      // Prepare the channel data
      const channelData = {
        id: channelId,
        serverId,
        name,
        type,
        topic,
        createdBy: creatorId,
        createdAt: timestamp
      }

      // Try direct database operation first
      try {
        // Use direct database update instead of dispatch
        await this.syncBase.base.view.insert('@server/channel', channelData)
        return channelData
      } catch (err) {
        console.warn('Direct channel insert failed, trying dispatch method:', err.message)
        
        // Fall back to dispatch method
        // Create the channel action
        const action = this.syncBase.crypto.createSignedAction('@server/create-channel', channelData)

        // Use encoded message
        try {
          // Use the router's direct dispatch method
          await this.syncBase.router.router.dispatch('@server/create-channel', channelData, {
            view: this.syncBase.base.view,
            base: this.syncBase.base,
            authorKey: this.syncBase.crypto.publicKey
          })
        } catch (dispatchErr) {
          console.warn('Router dispatch failed, using Autobase append:', dispatchErr.message)
          
          // If that fails, try using MessageParser to encode the action
          const MessageParser = require('./parser')
          const encodedAction = MessageParser.encodeAction(action)
          
          if (encodedAction) {
            // Dispatch the action using Autobase append
            await this.syncBase.base.append(encodedAction, { optimistic: true })
          } else {
            throw new Error('Failed to encode channel creation action')
          }
        }
      }

      return { id: channelId, serverId, name, type, topic, createdBy: creatorId, createdAt: timestamp }
    } catch (err) {
      console.error('Error creating channel:', err)
      throw err
    }
  }

  /**
   * Get a channel by ID
   * @param {String} channelId - The channel ID
   * @returns {Promise<Object|null>} The channel or null if not found
   */
  async getChannel(channelId) {
    return this.syncBase.base.view.findOne('@server/channel', { id: channelId })
  }

  /**
   * Get all channels in the server
   * @returns {Promise<Array<Object>>} The channels
   */
  async getChannels() {
    // Get the server owner ID (which is this instance's public key)
    const serverId = b4a.toString(this.syncBase.writerKey, 'hex')

    return this.syncBase.base.view.find('@server/channel', { serverId })
  }

  /**
   * Delete a channel
   * @param {Object} params - Delete parameters
   * @param {String} params.channelId - The channel ID
   * @returns {Promise<Boolean>} Whether the deletion was successful
   */
  async deleteChannel({ channelId }) {
    try {
      // Get the channel to check permissions
      const channel = await this.getChannel(channelId)
      if (!channel) {
        throw new Error('Channel not found')
      }

      // Get the server owner ID
      const serverId = b4a.toString(this.syncBase.writerKey, 'hex')

      // Prepare the delete data
      const deleteData = {
        id: channelId,
        serverId,
        timestamp: Date.now()
      }

      // Try direct database operation first
      try {
        // Use direct database delete
        await this.syncBase.base.view.delete('@server/channel', { id: channelId })
        return true
      } catch (err) {
        console.warn('Direct channel delete failed, trying dispatch method:', err.message)
        
        // Fall back to dispatch method
        // Create the delete channel action
        const action = this.syncBase.crypto.createSignedAction('@server/delete-channel', deleteData)

        // Try using router's direct dispatch
        try {
          await this.syncBase.router.router.dispatch('@server/delete-channel', deleteData, {
            view: this.syncBase.base.view,
            base: this.syncBase.base,
            authorKey: this.syncBase.crypto.publicKey
          })
        } catch (dispatchErr) {
          console.warn('Router dispatch failed, using Autobase append:', dispatchErr.message)
          
          // If that fails, try using MessageParser
          const MessageParser = require('./parser')
          const encodedAction = MessageParser.encodeAction(action)
          
          if (encodedAction) {
            // Dispatch the action using Autobase append
            await this.syncBase.base.append(encodedAction, { optimistic: true })
          } else {
            throw new Error('Failed to encode channel deletion action')
          }
        }
      }

      return true
    } catch (err) {
      console.error('Error deleting channel:', err)
      throw err
    }
  }

  /**
   * Update a channel
   * @param {Object} params - Update parameters
   * @param {String} params.channelId - The channel ID to update
   * @param {String} [params.name] - The new channel name
   * @param {String} [params.topic] - The new channel topic
   * @returns {Promise<Object>} The updated channel
   */
  async updateChannel({ channelId, name, topic }) {
    try {
      // Check if the channel exists
      const channel = await this.syncBase.base.view.findOne('@server/channel', { id: channelId })
      if (!channel) {
        throw new Error('Channel not found')
      }

      // Get the server owner ID
      const serverId = channel.serverId || b4a.toString(this.syncBase.writerKey, 'hex')

      // Prepare update data
      const updateData = {
        id: channelId,
        serverId,
        name: name || channel.name,
        topic: topic !== undefined ? topic : channel.topic,
        type: channel.type,
        createdBy: channel.createdBy,
        createdAt: channel.createdAt,
        updatedAt: Date.now()
      }

      // Try direct database operation first
      try {
        // Use direct database update
        await this.syncBase.base.view.update('@server/channel', updateData)
        
        // Force flush the view to ensure changes are written
        if (this.syncBase.base.view.flush) {
          await this.syncBase.base.view.flush()
        }
        
        // Use a setTimeout to give the database time to update
        await new Promise(resolve => setTimeout(resolve, 500))
        
        // Fetch the updated channel to confirm changes
        const updatedChannel = await this.syncBase.base.view.findOne('@server/channel', { id: channelId })
        return updatedChannel
      } catch (err) {
        console.warn('Direct channel update failed, trying dispatch method:', err.message)
        
        // Fall back to dispatch method
        // Create the update channel action
        const action = this.syncBase.crypto.createSignedAction('@server/update-channel', updateData)

        // Try using router's direct dispatch
        try {
          const result = await this.syncBase.router.router.dispatch('@server/update-channel', updateData, {
            view: this.syncBase.base.view,
            base: this.syncBase.base,
            authorKey: this.syncBase.crypto.publicKey
          })
          
          // Force flush the view to ensure changes are written
          if (this.syncBase.base.view.flush) {
            await this.syncBase.base.view.flush()
          }
          
          // Use a setTimeout to give the database time to update
          await new Promise(resolve => setTimeout(resolve, 500))
          
          // Fetch the updated channel to confirm changes
          const updatedChannel = await this.syncBase.base.view.findOne('@server/channel', { id: channelId })
          return updatedChannel
        } catch (dispatchErr) {
          console.warn('Router dispatch failed, using Autobase append:', dispatchErr.message)
          
          // If that fails, try using MessageParser
          const MessageParser = require('./parser')
          const encodedAction = MessageParser.encodeAction(action)
          
          if (encodedAction) {
            // Dispatch the action using Autobase append
            await this.syncBase.base.append(encodedAction, { optimistic: true })
            
            // Use a setTimeout to give the database time to update
            await new Promise(resolve => setTimeout(resolve, 500))
            
            // Fetch the updated channel to confirm changes
            const updatedChannel = await this.syncBase.base.view.findOne('@server/channel', { id: channelId })
            return updatedChannel
          } else {
            throw new Error('Failed to encode channel update action')
          }
        }
      }
    } catch (err) {
      console.error('Error updating channel:', err)
      throw err
    }
  }

  /**
   * Get channels by type
   * @param {String} type - The channel type (e.g., 'TEXT', 'VOICE')
   * @returns {Promise<Array<Object>>} The channels of the specified type
   */
  async getChannelsByType(type) {
    // Get the server owner ID
    const serverId = b4a.toString(this.syncBase.writerKey, 'hex')

    // Get all channels for this server
    const allChannels = await this.syncBase.base.view.find('@server/channel', { serverId })

    // Filter by type
    return allChannels.filter(channel => channel.type === type)
  }

  /**
   * Find a channel by name
   * @param {String} name - The channel name
   * @returns {Promise<Object|null>} The channel or null if not found
   */
  async findChannelByName(name) {
    // Get the server owner ID
    const serverId = b4a.toString(this.syncBase.writerKey, 'hex')

    // Find channel by name
    return this.syncBase.base.view.findOne('@server/channel', { serverId, name })
  }

  /**
   * Check if a channel exists
   * @param {String} channelId - The channel ID
   * @returns {Promise<Boolean>} Whether the channel exists
   */
  async channelExists(channelId) {
    const channel = await this.getChannel(channelId)
    return !!channel
  }
}

module.exports = ChannelManager
