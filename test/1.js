const test = require('brittle')
const path = require('path')
const Corestore = require('corestore')
const SyncBase = require('../lib/syncbase')
const b4a = require('b4a')
const crypto = require('hypercore-crypto')

// Helper to create a Corestore instance
function createStore(id = "1") {
  const folder = path.join('./teststores', id?.toString(), '/')
  return new Corestore(folder)
}

// Helper to create a SyncBase instance
async function createSyncBase(opts = {}, id) {
  const store = createStore(id)
  const syncBase = new SyncBase(store, {
    replicate: false,
    ...opts
  })
  await syncBase.ready()
  return syncBase
}

test('Create server and verify it exists', async t => {
  // Create a new SyncBase instance
  const syncBase = await createSyncBase(1)

  // The default server should be created automatically
  const servers = await syncBase.channels.getServers()
  t.equal(servers.length, 1, 'One server should exist')
  t.equal(servers[0].name, 'Default Server', 'Server should be named "Default Server"')

  // Check that the user is the owner
  const userId = b4a.toString(syncBase.writerKey, 'hex')
  const role = await syncBase.permissions.getUserRole(userId, servers[0].id)
  t.equal(role, 'OWNER', 'User should be owner of the server')

  // Close the instance
  await syncBase.close()
  t.end()
})

test('Create a channel and verify it exists', async t => {
  // Create a new SyncBase instance
  const syncBase = await createSyncBase(1)

  // Get the default server
  const servers = await syncBase.channels.getServers()
  const serverId = servers[0].id

  // Create a new channel
  const channelName = 'test-channel'
  const channel = await syncBase.channels.createChannel({
    serverId,
    name: channelName,
    type: 'TEXT'
  })

  // Verify the channel was created
  const channels = await syncBase.channels.getChannels(serverId)
  t.equal(channels.length, 2, 'Two channels should exist (default general and the new one)')

  // Find our specific channel
  const createdChannel = channels.find(c => c.name === channelName)
  t.ok(createdChannel, 'Our channel should exist')
  t.equal(createdChannel.serverId, serverId, 'Channel should be in the correct server')

  // Close the instance
  await syncBase.close()
  t.end()
})

test('Send a message and verify it exists', async t => {
  // Create a new SyncBase instance
  const syncBase = await createSyncBase(1)

  // Get the default server
  const servers = await syncBase.channels.getServers()
  const serverId = servers[0].id

  // Get the default general channel
  const channels = await syncBase.channels.getChannels(serverId)
  const generalChannel = channels.find(c => c.name === 'general')
  t.ok(generalChannel, 'General channel should exist')

  // Send a message to the general channel
  const content = 'Hello, world!'
  const message = await syncBase.messages.sendMessage({
    channelId: generalChannel.id,
    content
  })

  // Get messages from the channel
  const messages = await syncBase.messages.getMessages({
    channelId: generalChannel.id
  })

  t.equal(messages.length, 1, 'One message should exist')
  t.equal(messages[0].content, content, 'Message content should match')
  t.equal(messages[0].author, b4a.toString(syncBase.writerKey, 'hex'), 'Author should be our public key')

  // Close the instance
  await syncBase.close()
  t.end()
})

test('Create an invite and test pairing', async t => {
  // Create a first SyncBase instance (server)
  const server = await createSyncBase(1)

  // Get the default server
  const servers = await server.channels.getServers()
  const serverId = servers[0].id

  // Create an invite
  const inviteCode = await server.invites.createInvite({
    serverId
  })

  t.ok(inviteCode, 'Invite code should be generated')

  // Create a second Corestore for the client
  const clientStore = createStore(2)

  // Create a pairing instance
  const pairer = SyncBase.pair(clientStore, inviteCode, {
    replicate: false
  })

  // We'll simulate the pairing process manually for testing
  const client = new SyncBase(clientStore, {
    key: server.key,
    encryptionKey: server.base.encryptionKey,
    replicate: false
  })

  await client.ready()

  // Claim the invite
  await client.invites.claimInvite({
    inviteCode,
    timestamp: Date.now()
  })

  // At this point in a real scenario, the client would be acknowledged by the server
  // For testing, we'll force it by adding the writer
  await server.base.addWriter(client.writerKey)

  // The client should now be able to see the server
  const clientServers = await client.channels.getServers()
  t.equal(clientServers.length, 1, 'Client should see one server')
  t.equal(clientServers[0].id, serverId, 'Client should see the correct server')

  // Client should have MEMBER role by default
  const clientId = b4a.toString(client.writerKey, 'hex')
  const clientRole = await server.permissions.getUserRole(clientId, serverId)
  t.equal(clientRole, 'GUEST', 'Client should have GUEST role initially')

  // Server admin can upgrade the client to MEMBER
  await server.permissions.setRole({
    userId: clientId,
    serverId,
    role: 'MEMBER'
  })

  // Allow time for updates to propagate
  await new Promise(resolve => setTimeout(resolve, 100))

  // Both sides should now be able to interact
  await client.messages.sendMessage({
    channelId: (await client.channels.getChannels(serverId))[0].id,
    content: 'Hello from client!'
  })

  // Close all instances
  await client.close()
  await pairer.close()
  await server.close()
  t.end()
})

test('Test role permissions', async t => {
  // Create a new SyncBase instance
  const syncBase = await createSyncBase(1)

  // Get the default server
  const servers = await syncBase.channels.getServers()
  const serverId = servers[0].id

  // Create a second user to test with (simulated)
  const userId = crypto.randomBytes(32).toString('hex')

  // Set the user as a MEMBER
  await syncBase.permissions.setRole({
    userId,
    serverId,
    role: 'MEMBER'
  })

  // Check permissions
  const canSendMessage = await syncBase.permissions.hasPermission(userId, serverId, 'SEND_MESSAGE')
  t.ok(canSendMessage, 'MEMBER should be able to send messages')

  const canDeleteMessage = await syncBase.permissions.hasPermission(userId, serverId, 'DELETE_MESSAGE')
  t.notOk(canDeleteMessage, 'MEMBER should not be able to delete messages')

  // Promote user to MODERATOR
  await syncBase.permissions.setRole({
    userId,
    serverId,
    role: 'MODERATOR'
  })

  // Check permissions again
  const canDeleteMessageAsModarator = await syncBase.permissions.hasPermission(userId, serverId, 'DELETE_MESSAGE')
  t.ok(canDeleteMessageAsModarator, 'MODERATOR should be able to delete messages')

  // Close the instance
  await syncBase.close()
  t.end()
})

test('Test database index access', async t => {
  // This test explicitly checks that we can access all the collections
  // that were causing issues before
  const syncBase = await createSyncBase()

  try {
    // Get the default server
    const servers = await syncBase.channels.getServers()
    const serverId = servers[0].id

    // Test @server/role access
    const ownerId = b4a.toString(syncBase.writerKey, 'hex')
    const ownerRole = await syncBase.base.view.findOne('@server/role', {
      userId: ownerId,
      serverId
    })

    t.ok(ownerRole, '@server/role collection should be accessible')
    t.equal(ownerRole.role, 'OWNER', 'Owner role should be correctly set')

    // Test creating a channel (uses multiple collections)
    const channel = await syncBase.channels.createChannel({
      serverId,
      name: 'test-channel-for-indexes',
      type: 'TEXT'
    })

    // Test accessing the channel
    const fetchedChannel = await syncBase.base.view.findOne('@server/channel', {
      id: channel.id
    })

    t.ok(fetchedChannel, '@server/channel collection should be accessible')
    t.equal(fetchedChannel.name, 'test-channel-for-indexes', 'Channel data should be correct')

    // Test creating an invite
    const invite = await syncBase.invites.createInvite({ serverId })

    // Test accessing the invite
    const allInvites = await syncBase.base.view.findAll('@server/invite', {})
    t.ok(allInvites.length > 0, '@server/invite collection should be accessible')

    const createdInvite = allInvites.find(i => i.code === invite)
    t.ok(createdInvite, 'Created invite should be accessible')

    // Tests passed
    t.pass('All database collections are accessible')
  } catch (err) {
    t.fail(`Database access error: ${err.message}`)
  } finally {
    await syncBase.close()
    t.end()
  }
})
