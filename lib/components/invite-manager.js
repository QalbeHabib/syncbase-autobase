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

      // Determine maxUses from options, default to 0 (unlimited uses)
      const maxUses = options.maxUses !== undefined ? options.maxUses : 0;

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
        expiresAt: expiresAt, // Store the actual expiration timestamp
        maxUses: maxUses, // Store maximum uses (0 = unlimited)
        uses: 0, // Initialize use counter
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

      // IMPORTANT: Force multiple updates to ensure invite propagation
      for (let i = 0; i < 3; i++) {
        try {
          await this.syncBase.base.update();
          await new Promise((resolve) => setTimeout(resolve, 300)); // Wait between updates
        } catch (updateErr) {
          console.warn(
            `Error in update ${i + 1} after invite creation: ${
              updateErr.message
            }`
          );
        }
      }

      // Add a slightly longer sleep to ensure the invite is fully processed before continuing
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const { id, invite, publicKey, expires } = payload;
      const inviteCode = z32.encode(invite);

      // Verify the invite was actually stored
      let storedInvite = null;
      let retryVerification = 3;

      while (retryVerification > 0 && !storedInvite) {
        try {
          // Try to find the invite directly in the view
          storedInvite = await this.syncBase.base.view.findOne(
            "@server/invite",
            {
              id: b4a.toString(id, "hex"),
            }
          );

          if (!storedInvite) {
            // If not found directly, try importing it via BlindPairing
            console.log("Verifying invite through BlindPairing import");
            storedInvite = await BlindPairing.importInvite(
              invite,
              this.syncBase.base.store
            );
          }

          if (storedInvite) {
            console.log(
              `Successfully verified invite in view with ID: ${b4a.toString(
                id,
                "hex"
              )}`
            );
            break;
          } else {
            console.warn("Invite verification attempt failed, retrying...");
            retryVerification--;

            // Check if we need to retry creation instead
            if (retryVerification === 0) {
              console.warn("Cannot verify invite, retrying creation");
              // Retry creation with incremented counter
              return this.createInvite(options, retryCount + 1);
            }

            // Wait before next verification attempt
            await new Promise((resolve) => setTimeout(resolve, 1000));
            // Force another update
            await this.syncBase.base.update();
          }
        } catch (verifyErr) {
          console.warn(`Error verifying invite: ${verifyErr.message}`);
          retryVerification--;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      // Try to store the encoded invite code in our view for easier lookup
      try {
        if (storedInvite && id && inviteCode) {
          // Store the invite code for lookup
          await this.syncBase.base.view.put("@server/invite_code", {
            id: b4a.toString(id, "hex"),
            code: inviteCode,
            createdAt: Date.now(),
            expiresAt: expiresAt,
          });
        }
      } catch (storeErr) {
        console.warn(`Error storing encoded invite: ${storeErr.message}`);
        // This is non-fatal, we can continue without storing the code mapping
      }

      return inviteCode;
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
      // Extract the invite ID from the candidate
      const inviteId = candidate.inviteId;

      console.log({ inv: inviteId });

      // Find the invite in our database
      let invite = await this.syncBase.base.view.get("@server/invite", {
        id: inviteId,
      });

      // If not found immediately, try retrieving by direct ID
      if (!invite || !b4a.equals(invite.id, inviteId)) {
        console.log(
          `No invite found with id: ${b4a.toString(inviteId, "hex")}`
        );

        // Try an alternative approach - import via BlindPairing directly
        try {
          // Get all stored invites
          const allInvites = await this.syncBase.base.view.find(
            "@server/invite",
            {}
          );
          console.log(
            `Found ${allInvites?.length || 0} total invites in database`
          );

          // Try to find a matching invite by ID
          if (Array.isArray(allInvites) && allInvites.length > 0) {
            for (const inv of allInvites) {
              if (
                inv.id &&
                (b4a.equals(inv.id, inviteId) ||
                  (typeof inv.id === "string" &&
                    inv.id === b4a.toString(inviteId, "hex")))
              ) {
                console.log("Found invite in database by direct comparison");
                invite = inv;
                break;
              }
            }
          }

          // If still not found, try to reconstruct from the candidate
          if (!invite && candidate.invite) {
            console.log("Attempting to reconstruct invite from candidate data");
            invite = {
              id: inviteId,
              invite: candidate.invite,
              publicKey: candidate.publicKey || this.syncBase.crypto.publicKey,
              expiresAt: Date.now() + 86400000, // Default 24h expiry
            };
          }
        } catch (findErr) {
          console.error("Error searching for invites:", findErr.message);
        }
      }

      // If we still don't have a valid invite, try a last resort fallback
      if (!invite) {
        console.log(
          "No valid invite found, attempting fallback to direct candidate data"
        );

        // Last resort - try to use the candidate's data directly
        if (candidate.publicKey) {
          console.log("Using candidate's public key as fallback");
          invite = {
            id: inviteId,
            publicKey: candidate.publicKey,
            expires: 0, // No expiration as fallback
          };
        } else {
          console.error(
            "Cannot proceed without invite data or candidate public key"
          );
          return;
        }
      }

      // Check if the invite has expired
      const now = Date.now();
      if (invite.expires && now > invite.expires) {
        console.log("Invite has expired");
        return;
      }

      if (invite.expiresAt && now > invite.expiresAt) {
        console.log("Invite has expired (expiresAt)");
        return;
      }

      // Check if invite has a maxUses limit and has reached it
      if (invite.maxUses && invite.uses >= invite.maxUses) {
        console.log(
          `Invite has reached maximum uses: ${invite.uses}/${invite.maxUses}`
        );
        return;
      }

      // Open the candidate with the public key from the invite
      const publicKeyToUse = invite.publicKey || this.syncBase.crypto.publicKey;
      await candidate.open(publicKeyToUse);

      // Create a claim-invite action to record the user joining
      const userData = candidate.userData;
      if (!userData) {
        console.error("Missing user data in candidate");
        return;
      }

      // Increment the invite usage counter (safely)
      try {
        if (invite.id) {
          // Update usage count - safely handle if uses doesn't exist
          invite.uses = (invite.uses || 0) + 1;

          console.log(`Updating invite usage: ${invite.uses} uses`);

          // Try to store the updated usage count, but don't block on it
          this.syncBase.base.view
            .put?.("@server/invite", invite)
            .catch((err) =>
              console.warn(
                "Non-fatal: Failed to update invite usage count:",
                err.message
              )
            );
        }
      } catch (usageErr) {
        console.warn(
          "Non-fatal: Failed to track invite usage:",
          usageErr.message
        );
      }

      // With mutual writer approach, we just need to create a claim action
      // and let the _processNode method handle the user and role creation
      const action = this.syncBase.crypto.createSignedAction("claim-invite", {
        type: "claim-invite",
        user: {
          id: b4a.toString(userData, "hex"),
          code: invite.id ? b4a.toString(invite.id, "hex") : null,
        },
      });

      // Append the action to the autobase optimistically
      await this.syncBase.base.append(action, { optimistic: true });

      // Confirm the pairing by sharing keys
      candidate.confirm({
        key: this.syncBase.base.key,
        encryptionKey: this.syncBase.base.encryptionKey,
      });

      console.log(
        "Successfully processed invite claim:",
        b4a.toString(inviteId, "hex")
      );
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
