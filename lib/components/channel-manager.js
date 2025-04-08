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
      await this.syncBase.base.ready()

      // Get server info to make sure we're operating on a valid server
      const serverInfo = await this.syncBase.serverInitializer.getServerInfo()
      if (!serverInfo || !serverInfo.id) {
        throw new Error('Cannot verify server identity - unauthorized channel creation rejected')
      }

      // By default, no authorization until proven otherwise
      let isAuthorized = false
      // Check if user has CREATE_CHANNEL or ADMINISTRATOR permissions
      const hasChannelPermission = await this.syncBase.permissions.hasPermission('CREATE_CHANNEL');
      const hasAdminPermission = await this.syncBase.permissions.hasPermission('ADMINISTRATOR');

      if (hasChannelPermission || hasAdminPermission) {
        isAuthorized = true;
      } else {
        // Final fallback - try admin permission
        const isAdmin = await this.syncBase.serverInitializer.hasAdminPermission();
        isAuthorized = !!isAdmin;
      }

      // Check final authorization result
      if (!isAuthorized) {
        throw new Error('Unauthorized: You do not have permission to create channels in this server');
      }
      // If we get here, permissions check passed
      const allChannels = await this.getChannels()
      const position = allChannels.length + 1

      // Generate a unique ID for the channel
      const id = this.syncBase.crypto.generateId(32)
      const channelId = this.syncBase.crypto.generateId()
      // Get current user ID for creator tracking
      const creatorId = b4a.toString(this.syncBase.crypto.publicKey, 'hex')
      // Prepare the channel data
      const channelData = {
        id,
        channelId,
        name,
        type,
        topic,
        createdBy: creatorId,
        createdAt: timestamp,
        position
      }
      const action = await this.syncBase.crypto.createSignedAction('@server/create-channel', channelData)
      await this.syncBase.base.append(action, { optimistic: true })
      return channelData
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
    const channel = await this.syncBase.base.view.get('@server/channel', { channelId: channelId })
    return channel?.channelId == channelId ? channel : null
  }

  /**
   * Get all channels in the server
   * @returns {Promise<Array<Object>>} The channels
   */
  async getChannels() {
    // Get the server owner ID (which is this instance's public key)
    const stream = this.syncBase.base.view.find('@server/channel', {})
    const channels = []
    for await (const node of stream) {
      channels.push(node)
    }
    return channels
  }

  /**
   * Delete a channel
   * @param {Object} params - Delete parameters
   * @param {String} params.channelId - The channel ID
   * @returns {Promise<Boolean>} Whether the deletion was successful
   */
  async deleteChannel(channelId) {
    try {
      // Get the channel to check permissions
      const channel = await this.getChannel(channelId)
      if (!channel) {
        throw new Error('Channel not found')
      }

      const action = this.syncBase.crypto.createSignedAction('@server/delete-channel', channel)
      await this.syncBase.base.append(action, { optimistic: true })
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
  async updateChannel({ id, channelId, name, topic }) {
    try {
      // Check if the channel exists
      const channel = await this.getChannel(channelId)
      if (!channel) {
        throw new Error('Channel not found')
      }

      // Prepare update data
      const updateData = {
        id: id,
        ...channel,
        channelId: channelId,
        name: name || channel.name,
        topic: topic !== undefined ? topic : channel.topic,
        type: channel.type,
        createdBy: channel.createdBy,
        createdAt: channel.createdAt,
        updatedAt: Date.now()
      }
      const action = this.syncBase.crypto.createSignedAction('@server/update-channel', updateData)
      await this.syncBase.base.append(action, { optimistic: true })
      return updateData
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
    // Get all channels for this server
    const allChannels = await this.syncBase.base.view.find('@server/channel', { type })

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
