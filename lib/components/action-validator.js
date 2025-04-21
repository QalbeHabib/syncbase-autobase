const b4a = require("b4a");

/**
 * ActionValidator - Validates user actions before they're applied
 * Updated to work with the "SyncBase is a server" paradigm
 */
class ActionValidator {
  /**
   * Create a new ActionValidator instance
   * @param {CryptoManager} crypto - Crypto manager instance
   */
  constructor(syncbase, crypto) {
    this.syncbase = syncbase;
    this.crypto = crypto;
  }

  static ACTION_TYPE_MAP = {
    CREATE_SERVER: "@server/create-server",
    CREATE_CHANNEL: "@server/create-channel",
    UPDATE_CHANNEL: "@server/update-channel",
    DELETE_CHANNEL: "@server/delete-channel",
    SEND_MESSAGE: "@server/send-message",
    SET_ROLE: "@server/set-role",
    CREATE_INVITE: "@server/create-invite",
    CLAIM_INVITE: "@server/claim-invite",
    REVOKE_INVITE: "@server/revoke-invite",
    DELETE_MESSAGE: "@server/delete-message",
    EDIT_MESSAGE: "@server/edit-message",
  };

  static ROUTE_TYPE_MAP = Object.fromEntries(
    Object.entries(this.ACTION_TYPE_MAP).map(([k, v]) => [v, k])
  );

  async getUserRole(action, view) {
    const signerBuffer = b4a.isBuffer(action.signer)
      ? action.signer
      : b4a.from(action.signer);
    const userId = b4a.toString(signerBuffer, "hex");

    // Check if the user has permission to update channels
    const userRole = await view.get("@server/role", {
      userId: userId,
    });
    return userRole;
  }

  /**
   * Validate an action
   * @param {Object} action - The action to validate
   * @param {Buffer} authorKey - The public key of the author
   * @param {Object} view - The database view
   * @param {Boolean} optimistic - Whether this is an optimistic operation
   * @returns {Promise<Boolean>} Whether the action is valid
   */
  async validateAction(
    payload,
    signature,
    authorKey,
    signer,
    view,
    optimistic,
    action
  ) {
    try {
      // Convert authorKey to hex string
      let authorId = authorKey ? b4a.toString(authorKey, "hex") : null;

      // Verify the signature first
      const signatureIsValid =
        optimistic || this._verifySignature(payload, signature, signer);

      if (!signatureIsValid) {
        console.warn("Invalid signature");
        return false;
      }

      // Check if the action is a known type
      const actionType = action?.type;

      if (!actionType) {
        console.warn("Missing action type");
        return false;
      }

      // Validate based on action type
      switch (actionType) {
        case "@server/create-server":
          return this._validateCreateServer(action, authorKey, view);
        case "@server/update-server":
          return this._validateUpdateServer(action, authorKey, view);
        case "@server/create-channel":
          return this._validateCreateChannel(action, authorId, view);
        case "@server/update-channel":
          return this._validateUpdateChannel(action, authorId, view);
        case "@server/delete-channel":
          return this._validateDeleteChannel(action, authorId, view);
        case "@server/send-message":
          return this._validateSendMessage(action, authorId, view);
        case "@server/set-role":
          return this._validateSetRole(action, authorId, view);
        case "@server/create-invite":
          return this._validateCreateInvite(action, authorId, view);
        case "@server/claim-invite":
          return this._validateClaimInvite(action, authorKey, view);
        case "claim-invite":
          // TODO add validation here
          return true;
        case "@server/revoke-invite":
          return this._validateRevokeInvite(action, authorId, view);
        case "@server/delete-message":
          return this._validateDeleteMessage(action, authorId, view);
        case "@server/edit-message":
          return this._validateEditMessage(action, authorId, view);
        default:
          console.warn(`Unknown action type: ${actionType}`);
          return false;
      }
    } catch (err) {
      console.error("Error validating action:", err);
      return false;
    }
  }

  /**
   * Verify the signature of an action
   * @param {Object} action - The action to verify
   * @param {Buffer} publicKey - The public key to verify against
   * @returns {Boolean} Whether the signature is valid
   * @private
   */
  _verifySignature(payload, signature, publicKey) {
    // Skip signature verification if not present (for testing/development)
    if (!payload || !signature) {
      return false;
    }

    try {
      // Create a canonical representation of the payload for verification
      const sortedPayload = Object.keys(payload)
        .sort()
        .reduce((obj, key) => {
          obj[key] = payload[key];
          return obj;
        }, {});

      const message = JSON.stringify(sortedPayload);
      const isValid = this.crypto.verify(signature, message, publicKey);
      console.log("Signature Verification Result:", { isValid, message });

      return isValid;
    } catch (err) {
      console.error("Error verifying signature:", err);
      return false;
    }
  }

  // Implement specific validation methods (examples)
  async _validateCreateServer(action, authorKey, view) {
    try {
      const { payload } = action;
      if (!payload) {
        console.warn("No payload in create server action");
        return false;
      }

      // Validate required fields
      const isValid = !!(
        (payload.id && payload.name && (payload.createdAt || true)) // createdAt is optional
      );

      console.log("Create server validation:", { isValid });
      return isValid;
    } catch (err) {
      console.error("Error validating create server:", err);
      return false;
    }
  }

  /**
   * Validate UPDATE_SERVER action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateUpdateServer(action, authorId, view) {
    // Check if the server exists
    const server = await view.get("@server/server", { id: action.payload.id });
    if (!server) {
      return false;
    }
    const userRole = await this.getUserRole(action, view);

    if (!userRole || !this._hasPermission(userRole.role, "MANAGE_SERVER")) {
      console.log("NO PERM");
      return false;
    }
    // Basic validation of required fields
    return !!(action.payload.id && action.payload);
  }

  /**
   * Validate CREATE_CHANNEL action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateCreateChannel(action, authorId, view) {
    // Check if the server exists
    const server = await view.findOne("@server/server", {});
    if (!server) {
      console.log("NO SERVER");
      return false;
    }

    const userRole = await this.getUserRole(action, view);

    if (!userRole || !this._hasPermission(userRole.role, "MANAGE_CHANNELS")) {
      console.log("NO ROLE PERMS");
      return false;
    }

    return true;
  }

  /**
   * Validate UPDATE_CHANNEL action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateUpdateChannel(action, authorId, view) {
    // Check if the channel exists
    const channel = await this.syncbase.channels.getChannel(
      action.payload.channelId
    );
    if (!channel) {
      return false;
    }

    const userRole = await this.getUserRole(action, view);

    if (!userRole || !this._hasPermission(userRole.role, "MANAGE_CHANNELS")) {
      return false;
    }

    // If changing name, check if the name is already taken
    if (action.payload.name && action.payload.name !== channel.name) {
      const existingChannelByName = await view.findOne("@server/channel", {
        name: action.payload.name,
      });
      if (
        existingChannelByName.name == action.payload.name &&
        existingChannelByName.channelId !== action.payload.channelId
      ) {
        return false;
      }
    }

    // Basic validation of required fields
    return !!(action.payload.id && action.payload.timestamp);
  }

  /**
   * Validate DELETE_CHANNEL action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateDeleteChannel(action, authorId, view) {
    // Check if the channel exists
    const channel = await this.syncbase.channels.getChannel(
      action.payload.channelId
    );
    if (!channel) {
      return false;
    }

    const userRole = await this.getUserRole(action, view);

    if (!userRole || !this._hasPermission(userRole.role, "MANAGE_CHANNELS")) {
      console.log("NO_PERM");
      return false;
    }

    // Basic validation of required fields
    return !!(action.payload.channelId && action.payload.timestamp);
  }

  /**
   * Validate SEND_MESSAGE action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateSendMessage(action, authorId, view) {
    const userRole = await this.getUserRole(action, view);

    if (!userRole || !this._hasPermission(userRole.role, "SEND_MESSAGES")) {
      console.log("NO AUTH");
      return false;
    }

    // Basic validation of required fields
    return !!(
      action.payload.id &&
      action.payload.channelId &&
      action.payload.content &&
      action.payload.timestamp
    );
  }

  /**
   * Validate SET_ROLE action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateSetRole(action, authorId, view) {
    // Check if the server exists
    const server = await view.findOne("@server/server", {});
    if (!server) {
      return false;
    }

    const userRole = await this.getUserRole(action, view);

    if (!authorRole) {
      return false;
    }

    // Only OWNER can set ADMIN roles
    if (action.payload.role === "ADMIN" && authorRole.role !== "OWNER") {
      return false;
    }

    // ADMINs and OWNERs can set MODERATOR and MEMBER roles
    if (
      (action.payload.role === "MODERATOR" ||
        action.payload.role === "MEMBER") &&
      authorRole.role !== "ADMIN" &&
      authorRole.role !== "OWNER"
    ) {
      return false;
    }

    // Basic validation of required fields
    return !!(
      action.payload.userId &&
      action.payload.serverId &&
      action.payload.role &&
      action.payload.timestamp
    );
  }

  /**
   * Validate CLAIM_INVITE action
   * @param {Object} action - The action to validate
   * @param {Buffer} authorKey - The public key of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateClaimInvite(action, authorKey, view) {
    // Check if the invite exists and is valid
    const invite = await view.findOne("@server/invite", {
      code: action.payload.inviteCode,
    });

    if (!invite) {
      return false;
    }

    // Check if the invite has expired
    if (invite.expiresAt && invite.expiresAt < action.payload.timestamp) {
      return false;
    }

    // Check if the user already exists
    const authorId = b4a.toString(authorKey, "hex");
    const existingUser = await view.findOne("@server/user", { id: authorId });

    // Allow only if the user doesn't exist yet
    return !existingUser;
  }

  /**
   * Validate CREATE_INVITE action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateCreateInvite(action, authorId, view) {
    // Check if the server exists
    const server = await view.findOne("@server/server", {});
    if (!server) {
      return false;
    }

    const userRole = await this.getUserRole(action, view);

    if (!userRole || !this._hasPermission(userRole.role, "CREATE_INVITES")) {
      return false;
    }

    // Check if the invite ID is already taken
    const existingInvite = await view.findOne("@server/invite", {
      id: action.payload.id,
    });
    if (existingInvite) {
      return false;
    }

    // Basic validation of required fields
    return !!(
      action.payload.id &&
      action.payload.invite &&
      action.payload.timestamp
    );
  }

  /**
   * Validate DELETE_MESSAGE action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateDeleteMessage(action, authorId, view) {
    // Check if the message exists
    const message = await view.findOne("@server/message", {
      id: action.payload.id,
    });
    if (!message) {
      return false;
    }

    // Find the channel for this message
    const channel = await this.syncbase.channels.getChannel(
      action.payload.channelId
    );
    if (!channel) {
      return false;
    }

    const signerPubKey = b4a.isBuffer(action.signer)
      ? action.signer
      : b4a.from(action.signer);
    // Users can only edit their own messages
    if (message.author !== b4a.toString(signerPubKey, "hex")) {
      return false;
    }

    const userRole = await this.getUserRole(action, view);

    if (!userRole || !this._hasPermission(userRole.role, "DELETE_MESSAGES")) {
      return false;
    }

    // Basic validation of required fields
    return !!(action.payload.id && action.payload.timestamp);
  }

  /**
   * Validate EDIT_MESSAGE action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateEditMessage(action, authorId, view) {
    // Check if the message exists
    const message = await this.syncbase.messages.getMessage(
      action.payload.id,
      action.payload.channelId
    );
    if (!message) {
      return false;
    }

    const signerPubKey = b4a.isBuffer(action.signer)
      ? action.signer
      : b4a.from(action.signer);
    // Users can only edit their own messages
    if (message.author !== b4a.toString(signerPubKey, "hex")) {
      return false;
    }

    // Basic validation of required fields
    return !!(
      action.payload.id &&
      action.payload.content &&
      action.payload.timestamp
    );
  }

  /**
   * Validate REVOKE_INVITE action
   * @param {Object} action - The action to validate
   * @param {String} authorId - The ID of the author
   * @param {Object} view - The database view
   * @returns {Promise<Boolean>} Whether the action is valid
   * @private
   */
  async _validateRevokeInvite(action, authorId, view) {
    // Check if the invite exists
    const invite = await view.findOne("@server/invite", {
      code: action.payload.code,
    });
    if (!invite) {
      return false;
    }

    // Check if the server exists
    const server = await view.findOne("@server/server", {});
    if (!server) {
      return false;
    }

    // Check if the user has permission to manage invites
    const userRole = await view.findOne("@server/role", {
      userId: authorId,
    });

    if (!userRole || !this._hasPermission(userRole.role, "MANAGE_INVITES")) {
      return false;
    }

    // Basic validation of required fields
    return !!(
      action.payload.code &&
      action.payload.serverId &&
      action.payload.timestamp
    );
  }

  /**
   * Check if a role has a specific permission
   * @param {String} role - The role to check
   * @param {String} permission - The permission to check for
   * @returns {Boolean} Whether the role has the permission
   * @private
   */
  _hasPermission(role, permission) {
    const rolePermissions = {
      OWNER: [
        "MANAGE_SERVER",
        "MANAGE_CHANNELS",
        "SEND_MESSAGES",
        "DELETE_MESSAGES",
        "SET_ROLE",
        "CREATE_INVITES",
        "EDIT_SERVER",
        "EDIT_CHANNEL",
        "DELETE_CHANNEL",
        "MANAGE_INVITES",
      ],
      ADMIN: [
        "MANAGE_CHANNELS",
        "SEND_MESSAGES",
        "DELETE_MESSAGES",
        "SET_ROLE",
        "CREATE_INVITES",
        "EDIT_CHANNEL",
        "MANAGE_SERVER",
        "MANAGE_INVITES",
      ],
      MODERATOR: [
        "SEND_MESSAGES",
        "DELETE_MESSAGES",
        "CREATE_INVITES",
        "MANAGE_INVITES",
      ],
      MEMBER: ["SEND_MESSAGES"],
    };

    const permissions = rolePermissions[role] || [];
    return permissions.includes(permission);
  }

  hasPermission(role, permission) {
    return this._hasPermission(role, permission);
  }
}

module.exports = ActionValidator;
