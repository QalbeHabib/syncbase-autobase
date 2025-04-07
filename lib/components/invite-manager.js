const BlindPairing = require('blind-pairing')
const z32 = require('z32')
const b4a = require('b4a')
const { dispatch } = require('../utils/dispatch')

/**
 * InviteManager - Handles invite creation and claiming
 */
class InviteManager {
  /**
   * Create a new InviteManager instance
   * @param {SyncBase} syncBase - The SyncBase instance
   * @param {CryptoManager} crypto - Crypto manager instance
   * @param {ActionValidator} validator - Action validator instance
   */
  constructor(syncBase, crypto, validator) {
    this.syncBase = syncBase
    this.crypto = crypto
    this.validator = validator
    this.member = null
    this.pairing = null
  }

  /**
   * Initialize invite manager
   * @returns {Promise<void>}
   */
  async init() {
    // Nothing to initialize for now
  }

  /**
   * Create an invite for a server
   * @param {Object} params - Invite parameters
   * @param {String} params.serverId - The server ID
   * @param {Number} [params.expireInDays=7] - Days until the invite expires
   * @returns {Promise<String>} The invite code
   */
  async createInvite({ serverId, expireInDays = 7 }) {
    // Generate an expiration date
    const expiresAt = Date.now() + (expireInDays * 24 * 60 * 60 * 1000)

    // Create invite with BlindPairing
    const { id, invite, publicKey } = BlindPairing.createInvite(this.syncBase.base.key)

    // Generate a unique code
    const code = z32.encode(invite)

    // Create the invite action
    const action = this.crypto.createSignedAction('CREATE_INVITE', {
      id: this.crypto.generateId(),
      code,
      serverId,
      expiresAt,
      timestamp: Date.now()
    })

    // Dispatch the action
    await this.syncBase.base.append(dispatch('@server/create-invite', action))

    // Return the invite code
    return code
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
    const action = this.crypto.createSignedAction('CLAIM_INVITE', {
      inviteCode,
      timestamp
    })

    // Dispatch the action with optimistic flag
    await this.syncBase.base.append(dispatch('@server/claim-invite', action), { optimistic: true })

    return true
  }

  /**
   * Setup pairing for accepting invites
   * @param {Hyperswarm} swarm - The Hyperswarm instance
   * @returns {Promise<void>}
   */
  async setupPairing(swarm) {
    if (!swarm) return

    this.pairing = new BlindPairing(swarm)

    this.member = this.pairing.addMember({
      discoveryKey: this.syncBase.base.discoveryKey,
      onadd: this._handlePairingCandidate.bind(this)
    })
  }

  /**
   * Handle a pairing candidate
   * @param {Object} candidate - The pairing candidate
   * @private
   */
  async _handlePairingCandidate(candidate) {
    try {
      // Find the invite by ID
      const inviteId = candidate.inviteId
      const invite = await this.syncBase.base.view.findOne('@server/invite', {
        id: b4a.toString(inviteId, 'hex')
      })

      if (!invite) return

      // Check if the invite is expired
      if (invite.expiresAt && invite.expiresAt < Date.now()) return

      // Accept the candidate
      candidate.open(invite.publicKey)

      // Send confirmation
      candidate.confirm({
        key: this.syncBase.base.key,
        encryptionKey: this.syncBase.base.encryptionKey
      })
    } catch (err) {
      console.error('Error handling pairing candidate:', err)
    }
  }

  /**
   * Get all active invites for a server
   * @param {String} serverId - The server ID
   * @returns {Promise<Array<Object>>} The active invites
   */
  async getActiveInvites(serverId) {
    const now = Date.now()

    // First get all invites for this server
    const allInvites = await this.syncBase.base.view.find('@server/invite', { serverId })

    // Filter for non-expired invites
    return allInvites.filter(invite =>
      !invite.expiresAt || invite.expiresAt > now
    )
  }
}

module.exports = InviteManager
