
const assert = require('assert')
const Corestore = require('corestore')
const path = require('path')
const fs = require('fs')
const os = require('os')
const rimraf = require('rimraf')
const b4a = require('b4a')
const SyncBase = require('../lib/syncbase')

// Test directory setup
const TEST_DIR = path.join('./cores', 'syncbase-test-' + Date.now())
console.log(TEST_DIR)
fs.mkdirSync(TEST_DIR, { recursive: true })

// Cleanup function to run after tests
function cleanup() {
  rimraf.sync(TEST_DIR)
}

async function runTests() {
  console.log('Starting SyncBase tests...')

  try {
    // await testServerInitialization()
    // await testChannelOperations()
    // await testMessageOperations()
    await testServerReplication()

    console.log('All tests passed!')
  } catch (err) {
    console.error('Test failed:', err)
    process.exit(1)
  } finally {
    cleanup()
  }
}

async function testServerInitialization() {
  console.log('\n--- Testing Server Initialization ---')

  // Create a store using the same approach as the main application
  const storePath = path.join(TEST_DIR, 'server1')
  const store = new Corestore(storePath)
  await store.ready()

  // Create a new SyncBase instance with a seed phrase
  const server = new SyncBase(store, {
    seedPhrase: 'test seed phrase for server initialization'
  })

  // Wait for the server to be ready
  await server.ready()
  console.log('✓ SyncBase server is ready')

  // Verify server is not initialized yet
  const preInitInfo = await server.getServerInfo()
  assert(!preInitInfo, 'Server should not be initialized yet')
  console.log('✓ Server correctly shows as not initialized')

  // Initialize the server with a name
  await server.initialize({
    name: 'Test Server',
    description: 'A server for testing the SyncBase architecture'
  })
  console.log('✓ Server initialized successfully')

  // Get server info
  const serverInfo = await server.getServerInfo()
  assert(serverInfo, 'Server info should exist after initialization')
  assert.equal(serverInfo.name, 'Test Server', 'Server name should match')
  assert.equal(serverInfo.description, 'A server for testing the SyncBase architecture', 'Server description should match')
  console.log('✓ Server info is correct')

  // Update server info
  await server.updateServerInfo({
    name: 'Updated Server Name',
    description: 'This description has been updated'
  })

  const updatedServerInfo = await server.getServerInfo()
  assert.equal(updatedServerInfo.name, 'Updated Server Name', 'Server name should be updated')
  assert.equal(updatedServerInfo.description, 'This description has been updated', 'Server description should be updated')
  console.log('✓ Server info updates correctly')

  // Confirm creator has OWNER role by their public key
  const creatorId = b4a.toString(server.crypto.publicKey, 'hex')
  const ownerRole = await server.roleManager.checkUserRole(creatorId, "OWNER")
  console.log({ ownerRole })
  assert(ownerRole, 'Owner role should exist')
  console.log('✓ Owner role is set correctly')

  // Clean up
  await server.close()
  console.log('✓ Server closed successfully')
}

async function testChannelOperations() {
  console.log('\n--- Testing Channel Operations ---')

  const storePath = path.join(TEST_DIR, 'server2')
  const store = new Corestore(storePath)
  await store.ready()

  const server = new SyncBase(store, {
    seedPhrase: 'test seed phrase for channel operations'
  })

  await server.ready()
  await server.initialize({ name: 'Channel Test Server' })
  console.log('✓ Test server initialized')

  // Store the creator's ID from their public key
  const creatorId = b4a.toString(server.crypto.publicKey, 'hex')

  // Create channels
  const generalChannel = await server.channels.createChannel({
    name: 'general-2',
    type: 'TEXT',
    topic: 'General discussions'
  })
  assert(generalChannel.channelId, 'Channel should have an ID')
  assert.equal(generalChannel.name, 'general-2', 'Channel name should match')
  console.log('✓ Created general channel')

  await sleep(300)
  const announcementsChannel = await server.channels.createChannel({
    name: 'announcements',
    type: 'TEXT',
    topic: 'Important server announcements'
  })
  await sleep(200)

  console.log('✓ Created announcements channel')

  // List all channels
  const channels = await server.channels.getChannels()
  assert.equal(channels.length, 3, 'Server should have 2 channels')
  console.log(`✓ Server has ${channels.length} channels as expected`)

  // Verify the channel creator is correctly recorded
  const channelData = await server.channels.getChannel(generalChannel.channelId)
  assert.equal(channelData.createdBy, creatorId, 'Channel creator should match the public key of the server creator')
  console.log('✓ Channel creator correctly recorded')

  // Get channel by ID
  const retrievedChannel = await server.channels.getChannel(generalChannel.channelId)
  assert.equal(retrievedChannel.channelId, generalChannel.channelId, 'Retrieved channel ID should match')
  console.log('✓ Retrieved channel correctly')

  // Update channel
  const updatedChannel = await server.channels.updateChannel({
    id: generalChannel.id,
    channelId: generalChannel.channelId,
    name: 'general-chat3',
    topic: 'Updated topic'
  })
  await sleep(100)


  assert.equal(updatedChannel.name, 'general-chat3', 'Channel name should be updated')
  assert.equal(updatedChannel.topic, 'Updated topic', 'Channel topic should be updated')
  console.log('✓ Updated channel successfully')

  // Delete channel
  await server.channels.deleteChannel(announcementsChannel.channelId)
  await sleep(100)

  const remainingChannels = await server.channels.getChannels()
  assert.equal(remainingChannels.length, 2, 'One channel should remain after deletion')
  console.log('✓ Deleted channel successfully')

  await server.close()
}

async function testMessageOperations() {
  console.log('\n--- Testing Message Operations ---')

  const storePath = path.join(TEST_DIR, 'server3')
  const store = new Corestore(storePath)
  await store.ready()

  const server = new SyncBase(store, {
    seedPhrase: 'test seed phrase for message operations'
  })

  await server.ready()
  await server.initialize({ name: 'Message Test Server' })

  // Store the creator's ID from their public key
  const creatorId = b4a.toString(server.crypto.publicKey, 'hex')

  // Create a channel for messages
  const channel = await server.channels.createChannel({
    name: 'general5',
    type: 'TEXT'
  })
  console.log('✓ Created test channel')

  // Send messages
  const message1 = await server.messages.sendMessage({
    channelId: channel.channelId,
    content: 'Hello world! This is test message 1.'
  })
  assert(message1.id, 'Message should have an ID')
  console.log('✓ Sent message 1')

  const message2 = await server.messages.sendMessage({
    channelId: channel.channelId,
    content: 'This is test message 2.'
  })
  console.log('✓ Sent message 2')

  // Get messages from channel
  const messages = await server.messages.getMessages({ channelId: channel.channelId })
  assert.equal(messages.length, 2, 'Channel should have 2 messages')
  console.log(`✓ Retrieved ${messages.length} messages from channel`)

  // Verify message author is recorded correctly
  const messageData = await server.messages.getMessage(message1.id, channel.channelId)
  assert.equal(messageData.author, creatorId, 'Message author should match the public key of the server creator')
  console.log('✓ Message author correctly recorded')

  // Edit a message
  const editedMessage = await server.messages.editMessage({
    messageId: message2.id,
    channelId: message2.channelId,
    content: 'This message has been edited!'
  })
  assert.equal(editedMessage.content, 'This message has been edited!', 'Message content should be updated')
  console.log('✓ Edited message successfully')

  // Retrieve edited message
  const retrievedMessage = await server.messages.getMessage(message2.id, message2.channelId)
  console.log({ retrievedMessage })
  assert.equal(retrievedMessage.content, 'This message has been edited!', 'Retrieved message should have updated content')
  console.log('✓ Retrieved edited message successfully')

  const beforeDelete = await server.messages.getMessages({ channelId: channel.channelId })
  // Delete a message
  console.log('Deleting', message1.id)
  await server.messages.deleteMessage({ messageId: message1.id, channelId: message1.channelId })

  await sleep(1000)
  const remainingMessages = await server.messages.getMessages({ channelId: channel.channelId })
  assert.equal(remainingMessages.length, 1, 'One message should remain after deletion')
  console.log('✓ Deleted message successfully')
  await server.close()
}

async function testServerReplication() {
  console.log('\n--- Testing Server Replication ---')

  // Create two servers
  const storePath1 = path.join(TEST_DIR, 'replication-server1')
  const store13 = new Corestore(storePath1)
  await store13.ready()

  const server1 = new SyncBase(store13, {
    seedPhrase: 'test seed phrase for source server'
  })

  await server1.ready()
  await server1.initialize({ name: 'Source Server' })
  console.log('✓ Source server initialized')

  // Store the creator's ID from their public key
  const creatorId = b4a.toString(server1.crypto.publicKey, 'hex')

  // Create a channel and send a message
  const channel = await server1.channels.createChannel({
    name: 'testRoom',
    type: 'TEXT'
  })

  await server1.messages.sendMessage({
    channelId: channel.channelId,
    content: 'This message should replicate to the joined server'
  })
  console.log('✓ Created channel and message in source server')

  // Create an invite
  const invite = await server1.invites.createInvite({
    serverId: creatorId, // Use the creator's ID rather than the writerKey
    expireInDays: 1
  })
  console.log('✓ Created invite:', invite)

  // Join the server with a second instance
  const storePath2 = path.join(TEST_DIR, 'replication-server2')
  const store22 = new Corestore(storePath2)
  await store22.ready()

  console.log('✓ Starting server join process with invite')
  const joiner = SyncBase.pair(store22, invite, {
    seedPhrase: 'test seed phrase for joining server',
  })
  console.log('Waiting pairing to be finished')
  const joinerClient = await joiner.finished()
  await joinerClient.ready()
  console.log('Pair up!')
  console.log('get channels:')
  const channels = await joinerClient.channels.getChannels()
  console.log({syncchannels: channels})
}

// Run all tests
runTests()
  .then(() => {
    console.log('\nAll tests completed successfully!')
    process.exit(0)
  })
  .catch(err => {
    fs.rmdirSync(TEST_DIR)
    console.error('Test runner failed:', err)
    process.exit(1)
  })


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}