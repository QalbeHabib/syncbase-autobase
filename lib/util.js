const crypto = require("crypto");
const b4a = require("b4a");

/**
 * Creates a cryptographically secure random seed
 * @param {number} length - The length of the seed in bytes
 * @returns {Buffer} - A buffer containing the random seed
 */
function createSeed(length = 32) {
  return crypto.randomBytes(length);
}

/**
 * Creates a SHA-256 hash of the input data
 * @param {Buffer|string} data - The data to hash
 * @returns {Buffer} - The resulting hash as a buffer
 */
function createHash(data) {
  const hash = crypto.createHash("sha256");

  if (typeof data === "string") {
    hash.update(data);
  } else if (Buffer.isBuffer(data) || b4a.isBuffer(data)) {
    hash.update(data);
  } else {
    throw new Error("Input must be a string or buffer");
  }

  return hash.digest();
}

module.exports = {
  createSeed,
  createHash,
};
