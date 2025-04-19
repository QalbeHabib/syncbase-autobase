const Autobase = require("autobase");
const BlindPairing = require("blind-pairing");
const Hyperswarm = require("hyperswarm");
const ReadyResource = require("ready-resource");
const z32 = require("z32");
const b4a = require("b4a");
const { EventEmitter } = require("events");

const CryptoManager = require("./components/crypto-manager");
const MessageManager = require("./components/message-manager");
const ChannelManager = require("./components/channel-manager");
const PermissionManager = require("./components/permission-manager");
const InviteManager = require("./components/invite-manager");
const ActionValidator = require("./components/action-validator");
const DatabaseManager = require("./components/database-manager");
const ServerInitializer = require("./components/server-initializer");
const SyncBaseRouter = require("./components/router");
const { RoleManager } = require("./components/role-manager");
const RoleInterface = require("./components/role-interface");

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
    super();

    this.store = corestore;
    this.options = options;
    this.replicate = options.replicate !== false;
    this.bootstrap = options.bootstrap || null;
    this.swarm = null;
    this.eventEmitter = new EventEmitter();
    this.processedActions = new Set();

    // Initialize crypto manager
    this.crypto = new CryptoManager(options.seedPhrase);

    // Initialize database view manager
    this.dbManager = new DatabaseManager();

    // Initialize components with dependency injection
    this.validator = new ActionValidator(this, this.crypto);
    this.router = new SyncBaseRouter(this, this.validator);
    this.serverInitializer = new ServerInitializer(this, this.validator);
    this.channels = new ChannelManager(this, this.validator);
    this.messages = new MessageManager(this, this.validator);
    this.permissions = new PermissionManager(this, this.validator);
    this.roleManager = new RoleManager(this, this.permissions);
    this.roles = new RoleInterface(this);
    this.invites = new InviteManager(this, this.crypto, this.validator);

    // Initialize Autobase
    this._initAutobase(options);

    // Start initialization
    this.ready().catch((err) =>
      console.error("Error initializing SyncBase:", err)
    );
  }

  /**
   * Initialize Autobase with optimistic mode
   * @param {Object} options - Configuration options
   * @private
   */
  _initAutobase(options) {
    const { key, encryptionKey } = options;

    this.base = new Autobase(this.store, key, {
      encrypt: true,
      encryptionKey,
      optimistic: true,
      valueEncoding: "json",
      ackInterval: 1000,
      // Set up the database view
      open: (store) => {
        return this.dbManager.createDatabaseView(store);
      },
      // Apply incoming changes with validation
      apply: this._apply.bind(this),
    });

    // Listen for updates with debouncing
    this.base.on("update", () => {
      if (!this.base._interrupting) {
        this.eventEmitter.emit("update");
      }
    });
  }
  async _processNode(node, view, host) {
    await this.base.ready();
    await this.base.view.ready();
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
      return false;
    }
    console.log("Validated action ", node.value.type);
    // Process the action directly using dispatch
    try {
      if (node.value.type == "claim-invite") {
        await host.ackWriter(node.from?.key);
        // IDK what this does
        if (this.base.localWriter.isRemoved) {
          this.base.localWriter.isRemoved = false;
        }

        // TODO check usage limits and expiration here
        const user = {
          id: node.value.payload.user.id,
          publicKey: node.value.payload.user.id,
          username: "User",
          joinedAt: Date.now(),
          inviteCode: node.value.payload.user.code,
          avatar: "1",
          status: "Chilling",
        };
        const role = {
          userId: node.value.payload.user.id,
          updatedBy: node.value.payload.user.id,
          updatedAt: Date.now(),
          role: "MEMBER",
        };
        const payload1 = this.router.dispatch("@server/create-user", user);
        await this.router.router.dispatch(payload1, {
          view,
          base: this.base,
          authorKey: node.from?.key,
          signer: !b4a.isBuffer(node.value.signer)
            ? b4a.from(node.value.signer)
            : node.value.signer,
        });

        await host.ackWriter(node.from?.key);
        const payload2 = this.router.dispatch("@server/set-role", role);
        await this.router.router.dispatch(payload2, {
          view,
          base: this.base,
          authorKey: node.from?.key,
          signer: !b4a.isBuffer(node.value.signer)
            ? b4a.from(node.value.signer)
            : node.value.signer,
        });
      } else if (node.value.type == "@server/create-invite") {
        await host.ackWriter(node.from?.key);
        const encodedMessage = this.router.dispatch(node.value.type, {
          id: b4a.isBuffer(node.value.payload.id)
            ? node.value.payload.id
            : b4a.from(node.value.payload.id),
          invite: b4a.isBuffer(node.value.payload.invite)
            ? node.value.payload.invite
            : b4a.from(node.value.payload.invite),
          publicKey: b4a.isBuffer(node.value.payload.publicKey)
            ? node.value.payload.publicKey
            : b4a.from(node.value.payload.publicKey),
          expires: node.value.payload.expires,
        });
        await this.router.router.dispatch(encodedMessage, {
          view,
          base: this.base,
          authorKey: node.from?.key,
          signer: !b4a.isBuffer(node.value.signer)
            ? b4a.from(node.value.signer)
            : node.value.signer,
        });
      } else {
        await host.ackWriter(node.from?.key);
        const encodedMessage = this.router.dispatch(
          node.value.type,
          node.value.payload
        );
        await this.router.router.dispatch(encodedMessage, {
          view,
          base: this.base,
          authorKey: node.from?.key,
          signer: !b4a.isBuffer(node.value.signer)
            ? b4a.from(node.value.signer)
            : node.value.signer,
        });
      }

      // Use hyperdispatch to directly process the message
      await host.ackWriter(node.from?.key);
      await view.flush();
    } catch (err) {
      console.error("Error applying node:", err);
      return false;
    }
  }
  isProcessed(node) {
    const actionId = `${node.value.type}:${JSON.stringify(node.value.payload)}`;
    // Skip if already processed
    if (this.processedActions.has(actionId)) {
      console.log(`Skipping duplicate action: ${node.value.type}`);
      return true;
    }
    return false;
  }
  async _apply(nodes, view, host) {
    // More defensive approach to be tolerant of reordering during sync
    const serverOps = [];
    const channelOps = [];
    const messageOps = [];
    const otherOps = [];
    const processedInThisRun = new Set();

    // Add batching to prevent overwhelming the system with too many operations at once
    const MAX_BATCH_SIZE = 20;
    let currentBatch = 0;

    // First pass: categorize operations
    for await (const node of nodes) {
      const type = node.value.type;

      // If we have a node from a different writer, acknowledge them as a writer
      if (node.from?.key && !b4a.equals(node.from.key, this.base.local.key)) {
        try {
          // Check if this writer is already acknowledged
          const isWriter = this.base.writers.some(
            (w) => w.key && b4a.equals(w.key, node.from.key)
          );

          if (!isWriter) {
            console.log(
              `Auto-acknowledging writer: ${b4a.toString(node.from.key, "hex")}`
            );
            await host.addWriter(node.from.key, { indexer: true });
            await host.ackWriter(node.from.key);
          }
        } catch (err) {
          console.warn(`Error acknowledging writer: ${err.message}`);
        }
      }

      if (
        type === "@server/create-server" ||
        type === "@server/update-server"
      ) {
        serverOps.push(node);
      } else if (type.includes("channel")) {
        channelOps.push(node);
      } else if (type.includes("message")) {
        messageOps.push(node);
      } else {
        otherOps.push(node);
      }
    }

    const getActionString = (node) => {
      return `${node.value.type}:${JSON.stringify(
        node.value.payload.timestamp
      )}`;
    };

    // Process operations in batches with awaits between them to allow for linearization
    // Process server operations first (defensive)
    for (const node of serverOps) {
      const actionId = getActionString(node);
      if (!this.isProcessed(node) && !processedInThisRun.has(actionId)) {
        try {
          await this._processNode(node, view, host);
          this.processedActions.add(actionId);
          processedInThisRun.add(actionId);

          currentBatch++;
          if (currentBatch >= MAX_BATCH_SIZE) {
            await view.flush();
            await sleep(10); // Small pause between batches
            currentBatch = 0;
          }
        } catch (err) {
          console.warn(
            `Ignoring error in server operation: ${node.value.type}`,
            err.message
          );
        }
      }
    }

    // Flush after server operations
    await view.flush();

    // Then channel operations (defensive)
    for (const node of channelOps) {
      const actionId = getActionString(node);
      if (!this.isProcessed(node) && !processedInThisRun.has(actionId)) {
        try {
          // Special handling for channel creation - check if channel already exists
          if (node.value.type === "@server/create-channel") {
            const existingChannel = await view.get("@server/channel", {
              channelId: node.value.payload.channelId,
            });

            if (existingChannel) {
              console.log(
                `Channel ${node.value.payload.channelId} already exists - skipping create operation`
              );
              this.processedActions.add(actionId);
              processedInThisRun.add(actionId);
              continue; // Skip this operation
            }
          }

          await this._processNode(node, view, host);
          this.processedActions.add(actionId);
          processedInThisRun.add(actionId);

          currentBatch++;
          if (currentBatch >= MAX_BATCH_SIZE) {
            await view.flush();
            await sleep(10); // Small pause between batches
            currentBatch = 0;
          }
        } catch (err) {
          console.warn(
            `Ignoring error in channel operation: ${node.value.type}`,
            err.message
          );
        }
      }
    }

    // Flush after channel operations
    await view.flush();

    // Then message operations which depend on channels (defensive)
    for (const node of messageOps) {
      const actionId = getActionString(node);
      if (!this.isProcessed(node) && !processedInThisRun.has(actionId)) {
        try {
          await this._processNode(node, view, host);
          this.processedActions.add(actionId);
          processedInThisRun.add(actionId);

          currentBatch++;
          if (currentBatch >= MAX_BATCH_SIZE) {
            await view.flush();
            await sleep(10); // Small pause between batches
            currentBatch = 0;
          }
        } catch (err) {
          console.warn(
            `Ignoring error in message operation: ${node.value.type}`,
            err.message
          );
        }
      }
    }

    // Flush after message operations
    await view.flush();

    // Then other operations (defensive)
    for (const node of otherOps) {
      const actionId = getActionString(node);
      if (!this.isProcessed(node) && !processedInThisRun.has(actionId)) {
        try {
          await this._processNode(node, view, host);
          this.processedActions.add(actionId);
          processedInThisRun.add(actionId);

          currentBatch++;
          if (currentBatch >= MAX_BATCH_SIZE) {
            await view.flush();
            await sleep(10); // Small pause between batches
            currentBatch = 0;
          }
        } catch (err) {
          console.warn(
            `Ignoring error in other operation: ${node.value.type}`,
            err.message
          );
        }
      }
    }

    // Final flush
    await view.flush();

    // For high-volume scenarios, force an update to ensure linearization
    if (processedInThisRun.size > 5) {
      await this.base.update();
    }
  }

  /**
   * Initialize replication with peers
   * @private
   */
  async _setupReplication() {
    if (!this.replicate) return;
    await this.base.ready();

    this.swarm = new Hyperswarm({
      keyPair: await this.store.createKeyPair("hyperswarm"),
      bootstrap: this.bootstrap,
    });

    this.swarm.on("connection", (connection, peerInfo) => {
      this.store.replicate(connection);
    });

    this.pairing = new BlindPairing(this.swarm);

    this.member = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: async (candidate) => {
        const id = candidate.inviteId;
        const inv = await this.base.view.get("@server/invite", { id });
        console.log({ inv });
        if (!inv) {
          console.warn(`No invite found with id: ${b4a.toString(id, "hex")}`);
          return;
        }
        if (!b4a.equals(inv.id, id)) {
          return;
        }
        await candidate.open(inv.publicKey);
        const action = this.crypto.createSignedAction("claim-invite", {
          type: "claim-invite",
          user: {
            id: b4a.toString(candidate.userData, "hex"),
            code: b4a.toString(inv.id, "hex"),
          },
        });
        await this.base.append(action, { optimistic: true });
        candidate.confirm({
          key: this.base.key,
          encryptionKey: this.base.encryptionKey,
        });
      },
    });

    this.swarm.join(this.base.discoveryKey);
  }
  async addWriter(writerKey, options = {}) {
    if (!writerKey) return false;

    try {
      console.log(`Adding writer: ${b4a.toString(writerKey, "hex")}`);
      await this.base.addWriter(writerKey, { indexer: true, ...options });

      // Update after adding the writer to ensure linearization
      await this.base.update();
      return true;
    } catch (err) {
      console.error(`Error adding writer: ${err.message}`);
      return false;
    }
  }

  /**
   * Resource open implementation
   * @private
   */
  async _open() {
    // Initialize Autobase
    await this.base.ready();

    // Setup replication if enabled
    if (this.replicate) {
      await this._setupReplication();
    }

    // Initialize managers
    await this.channels.init();
    await this.messages.init();
    await this.permissions.init();
    await this.roleManager.init();
    await this.roles.init();
    await this.invites.init();
  }

  /**
   * Resource close implementation
   * @private
   */
  async _close() {
    if (this.swarm) {
      await this.swarm.destroy();
    }
    await this.base.close();
  }

  /**
   * Get the writer's public key
   * @returns {Buffer} The writer's public key
   */
  get writerKey() {
    return this.base.local.key;
  }

  /**
   * Get the Autobase public key
   * @returns {Buffer} The Autobase public key
   */
  get key() {
    return this.base.key;
  }

  /**
   * Get the Autobase discovery key
   * @returns {Buffer} The Autobase discovery key
   */
  get discoveryKey() {
    return this.base.discoveryKey;
  }

  /**
   * Check if this instance has write access
   * @returns {Boolean} True if this instance has write access
   */
  get writable() {
    return this.base.writable;
  }

  /**
   * Initialize this SyncBase as a server
   * @param {Object} options - Server options
   * @param {String} options.name - Server name
   * @param {String} [options.description] - Server description
   * @returns {Promise<Object>} The server information
   */
  async initialize(options) {
    return this.serverInitializer.initialize(options);
  }

  /**
   * Get server information
   * @returns {Promise<Object|null>} The server info
   */
  async getServerInfo() {
    return this.serverInitializer.getServerInfo();
  }

  /**
   * Update server information
   * @param {Object} options - Update options
   * @param {String} [options.name] - New server name
   * @param {String} [options.description] - New server description
   * @returns {Promise<Object>} The updated server info
   */
  async updateServerInfo(options) {
    return this.serverInitializer.updateServerInfo(options);
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
    const user = await this.base.view.get("@server/role", {
      userId: b4a.isBuffer(this.crypto.publicKey)
        ? b4a.toString(this.crypto.publicKey, "hex")
        : this.crypto.publicKey,
    });

    if (user) {
      const hasPerm = this.validator.hasPermission(user.role, permissionType);
      return hasPerm;
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
      throw new Error("Cannot create invite: No server ID set");
    }

    // Add serverId to options
    const inviteOptions = {
      ...options,
      serverId: this.serverId,
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
      throw new Error("Cannot get invites: No server ID set");
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
      throw new Error("Cannot revoke invite: No server ID set");
    }

    try {
      // Directly use the invites manager's revokeInvite method
      return await this.invites.revokeInvite(inviteCode);
    } catch (err) {
      console.error("Error revoking invite:", err);
      return false;
    }
  }

  /**
   * Listen for events
   * @param {String} event - The event name
   * @param {Function} listener - The event listener
   */
  on(event, listener) {
    this.eventEmitter.on(event, listener);
  }

  /**
   * Remove an event listener
   * @param {String} event - The event name
   * @param {Function} listener - The event listener
   */
  off(event, listener) {
    this.eventEmitter.off(event, listener);
  }

  /**
   * Create a pair to join a server using an invite code
   * @param {Object} store - The corestore instance
   * @param {String} inviteCode - The invite code
   * @param {Object} [options] - Additional options
   * @returns {Object} A pairing instance
   */
  static pair(store, inviteCode, options = {}) {
    return new SyncBasePairer(store, inviteCode, options);
  }
}

class SyncBasePairer extends ReadyResource {
  constructor(store, invite, opts = {}) {
    super();
    this.store = store;
    this.invite = invite;
    this.swarm = null;
    this.pairing = null;
    this.candidate = null;
    this.bootstrap = opts.bootstrap || null;
    this.onresolve = null;
    this.onreject = null;
    this.pass = null;
    this.seedPhrase = opts.seedPhrase || "seed for joining";
    this.crypto = new CryptoManager(this.seedPhrase);
    this.waitTimeout = opts.timeout || 30000; // Default 30 second timeout
    this.maxRetries = opts.maxRetries || 3;
    this.retries = 0;
    this.ready().catch((err) =>
      console.error("Error in SyncBasePairer ready:", err)
    );
  }

  async _open() {
    await this.store.ready();
    this.swarm = new Hyperswarm({
      keyPair: await this.store.createKeyPair("hyperswarm"),
      bootstrap: this.bootstrap,
    });

    // Improved connection logging
    this.swarm.on("connection", (connection, peerInfo) => {
      console.log(
        `Pairer: New connection established with peer ${b4a
          .toString(peerInfo.publicKey, "hex")
          .slice(0, 8)}`
      );
      this.store.replicate(connection);
    });

    this.pairing = new BlindPairing(this.swarm);
    const core = Autobase.getLocalCore(this.store);
    await core.ready();
    const key = core.key;
    await core.close();

    console.log(
      "Adding pairing candidate with user data:",
      b4a.toString(this.crypto.publicKey, "hex")
    );

    // Improved invite decoding with error handling
    let decodedInvite;
    try {
      console.log(`Decoding invite code of length ${this.invite.length}`);
      decodedInvite = z32.decode(this.invite);
      console.log(
        `Successfully decoded invite, buffer length: ${decodedInvite.length}`
      );
    } catch (decodeErr) {
      console.error(`Error decoding invite: ${decodeErr.message}`);
      if (this.onreject) {
        this.onreject(new Error(`Invalid invite code: ${decodeErr.message}`));
      }
      return;
    }

    // Create our candidate with more robust error handling
    this.candidate = this.pairing.addCandidate({
      invite: decodedInvite,
      userData: this.crypto.publicKey,
      onadd: async (result) => {
        console.log(
          "Pairing candidate added, received encryption key:",
          !!result.encryptionKey
        );

        if (this.pass === null) {
          try {
            console.log("Creating SyncBase instance for paired server");
            this.pass = new SyncBase(this.store, {
              swarm: this.swarm,
              key: result.key,
              encryptionKey: result.encryptionKey,
              bootstrap: this.bootstrap,
              seedPhrase: this.seedPhrase,
            });

            // Wait for our base to be ready
            await this.pass.ready();
            console.log(
              "Paired SyncBase is ready, waiting for writable status"
            );

            // Set a timeout to force resolution if writable check hangs
            setTimeout(() => {
              if (this.onresolve && this.pass) {
                console.log(
                  "Force resolving after timeout - pairing appears successful"
                );
                this.onresolve(this.pass);
              }
            }, 10000);

            this.swarm = null;
            this.store = null;

            if (this.onresolve) {
              this._whenWritable();
            }
          } catch (err) {
            console.error("Error in pairing onadd handler:", err);
            if (this.onreject) {
              this.onreject(err);
            }
          }
        }

        // Close the candidate regardless of outcome
        if (this.candidate) {
          this.candidate
            .close()
            .catch((err) =>
              console.warn("Error closing candidate:", err.message)
            );
        }
      },
      // Add explicit error handler
      onerror: (err) => {
        console.error("Pairing candidate error:", err);

        // Try again up to maxRetries times
        if (this.retries < this.maxRetries) {
          this.retries++;
          console.log(
            `Retrying pairing (${this.retries}/${this.maxRetries})...`
          );
          setTimeout(() => {
            try {
              this.candidate = this.pairing.addCandidate({
                invite: decodedInvite,
                userData: this.crypto.publicKey,
                onadd: this.candidate.onadd,
                onerror: this.candidate.onerror,
              });
            } catch (retryErr) {
              console.error(`Error during retry: ${retryErr.message}`);
              if (this.onreject && this.retries >= this.maxRetries) {
                this.onreject(retryErr);
              }
            }
          }, 1000);
        } else if (this.onreject) {
          this.onreject(err);
        }
      },
    });

    // Set a timeout for the entire pairing process
    setTimeout(() => {
      if (!this.pass && this.onreject) {
        this.onreject(
          new Error(`Pairing timed out after ${this.waitTimeout}ms`)
        );
      }
    }, this.waitTimeout);
  }

  _whenWritable() {
    if (this.pass && this.pass.base && this.pass.base.writable) {
      console.log("Base is already writable, resolving immediately");
      if (this.onresolve) this.onresolve(this.pass);
      return;
    }

    console.log("Waiting for base to become writable");

    let checkCount = 0;
    const maxChecks = 20;

    const check = () => {
      checkCount++;

      if (!this.pass || !this.pass.base) {
        console.log("No base available yet");
        return;
      }

      console.log(
        `Writable check (${checkCount}/${maxChecks}): ${this.pass.base.writable}`
      );

      if (this.pass.base.writable) {
        console.log("Base is now writable, resolving promise");
        this.pass.base.off("update", check);
        if (this.onresolve) this.onresolve(this.pass);
        return;
      }

      // After a certain number of checks, force resolve even if not writable
      if (checkCount >= maxChecks) {
        console.log("Maximum writable checks reached, force resolving");
        this.pass.base.off("update", check);
        if (this.onresolve) this.onresolve(this.pass);
      }
    };

    if (this.pass && this.pass.base) {
      this.pass.base.on("update", check);

      // Run the first check immediately
      check();

      // Also set an interval to check regularly
      const interval = setInterval(() => {
        if (!this.pass || !this.pass.base) {
          clearInterval(interval);
          return;
        }

        check();
      }, 1000);

      // Clear the interval after max checks
      setTimeout(() => {
        clearInterval(interval);
        if (
          this.pass &&
          this.pass.base &&
          !this.pass.base.writable &&
          this.onresolve
        ) {
          console.log("Final timeout reached, force resolving pairing");
          this.onresolve(this.pass);
        }
      }, maxChecks * 1000);
    }
  }

  async _close() {
    if (this.candidate !== null) {
      await this.candidate.close();
    }

    if (this.swarm !== null) {
      await this.swarm.destroy();
    }

    if (this.store !== null) {
      await this.store.close();
    }

    if (this.onreject) {
      this.onreject(new Error("Pairing closed"));
    } else if (this.base) {
      await this.base.close();
    }
  }

  finished() {
    return new Promise((resolve, reject) => {
      this.onresolve = resolve;
      this.onreject = reject;

      // If we already have a pass, check if it's writable
      if (this.pass) {
        this._whenWritable();
      }
    });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = SyncBase;
