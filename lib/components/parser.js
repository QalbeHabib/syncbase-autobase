const b4a = require('b4a')
const { getEncoding } = require('./spec/hyperdispatch/messages')

class MessageParser {

  static parseNode(node, options = {}) {
    try {
      // If the node is already a decoded action object, return it
      if (node && typeof node === 'object' && node.type && node.payload) {
        return node
      }

      // Check if we have a node with the specific structure you're seeing
      if (node && node.value && b4a.isBuffer(node.value)) {
        // Extract additional metadata if available
        const type = node.value.type || '@server/create-server'
        const signer = node.value.signer
        const signature = node.value.signature

        // Ensure we have at least one byte for message type
        if (node.value.length < 1) {
          console.warn('Invalid message buffer: too short')
          return null
        }

        // Get message type from first byte
        const messageType = node.value[0]
        console.log('parseNode messageType: ', messageType)

        // Dynamically get encoding based on message type
        const encoding = this.getEncodingForType(messageType, options)

        if (!encoding) {
          console.warn(`Unknown message type: ${messageType}`)
          return null
        }

        // Decode the message
        // Ensure we start parsing from the second byte (after message type)
        const state = {
          buffer: node.value,
          start: 1,
          end: node.value.byteLength
        }

        const payload = encoding.decode(state)

        // Return the full action structure
        return {
          type,
          payload,
          signer,
          signature
        }
      }

      // Log the full node structure for debugging
      console.warn('Unknown message data format:', typeof node)
      return null
    } catch (error) {
      console.error('Error in message parsing:', error)
      return null
    }
  }
  // Modify the encodeAction method to handle full action structure
  static encodeAction(action) {
    // Determine the message type based on the action type
    const typeMap = {
      '@server/create-server': 0,
      '@server/update-server': 1,
      '@server/create-channel': 2,
      '@server/update-channel': 3,
      '@server/send-message': 4,
      '@server/edit-message': 5,
      '@server/delete-message': 6,
      '@server/set-role': 7,
      '@server/create-invite': 8,
      '@server/claim-invite': 9
    }

    const messageType = typeMap[action.type]
    if (messageType === undefined) {
      throw new Error(`Unknown action type: ${action.type}`)
    }

    // Get the appropriate encoding
    const encoding = this.getEncodingForType(messageType)
    if (!encoding) {
      throw new Error(`No encoding found for type: ${action.type}`)
    }

    // Create a state for encoding
    const state = { buffer: null, start: 0, end: 0 }

    // Preencode to determine buffer size
    encoding.preencode(state, action.payload)

    // Create a buffer with space for type byte
    state.buffer = b4a.allocUnsafe(state.end + 1)

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
}

module.exports = MessageParser
