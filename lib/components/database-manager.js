const HyperDB = require('hyperdb')
const db = require('./spec/db')

/**
 * DatabaseManager - Handles database operations with HyperDB
 */
class DatabaseManager {
  /**
   * Create a new DatabaseManager instance
   */
  constructor() {
    this.db = null
  }

  /**
   * Create the database view for the Autobase
   * @param {Object} store - Store from the Autobase open function
   * @returns {Object} Database view
   */
  createDatabaseView(store) {
    // Use HyperDB with our schema
    this.db = HyperDB.bee(store.get('view'), db, {
      extension: false,
      autoUpdate: true
    })

    // Add utility methods to properly handle streams
    this.db.findAll = async function (collection, query = {}) {
      return new Promise((resolve, reject) => {
        const results = []
        this.find(collection, query)
          .on('data', data => results.push(data))
          .on('error', err => reject(err))
          .on('end', () => resolve(results))
      })
    }

    this.db.findOne = async function (collection, query = {}) {
      return new Promise((resolve, reject) => {
        let found = null
        this.find(collection, query)
          .on('data', data => {
            if (!found) found = data
          })
          .on('error', err => reject(err))
          .on('end', () => resolve(found))
      })
    }

    return this.db
  }

  /**
   * Check if a server exists in the database
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} True if a server exists
   */
  static async hasServer(view) {
    if (!view) return false

    try {
      const servers = await DatabaseManager.getAll(view, '@server/server', {})
      return servers.length > 0
    } catch (err) {
      console.error('Error checking for servers:', err)
      return false
    }
  }

  /**
   * Get a user by their public key
   * @param {Object} view - The database view
   * @param {Buffer} publicKey - The user's public key
   * @returns {Promise<Object|null>} The user object or null
   */
  static async getUserByPublicKey(view, publicKey) {
    if (!view) return null

    try {
      return await DatabaseManager.getOne(view, '@server/user', { publicKey })
    } catch (err) {
      console.error('Error getting user by public key:', err)
      return null
    }
  }

  /**
   * Flush changes to storage
   * @param {Object} view - The database view
   * @returns {Promise<void>}
   */
  static async flush(view) {
    if (view && view.flush) {
      await view.flush()
    }
  }

  /**
   * Get all records from a collection
   * @param {Object} view - The database view
   * @param {String} collection - The collection name (e.g., '@server/message')
   * @param {Object} query - Query parameters
   * @returns {Promise<Array>} The query results
   */
  static async getAll(view, collection, query = {}) {
    if (!view) return []

    try {
      if (view.findAll) {
        return await view.findAll(collection, query)
      }

      // Fallback for views without our custom method
      return new Promise((resolve, reject) => {
        const results = []
        view.find(collection, query)
          .on('data', data => results.push(data))
          .on('error', err => reject(err))
          .on('end', () => resolve(results))
      })
    } catch (err) {
      console.error(`Error getting all from ${collection}:`, err)
      return []
    }
  }

  /**
   * Get a single record from a collection
   * @param {Object} view - The database view
   * @param {String} collection - The collection name (e.g., '@server/server')
   * @param {Object} query - Query parameters
   * @returns {Promise<Object|null>} The record or null if not found
   */
  static async getOne(view, collection, query = {}) {
    if (!view) return null

    try {
      if (view.findOne) {
        return await view.findOne(collection, query)
      }

      // Fallback for views without our custom method
      return new Promise((resolve, reject) => {
        let found = null
        view.find(collection, query)
          .on('data', data => {
            if (!found) found = data
          })
          .on('error', err => reject(err))
          .on('end', () => resolve(found))
      })
    } catch (err) {
      console.error(`Error getting one from ${collection}:`, err)
      return null
    }
  }

  /**
   * Insert a record into a collection
   * @param {Object} view - The database view
   * @param {String} collection - The collection name (e.g., '@server/channel')
   * @param {Object} data - The data to insert
   * @returns {Promise<Object|null>} The inserted record or null on error
   */
  static async insert(view, collection, data) {
    if (!view) return null

    try {
      return await view.insert(collection, data)
    } catch (err) {
      console.error(`Error inserting into ${collection}:`, err)
      return null
    }
  }

  /**
   * Update a record in a collection
   * @param {Object} view - The database view
   * @param {String} collection - The collection name (e.g., '@server/message')
   * @param {Object} data - The data to update with identifier fields
   * @returns {Promise<Object|null>} The updated record or null on error
   */
  static async update(view, collection, data) {
    if (!view) return null

    try {
      return await view.update(collection, data)
    } catch (err) {
      console.error(`Error updating in ${collection}:`, err)
      return null
    }
  }

  /**
   * Delete a record from a collection
   * @param {Object} view - The database view
   * @param {String} collection - The collection name (e.g., '@server/invite')
   * @param {Object} query - Query to find the record
   * @returns {Promise<Boolean>} True if deleted, false otherwise
   */
  static async delete(view, collection, query) {
    if (!view) return false

    try {
      return await view.delete(collection, query)
    } catch (err) {
      console.error(`Error deleting from ${collection}:`, err)
      return false
    }
  }
}

module.exports = DatabaseManager
