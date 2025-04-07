const { dispatch } = require('../utils/dispatch')
const b4a = require('b4a')

/**
 * MessageManager - Handles message operations within a SyncBase server
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
    // Check if the channel exists
    const channel = await this.syncBase.base.view.findOne('@server/channel', { id: channelId })
    if (!channel) {
      throw new Error('Channel not found')
    }

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
   * Edit a message
   * @param {Object} params - Edit parameters
   * @param {String} params.messageId - The message ID
   * @param {String} params.content - The new content
   * @returns {Promise<Object>} The edited message
   */
  async editMessage({ messageId, content }) {
    // Check if the message exists
    const message = await this.syncBase.base.view.findOne('@server/message', { id: messageId })
    if (!message) {
      throw new Error('Message not found')
    }

    // Verify ownership - only the author can edit their messages
    const authorId = b4a.toString(this.syncBase.writerKey, 'hex')
    if (message.author !== authorId) {
      throw new Error('You can only edit your own messages')
    }

    // Create the edit action
    const action = this.syncBase.crypto.createSignedAction('EDIT_MESSAGE', {
      id: messageId,
      content,
      timestamp: Date.now()
    })

    // Dispatch the action
    await this.syncBase.base.append(dispatch('@server/edit-message', action))

    return { ...message, content, editedAt: Date.now() }
  }

  /**
   * Delete a message
   * @param {Object} params - Delete parameters
   * @param {String} params.messageId - The message ID
   * @returns {Promise<Boolean>} Whether the deletion was successful
   */
  async deleteMessage({ messageId }) {
    // Check if the message exists
    const message = await this.syncBase.base.view.findOne('@server/message', { id: messageId })
    if (!message) {
      throw new Error('Message not found')
    }

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
    let filteredMessages = [...messages]

    if (before || after) {
      filteredMessages = messages.filter(msg => {
        if (before && msg.timestamp >= before) return false
        if (after && msg.timestamp <= after) return false
        return true
      })
    }

    // Filter out deleted messages, unless explicitly requested
    filteredMessages = filteredMessages.filter(msg => !msg.deletedAt)

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
   * Get all messages from a specific user
   * @param {String} userId - The user ID
   * @param {Number} [limit=50] - Maximum number of messages to return
   * @returns {Promise<Array<Object>>} The messages
   */
  async getUserMessages(userId, limit = 50) {
    // Get all messages
    const messages = await this.syncBase.base.view.find('@server/message', {})

    // Filter by user
    const userMessages = messages.filter(msg => msg.author === userId && !msg.deletedAt)

    // Sort by timestamp in descending order
    userMessages.sort((a, b) => b.timestamp - a.timestamp)

    // Apply limit
    return userMessages.slice(0, limit)
  }

  /**
   * Search messages by content
   * @param {Object} params - Search parameters
   * @param {String} params.query - The search query
   * @param {String} [params.channelId] - Optional channel to search within
   * @param {Number} [params.limit=20] - Maximum number of results
   * @returns {Promise<Array<Object>>} The matching messages
   */
  async searchMessages({ query, channelId, limit = 20 }) {
    // Get messages, filtered by channel if specified
    let messages = []
    if (channelId) {
      messages = await this.syncBase.base.view.find('@server/message', { channelId })
    } else {
      messages = await this.syncBase.base.view.find('@server/message', {})
    }

    // Filter by query and exclude deleted messages
    const results = messages.filter(msg =>
      !msg.deletedAt &&
      msg.content.toLowerCase().includes(query.toLowerCase())
    )

    // Sort by relevance (simple implementation - more matches = more relevant)
    results.sort((a, b) => {
      const matchesA = (a.content.toLowerCase().match(new RegExp(query.toLowerCase(), 'g')) || []).length
      const matchesB = (b.content.toLowerCase().match(new RegExp(query.toLowerCase(), 'g')) || []).length
      return matchesB - matchesA
    })

    // Apply limit
    return results.slice(0, limit)
  }

  /**
   * Get message history (including edits) for a specific message
   * @param {String} messageId - The message ID
   * @returns {Promise<Array<Object>>} The message history
   */
  async getMessageHistory(messageId) {
    // Get the original message
    const message = await this.getMessage(messageId)
    if (!message) return []

    // Get all edit events for this message
    const edits = await this.syncBase.base.view.find('@server/message_edit', { messageId })

    // Sort by timestamp
    edits.sort((a, b) => a.timestamp - b.timestamp)

    // Create history array starting with the original message
    return [message, ...edits]
  }
}

module.exports = MessageManager
