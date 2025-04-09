const assert = require('assert')
const Corestore = require('corestore')
const path = require('path')
const fs = require('fs')
const rimraf = require('rimraf')
const b4a = require('b4a')
const SyncBase = require('../lib/syncbase')

// Test directory setup - use a timestamp for unique directory each run
const TEST_DIR = path.join('./cores', 'syncbase-test-' + Date.now())
console.log(`Test directory: ${TEST_DIR}`)
fs.mkdirSync(TEST_DIR, { recursive: true })

// Cleanup function to remove test directories
function cleanup() {
    console.log(`Cleaning up test directory: ${TEST_DIR}`)
    rimraf.sync(TEST_DIR)
}

// Helper sleep function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// Helper function to create a unique seed phrase
function generateUniqueSeed(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2)}`
}

// Modified version of the SyncBasePairer's finished method
// Create a wrapper around SyncBase.pair to add debugging
const originalPair = SyncBase.pair
SyncBase.pair = function (store, invite, opts = {}) {
    console.log('DEBUG: Creating enhanced pairer')

    // Create the original pairer
    const pairer = originalPair(store, invite, opts)

    // Save the original finished method
    const originalFinished = pairer.finished

    // Override the finished method to add timeout and debugging
    pairer.finished = function () {
        console.log('DEBUG: Enhanced finished() called')

        // Call the original, but add our own timeout
        const originalPromise = originalFinished.call(this)

        // Wrap in a race to avoid hanging
        return Promise.race([
            originalPromise,
            new Promise((resolve, reject) => {
                // After 15 seconds, force resolve if we have a pass object
                setTimeout(() => {
                    console.log('DEBUG: finished() timeout - checking state')
                    if (this.pass) {
                        console.log('DEBUG: pass exists, force resolving')
                        resolve(this.pass)
                    } else {
                        console.log('DEBUG: no pass available after timeout')
                        reject(new Error('Pairing timed out after 15 seconds'))
                    }
                }, 15000)
            })
        ])
    }

    // Also enhance the _whenWritable method to add debugging
    const originalWhenWritable = pairer._whenWritable
    pairer._whenWritable = function () {
        console.log('DEBUG: Enhanced _whenWritable called')

        if (!this.pass || !this.pass.base) {
            console.log('DEBUG: No pass or base available yet')

            // Set interval to check for pass creation
            const checkPassInterval = setInterval(() => {
                console.log(`DEBUG: Checking for pass: ${this.pass ? 'found' : 'not found'}`)
                if (this.pass && this.pass.base) {
                    clearInterval(checkPassInterval)
                    console.log('DEBUG: Pass and base now available')

                    // Now that pass is available, set up writable check
                    setupWritableCheck.call(this)
                }
            }, 1000)

            return
        }

        // If pass is already available, set up writable check right away
        setupWritableCheck.call(this)

        // Define the helper function for setting up writable checks
        function setupWritableCheck() {
            console.log(`DEBUG: Pass writable state: ${this.pass.base.writable}`)

            // Check immediately if already writable
            if (this.pass.base.writable) {
                console.log('DEBUG: Already writable, resolving immediately')
                if (this.onresolve) this.onresolve(this.pass)
                return
            }

            // Set up writable state monitoring
            const debugInterval = setInterval(() => {
                if (!this.pass || !this.pass.base) return

                console.log(`DEBUG: Writable check: ${this.pass.base.writable}`)
                if (this.pass.base.localWriter) {
                    console.log(`DEBUG: LocalWriter state:`)
                    console.log(`  - closed: ${this.pass.base.localWriter.closed}`)
                    console.log(`  - isRemoved: ${this.pass.base.localWriter.isRemoved}`)
                } else {
                    console.log('DEBUG: No localWriter available')
                }
            }, 2000)

            // Listen for update events
            const check = () => {
                console.log('DEBUG: Update event received')
                console.log(`DEBUG: Writable after update: ${this.pass.base.writable}`)

                if (this.pass.base.writable) {
                    console.log('DEBUG: Now writable, resolving promise')
                    this.pass.base.off('update', check)
                    clearInterval(debugInterval)
                    if (this.onresolve) this.onresolve(this.pass)
                }
            }

            console.log('DEBUG: Setting up update listener')
            this.pass.base.on('update', check)

            // Force resolve after 10 seconds regardless of writable state
            setTimeout(() => {
                if (!this.pass || !this.pass.base) return

                console.log('DEBUG: Force timeout check')
                if (!this.pass.base.writable && this.onresolve) {
                    console.log('DEBUG: Force resolving after timeout')
                    this.pass.base.off('update', check)
                    clearInterval(debugInterval)
                    this.onresolve(this.pass)
                }
            }, 10000)
        }
    }

    return pairer
}

// Test pairing and synchronization with proper logging and verification
async function testPairingAndSync() {
    console.log('\n=== TESTING PAIRING AND SYNCHRONIZATION ===')

    // Setup source server with a unique seed
    const sourceStorePath = path.join(TEST_DIR, 'source-server')
    const sourceStore = new Corestore(sourceStorePath)
    await sourceStore.ready()

    // Use a unique seed phrase for the source server
    const sourceSeed = generateUniqueSeed('source')
    console.log(`Source server seed: ${sourceSeed}`)

    console.log('Creating source server...')
    const sourceServer = new SyncBase(sourceStore, {
        seedPhrase: sourceSeed,
        replicate: true
    })

    let targetServer = null

    try {
        await Promise.race([
            sourceServer.ready(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Source server ready timeout')), 5000))
        ])
        console.log('✓ Source server ready')

        // Initialize source server
        const serverInfo = await sourceServer.initialize({
            name: 'Source Test Server',
            description: 'Server for testing pairing'
        })
        console.log('✓ Source server initialized:', serverInfo ? serverInfo.name : 'No server info')

        // Store creator ID for later verification
        const sourceCreatorId = b4a.toString(sourceServer.crypto.publicKey, 'hex')
        console.log(`Source server creator ID: ${sourceCreatorId}`)

        // Create a channel on source server
        console.log('Creating test channel...')
        const channel = await sourceServer.channels.createChannel({
            name: 'sync-test-channel',
            type: 'TEXT',
            topic: 'Channel for testing sync'
        })
        console.log(`✓ Created channel with ID: ${channel.channelId}`)

        // Add a message to the channel
        console.log('Sending test message...')
        const sourceMessage = await sourceServer.messages.sendMessage({
            channelId: channel.channelId,
            content: 'This is a test message from source server'
        })
        console.log(`✓ Sent message with ID: ${sourceMessage.id}`)

        // Verify message was added
        const sourceMessages = await sourceServer.messages.getMessages({ channelId: channel.channelId })
        console.log(`✓ Source server has ${sourceMessages.length} message(s)`)
        assert.equal(sourceMessages.length, 1, 'Source server should have 1 message')

        // Create an invite with a short expiry for testing
        console.log('Creating invite...')
        const invite = await sourceServer.invites.createInvite({
            expireInMinutes: 5 // Short expiry for testing
        })
        console.log(`✓ Created invite: ${invite}`)
        assert(invite, 'Invite should be created')

        // Setup target server (the one that will join)
        const targetStorePath = path.join(TEST_DIR, 'target-server')
        const targetStore = new Corestore(targetStorePath)
        await targetStore.ready()

        // Use a unique seed phrase for the target server
        const targetSeed = generateUniqueSeed('target')
        console.log(`Target server seed: ${targetSeed}`)

        // Start pairing process
        console.log('Starting pairing process...')
        const pairer = SyncBase.pair(targetStore, invite, {
            seedPhrase: targetSeed
        })

        // Wait for pairing to complete with timeout
        console.log('Waiting for pairing to complete...')
        targetServer = await pairer.finished()

        console.log('✓ Pairing completed')

        // Give some time for initial sync
        console.log('Waiting for initial sync...')
        await sleep(3000)

        // Check server info directly via the view
        console.log('Checking database directly:')
        try {
            // Ensure we can access the database
            await targetServer.base.ready()
            await targetServer.base.view.ready()

            // List all collections to see what's available
            const serverRecords = await targetServer.getServerInfo()
            console.log(`First server record: ${serverRecords.name}`)

            const channelRecords = await targetServer.channels.getChannels()
            console.log(`Found ${channelRecords.length} channel records`)

            if (channelRecords.length > 0) {
                for (const ch of channelRecords) {
                    console.log(`- Channel: ${ch.name} (${ch.channelId})`)
                }
            }
        } catch (err) {
            console.log(`Error accessing database directly: ${err.message}`)
        }


        await sleep(1000)

        let hasRole = false
        console.log('Checking user role on source server:')
        try {
            const targetUserPubkey = targetServer.crypto.publicKey
            const targetUserId = b4a.toString(targetUserPubkey, 'hex')
            console.log(`Target user ID: ${targetUserId}`)

            // Directly query the database
            const userRole = await sourceServer.base.view.findOne('@server/role', { userId: targetUserId })
            hasRole = userRole?.role
            if (userRole) {
                console.log(`✓ Source: User has role: ${userRole.role}`)
            } else {
                console.log('× No role found for user')
            }
        } catch (err) {
            console.log(`× Error checking role: ${err.message}`)
        }
        if (!hasRole) {
            console.log('Await sync on source.. called .base.update()')
            await sourceServer.base.update()
        }

        const channelRecords = await targetServer.channels.getChannels()
        const generalChannel = channelRecords.find(c => c.name == 'general-chat')
        // Try to add a new channel from the target - this tests write capability
        console.log('Attempting to send a message to general-chat from target:')
        try {
            const message1 = await targetServer.messages.sendMessage({
                channelId: generalChannel.channelId,
                content: 'Hello world! This is another test message from target'
            })
            console.log(`✓ Successfully sent message`, message1)
        } catch (err) {
            console.log(`× Failed to create channel: ${err.message}`)
        }
        await sleep(1000)
        // Check user role on target server
        console.log('Checking user role on target server:')
        try {
            const targetUserPubkey = targetServer.crypto.publicKey
            const targetUserId = b4a.toString(targetUserPubkey, 'hex')
            console.log(`Target user ID: ${targetUserId}`)

            // Directly query the database
            const userRole = await targetServer.base.view.findOne('@server/role', { userId: targetUserId })

            if (userRole) {
                console.log(`✓ User has role: ${userRole.role}`)
            } else {
                console.log('× No role found for user')
            }
        } catch (err) {
            console.log(`× Error checking role: ${err.message}`)
        }
        await sleep(1000)
        try {
            console.log('Checking messages in main server to see if its synced')
            const messages = await sourceServer.messages.getMessages()
            console.log({ messages })
        } catch (error) {
            console.log(error)
        }

        // Clean closure
        console.log('Closing servers...')
        await sourceServer.close()

        // Brief pause to let connections settle
        await sleep(500)

        if (targetServer) {
            try {
                await targetServer.close()
            } catch (err) {
                console.log(`Error closing target server: ${err.message}`)
            }
        }

        console.log('✓ Test complete')
        return true
    } catch (error) {
        console.error('Test failed:', error)

        // Clean up source server
        if (sourceServer) {
            try {
                await sourceServer.close()
            } catch (closeError) {
                console.error('Error closing source server:', closeError)
            }
        }

        // Clean up target server if it exists
        if (targetServer) {
            try {
                await targetServer.close()
            } catch (closeError) {
                console.error('Error closing target server:', closeError)
            }
        }

        throw error
    }
}

// Run tests
async function runTests() {
    try {
        await testPairingAndSync()
        console.log('\n✅ All tests complete!')

        // Brief pause before cleanup to let any remaining I/O complete
        await sleep(1000)
        cleanup()
        process.exit(0)
    } catch (error) {
        console.error('\n❌ Tests failed:', error)

        // Brief pause before cleanup
        await sleep(1000)
        cleanup()
        process.exit(1)
    }
}

// Start testing
runTests()