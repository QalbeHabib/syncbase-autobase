const { dispatch } = require('../utils/dispatch')

/**
 * MessageManager - Handles message operations
 */
class MessageManager {
  /**
   * Create a new MessageManager instance
   * @param {SyncBase} syncBase - The SyncBase instance
   * @param {ActionValidator} validator - Action validator instance
   */
  constructor(syncBase, validator) {
    this.syncBase = syncBase
    this.validator = validator
  }

  /**
   * Initialize message manager
   * @returns {Promise<void>}
   */
  async init() {
    // Nothing to initialize for now
  }

  /**
   * Send a message to a channel
   * @param {Object} params - Message parameters
   * @param {String} params.channelId - The channel ID
   * @param {String} params.content - The message content
   * @param {Array} [params.attachments] - Optional attachments
   * @returns {Promise<Object>} The created message
   */
  async sendMessage({ channelId, content, attachments = [] }) {
    // Generate a unique ID for the message
    const id = this.syncBase.crypto.generateId()

    // Create the message action
    const action = this.syncBase.crypto.createSignedAction('SEND_MESSAGE', {
      id,
      channelId,
      content,
      attachments,
      timestamp: Date.now()
    })

    // Dispatch the action
    await this.syncBase.base.append(dispatch('@server/send-message', action))

    return { id, channelId, content, attachments }
  }

  /**
   * Delete a message
   * @param {Object} params - Delete parameters
   * @param {String} params.messageId - The message ID
   * @returns {Promise<Boolean>} Whether the deletion was successful
   */
  async deleteMessage({ messageId }) {
    // Create the delete action
    const action = this.syncBase.crypto.createSignedAction('DELETE_MESSAGE', {
      id: messageId,
      timestamp: Date.now()
    })

    // Dispatch the action
    await this.syncBase.base.append(dispatch('@server/delete-message', action))

    return true
  }

  /**
   * Get messages from a channel
   * @param {Object} params - Query parameters
   * @param {String} params.channelId - The channel ID
   * @param {Number} [params.limit=50] - Maximum number of messages to return
   * @param {String} [params.before] - Return messages before this timestamp
   * @param {String} [params.after] - Return messages after this timestamp
   * @returns {Promise<Array<Object>>} The messages
   */
  async getMessages({ channelId, limit = 50, before, after }) {
    // Get all messages for this channel
    const messages = await this.syncBase.base.view.find('@server/message', { channelId })

    // Filter by timestamp if needed
    let filteredMessages = messages

    if (before || after) {
      filteredMessages = messages.filter(msg => {
        if (before && msg.timestamp >= before) return false
        if (after && msg.timestamp <= after) return false
        return true
      })
    }

    // Sort by timestamp in descending order (newest first)
    filteredMessages.sort((a, b) => b.timestamp - a.timestamp)

    // Apply limit
    return filteredMessages.slice(0, limit)
  }

  /**
   * Get a specific message by ID
   * @param {String} messageId - The message ID
   * @returns {Promise<Object|null>} The message or null if not found
   */
  async getMessage(messageId) {
    return this.syncBase.base.view.findOne('@server/message', { id: messageId })
  }

  /**
   * Parse message data for display
   * @param {Object} message - The message to parse
   * @returns {Promise<Object>} The parsed message
   */
  async parseMessage(message) {
    // Get the user who sent the message
    const user = await this.syncBase.base.view.findOne('@server/user', { id: message.author })

    return {
      ...message,
      author: {
        id: message.author,
        username: user ? user.username : 'Unknown User'
      }
    }
  }
}

module.exports = MessageManager
