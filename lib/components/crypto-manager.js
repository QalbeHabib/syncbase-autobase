const crypto = require('hypercore-crypto')
const sodium = require('sodium-native')
const b4a = require('b4a')

/**
 * CryptoManager - Handles cryptographic operations
 */
class CryptoManager {
  /**
   * Create a new CryptoManager instance
   * @param {String|Array} [seedPhrase] - Seed phrase to derive keys from
   */
  constructor(seedPhrase) {
    if (seedPhrase) {
      const keys = CryptoManager.deriveKeysFromSeed(seedPhrase)
      this.publicKey = keys.publicKey
      this.secretKey = keys.secretKey
      this.discoveryKey = keys.discoveryKey
    }
  }

  /**
   * Derive keys from a seed phrase
   * @param {String|Array} seedPhrase - Seed phrase to derive keys from
   * @returns {Object} Generated keys
   */
  static deriveKeysFromSeed(seedPhrase) {
    if (!seedPhrase) return null

    seedPhrase = Array.isArray(seedPhrase) ? seedPhrase.join(' ') : seedPhrase
    const seedBuffer = b4a.from(seedPhrase)
    const masterHash = crypto.hash(seedBuffer)

    const seed = b4a.alloc(sodium.crypto_sign_SEEDBYTES)
    sodium.crypto_generichash(seed, seedBuffer)

    const publicKey = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
    const secretKey = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_seed_keypair(publicKey, secretKey, seed)

    const discoveryKey = crypto.hash(b4a.concat([masterHash, b4a.from('discovery')]))
    return { publicKey, secretKey, discoveryKey }
  }

  /**
   * Sign a message with the secret key
   * @param {Buffer|String} message - Message to sign
   * @returns {Buffer} Signature
   */
  sign(message) {
    if (!this.secretKey) {
      throw new Error('Cannot sign: No secret key available')
    }

    const data = typeof message === 'string' ? b4a.from(message) : message
    const signature = b4a.alloc(sodium.crypto_sign_BYTES)

    sodium.crypto_sign_detached(signature, data, this.secretKey)

    return signature
  }

  createSignedAction(type, payload) {
    // Ensure payload has the required fields
    if (!payload.timestamp) {
      payload.timestamp = Date.now()
    }

    // Create a canonical representation of the payload for signing
    const sortedPayload = Object.keys(payload)
      .sort()
      .reduce((obj, key) => {
        obj[key] = payload[key]
        return obj
      }, {});

    // Create a canonical string, but remove the timestamp for signing
    const payloadForSigning = { ...sortedPayload }
    delete payloadForSigning.timestamp

    const message = JSON.stringify(payloadForSigning)

    // Sign the message
    const signature = this.sign(message)

    return {
      type,
      signature,
      payload: sortedPayload,
      signer: b4a.from(this.publicKey, 'hex'),
    }
  }

  /**
   * Verify a signature
   * @param {Buffer} signature - The signature to verify
   * @param {Buffer|String} message - The original message
   * @param {Buffer} publicKey - The public key to verify against
   * @returns {Boolean} True if the signature is valid
   */
  verify(signature, message, publicKey) {
    const data = typeof message === 'string'
      ? b4a.from(message)
      : (typeof message === 'object'
        ? b4a.from(JSON.stringify(message, Object.keys(message).sort()))
        : message);

    const signatureBuffer = b4a.isBuffer(signature)
      ? signature
      : b4a.from(signature, 'hex');

    const senderBuffer = b4a.isBuffer(publicKey)
      ? publicKey
      : b4a.from(publicKey, 'hex');

    return sodium.crypto_sign_verify_detached(signatureBuffer, data, senderBuffer)
  }

  /**
   * Generate a random ID
   * @param {Number} [length=16] - Length of the ID in bytes
   * @returns {String} Random ID as hex string
   */
  generateId(length = 16) {
    return crypto.randomBytes(length).toString('hex')
  }

  /**
   * Hash a value
   * @param {Buffer|String} value - Value to hash
   * @returns {Buffer} Hashed value
   */
  hash(value) {
    const data = typeof value === 'string' ? b4a.from(value) : value
    return crypto.hash(data)
  }


  /**
   * Generate a symmetric encryption key
   * @returns {Buffer} Encryption key
   */
  generateEncryptionKey() {
    return crypto.randomBytes(32)
  }

  /**
   * Encrypt data using a symmetric key
   * @param {Buffer|String} data - Data to encrypt
   * @param {Buffer} key - Encryption key
   * @returns {Buffer} Encrypted data
   */
  encrypt(data, key) {
    const nonce = crypto.randomBytes(24)
    const message = typeof data === 'string' ? b4a.from(data) : data

    const ciphertext = b4a.alloc(message.length + sodium.crypto_secretbox_MACBYTES)

    sodium.crypto_secretbox_easy(
      ciphertext,
      message,
      nonce,
      key
    )

    return b4a.concat([nonce, ciphertext])
  }

  /**
   * Decrypt data using a symmetric key
   * @param {Buffer} encryptedData - Encrypted data
   * @param {Buffer} key - Encryption key
   * @returns {Buffer|null} Decrypted data or null if decryption fails
   */
  decrypt(encryptedData, key) {
    try {
      const nonce = encryptedData.slice(0, 24)
      const ciphertext = encryptedData.slice(24)

      const message = b4a.alloc(ciphertext.length - sodium.crypto_secretbox_MACBYTES)

      const result = sodium.crypto_secretbox_open_easy(
        message,
        ciphertext,
        nonce,
        key
      )

      if (!result) return null
      return message
    } catch (err) {
      console.error('Decryption error:', err)
      return null
    }
  }

}

module.exports = CryptoManager
