const { dispatch } = require('./spec/hyperdispatch/')
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
    try {
      // First, check if this SyncBase instance has a writerKey and is properly initialized
      if (!this.syncBase.writerKey) {
        throw new Error('Server is not initialized, cannot send messages')
      }
      
      // Check if the channel exists
      const channel = await this.syncBase.base.view.findOne('@server/channel', { id: channelId })
      if (!channel) {
        throw new Error('Channel not found')
      }
      
      // Server verification step - critical security check
      // Get server info to make sure we're operating on a valid server
      const serverInfo = await this.syncBase.serverInitializer.getServerInfo()
      if (!serverInfo || !serverInfo.id) {
        throw new Error('Cannot verify server identity - unauthorized message sending rejected')
      }
      
      // Verify the channel belongs to this server
      if (channel.serverId !== b4a.toString(this.syncBase.writerKey, 'hex')) {
        throw new Error('Unauthorized: Cannot send messages to channels in a server you don\'t have access to')
      }

      // CRITICAL CHECK: Verify this user has access to THIS specific server
      // If this is a different server instance than the main one, this will fail
      const thisServer = serverInfo.id
      
      // Look up main server permissions
      try {
        // Get server from the database directly with ID
        const serverRecord = await this.syncBase.base.view.findOne('@server/server', { id: thisServer })
        
        // If we can't find the server record, this is likely an unauthorized instance
        if (!serverRecord) {
          throw new Error('Server verification failed - unauthorized message sending rejected')
        }
      } catch (serverErr) {
        console.error('Server verification failed:', serverErr)
        throw new Error('Unauthorized: Cannot send messages in a server you don\'t have access to')
      }

      // Standard permission checking for sending messages
      const serverKey = b4a.toString(this.syncBase.writerKey, 'hex')
      const userKey = b4a.toString(this.syncBase.crypto.publicKey, 'hex')
      
      // By default, no authorization until proven otherwise
      let isAuthorized = false
      
      if (serverKey === userKey) {
        // This is the server owner, automatic authorization
        isAuthorized = true;
      } else {
        // Not the server owner, check other permissions
        try {
          // Check if user has SEND_MESSAGES or ADMINISTRATOR permissions
          const hasSendPermission = await this.syncBase.permissions.hasPermission('SEND_MESSAGES');
          const hasAdminPermission = await this.syncBase.permissions.hasPermission('ADMINISTRATOR');
          
          if (hasSendPermission || hasAdminPermission) {
            isAuthorized = true;
          } else {
            // Final fallback - try admin permission
            const isAdmin = await this.syncBase.serverInitializer.hasAdminPermission();
            isAuthorized = !!isAdmin;
          }
        } catch (permErr) {
          console.error('Permission check error:', permErr);
          // Default to unauthorized on error
          isAuthorized = false;
        }
      }
      
      // Check final authorization result
      if (!isAuthorized) {
        throw new Error('Unauthorized: You do not have permission to send messages in this channel');
      }

      // Generate a unique ID for the message
      const id = this.syncBase.crypto.generateId()
      
      // Get the author ID (current user)
      const author = b4a.toString(this.syncBase.crypto.publicKey, 'hex')

      // Prepare message data
      const messageData = {
        id,
        channelId,
        content,
        author,
        attachments: Array.isArray(attachments) ? attachments : [],
        timestamp: Date.now()
      }

      // Try direct database operation first
      try {
        // Use direct database insert
        await this.syncBase.base.view.insert('@server/message', messageData)
        return messageData
      } catch (err) {
        console.warn('Direct message insert failed, trying dispatch method:', err.message)
        
        // Fall back to dispatch method
        // Create the message action with properly formatted attachments
        const actionData = {
          ...messageData,
          attachments: Array.isArray(messageData.attachments) ? messageData.attachments : []
        }
        
        const action = this.syncBase.crypto.createSignedAction('@server/send-message', actionData)

        // Try using router's direct dispatch
        try {
          await this.syncBase.router.router.dispatch('@server/send-message', actionData, {
            view: this.syncBase.base.view,
            base: this.syncBase.base,
            authorKey: this.syncBase.crypto.publicKey
          })
        } catch (dispatchErr) {
          console.warn('Router dispatch failed, using Autobase append:', dispatchErr.message)
          
          try {
            // If that fails, try using MessageParser
            const MessageParser = require('./parser')
            const encodedAction = MessageParser.encodeAction(action)
            
            if (encodedAction) {
              // Dispatch the action using Autobase append
              await this.syncBase.base.append(encodedAction, { optimistic: true })
            } else {
              console.error('Error encoding action:', action)
              throw new Error('Failed to encode message action')
            }
          } catch (encodeErr) {
            console.error('Error encoding action:', encodeErr)
            throw new Error('Failed to encode message action')
          }
        }
      }

      return messageData
    } catch (err) {
      console.error('Error sending message:', err)
      throw err
    }
  }

  /**
   * Edit a message
   * @param {Object} params - Edit parameters
   * @param {String} params.messageId - The message ID
   * @param {String} params.content - The new content
   * @returns {Promise<Object>} The edited message
   */
  async editMessage({ messageId, content }) {
    try {
      // Check if the message exists
      const message = await this.syncBase.base.view.findOne('@server/message', { id: messageId })
      if (!message) {
        throw new Error('Message not found')
      }

      // Verify ownership - only the author can edit their messages
      const authorId = b4a.toString(this.syncBase.crypto.publicKey, 'hex')
      if (message.author !== authorId) {
        throw new Error('You can only edit your own messages')
      }

      // Prepare edit data
      const editData = {
        id: messageId,
        content,
        editedAt: Date.now()
      }

      // Try direct database operation first
      try {
        // Use direct database update
        await this.syncBase.base.view.update('@server/message', {
          ...editData,
          channelId: message.channelId, // Include required fields
          author: message.author
        })
        return { ...message, ...editData }
      } catch (err) {
        console.warn('Direct message update failed, trying dispatch method:', err.message)
        
        // Fall back to dispatch method
        // Create the edit action
        const action = this.syncBase.crypto.createSignedAction('@server/edit-message', editData)

        // Try using router's direct dispatch
        try {
          await this.syncBase.router.router.dispatch('@server/edit-message', editData, {
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
            throw new Error('Failed to encode message edit action')
          }
        }
      }

      return { ...message, ...editData }
    } catch (err) {
      console.error('Error editing message:', err)
      throw err
    }
  }

  /**
   * Delete a message
   * @param {Object} params - Delete parameters
   * @param {String} params.messageId - The message ID
   * @returns {Promise<Boolean>} Whether the deletion was successful
   */
  async deleteMessage({ messageId }) {
    try {
      // Check if the message exists
      const message = await this.syncBase.base.view.findOne('@server/message', { id: messageId })
      if (!message) {
        throw new Error('Message not found')
      }

      // Prepare delete data
      const deleteData = {
        id: messageId,
        deletedAt: Date.now(),
        deletedBy: b4a.toString(this.syncBase.crypto.publicKey, 'hex')
      }

      // Try direct database operation first
      try {
        // Use direct database update for soft delete
        await this.syncBase.base.view.update('@server/message', {
          ...deleteData,
          channelId: message.channelId, // Include required fields
          author: message.author,
          content: message.content
        })
        return true
      } catch (err) {
        console.warn('Direct message delete failed, trying dispatch method:', err.message)
        
        // Fall back to dispatch method
        // Create the delete action
        const action = this.syncBase.crypto.createSignedAction('@server/delete-message', deleteData)

        // Try using router's direct dispatch
        try {
          await this.syncBase.router.router.dispatch('@server/delete-message', deleteData, {
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
            throw new Error('Failed to encode message delete action')
          }
        }
      }

      return true
    } catch (err) {
      console.error('Error deleting message:', err)
      throw err
    }
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
