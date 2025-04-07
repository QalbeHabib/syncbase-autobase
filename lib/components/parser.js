const b4a = require('b4a')
const { getEncoding } = require('./spec/hyperdispatch/messages')

class MessageParser {
  /**
   * Parse a message node using Hyperdispatch encoding
   * @param {Object|Buffer} node - The node to parse
   * @param {Object} options - Parsing options
   * @returns {Object|null} Parsed message or null
   */
  static parseNode(node, options = {}) {
    try {
      // If data is already an object (not a Buffer), return it
      if (node && typeof node === 'object' && !b4a.isBuffer(node.value)) {
        return node.value
      }

      // If we have a node with value Buffer, use the Hyperdispatch approach
      if (node && node.value && b4a.isBuffer(node.value)) {
        // Create state object for binary decoding
        const state = {
          buffer: node.value,
          start: 0,
          end: node.value.byteLength
        }

        // Get message type from first byte
        const messageType = node.value[0]

        // Dynamically get encoding based on message type
        const encoding = this.getEncodingForType(messageType, options)

        if (!encoding) {
          console.warn(`Unknown message type: ${messageType}`)
          return null
        }

        // Decode the message
        // Ensure we start parsing from the second byte (after message type)
        state.start = 1
        const message = encoding.decode(state)

        // Process additional parsing if needed
        return message
      }

      // If we get here, we don't know how to handle this format
      console.warn('Unknown message data format:', typeof node)
      return null
    } catch (error) {
      console.error('Error in message parsing:', error)
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
   * Encode a message for dispatching
   * @param {string} type - Message type
   * @param {Object} payload - Message payload
   * @param {Object} options - Encoding options
   * @returns {Buffer} Encoded message buffer
   */
  static encodeMessage(type, payload, options = {}) {
    // Determine message type byte
    const typeMap = {
      'server': 0,
      'channel': 1,
      'message': 2,
      "user": 3,
      "role": 4,
      "invite": 5
    }

    // Get the type byte
    const typeByte = typeof type === 'number'
      ? type
      : (typeMap[type] || 0)

    // Get the appropriate encoding
    const encoding = this.getEncodingForType(typeByte, options)

    if (!encoding) {
      throw new Error(`No encoding found for type: ${type}`)
    }

    // Create a state for encoding
    const state = { buffer: null, start: 0, end: 0 }

    // Preencode to determine buffer size
    encoding.preencode(state, payload)

    // Create a buffer with space for type byte
    state.buffer = b4a.allocUnsafe(state.end + 1)

    // Write type byte
    state.buffer[0] = typeByte
    state.start = 1

    // Encode the payload
    encoding.encode(state, payload)

    return state.buffer
  }
}

module.exports = MessageParser
