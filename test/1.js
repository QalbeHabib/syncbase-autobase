const Corestore = require('corestore')
const SyncBase = require('../lib/syncbase.js')

async function main() {
  // Run this before starting the application:
  // node ServerSchema.js

  console.log('Starting server example...')

  // 1. Creating a new server
  console.log('\n--- Creating a new server ---')

  // Create a corestore for storage
  const store1 = new Corestore('./store')
  await store1.ready()

  // Create a seed phrase for key derivation (in production, this would be securely stored)
  const seedPhrase = 'example seed phrase for demonstration purposes only'

  // Create a new SyncBase instance (server owner)
  const server = new SyncBase(store1, {
    seedPhrase,
    replicate: true
  })

  // Wait for the server to be ready
  await server.ready()
  console.log('Server created with key:', server.key.toString('hex'))
  console.log('Writer key:', server.writerKey.toString('hex'))

  // 2. Create a channel
  console.log('\n--- Creating channels ---')

  // Get server info (this is the default server created during initialization)
  const servers = await server.channels.getServers()
  const mainServer = servers[0]
  console.log('Default server:', mainServer)

  // Create a general channel
  const generalChannel = await server.channels.createChannel({
    serverId: mainServer.id,
    name: 'general',
    type: 'TEXT'
  })
  console.log('Created general channel:', generalChannel)

  // Create an announcements channel
  const announcementsChannel = await server.channels.createChannel({
    serverId: mainServer.id,
    name: 'announcements',
    type: 'TEXT'
  })
  console.log('Created announcements channel:', announcementsChannel)

  // List all channels
  const channels = await server.channels.getChannels(mainServer.id)
  console.log('All channels:', channels)

  // 3. Create invite
  console.log('\n--- Creating an invite ---')

  // Create an invite that expires in 1 day
  const inviteCode = await server.invites.createInvite({
    serverId: mainServer.id,
    expireInDays: 1
  })
  console.log('Created invite code:', inviteCode)

  // 4. Someone joins using the invite
  console.log('\n--- Joining with invite ---')

  // Create a second corestore for the joining user
  const store2 = new Corestore('./store2')
  await store2.ready()

  // The joining user's seed phrase
  const userSeedPhrase = 'another seed phrase for the joining user'

  // Create a pairer to join the server
  const pairer = SyncBase.pair(store2, inviteCode, {
    seedPhrase: userSeedPhrase
  })

  // Wait for pairing to complete
  const joinedServer = await pairer.finished()
  console.log('Joined server with key:', joinedServer.key.toString('hex'))
  console.log('New member writer key:', joinedServer.writerKey.toString('hex'))

  // 5. Server owner assigns a role to the new member
  console.log('\n--- Assigning roles ---')

  // Get the new member's user ID (hex string of their public key)
  const newMemberId = joinedServer.writerKey.toString('hex')

  // Set the role to MODERATOR
  await server.permissions.setRole({
    userId: newMemberId,
    serverId: mainServer.id,
    role: 'MODERATOR'
  })
  console.log('Set role for new member to MODERATOR')

  // 6. New member sends a message
  console.log('\n--- Sending messages ---')

  // Get the general channel
  const generalChannelInfo = await joinedServer.channels.getChannel(generalChannel.id)

  // Send a message
  const message = await joinedServer.messages.sendMessage({
    channelId: generalChannelInfo.id,
    content: 'Hello everyone! I just joined the server.'
  })
  console.log('Sent message:', message)

  // 7. Reading messages
  console.log('\n--- Reading messages ---')

  // Get messages from the channel
  await new Promise(resolve => setTimeout(resolve, 500)) // Small delay to ensure replication

  const messages = await server.messages.getMessages({
    channelId: generalChannel.id
  })
  console.log('Messages in general channel:', messages)

  // 8. Server owner sends a welcome message
  const welcomeMessage = await server.messages.sendMessage({
    channelId: generalChannel.id,
    content: 'Welcome to the server! Feel free to introduce yourself.'
  })
  console.log('Sent welcome message:', welcomeMessage)

  // Wait for replication
  await new Promise(resolve => setTimeout(resolve, 500))

  // 9. New member checks messages again
  console.log('\n--- Updated messages ---')

  const updatedMessages = await joinedServer.messages.getMessages({
    channelId: generalChannel.id
  })
  console.log('Updated messages in general channel:', updatedMessages)

  // 10. Check roles directly from the database
  console.log('\n--- Checking roles in database ---')

  const roles = await server.base.view.roles.find({
    serverId: mainServer.id
  })
  console.log('Roles in database:', roles)

  // Close both instances
  await server.close()
  await joinedServer.close()

  console.log('\nExample completed successfully!')
}

main().catch(err => {
  console.error('Error in example:', err)
  process.exit(1)
})
