const b4a = require('b4a')
const { getEncoding } = require('./spec/hyperdispatch/messages')

class MessageParser {

  static parseNode(node, options = {}) {
    try {
      // If the node is already a decoded action object, return it
      if (node && typeof node === 'object' && node.type && node.payload) {
        return node
      }

      // Handle serverInitAction format
      if (node && node.serverInitAction) {
        const action = node.serverInitAction
        if (!action.type || !action.payload) {
          console.warn('Invalid serverInitAction format')
          return null
        }
        return action
      }

      // Handle encodedAction format
      if (node && node.encodedAction) {
        const buffer = node.encodedAction
        if (!b4a.isBuffer(buffer)) {
          console.warn('Invalid encodedAction format')
          return null
        }

        // Extract message type from first byte
        const messageType = buffer[0]
        const encoding = this.getEncodingForType(messageType, options)

        if (!encoding) {
          console.warn(`Unknown message type: ${messageType}`)
          return null
        }

        try {
          // Decode the message
          const state = {
            buffer,
            start: 1,
            end: buffer.byteLength
          }

          const payload = encoding.decode(state)

          return {
            type: node.type || '@server/create-server',
            payload,
            signer: node.signer,
            signature: node.signature
          }
        } catch (err) {
          console.error('Error decoding message:', err)
          return null
        }
      }

      // Handle raw value buffer
      if (node && node.value && b4a.isBuffer(node.value)) {
        const buffer = node.value
        if (buffer.length < 1) {
          console.warn('Invalid message buffer: too short')
          return null
        }

        const messageType = buffer[0]
        const encoding = this.getEncodingForType(messageType, options)

        if (!encoding) {
          console.warn(`Unknown message type: ${messageType}`)
          return null
        }

        try {
          const state = {
            buffer,
            start: 1,
            end: buffer.byteLength
          }

          const payload = encoding.decode(state)

          return {
            type: node.type || '@server/create-server',
            payload,
            signer: node.signer,
            signature: node.signature
          }
        } catch (err) {
          console.error('Error decoding message:', err)
          return null
        }
      }

      console.warn('Unknown message data format:', typeof node)
      return null
    } catch (error) {
      console.error('Error in message parsing:', error)
      return null
    }
  }
  // Modify the encodeAction method to handle full action structure
  static encodeAction(action) {
    try {
      // Validate action
      if (!action || !action.type || !action.payload) {
        console.warn('Invalid action format for encoding:', action)
        return null
      }

      // Determine the message type based on the action type
      const typeMap = {
        '@server/create-server': 0,
        '@server/update-server': 1,
        '@server/create-channel': 2,
        '@server/update-channel': 3,
        '@server/delete-channel': 4,
        '@server/send-message': 5,
        '@server/edit-message': 6,
        '@server/delete-message': 7,
        '@server/set-role': 8,
        '@server/create-invite': 9,
        '@server/claim-invite': 10,
        '@server/revoke-invite': 11
      }

      const messageType = typeMap[action.type]
      if (messageType === undefined) {
        console.warn(`Unknown action type for encoding: ${action.type}`)
        return null
      }

      // Get the appropriate encoding
      const encoding = this.getEncodingForType(messageType)
      if (!encoding) {
        console.warn(`No encoding found for type: ${action.type}`)
        return null
      }

      // Use direct dispatch function from hyperdispatch
      try {
        const { dispatch } = require('./spec/hyperdispatch')
        return dispatch(action.type, action.payload)
      } catch (err) {
        console.error('Error using hyperdispatch:', err)
        
        // Fallback to manual encoding
        // Create a state for encoding
        const state = { buffer: null, start: 0, end: 0 }

        // Preencode to determine buffer size
        encoding.preencode(state, action.payload)

        // Validate buffer size
        if (isNaN(state.end) || state.end <= 0) {
          console.warn('Invalid buffer size:', state.end)
          return null
        }

        // Create a buffer with space for type byte
        const bufferSize = state.end + 1
        if (bufferSize <= 0 || bufferSize > 10000000) { // Sanity check
          console.warn('Buffer size out of reasonable range:', bufferSize)
          return null
        }

        state.buffer = b4a.allocUnsafe(bufferSize)

        // Write type byte
        state.buffer[0] = messageType
        state.start = 1

        // Encode the payload
        encoding.encode(state, action.payload)

        // Attach additional metadata
        state.buffer.type = action.type
        state.buffer.signer = action.signer
        state.buffer.signature = action.signature

        return state.buffer
      }
    } catch (err) {
      console.error('Error encoding action:', err)
      return null
    }
  }

  /**
   * Get the appropriate encoding for a message type
   * @param {number} messageType - The message type byte
   * @param {Object} options - Additional options for encoding selection
   * @returns {Object|null} Encoding object or null
   */
  static getEncodingForType(messageType, options = {}) {
    // Map of message types to their encodings
    const encodingMap = {
      0: () => getEncoding('@server/server'),
      1: () => getEncoding('@server/server'),
      2: () => getEncoding('@server/channel'),
      3: () => getEncoding('@server/channel'),
      4: () => getEncoding('@server/message'),
      5: () => getEncoding('@server/message'),
      6: () => getEncoding('@server/message'),
      7: () => getEncoding('@server/message'),
      8: () => getEncoding('@server/role'),
      9: () => getEncoding('@server/invite'),
      10: () => getEncoding('@server/user'),
      11: () => getEncoding('@server/revoke-invite'),
      // Add more mappings as needed
    }

    if (options.getEncoding) {
      const customEncoding = options.getEncoding(messageType)
      if (customEncoding) return customEncoding
    }

    const encodingGetter = encodingMap[messageType]
    return encodingGetter ? encodingGetter() : null
  }

  /**
   * Process a decoded message with additional transformations
   * @param {Object} message - The decoded message
   * @param {number} messageType - The message type
   * @param {Object} options - Processing options
   * @returns {Object} Processed message
   */
  static processMessage(message, messageType, options = {}) {
    return message;
    // Handle specific message type processing
    switch (messageType) {
      case 20: // Example message type
      case 21:
        // Process attachments if present
        if (message.hasAttachments && message.attachments) {
          try {
            message.attachments = typeof message.attachments === 'string'
              ? JSON.parse(message.attachments)
              : message.attachments
          } catch (err) {
            message.attachments = []
          }
        }
        break
    }

    // Allow custom post-processing
    if (options.processMessage) {
      return options.processMessage(message, messageType)
    }

    return message
  }

  /**
   * ID to schema mapping for encoding
   * @type {Object}
   */
  static SCHEMA_MAP = {
    1: () => getEncoding('@server/server'),
    2: () => getEncoding('@server/channel'),
    3: () => getEncoding('@server/channel'),
    4: () => getEncoding('@server/channel'),
    5: () => getEncoding('@server/message'),
    6: () => getEncoding('@server/message'),
    7: () => getEncoding('@server/message'),
    8: () => getEncoding('@server/role'),
    9: () => getEncoding('@server/invite'),
    10: () => getEncoding('@server/user'),
    11: () => getEncoding('@server/revoke-invite')
  }
}

module.exports = MessageParser
