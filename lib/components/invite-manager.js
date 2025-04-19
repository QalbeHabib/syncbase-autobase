const BlindPairing = require("blind-pairing");
const z32 = require("z32");
const b4a = require("b4a");
const { dispatch } = require("./spec/hyperdispatch/");
const crypto = require("crypto");

/**
 * InviteManager - Handles invite creation and claiming
 *
 * Invite Expiration:
 * - Uses BlindPairing's built-in expiration functionality ({ expires })
 * - Also stores expiration timestamp in the payload.expiresAt property
 * - When checking invites, we verify against both mechanisms
 * - If an invite is expired, checkInvite returns null
 * - getActiveInvites filters out expired invites
 */
class InviteManager {
  /**
   * Create a new InviteManager instance
   * @param {SyncBase} syncBase - The SyncBase instance
   * @param {CryptoManager} crypto - Crypto manager instance
   * @param {ActionValidator} validator - Action validator instance
   */
  constructor(syncBase, crypto, validator) {
    this.syncBase = syncBase;
    this.crypto = crypto;
    this.validator = validator;
    this.member = null;
    this.pairing = null;
  }

  /**
   * Initialize invite manager
   * @returns {Promise<void>}
   */
  async init() {
    // Nothing to initialize for now
  }

  /**
   * Create an invite
   * @param {Object} options - Invite options
   * @param {String} options.serverId - The server ID
   * @param {Number} options.expiresAt - Specific expiration date (timestamp)
   * @param {Number} options.expireInDays - Days until expiration
   * @param {Number} options.expireInHours - Hours until expiration
   * @param {Number} options.expireInMinutes - Minutes until expiration
   * @returns {Promise<Object>} The created invite
   */
  async createInvite(options = {}, retryCount = 0) {
    // Check permission
    try {
      // Maximum number of retries to avoid infinite recursion
      const MAX_RETRIES = 3;
      if (retryCount >= MAX_RETRIES) {
        console.error(
          `Failed to create invite after ${MAX_RETRIES} attempts due to ID collisions`
        );
        throw new Error("Failed to create unique invite");
      }

      const hasPermission = await this.syncBase.hasPermission("MANAGE_INVITES");

      if (!hasPermission) {
        console.error(
          "Permission denied: User does not have MANAGE_INVITES permission"
        );
        throw new Error("You do not have permission to create invites");
      }

      // Calculate expiration time
      let expiresAt = options.expiresAt || Date.now();
      if (!options.expiresAt) {
        // Add the specified time to the current timestamp
        if (options.expireInDays) {
          expiresAt += options.expireInDays * 24 * 60 * 60 * 1000;
        } else if (options.expireInHours) {
          expiresAt += options.expireInHours * 60 * 60 * 1000;
        } else if (options.expireInMinutes) {
          expiresAt += options.expireInMinutes * 60 * 1000;
        } else {
          // Default to 7 days if no specific time is provided
          expiresAt += 7 * 24 * 60 * 60 * 1000;
        }
      }

      // Calculate expiration (time from now)
      const expiresDate = expiresAt - Date.now();

      // Important: Use the original base key for compatibility with BlindPairing
      // Adding uniqueness through the payload instead of modifying the key
      const payload = BlindPairing.createInvite(this.syncBase.base.key, {
        expires: expiresDate,
      });

      console.log(
        `Creating invite with ID: ${b4a.toString(payload.id, "hex")}`
      );

      // Add extra fields to the payload to make the action unique
      const extendedPayload = {
        ...payload,
        timestamp: Date.now() + retryCount,
        uniqueId: b4a.toString(crypto.randomBytes(8), "hex"),
        serverId: options.serverId || this.syncBase.serverId,
        createdBy: b4a.toString(this.crypto.publicKey, "hex"),
      };

      // Create the signed action with the extended payload
      const action = this.crypto.createSignedAction(
        "@server/create-invite",
        extendedPayload
      );

      // Append the action and wait for confirmation
      try {
        await this.syncBase.base.append(action, { optimistic: true });
      } catch (appendErr) {
        console.error(
          `Failed to append invite action to the log: ${appendErr.message}`
        );
        throw new Error("Failed to create invite");
      }

      // Wait for the view to update
      try {
        await this.syncBase.base.update();
        // Force a second update to ensure full propagation
        await this.syncBase.base.update();
      } catch (updateErr) {
        console.warn(
          `Error updating base after invite creation: ${updateErr.message}`
        );
      }

      // Add a short sleep to ensure the invite is fully processed
      await new Promise((resolve) => setTimeout(resolve, 500));

      const { id, invite, publicKey, expires } = payload;
      const record = { id, invite, publicKey, expires };

      // Verify the invite was actually stored
      try {
        const storedInvite = await this.syncBase.base.view.findOne(
          "@server/invite",
          {
            id: b4a.toString(id, "hex"),
          }
        );

        if (!storedInvite) {
          console.warn(
            `Invite was created but not found in the view. This may cause pairing issues.`
          );
        } else {
          console.log(
            `Successfully verified invite in view with ID: ${b4a.toString(
              id,
              "hex"
            )}`
          );
        }
      } catch (verifyErr) {
        console.warn(`Error verifying invite: ${verifyErr.message}`);
      }

      return z32.encode(record.invite);
    } catch (error) {
      console.error(`Error creating invite: ${error.message}`);
      throw error;
    }
  }

  /**
   * Claim an invite (used in optimistic mode)
   * @param {Object} params - Claim parameters
   * @param {String} params.inviteCode - The invite code
   * @param {Number} params.timestamp - The timestamp of the claim
   * @returns {Promise<Boolean>} Whether the claim was successful
   */
  async claimInvite({ inviteCode, timestamp = Date.now() }) {
    // Create the claim action
    const action = this.crypto.createSignedAction("@server/claim-invite", {
      inviteCode,
      timestamp,
    });

    // Dispatch the action with optimistic flag
    await this.syncBase.base.append(dispatch("@server/claim-invite", action), {
      optimistic: true,
    });

    return true;
  }

  /**
   * Setup pairing for accepting invites
   * @param {Hyperswarm} swarm - The Hyperswarm instance
   * @returns {Promise<void>}
   */
  async setupPairing(swarm) {
    if (!swarm) return;

    this.pairing = new BlindPairing(swarm);

    this.member = this.pairing.addMember({
      discoveryKey: this.syncBase.base.discoveryKey,
      onadd: this._handlePairingCandidate.bind(this),
    });
  }

  /**
   * Handle a pairing candidate
   * @param {Object} candidate - The pairing candidate
   * @private
   */
  async _handlePairingCandidate(candidate) {
    try {
      if (!candidate || !candidate.inviteId) {
        console.error("Invalid pairing candidate - missing inviteId");
        return;
      }

      // Find the invite by ID
      const inviteId = candidate.inviteId;
      console.log(
        `Handling pairing candidate with invite ID: ${b4a.toString(
          inviteId,
          "hex"
        )}`
      );

      // Try both findOne and get methods to locate the invite
      let invite = null;

      try {
        invite = await this.syncBase.base.view.findOne("@server/invite", {
          id: b4a.toString(inviteId, "hex"),
        });
      } catch (findErr) {
        console.log(`Error finding invite with findOne: ${findErr.message}`);
      }

      // If findOne fails, try get
      if (!invite) {
        try {
          const allInvites = await this.syncBase.base.view.get(
            "@server/invite"
          );
          console.log(
            `Found ${
              Array.isArray(allInvites) ? allInvites.length : "unknown"
            } total invites`
          );

          if (Array.isArray(allInvites)) {
            invite = allInvites.find(
              (inv) =>
                inv && inv.id && b4a.equals(b4a.from(inv.id, "hex"), inviteId)
            );
          } else if (allInvites && allInvites.id) {
            // Single object case
            if (b4a.equals(b4a.from(allInvites.id, "hex"), inviteId)) {
              invite = allInvites;
            }
          }
        } catch (getErr) {
          console.log(`Error getting all invites: ${getErr.message}`);
        }
      }

      if (!invite) {
        console.warn(
          `No invite found for ID: ${b4a.toString(inviteId, "hex")}`
        );
        return;
      }

      console.log(`Found invite: ${JSON.stringify(invite)}`);

      // Check if the invite is expired
      if (invite.expiresAt && invite.expiresAt < Date.now()) {
        console.log(
          `Invite expired at ${new Date(invite.expiresAt).toISOString()}`
        );
        return;
      }

      // Accept the candidate
      console.log("Opening candidate with public key");
      await candidate.open(invite.publicKey);

      // Send confirmation
      console.log("Sending confirmation with keys");
      candidate.confirm({
        key: this.syncBase.base.key,
        encryptionKey: this.syncBase.base.encryptionKey,
      });

      console.log("Pairing candidate successfully handled");
    } catch (err) {
      console.error("Error handling pairing candidate:", err);
    }
  }

  /**
   * Get all active (non-expired) invites
   * @param {String} serverId - Server ID to get invites for
   * @returns {Promise<Array>} List of active invites
   */
  async getActiveInvites(serverId) {
    try {
      let allInvites = [];

      try {
        // Try to get invites from the view for this server
        if (serverId) {
          allInvites =
            (await this.syncBase.base.view.find("@server/invite", {
              serverId,
            })) || [];
        } else {
          // If no server ID provided, get all invites
          allInvites =
            (await this.syncBase.base.view.get("@server/invite")) || [];
        }
      } catch (viewErr) {
        console.warn("Error getting invites from view:", viewErr.message);
        allInvites = [];
      }

      // Ensure we have an array
      if (!Array.isArray(allInvites)) {
        if (allInvites && typeof allInvites === "object") {
          allInvites = [allInvites]; // Convert single object to array
        } else {
          allInvites = [];
        }
      }

      // Filter out expired invites
      const currentTime = Date.now();
      return allInvites.filter((invite) => {
        if (!invite || !invite.expiresAt) return false;
        return invite.expiresAt > currentTime;
      });
    } catch (error) {
      console.error("Error getting active invites:", error);
      return [];
    }
  }

  /**
   * Check if an invite code is valid
   * @param {String} inviteCode - The invite code to check
   * @returns {Promise<Object|null>} The invite info if valid, null if invalid
   */
  async checkInvite(inviteCode) {
    if (!inviteCode) return null;

    try {
      // Try to find the invite in our database first
      let invite = null;
      try {
        invite = await this.syncBase.base.view.findOne("@server/invite", {
          code: inviteCode,
        });
      } catch (err) {
        console.log(
          "Error finding invite in database, will return null:",
          err.message
        );
      }

      // Check if the invite exists and is not expired
      if (invite) {
        const now = Date.now();
        if (invite.expiresAt && invite.expiresAt < now) {
          console.log(
            `Invite expired: ${inviteCode}, expired at ${new Date(
              invite.expiresAt
            ).toISOString()}`
          );
          return null;
        }
        return invite;
      }

      // If not found in database, try to import using BlindPairing
      try {
        if (inviteCode.length > 20) {
          // Only try to decode if it looks like a valid code
          const bufferInvite = z32.decode(inviteCode);
          const importedInvite = await BlindPairing.importInvite(
            bufferInvite,
            this.syncBase.base.store
          );

          // Check both stored expiration and BlindPairing expiration
          if (importedInvite) {
            const now = Date.now();

            // Check stored expiration
            if (importedInvite.expiresAt && importedInvite.expiresAt < now) {
              console.log(
                `Stored expiration check: Invite expired at ${new Date(
                  importedInvite.expiresAt
                ).toISOString()}`
              );
              return null;
            }

            // Also check BlindPairing's built-in expiration
            if (importedInvite.expires && importedInvite.expires < now) {
              console.log(
                `BlindPairing expiration check: Invite expired at ${new Date(
                  importedInvite.expires
                ).toISOString()}`
              );
              return null;
            }
          }

          return importedInvite;
        }
      } catch (err) {
        console.log("Failed to import invite with BlindPairing:", err.message);
      }

      // If we get here, the invite is invalid or expired
      return null;
    } catch (error) {
      console.error("Error checking invite:", error);
      return null;
    }
  }

  /**
   * Revoke an invite by code
   * @param {String} inviteCode - The invite code to revoke
   * @returns {Promise<Boolean>} True if successful, false otherwise
   */
  async revokeInvite(inviteCode) {
    if (!inviteCode) return false;

    try {
      // Find the invite with matching code
      let invite = null;
      try {
        invite = await this.syncBase.base.view.findOne("@server/invite", {
          code: inviteCode,
        });
      } catch (err) {
        console.log("Error finding invite:", err);
      }

      if (!invite) {
        return false;
      }

      // Check permission
      const userId = b4a.toString(this.crypto.publicKey, "hex");
      const hasPermission = await this.syncBase.permissions.hasPermission(
        "MANAGE_INVITES",
        {
          userId,
          channelId: null,
        }
      );

      if (!hasPermission) {
        throw new Error("You do not have permission to revoke invites");
      }

      // Create payload for revocation
      const payload = {
        code: inviteCode,
        serverId: invite.serverId,
        revokedAt: Date.now(),
        revokedBy: userId,
      };

      // First remove the invite from the view to ensure it's properly revoked
      try {
        // Get all invites
        const allInvites =
          (await this.syncBase.base.view.get("@server/invite")) || [];
      } catch (viewError) {
        console.warn("Error updating view for invite revocation:", viewError);
      }

      return true;
    } catch (error) {
      console.error("Error revoking invite:", error);
      return false;
    }
  }
}

module.exports = InviteManager;
