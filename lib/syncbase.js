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
          if (node.value.type == '@server/create-invite') {
            console.log(node.value)
            const encodedMessage = this.router.dispatch(node.value.type, {
              id: b4a.isBuffer(node.value.payload.id) ? node.value.payload.id : b4a.from(node.value.payload.id),
              invite: b4a.isBuffer(node.value.payload.invite) ? node.value.payload.invite : b4a.from(node.value.payload.invite),
              publicKey: b4a.isBuffer(node.value.payload.publicKey) ? node.value.payload.publicKey: b4a.from(node.value.payload.publicKey),
              expires: node.value.payload.expires
            });
            console.log({encodedMessage})
            await this.router.router.dispatch(encodedMessage, {
              view,
              base: this.base,
              authorKey: node.from?.key,
              signer: !b4a.isBuffer(node.value.signer) ? b4a.from(node.value.signer) : node.value.signer
            });
          } else {
            const encodedMessage = this.router.dispatch(node.value.type, node.value.payload);
            await this.router.router.dispatch(encodedMessage, {
              view,
              base: this.base,
              authorKey: node.from?.key,
              signer: !b4a.isBuffer(node.value.signer) ? b4a.from(node.value.signer) : node.value.signer
            });
          }
          // Use hyperdispatch to directly process the message

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

    this.pairing = new BlindPairing(this.swarm)
    this.member = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: async (candidate) => {
        const id = candidate.inviteId
        const inv = await this.base.view.findOne('@autopass/invite', {})
        if (!b4a.equals(inv.id, id)) {
          return
        }
        candidate.open(inv.publicKey)
        await this.addWriter(candidate.userData)
        candidate.confirm({
          key: this.base.key,
          encryptionKey: this.base.encryptionKey
        })
      }
    })

    this.swarm.join(this.base.discoveryKey)
  }
  async addWriter(pubKey) {
    const adminUser = {
      id: pubKey,
      publicKey: pubKey,
      username: "User",
      joinedAt: Date.now(),
      inviteCode: "founder",
      avatar: "1",
      status: "Chilling"
    }
    await view.insert('@server/user', adminUser)
    const role = {
      userId: pubKey, serverId: data.id, updatedBy: pubKey, updatedAt: Date.now(), role: "MEMBER"
    }
    await view.insert('@server/role', role)
    await view.flush()
  }

  async joinWithInvite(inviteCode) {
    const payload = this.crypto.createSignedAction('@server/claim-invite', { inviteCode })
    await this.base.append(payload, { optimistic: true })
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
   * @returns {Promise<Boolean>} Whether the user has the permission
   */
  async hasPermission(permissionType) {
    const user = await this.base.view.get('@server/role', {
      userId: b4a.isBuffer(this.crypto.publicKey) ? b4a.toString(this.crypto.publicKey, 'hex') : this.crypto.publicKey
    })

    if (user) {
      const hasPerm = this.validator.hasPermission(user.role, permissionType)
      return hasPerm
    }
    return;
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
}


class SyncBasePairer extends ReadyResource {
  constructor(store, invite, opts = {}) {
    super()
    this.store = store
    this.invite = invite
    this.swarm = null
    this.pairing = null
    this.candidate = null
    this.bootstrap = opts.bootstrap || null
    this.onresolve = null
    this.onreject = null
    this.pass = null
    this.seedPhrase = opts.seedPhrase || "seed"
    this.crypto = new CryptoManager(this.seedPhrase)
    this.ready().catch()
  }

  async _open() {
    await this.store.ready()
    this.swarm = new Hyperswarm({
      keyPair: await this.store.createKeyPair('hyperswarm'),
      bootstrap: this.bootstrap
    })

    const store = this.store
    this.swarm.on('connection', (connection, peerInfo) => {
      store.replicate(connection)
    })

    this.pairing = new BlindPairing(this.swarm)
    this.candidate = this.pairing.addCandidate({
      invite: z32.decode(this.invite),
      userData: b4a.isBuffer(this.crypto.publicKey) ? this.crypto.publicKey : this.crypto.publicKey,
      onadd: async (result) => {
        if (this.pass === null) {
          this.pass = new Autopass(this.store, {
            swarm: this.swarm,
            key: result.key,
            encryptionKey: result.encryptionKey,
            bootstrap: this.bootstrap
          })
        }
        this.swarm = null
        this.store = null
        if (this.onresolve) this._whenWritable()
        this.candidate.close().catch(noop)
      }
    })
  }

  _whenWritable() {
    if (this.pass.base.writable) return
    const check = () => {
      if (this.pass.base.writable) {
        this.pass.base.off('update', check)
        this.onresolve(this.pass)
      }
    }
    this.pass.base.on('update', check)
  }

  async _close() {
    if (this.candidate !== null) {
      await this.candidate.close()
    }

    if (this.swarm !== null) {
      await this.swarm.destroy()
    }

    if (this.store !== null) {
      await this.store.close()
    }

    if (this.onreject) {
      this.onreject(new Error('Pairing closed'))
    } else if (this.base) {
      await this.base.close()
    }
  }

  finished() {
    return new Promise((resolve, reject) => {
      this.onresolve = resolve
      this.onreject = reject
    })
  }
}


module.exports = SyncBase
