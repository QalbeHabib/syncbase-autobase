const Autobase = require('autobase')
const BlindPairing = require('blind-pairing')
const Hyperswarm = require('hyperswarm')
const ReadyResource = require('ready-resource')
const z32 = require('z32')
const b4a = require('b4a')
const { EventEmitter } = require('events')

const CryptoManager = require('./components/crypto-manager')
const MessageManager = require('./components/message-manager')
const ChannelManager = require('./components/channel-manager')
const PermissionManager = require('./components/permission-manager')
const InviteManager = require('./components/invite-manager')
const ActionValidator = require('./components/action-validator')
const DatabaseManager = require('./components/database-manager')
const ServerInitializer = require('./components/server-initializer')
const SyncBaseRouter = require('./components/router')
const MessageParser = require('./components/parser')

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
    this.validator = new ActionValidator(this, this.crypto)
    this.router = new SyncBaseRouter(this)
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

  async _apply(nodes, view, host) {
    for (const node of nodes) {
      try {

        // Parse the action from the node
        const action = await this._parseAction(node)
        console.log('Parsed action:', action)

        if (!action) {
          console.warn('Could not parse action, skipping')
          continue
        }

        console.log({ action })
        console.log({ action })
        console.log({ action })
        console.log({ action })
        console.log({ action })
        // Validate the action
        const isValid = await this.validator.validateAction(
          action.payload,
          action.signature,
          node.from?.key,
          action.signer,
          view,
          true // optimistic mode
        )
        console.log({ isValid })

        if (!isValid) {
          console.warn(`Invalid action: ${action.type}`)
          continue
        }

        console.log({ isValid, action })


        await host.ackWriter(node.from?.key)
        // Dispatch the action through the router
        const result = await this.router.router.dispatch(action.type, action.payload, {
          view,
          base: this.base,
          authorKey: node.from?.key
        })

        // Acknowledge the writer if the action was processed successfully
        if (result !== false) {
          await host.ackWriter(node.from?.key)
        }
      } catch (err) {
        console.error('Error applying node:', err)
        continue
      }
    }

    // Flush the view to ensure changes are saved
    await view.flush()
  }

  async _parseAction(value) {
    if (!value) {
      return null
    }

    try {
      // If it's already a fully formed action object, return it
      if (value.type && value.payload) {
        return value
      }

      // Handle the specific node structure you're seeing
      const parsedAction = await MessageParser.parseNode(value)

      if (!parsedAction) {
        console.warn('Could not parse action',)
        return null
      }

      return parsedAction
    } catch (err) {
      console.error('Error parsing action:', err)
      return null
    }
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
