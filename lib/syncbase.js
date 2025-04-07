const Autobase = require('autobase')
const BlindPairing = require('blind-pairing')
const Hyperswarm = require('hyperswarm')
const ReadyResource = require('ready-resource')
const z32 = require('z32')
const b4a = require('b4a')
const crypto = require('hypercore-crypto')
const { EventEmitter } = require('events')

const CryptoManager = require('./components/crypto-manager')
const MessageManager = require('./components/message-manager')
const ChannelManager = require('./components/channel-manager')
const PermissionManager = require('./components/permission-manager')
const InviteManager = require('./components/invite-manager')
const ActionValidator = require('./components/action-validator')
const DatabaseManager = require('./components/database-manager')
const ServerInitializer = require('./components/server-initializer')
const { dispatch, parseDispatch } = require('./utils/dispatch')

/**
 * SyncBase - A Discord-like server implementation using Autobase
 * Each SyncBase instance IS a server
 * @extends {ReadyResource}
 */
class SyncBase extends ReadyResource {
  /**
   * Create a new SyncBase instance (which is the server itself)
   * @param {Object} corestore - Hypercore storage instance
   * @param {Object} options - Configuration options
   * @param {Buffer|String} [options.key] - The public key of the Autobase
   * @param {Buffer} [options.encryptionKey] - Encryption key for the Autobase
   * @param {Boolean} [options.replicate=true] - Whether to replicate with peers
   * @param {String|Array} [options.seedPhrase] - Seed phrase to derive keys from
   * @param {Array} [options.bootstrap] - Bootstrap servers for the DHT
   */
  constructor(corestore, options = {}) {
    super()

    this.store = corestore
    this.options = options
    this.replicate = options.replicate !== false
    this.bootstrap = options.bootstrap || null
    this.swarm = null
    this.eventEmitter = new EventEmitter()

    // Initialize crypto manager
    this.crypto = new CryptoManager(options.seedPhrase)

    // Initialize database view manager
    this.dbManager = new DatabaseManager()

    // Initialize components with dependency injection
    this.validator = new ActionValidator(this.crypto)
    this.serverInitializer = new ServerInitializer(this, this.validator)
    this.channels = new ChannelManager(this, this.validator)
    this.messages = new MessageManager(this, this.validator)
    this.permissions = new PermissionManager(this, this.validator)
    this.invites = new InviteManager(this, this.crypto, this.validator)

    // Initialize Autobase
    this._initAutobase(options)

    // Start initialization
    this.ready().catch(err => console.error('Error initializing SyncBase:', err))
  }

  /**
   * Initialize Autobase with optimistic mode
   * @param {Object} options - Configuration options
   * @private
   */
  _initAutobase(options) {
    const { key, encryptionKey } = options

    this.base = new Autobase(this.store, key, {
      encrypt: true,
      encryptionKey,
      optimistic: true,
      // Set up the database view
      open: (store) => {
        return this.dbManager.createDatabaseView(store)
      },

      // Apply incoming changes with validation
      apply: this._apply.bind(this)
    })

    // Listen for updates
    this.base.on('update', () => {
      if (!this.base._interrupting) {
        this.eventEmitter.emit('update')
      }
    })
  }

  /**
   * Apply function for Autobase - validates and processes incoming operations
   * @param {Array} nodes - Incoming nodes to apply
   * @param {Object} view - The database view
   * @param {Object} host - Host functions for Autobase
   * @private
   */
  async _apply(nodes, view, host) {
    for (const node of nodes) {
      try {
        console.log(node)
        // Parse the action from the node value
        const action = await this._parseAction(node.value)

        if (!action) {
          console.warn('Could not parse action, skipping')
          continue
        }
        // Special case for initialization actions when there's no server yet
        const isInitializing = action.type === 'INITIALIZE_SERVER'

        // Always acknowledge the writer if this is server initialization
        if (isInitializing) {
          console.log('Processing server initialization action')
          await host.ackWriter(node.from.key)
        }

        // Check if the action is valid
        const isValid = await this.validator.validateAction(
          action,
          node.from.key,
          view,
          true
        )

        if (!isValid) {
          console.warn(`Invalid action: ${action.type}`)
          continue
        }

        // Acknowledge writer if needed (for optimistic operations)
        if (action.type === 'CLAIM_INVITE') {
          await host.ackWriter(node.from.key)
        }

        // Process the action based on its type
        await this._processAction(action, view, action.signer)

        // After processing INITIALIZE_SERVER, make sure to ack the writer again
        if (isInitializing) {
          await host.ackWriter(node.from.key)
        }
      } catch (err) {
        console.error('Error applying node:', err)
        continue
      }
    }

    await view.flush()
  }

  /**
   * Parse an action from a node value
   * @param {Buffer} value - The node value
   * @returns {Object|null} The parsed action or null if invalid
   * @private
   */
  async _parseAction(value) {
    if (!value || !b4a.isBuffer(value)) {
      return value
    }

    try {
      // Get the action type from the first byte
      const typeId = value[0]

      // Find the action type
      let type = 'UNKNOWN'
      const actionTypes = {
        1: 'INITIALIZE_SERVER',
        2: 'CREATE_CHANNEL',
        3: 'SEND_MESSAGE',
        4: 'SET_ROLE',
        5: 'CLAIM_INVITE',
        6: 'CREATE_INVITE',
        7: 'DELETE_MESSAGE',
        8: 'EDIT_MESSAGE',
        9: 'UPDATE_SERVER',
        10: 'UPDATE_CHANNEL',
        11: 'DELETE_CHANNEL'
      }



      if (actionTypes[typeId]) {
        type = actionTypes[typeId]
      }

      const action = JSON.parse(value.slice(1).toString())

      return {
        type,
        signature: action.signature ? b4a.from(action.signature) : Buffer.alloc(0),
        payload: action.payload
      }
    } catch (err) {
      console.error('Error parsing action:', err)
      return null
    }
  }

  /**
   * Process an action based on its type
   * @param {Object} action - The validated action
   * @param {Object} view - The database view
   * @param {Buffer} authorKey - The author's public key
   * @private
   */
  async _processAction(action, view, authorKey) {
    const authorId = b4a.toString(authorKey, 'hex')
    console.log(`Processing action: ${action.type} from ${authorId.substring(0, 8)}`)

    switch (action.type) {
      case 'INITIALIZE_SERVER': // Changed from CREATE_SERVER
        // Create the server record
        try {
          console.log('Inserting server with ID:', action.payload.id)
          console.log(action.payload)
          await view.insert('@server/server', action.payload)
          console.log('Server initialized successfully')
        } catch (err) {
          console.error('Error inserting server record:', err)
          throw err
        }
        break

      case 'UPDATE_SERVER':
        // Update existing server
        try {
          await view.update('@server/server', {
            id: action.payload.id,
            name: action.payload.name,
            description: action.payload.description,
            updatedBy: authorId,
            updatedAt: action.payload.updatedAt || action.payload.timestamp
          })
        } catch (err) {
          console.error('Error updating server record:', err)
          throw err
        }
        break

      case 'CREATE_USER':
        // Handle user creation
        await view.insert('@server/user', {
          id: action.payload.id,
          publicKey: action.payload.publicKey,
          username: action.payload.username,
          joinedAt: action.payload.joinedAt || action.payload.timestamp
        })
        break

      case 'CREATE_CHANNEL':
        // Handle channel creation
        await view.insert('@server/channel', {
          id: action.payload.id,
          serverId: action.payload.serverId,
          name: action.payload.name,
          type: action.payload.type,
          topic: action.payload.topic,
          createdBy: authorId,
          createdAt: action.payload.createdAt || action.payload.timestamp
        })
        break

      case 'SEND_MESSAGE':
        await view.insert('@server/message', {
          id: action.payload.id,
          channelId: action.payload.channelId,
          content: action.payload.content,
          author: authorId,
          timestamp: action.payload.timestamp,
          attachments: action.payload.attachments || []
        })
        break

      case 'SET_ROLE':
        // Verify that only server owners can set ADMIN roles
        // and only ADMINs or OWNERs can set other roles
        if (action.payload.role === 'ADMIN' || action.payload.role === 'OWNER') {
          // Check if the action author has OWNER role
          const authorRole = await view.findOne('@server/role', {
            userId: authorId,
            serverId: action.payload.serverId
          })

          if (!authorRole || authorRole.role !== 'OWNER') {
            // Only owners can set admin/owner roles
            console.warn('Unauthorized role assignment attempt:', authorId, 'tried to set', action.payload.role)
            break
          }
        }

        // Handle role assignment
        await view.update('@server/role', {
          userId: action.payload.userId,
          serverId: action.payload.serverId,
          role: action.payload.role,
          updatedAt: action.payload.timestamp,
          updatedBy: authorId
        })
        break

      case 'CLAIM_INVITE':
        // For regular invite claims, check if the invite exists and is valid
        if (action.payload.inviteCode !== 'initial-user') {
          const invite = await view.findOne('@server/invite', { code: action.payload.inviteCode })
          if (!invite || (invite.expiresAt && invite.expiresAt < action.payload.timestamp)) {
            console.warn('Invalid invite code:', action.payload.inviteCode)
            break
          }
        }

        // Create or update user record
        await view.update('@server/user', {
          id: authorId,
          publicKey: authorKey,
          username: action.payload.username || `User-${authorId.substring(0, 8)}`,
          joinedAt: action.payload.timestamp,
          inviteCode: action.payload.inviteCode
        })
        break

      case 'CREATE_INVITE':
        await view.insert('@server/invite', {
          id: action.payload.id,
          code: action.payload.code,
          serverId: action.payload.serverId,
          createdBy: authorId,
          createdAt: action.payload.timestamp,
          expiresAt: action.payload.expiresAt
        })
        break

      case 'DELETE_MESSAGE':
        const message = await view.findOne('@server/message', { id: action.payload.id })
        if (message) {
          await view.update('@server/message', {
            id: action.payload.id,
            deletedAt: action.payload.timestamp,
            deletedBy: authorId
          })
        }
        break

      case 'UPDATE_CHANNEL':
        await view.update('@server/channel', {
          id: action.payload.id,
          name: action.payload.name,
          topic: action.payload.topic,
          updatedAt: action.payload.timestamp,
          updatedBy: authorId
        })
        break

      case 'DELETE_CHANNEL':
        await view.delete('@server/channel', { id: action.payload.id })
        break

      default:
        // Unknown action type
        console.warn(`Unknown action type: ${action.type}`)
    }
    console.log('End process')
  }

  /**
   * Initialize replication with peers
   * @private
   */
  async _setupReplication() {
    if (!this.replicate) return

    this.swarm = new Hyperswarm({
      keyPair: await this.store.createKeyPair('hyperswarm'),
      bootstrap: this.bootstrap
    })

    this.swarm.on('connection', (connection, peerInfo) => {
      this.store.replicate(connection)
    })

    this.swarm.join(this.base.discoveryKey)
  }

  /**
   * Resource open implementation
   * @private
   */
  async _open() {
    // Initialize Autobase
    await this.base.ready()

    // Setup replication if enabled
    if (this.replicate) {
      await this._setupReplication()
    }

    // Initialize managers
    await this.channels.init()
    await this.messages.init()
    await this.permissions.init()
    await this.invites.init()
  }

  /**
   * Resource close implementation
   * @private
   */
  async _close() {
    if (this.swarm) {
      await this.swarm.destroy()
    }
    await this.base.close()
  }

  /**
   * Get the writer's public key
   * @returns {Buffer} The writer's public key
   */
  get writerKey() {
    return this.base.local.key
  }

  /**
   * Get the Autobase public key
   * @returns {Buffer} The Autobase public key
   */
  get key() {
    return this.base.key
  }

  /**
   * Get the Autobase discovery key
   * @returns {Buffer} The Autobase discovery key
   */
  get discoveryKey() {
    return this.base.discoveryKey
  }

  /**
   * Check if this instance has write access
   * @returns {Boolean} True if this instance has write access
   */
  get writable() {
    return this.base.writable
  }

  /**
   * Initialize this SyncBase as a server
   * @param {Object} options - Server options
   * @param {String} options.name - Server name
   * @param {String} [options.description] - Server description
   * @returns {Promise<Object>} The server information
   */
  async initialize(options) {
    return this.serverInitializer.initialize(options)
  }

  /**
   * Get server information
   * @returns {Promise<Object|null>} The server info
   */
  async getServerInfo() {
    return this.serverInitializer.getServerInfo()
  }

  /**
   * Update server information
   * @param {Object} options - Update options
   * @param {String} [options.name] - New server name
   * @param {String} [options.description] - New server description
   * @returns {Promise<Object>} The updated server info
   */
  async updateServerInfo(options) {
    return this.serverInitializer.updateServerInfo(options)
  }

  /**
   * Listen for events
   * @param {String} event - The event name
   * @param {Function} listener - The event listener
   */
  on(event, listener) {
    this.eventEmitter.on(event, listener)
  }

  /**
   * Remove an event listener
   * @param {String} event - The event name
   * @param {Function} listener - The event listener
   */
  off(event, listener) {
    this.eventEmitter.off(event, listener)
  }

  /**
   * Create a pair to join a server using an invite code
   * @param {Object} store - The corestore instance
   * @param {String} inviteCode - The invite code
   * @param {Object} [options] - Additional options
   * @returns {Object} A pairing instance
   */
  static pair(store, inviteCode, options = {}) {
    return new SyncBasePairer(store, inviteCode, options)
  }
}

/**
 * SyncBasePairer - Handles the pairing process for joining a server
 * @extends {ReadyResource}
 */
class SyncBasePairer extends ReadyResource {
  /**
   * Create a new SyncBasePairer instance
   * @param {Object} store - The corestore instance
   * @param {String} inviteCode - The invite code
   * @param {Object} [options] - Additional options
   */
  constructor(store, inviteCode, options = {}) {
    super()

    this.store = store
    this.inviteCode = inviteCode
    this.bootstrap = options.bootstrap || null
    this.swarm = null
    this.pairing = null
    this.candidate = null
    this.instance = null

    this.onresolve = null
    this.onreject = null

    this.ready().catch(err => console.error('Error initializing SyncBasePairer:', err))
  }

  /**
   * Resource open implementation
   * @private
   */
  async _open() {
    await this.store.ready()

    this.swarm = new Hyperswarm({
      keyPair: await this.store.createKeyPair('hyperswarm'),
      bootstrap: this.bootstrap
    })

    this.swarm.on('connection', (connection) => {
      this.store.replicate(connection)
    })

    this.pairing = new BlindPairing(this.swarm)

    // Get local key
    const core = Autobase.getLocalCore(this.store)
    await core.ready()
    const key = core.key
    await core.close()

    // Add candidate for pairing
    this.candidate = this.pairing.addCandidate({
      invite: z32.decode(this.inviteCode),
      userData: key,
      onadd: async (result) => {
        if (!this.instance) {
          this.instance = new SyncBase(this.store, {
            swarm: this.swarm,
            key: result.key,
            encryptionKey: result.encryptionKey,
            bootstrap: this.bootstrap
          })

          // Wait for the instance to be ready
          await this.instance.ready()

          // Send CLAIM_INVITE action optimistically
          await this.instance.invites.claimInvite({
            inviteCode: this.inviteCode,
            timestamp: Date.now()
          })
        }

        this.swarm = null
        this.store = null

        if (this.onresolve) {
          this._whenWritable()
        }

        this.candidate.close().catch(err => console.error('Error closing candidate:', err))
      }
    })
  }

  /**
   * Wait until the instance is writable
   * @private
   */
  _whenWritable() {
    if (this.instance.writable) {
      this.onresolve(this.instance)
      return
    }

    const check = () => {
      if (this.instance.writable) {
        this.instance.off('update', check)
        this.onresolve(this.instance)
      }
    }

    this.instance.on('update', check)
  }

  /**
   * Resource close implementation
   * @private
   */
  async _close() {
    if (this.candidate) {
      await this.candidate.close()
    }

    if (this.swarm) {
      await this.swarm.destroy()
    }

    if (this.instance) {
      await this.instance.close()
    }

    if (this.onreject) {
      this.onreject(new Error('Pairing closed'))
    }
  }

  /**
   * Get a promise that resolves when pairing is complete
   * @returns {Promise} A promise that resolves with the SyncBase instance
   */
  finished() {
    return new Promise((resolve, reject) => {
      this.onresolve = resolve
      this.onreject = reject
    })
  }
}

module.exports = SyncBase
