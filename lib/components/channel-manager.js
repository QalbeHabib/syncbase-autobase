const { dispatch } = require('../utils/dispatch')
const DatabaseManager = require('./database-manager')

/**
 * ChannelManager - Handles server and channel operations
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
   * Create a new server
   * @param {Object} params - Server parameters
   * @param {String} [params.id] - Optional server ID (generated if not provided)
   * @param {String} params.name - The server name
   * @param {Number} [params.timestamp] - Optional timestamp
   * @returns {Promise<Object>} The created server
   */
  async createServer({ id, name, timestamp = Date.now() }) {
    // Generate a unique ID if not provided
    const serverId = id || this.syncBase.crypto.generateId()

    // Create the server action
    const action = this.syncBase.crypto.createSignedAction('CREATE_SERVER', {
      id: serverId,
      name,
      timestamp
    })

    // Dispatch the action
    await this.syncBase.base.append(dispatch('@server/create-server', action))

    return { id: serverId, name }
  }

  /**
   * Create a new channel in a server
   * @param {Object} params - Channel parameters
   * @param {String} params.serverId - The server ID
   * @param {String} params.name - The channel name
   * @param {String} [params.type='TEXT'] - The channel type (TEXT, VOICE, etc.)
   * @param {Number} [params.timestamp] - Optional timestamp
   * @returns {Promise<Object>} The created channel
   */
  async createChannel({ serverId, name, type = 'TEXT', timestamp = Date.now() }) {
    // Generate a unique ID for the channel
    const channelId = this.syncBase.crypto.generateId()

    // Create the channel action
    const action = this.syncBase.crypto.createSignedAction('CREATE_CHANNEL', {
      id: channelId,
      serverId,
      name,
      type,
      timestamp
    })

    // Dispatch the action
    await this.syncBase.base.append(dispatch('@server/create-channel', action))

    return { id: channelId, serverId, name, type }
  }

  /**
   * Get a server by ID
   * @param {String} serverId - The server ID
   * @returns {Promise<Object|null>} The server or null if not found
   */
  async getServer(serverId) {
    return DatabaseManager.getOne(this.syncBase.base.view, '@server/server', { id: serverId })
  }

  /**
   * Get all servers the user is a member of
   * @returns {Promise<Array<Object>>} The servers
   */
  async getServers() {
    // Get the user's ID
    const userId = this.syncBase.writerKey.toString('hex')

    // Find all roles for this user
    const userRoles = await DatabaseManager.getAll(this.syncBase.base.view, '@server/role', { userId })

    // Get server IDs from the roles
    const serverIds = userRoles.map(role => role.serverId)

    // Get the servers
    const servers = []
    for (const serverId of serverIds) {
      const server = await this.getServer(serverId)
      if (server) {
        servers.push(server)
      }
    }

    return servers
  }

  /**
   * Get a channel by ID
   * @param {String} channelId - The channel ID
   * @returns {Promise<Object|null>} The channel or null if not found
   */
  async getChannel(channelId) {
    return DatabaseManager.getOne(this.syncBase.base.view, '@server/channel', { id: channelId })
  }

  /**
   * Get all channels in a server
   * @param {String} serverId - The server ID
   * @returns {Promise<Array<Object>>} The channels
   */
  async getChannels(serverId) {
    return DatabaseManager.getAll(this.syncBase.base.view, '@server/channel', { serverId })
  }

  /**
   * Delete a channel
   * @param {Object} params - Delete parameters
   * @param {String} params.channelId - The channel ID
   * @returns {Promise<Boolean>} Whether the deletion was successful
   */
  async deleteChannel({ channelId }) {
    // Get the channel to check server ID
    const channel = await this.getChannel(channelId)
    if (!channel) {
      throw new Error('Channel not found')
    }

    // Create the delete channel action
    const action = this.syncBase.crypto.createSignedAction('DELETE_CHANNEL', {
      id: channelId,
      serverId: channel.serverId,
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
    // Get the channel to check server ID
    const channel = await this.getChannel(channelId)
    if (!channel) {
      throw new Error('Channel not found')
    }

    // Create the update channel action
    const action = this.syncBase.crypto.createSignedAction('UPDATE_CHANNEL', {
      id: channelId,
      serverId: channel.serverId,
      name: name || channel.name,
      topic: topic !== undefined ? topic : channel.topic,
      timestamp: Date.now()
    })

    // Dispatch the action
    await this.syncBase.base.append(dispatch('@server/update-channel', action))

    return { ...channel, name: name || channel.name, topic: topic !== undefined ? topic : channel.topic }
  }
}

module.exports = ChannelManager
