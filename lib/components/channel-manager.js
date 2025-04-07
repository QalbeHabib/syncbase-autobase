const { dispatch } = require('../utils/dispatch')
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
    // Generate a unique ID for the channel
    const channelId = this.syncBase.crypto.generateId()

    // Get the server owner ID (which is this instance's public key)
    const serverId = b4a.toString(this.syncBase.writerKey, 'hex')

    // Create the channel action
    const action = this.syncBase.crypto.createSignedAction('CREATE_CHANNEL', {
      id: channelId,
      serverId,
      name,
      type,
      topic,
      timestamp
    })

    // Dispatch the action
    await this.syncBase.base.append(dispatch('@server/create-channel', action))

    return { id: channelId, serverId, name, type, topic }
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
    // Get the channel to check permissions
    const channel = await this.getChannel(channelId)
    if (!channel) {
      throw new Error('Channel not found')
    }

    // Get the server owner ID
    const serverId = b4a.toString(this.syncBase.writerKey, 'hex')

    // Create the delete channel action
    const action = this.syncBase.crypto.createSignedAction('DELETE_CHANNEL', {
      id: channelId,
      serverId,
      timestamp: Date.now()
    })

    // Dispatch the action
    await this.syncBase.base.append(dispatch('@server/delete-channel', action))

    return true
  }

  /**
   * Update a channel
   * @param {Object} params - Update parameters
   * @param {String} params.channelId - The channel ID
   * @param {String} [params.name] - The new channel name
   * @param {String} [params.topic] - The new channel topic
   * @returns {Promise<Object>} The updated channel
   */
  async updateChannel({ channelId, name, topic }) {
    // Get the channel to check permissions
    const channel = await this.getChannel(channelId)
    if (!channel) {
      throw new Error('Channel not found')
    }

    // Get the server owner ID
    const serverId = b4a.toString(this.syncBase.writerKey, 'hex')

    // Create the update channel action
    const action = this.syncBase.crypto.createSignedAction('UPDATE_CHANNEL', {
      id: channelId,
      serverId,
      name: name || channel.name,
      topic: topic !== undefined ? topic : channel.topic,
      timestamp: Date.now()
    })

    // Dispatch the action
    await this.syncBase.base.append(dispatch('@server/update-channel', action))

    return { ...channel, name: name || channel.name, topic: topic !== undefined ? topic : channel.topic }
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
