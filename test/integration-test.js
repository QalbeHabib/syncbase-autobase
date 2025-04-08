const assert = require('assert')
const Corestore = require('corestore')
const path = require('path')
const os = require('os')
const rimraf = require('rimraf')
const SyncBase = require('../lib/syncbase')

// Test directory setup
const TEST_DIR = path.join(os.tmpdir(), 'syncbase-test-' + Date.now())

async function cleanup() {
  rimraf.sync(TEST_DIR)
}

async function runTests() {
  console.log('Starting SyncBase Integration Tests...')

  try {
    // Test 1: Basic Server Initialization
    await testServerInitialization()
    
    // Test 2: Channel Operations
    await testChannelOperations()
    
    // Test 3: Message Operations
    await testMessageOperations()
    
    // Test 4: Replication Between Servers
    await testServerReplication()

    console.log('All tests passed successfully!')
  } catch (err) {
    console.error('Test failed:', err)
    process.exit(1)
  } finally {
    await cleanup()
  }
}

async function testServerInitialization() {
  console.log('\n--- Testing Server Initialization ---')
  
  const storePath = path.join(TEST_DIR, 'server1')
  const store = new Corestore(storePath)
  await store.ready()

  const server = new SyncBase(store, {
    replicate: false,
    seedPhrase: 'test seed phrase for initialization'
  })

  await server.ready()
  console.log('✓ Server ready')

  // Verify server is not initialized yet
  const preInitInfo = await server.getServerInfo()
  assert(!preInitInfo, 'Server should not be initialized yet')
  console.log('✓ Server correctly shows as not initialized')

  // Initialize server
  await server.initialize({
    name: 'Test Server',
    description: 'A server for testing'
  })
  console.log('✓ Server initialized')

  // Verify server info
  const serverInfo = await server.getServerInfo()
  assert(serverInfo, 'Server info should exist')
  assert.equal(serverInfo.name, 'Test Server')
  assert.equal(serverInfo.description, 'A server for testing')
  console.log('✓ Server info verified')

  await server.close()
  console.log('✓ Server closed successfully')
}

async function testChannelOperations() {
  console.log('\n--- Testing Channel Operations ---')
  
  const storePath = path.join(TEST_DIR, 'server2')
  const store = new Corestore(storePath)
  await store.ready()

  const server = new SyncBase(store, {
    replicate: false,
    seedPhrase: 'test seed phrase for channels'
  })

  await server.ready()
  await server.initialize({ name: 'Channel Test Server' })

  // Create a channel
  const channel = await server.channels.createChannel({
    name: 'general',
    type: 'TEXT',
    topic: 'General discussions'
  })
  assert(channel.id, 'Channel should have an ID')
  console.log('✓ Channel created')

  // List channels
  const channels = await server.channels.getChannels()
  assert.equal(channels.length, 1, 'Should have one channel')
  console.log('✓ Channels listed')

  // Update channel
  const updatedChannel = await server.channels.updateChannel({
    channelId: channel.id,
    name: 'general-chat',
    topic: 'Updated topic'
  })
  assert.equal(updatedChannel.name, 'general-chat')
  console.log('✓ Channel updated')

  await server.close()
  console.log('✓ Server closed successfully')
}

async function testMessageOperations() {
  console.log('\n--- Testing Message Operations ---')
  
  const storePath = path.join(TEST_DIR, 'server3')
  const store = new Corestore(storePath)
  await store.ready()

  const server = new SyncBase(store, {
    replicate: false,
    seedPhrase: 'test seed phrase for messages'
  })

  await server.ready()
  await server.initialize({ name: 'Message Test Server' })

  // Create a channel
  const channel = await server.channels.createChannel({
    name: 'general',
    type: 'TEXT'
  })

  // Send a message
  const message = await server.messages.sendMessage({
    channelId: channel.id,
    content: 'Hello, world!'
  })
  assert(message.id, 'Message should have an ID')
  console.log('✓ Message sent')

  // Get messages
  const messages = await server.messages.getMessages({ channelId: channel.id })
  assert.equal(messages.length, 1, 'Should have one message')
  console.log('✓ Messages retrieved')

  await server.close()
  console.log('✓ Server closed successfully')
}

async function testServerReplication() {
  console.log('\n--- Testing Server Replication ---')
  
  // Create two servers
  const storePath1 = path.join(TEST_DIR, 'replication-server1')
  const storePath2 = path.join(TEST_DIR, 'replication-server2')
  
  const store1 = new Corestore(storePath1)
  const store2 = new Corestore(storePath2)
  
  await store1.ready()
  await store2.ready()

  const server1 = new SyncBase(store1, {
    replicate: true,
    seedPhrase: 'test seed phrase for server 1'
  })

  const server2 = new SyncBase(store2, {
    replicate: true,
    seedPhrase: 'test seed phrase for server 2'
  })

  await server1.ready()
  await server2.ready()

  await server1.initialize({ name: 'Server 1' })
  await server2.initialize({ name: 'Server 2' })

  // Create a channel on server 1
  const channel = await server1.channels.createChannel({
    name: 'shared',
    type: 'TEXT'
  })

  // Send a message on server 1
  await server1.messages.sendMessage({
    channelId: channel.id,
    content: 'Message from server 1'
  })

  // Wait for replication
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Verify message appears on server 2
  const messages = await server2.messages.getMessages({ channelId: channel.id })
  assert(messages.length > 0, 'Message should be replicated')
  console.log('✓ Message replicated between servers')

  await server1.close()
  await server2.close()
  console.log('✓ Servers closed successfully')
}

// Run the tests
runTests().catch(console.error) 