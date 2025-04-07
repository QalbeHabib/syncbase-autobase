const c = require('compact-encoding')
const b4a = require('b4a')

// Action type mapping
const ACTION_TYPES = {
  '@server/create-server': 1,
  '@server/create-channel': 2,
  '@server/send-message': 3,
  '@server/set-role': 4,
  '@server/claim-invite': 5,
  '@server/create-invite': 6,
  '@server/delete-message': 7,
  '@server/edit-message': 8,
  '@server/update-server': 9,
  '@server/update-channel': 10,
  '@server/delete-channel': 11
}

/**
 * Create a dispatch payload for a specific action type
 * @param {String} type - The action type
 * @param {Object} action - The action data
 * @returns {Buffer} Encoded action buffer
 */
function dispatch(type, action) {
  if (!ACTION_TYPES[type]) {
    throw new Error(`Unknown action type: ${type}`)
  }

  // Create the buffer
  const typeId = ACTION_TYPES[type]
  const buffer = Buffer.alloc(1)
  buffer[0] = typeId

  // Create JSON representation of the action
  const actionBuffer = b4a.from(JSON.stringify(action))

  // Combine the buffers
  return Buffer.concat([buffer, actionBuffer])
}

/**
 * Parse a dispatched action
 * @param {Buffer} buffer - The encoded action buffer
 * @returns {Object|null} The decoded action or null if invalid
 */
function parseDispatch(buffer) {
  if (!buffer || buffer.length < 2) {
    return null
  }

  try {
    // Get the action type
    const typeId = buffer[0]

    // Find the action type string
    let type = 'UNKNOWN'
    for (const [key, value] of Object.entries(ACTION_TYPES)) {
      if (value === typeId) {
        type = key
        break
      }
    }

    // Parse the JSON data
    const actionData = JSON.parse(buffer.slice(1).toString())

    return {
      type,
      ...actionData
    }
  } catch (err) {
    console.error('Error parsing dispatch:', err)
    return null
  }
}

module.exports = {
  dispatch,
  parseDispatch,
  ACTION_TYPES
}
