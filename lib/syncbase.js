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
const { Permissions } = require('./components/permissions')
const { RoleManager } = require('./components/role-manager')
const RoleInterface = require('./components/role-interface')

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
    this.processedNodes = new Set()
    this.replicationRateLimit = options.replicationRateLimit || 1000 // ms between replications
    this.lastReplicationTime = 0

    // Initialize crypto manager
    this.crypto = new CryptoManager(options.seedPhrase)

    // Initialize database view manager
    this.dbManager = new DatabaseManager()

    // Initialize components with dependency injection
    this.validator = new ActionValidator(this, this.crypto)
    this.router = new SyncBaseRouter(this, this.validator)
    this.serverInitializer = new ServerInitializer(this, this.validator)
    this.channels = new ChannelManager(this, this.validator)
    this.messages = new MessageManager(this, this.validator)
    this.permissions = new PermissionManager(this, this.validator)
    this.roleManager = new RoleManager(this, this.permissions)
    this.roles = new RoleInterface(this)
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
      valueEncoding: "json",
      // Set up the database view
      open: (store) => {
        return this.dbManager.createDatabaseView(store)
      },

      // Apply incoming changes with validation
      apply: this._apply.bind(this),
    })

    // Listen for updates with debouncing
    let updateTimeout
    this.base.on('update', () => {
      if (!this.base._interrupting) {
        clearTimeout(updateTimeout)
        updateTimeout = setTimeout(() => {
          this.eventEmitter.emit('update')
        }, 100) // Debounce updates
      }
    })
  }

  async _apply(nodes, view, host) {
    for (const node of nodes) {
      try {
        // Always validate actions, regardless of environment
        const isValid = await this.validator.validateAction(
          node.value.payload,
          node.value.signature,
          node.from?.key,
          node.value.signer,
          view,
          true,
          node.value
        );

        if (!isValid) {
          console.warn(`Invalid action: ${node.value.type}`);
          continue;
        }

        console.log('Validated action ', node.value.type)
        await host.ackWriter(node.from?.key);
        // Process the action directly using dispatch 
        try {
          // Use hyperdispatch to directly process the message
          const encodedMessage = this.router.dispatch(node.value.type, node.value.payload);
          await this.router.router.dispatch(encodedMessage, {
            view,
            base: this.base,
            authorKey: node.from?.key,
            signer: !b4a.isBuffer(node.value.signer) ? b4a.from(node.value.signer) : node.value.signer
          });
          await host.ackWriter(node.from?.key);
          await view.flush();
        } catch (err) {
          console.error('Error processing action:', err);
          continue;
        }
      } catch (err) {
        console.error('Error applying node:', err);
        continue;
      }
    }
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
      bootstrap: this.bootstrap,
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
    await this.roleManager.init()
    await this.roles.init()
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
   * Grant a permission to a user
   * @param {String} userId - The user to grant permission to
   * @param {String} permissionType - The permission type from PermissionType enum
   * @param {Object} options - Options for granting permission
   * @param {String} [options.channelId] - Channel ID (null for server-wide permission)
   * @returns {Promise<Boolean>} Whether the permission was granted
   */
  async grantPermission(userId, permissionType, options = {}) {
    return this.permissions.grantPermission(userId, permissionType, options);
  }

  /**
   * Revoke a permission from a user
   * @param {String} userId - The user to revoke permission from
   * @param {String} permissionType - The permission type from PermissionType enum
   * @param {Object} options - Options for revoking permission
   * @param {String} [options.channelId] - Channel ID (null for server-wide permission)
   * @returns {Promise<Boolean>} Whether the permission was revoked
   */
  async revokePermission(userId, permissionType, options = {}) {
    return this.permissions.revokePermission(userId, permissionType, options);
  }

  /**
   * Check if a user has a specific permission
   * @param {String} permissionType - The permission type to check
   * @param {Object} options - Options for checking permission
   * @param {String} options.userId - The user to check permission for
   * @param {String} [options.channelId] - Channel ID (null for server-wide permission)
   * @returns {Promise<Boolean>} Whether the user has the permission
   */
  async hasPermission(permissionType, options = {}) {
    return this.permissions.hasPermission(permissionType, options);
  }

  /**
   * Create a new role on the server or for a specific channel
   * @param {Object} roleOptions - Role configuration
   * @param {String} roleOptions.name - Role name
   * @param {String} [roleOptions.color] - Role color (hex)
   * @param {Array<String>} [roleOptions.permissions] - Permissions to grant
   * @param {String} [roleOptions.channelId] - Channel ID for channel-specific roles
   * @returns {Promise<Object>} Created role
   */
  async createRole(roleOptions) {
    return this.roles.createRole(roleOptions);
  }

  /**
   * Update an existing role
   * @param {String} roleId - ID of the role to update
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} Updated role
   */
  async updateRole(roleId, updates) {
    return this.roles.updateRole(roleId, updates);
  }

  /**
   * Delete a role
   * @param {String} roleId - ID of the role to delete
   * @returns {Promise<Boolean>} Whether the role was deleted
   */
  async deleteRole(roleId) {
    return this.roles.deleteRole(roleId);
  }

  /**
   * List all roles on the server
   * @param {Object} options - Options
   * @param {String} [options.channelId] - Optional channel ID to list channel-specific roles
   * @returns {Promise<Array>} List of roles
   */
  async listRoles(options = {}) {
    return this.roles.listRoles(options);
  }

  /**
   * Assign a role to a user
   * @param {String} userId - User ID to assign the role to
   * @param {String} roleId - Role ID to assign
   * @param {Object} [options] - Assignment options
   * @param {String} [options.channelId] - Channel ID for channel-specific role assignment
   * @returns {Promise<Object>} Assignment result
   */
  async assignRole(userId, roleId, options = {}) {
    return this.roles.assignRole(userId, roleId, options);
  }

  /**
   * Remove a role from a user
   * @param {String} userId - User ID to remove the role from
   * @param {String} roleId - Role ID to remove
   * @param {Object} [options] - Removal options
   * @param {String} [options.channelId] - Channel ID for channel-specific role removal
   * @returns {Promise<Boolean>} Whether the role was removed
   */
  async removeRole(userId, roleId, options = {}) {
    return this.roles.removeRole(userId, roleId, options);
  }

  /**
   * Get all roles for a user
   * @param {String} userId - User ID to get roles for
   * @param {Object} [options] - Options
   * @param {String} [options.channelId] - Channel ID for channel-specific roles
   * @returns {Promise<Array>} User's roles
   */
  async getUserRoles(userId, options = {}) {
    return this.roles.getUserRoles(userId, options);
  }

  /**
   * Kick a user from a channel
   * @param {String} userId - User ID to kick
   * @param {Object} options - Kick options
   * @param {String} options.channelId - Channel to kick from
   * @param {String} [options.reason] - Reason for the kick
   * @param {Number} [options.duration] - Duration in milliseconds (temporary)
   * @returns {Promise<Object>} Kick information
   */
  async kickUser(userId, options) {
    return this.roles.kickUser(userId, options);
  }

  /**
   * Reinstate a kicked user
   * @param {String} userId - User ID to reinstate
   * @param {String} channelId - Channel to reinstate to
   * @returns {Promise<Boolean>} Whether the user was reinstated
   */
  async reinstateUser(userId, channelId) {
    return this.roles.reinstateUser(userId, channelId);
  }

  /**
   * Ban a user
   * @param {String} userId - User ID to ban
   * @param {Object} [options] - Ban options
   * @param {String} [options.channelId] - Channel to ban from (null for server-wide)
   * @param {String} [options.reason] - Reason for the ban
   * @param {Number} [options.duration] - Duration in milliseconds (null for permanent)
   * @returns {Promise<Object>} Ban information
   */
  async banUser(userId, options = {}) {
    return this.roles.banUser(userId, options);
  }

  /**
   * Unban a user
   * @param {String} userId - User ID to unban
   * @param {Object} [options] - Unban options
   * @param {String} [options.channelId] - Channel to unban from (null for server-wide)
   * @returns {Promise<Boolean>} Whether the user was unbanned
   */
  async unbanUser(userId, options = {}) {
    return this.roles.unbanUser(userId, options);
  }

  /**
   * Check if a user is banned
   * @param {String} userId - User ID to check
   * @param {Object} [options] - Check options
   * @param {String} [options.channelId] - Channel to check (null for server-wide)
   * @returns {Promise<Boolean>} Whether the user is banned
   */
  async isUserBanned(userId, options = {}) {
    return this.roles.isUserBanned(userId, options);
  }

  /**
   * Check if a user is kicked from a channel
   * @param {String} userId - User ID to check
   * @param {String} channelId - Channel to check
   * @returns {Promise<Boolean>} Whether the user is kicked
   */
  async isUserKicked(userId, channelId) {
    return this.roles.isUserKicked(userId, channelId);
  }

  /**
   * Create an invite for this server
   * @param {Object} options - Invite options
   * @param {Number} [options.expireInDays] - Days until the invite expires (default: 7)
   * @param {Number} [options.expireInHours] - Hours until the invite expires
   * @param {Number} [options.expireInMinutes] - Minutes until the invite expires
   * @param {Number} [options.expiresAt] - Specific timestamp when the invite expires
   * @returns {Promise<Object>} The invite object with code and expiration
   */
  async createInvite(options = {}) {
    if (!this.serverId) {
      throw new Error('Cannot create invite: No server ID set');
    }

    // Add serverId to options
    const inviteOptions = {
      ...options,
      serverId: this.serverId
    };

    return this.invites.createInvite(inviteOptions);
  }

  /**
   * Check if an invite is valid (exists and not expired)
   * @param {String} inviteCode - The invite code to check
   * @returns {Promise<Object|null>} The invite if valid, null if invalid or expired
   */
  async checkInvite(inviteCode) {
    return this.invites.checkInvite(inviteCode);
  }

  /**
   * Get all active (non-expired) invites for this server
   * @returns {Promise<Array>} List of active invites
   */
  async getActiveInvites() {
    if (!this.serverId) {
      throw new Error('Cannot get invites: No server ID set');
    }

    return this.invites.getActiveInvites(this.serverId);
  }

  /**
   * Revoke (delete) an invite
   * @param {String} inviteCode - The invite code to revoke
   * @returns {Promise<Boolean>} Whether the invite was revoked
   */
  async revokeInvite(inviteCode) {
    if (!this.serverId) {
      throw new Error('Cannot revoke invite: No server ID set');
    }

    try {
      // Directly use the invites manager's revokeInvite method
      return await this.invites.revokeInvite(inviteCode);
    } catch (err) {
      console.error('Error revoking invite:', err);
      return false;
    }
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

  /**
   * Join an existing server using its key and ID
   * 
   * @param {Buffer|String} serverKey - The public key of the server to join
   * @param {String} serverId - The ID of the server to join
   * @returns {Promise<Object>} Server information
   */
  async joinServer(serverKey, serverId) {
    try {
      if (!serverKey) {
        throw new Error('Server key is required to join a server')
      }

      if (!serverId) {
        throw new Error('Server ID is required to join a server')
      }

      // Convert serverKey to Buffer if it's a string
      let serverKeyBuf = serverKey
      if (typeof serverKey === 'string') {
        serverKeyBuf = b4a.from(serverKey, 'hex')
      }

      // Store the server key for later use
      this.serverKey = serverKeyBuf

      // Get or create a valid writerKey
      if (!this.writerKey) {
        this.writerKey = this.crypto.publicKey
      }

      // Set the server ID (used in security checks)
      this.serverId = serverId

      // Update server info in local database
      const serverInfo = {
        id: serverId,
        key: b4a.toString(serverKeyBuf, 'hex'),
        joined: Date.now()
      }

      // Save this server info to our database for tracking
      if (this.base && this.base.view) {
        try {
          const existingRecord = await this.base.view.findOne('@server/joined', { id: serverId });
          if (existingRecord) {
            // Update existing record
            await this.base.view.delete('@server/joined', { id: serverId })
            await this.base.view.insert('@server/joined', serverInfo);
          } else {
            // Insert new record
            await this.base.view.insert('@server/joined', serverInfo);
          }
        } catch (err) {
          console.warn('Could not save joined server info:', err.message)
        }
      }

      console.log(`Joined server ${serverId} with key ${b4a.toString(serverKeyBuf, 'hex')}`)
      return serverInfo
    } catch (err) {
      console.error('Error joining server:', err)
      throw err
    }
  }

  /**
   * Create a server
   * @param {String} name - Server name
   * @param {Object} options - Server options
   * @returns {Promise<Object>} Server info
   */
  async createServer(name, options = {}) {
    try {
      // Create the server using the server initializer
      const serverInfo = await this.serverInitializer.initialize({
        name,
        description: options.description || `Server created by ${b4a.toString(this.crypto.publicKey, 'hex').slice(0, 8)}`
      })

      // Server created successfully, now set up roles
      if (serverInfo && serverInfo.id) {
        this.serverId = serverInfo.id

        // Initialize the role manager
        await this.roleManager.init()

        // Create default roles if needed
        const ownerKey = b4a.toString(this.crypto.publicKey, 'hex')

        try {
          // Create owner role
          const ownerRole = await this.roleManager.createRole({
            name: 'OWNER',
            color: '#FF0000', // Red
            permissions: [
              'ADMINISTRATOR',
              'READ_MESSAGES',
              'SEND_MESSAGES',
              'DELETE_MESSAGES',
              'CREATE_CHANNEL',
              'DELETE_CHANNELS',
              'MANAGE_INVITES',
              'MANAGE_PERMISSIONS'
            ]
          })

          // Assign owner role to the server creator
          await this.roleManager.assignRole(ownerKey, ownerRole.id)

          console.log(`Created and assigned OWNER role for server ${serverInfo.id}`)
        } catch (roleErr) {
          console.error('Error setting up default server roles:', roleErr)
        }
      }

      return serverInfo
    } catch (err) {
      console.error('Error creating server:', err)
      throw err
    }
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
    this.error = null

    this.onresolve = null
    this.onreject = null

    this.ready().catch(err => {
      this.error = err;
      console.error('Error initializing SyncBasePairer:', err)
    })
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

    // First create a temporary SyncBase to check if the invite is valid
    const tempInstance = new SyncBase(this.store, {
      replicate: false
    })

    await tempInstance.ready()

    try {
      // Check if the invite is valid (not expired)
      const inviteValidity = await tempInstance.invites.checkInvite(this.inviteCode)

      if (!inviteValidity) {
        const error = new Error('Invite code is invalid or has expired')
        error.code = 'INVITE_EXPIRED'
        await tempInstance.close()

        if (this.onreject) {
          this.onreject(error)
        } else {
          this.error = error
        }

        return // Stop the pairing process
      }

      // Invite is valid, continue with pairing
      await tempInstance.close()

      // Get local key
      const core = Autobase.getLocalCore(this.store)
      await core.ready()
      const key = core.key
      await core.close()

      try {
        // Try to decode the invite code with z32
        let bufferInvite;
        try {
          bufferInvite = z32.decode(this.inviteCode);
        } catch (decodeErr) {
          throw new Error(`Invalid invite code format: ${decodeErr.message}`);
        }

        // Check if invite is expired (BlindPairing will check this too)
        try {
          const importResult = BlindPairing.importInvite(bufferInvite, this.store);
          if (importResult && importResult.expires && importResult.expires < Date.now()) {
            throw new Error('Invite has expired');
          }
        } catch (expireErr) {
          console.log('Invite expiration check:', expireErr.message);
          // Continue anyway, as BlindPairing.addCandidate will also check this
        }

        // Add candidate for pairing
        this.candidate = this.pairing.addCandidate({
          invite: bufferInvite,
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
      } catch (err) {
        console.error('Error adding candidate:', err);
        throw err;
      }
    } catch (err) {
      await tempInstance.close()

      if (this.onreject) {
        this.onreject(err)
      } else {
        this.error = err
      }
    }
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
