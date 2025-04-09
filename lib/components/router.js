const { Router, dispatch } = require('./spec/hyperdispatch')
const b4a = require('b4a')
const z32 = require('z32')
class SyncBaseRouter {
  constructor(syncBase, validator) {
    this.syncBase = syncBase
    this.validator = validator
    this.router = new Router()
    this.dispatch = dispatch

    // Server Operations
    this.router.add('@server/create-server', async (data, context) => {
      const { view } = context
      // Check if server already exists
      const server = await view.findOne('@server/server', {})
      if (server) {
        console.warn('Server already exists')
        return true
      }

      const stringifyPubKey = b4a.toString(context.signer, 'hex')
      if (!stringifyPubKey || !data || !data.id || !data.name) {
        console.warn('Invalid server data or signer pub key')
        return false
      }

      try {
        const server = {
          id: data.id,
          name: data.name,
          createdAt: data?.createdAt.toString() || Date.now().toString(),
          description: data?.description || '',
          avatar: data?.avatar || ''
        }
        await view.insert('@server/server', server)
        await view.flush()
      } catch (error) {
        console.error('Error creating server:', error)
        return false
      }

      try {
        const adminUser = {
          id: stringifyPubKey,
          publicKey: stringifyPubKey,
          username: "User",
          joinedAt: Date.now(),
          inviteCode: "founder",
          avatar: "1",
          status: "Chilling"
        }
        await view.insert('@server/user', adminUser)
        await view.flush()
      } catch (error) {
        console.error('Error creating init user:', error)
        return false
      }

      try {
        const role = {
          userId: stringifyPubKey, serverId: data.id, updatedBy: stringifyPubKey, updatedAt: Date.now(), role: "OWNER"
        }
        await view.insert('@server/role', role)
        await view.flush()
      } catch (error) {
        console.error('Error creating init role:', error)
        return false
      }
      return true
    })

    this.router.add('@server/update-server', async (data, context) => {
      const { view } = context
      const existing = await view.findOne('@server/server', { id: data.id })
      try {
        await view.delete('@server/server', { key: data.id })
        await view.insert('@server/server', {
          ...existing,
          id: data.id,
          name: data.name || "A chat server",
          description: data.description || "",
          avatar: data.avatar || ""
        })
        await view.flush()
        return true
      } catch (error) {
        console.log(error)
      }
    })

    // Channel Operations
    this.router.add('@server/create-channel', async (data, context) => {
      const { view } = context
      const newChannel = {
        id: data.id,
        channelId: data.channelId,
        name: data.name,
        type: data.type,
        createdAt: data.createdAt,
        createdBy: data.createdBy,
        description: data.description || '',
        position: data.position
      }
      // Check if the channel ID is already taken
      // const existingChannelById = await this.syncBase.channels.getChannel(data.channelId)

      // if (existingChannelById?.channelId == data.channelId) {
      //   console.log('Channel with same id exists')
      //   return false
      // }

      // Check if the channel name is already taken in this server
      const existingChannelByName = await view.get('@server/channel', {
        name: data.name,
      })

      if (existingChannelByName?.name == data.name) {
        console.log('exists with name')
        return false
      }


      try {
        await view.insert('@server/channel', newChannel)
        await view.flush()
        return true
      } catch (error) {
        console.log(error)
      }
    })

    this.router.add('@server/update-channel', async (data, context) => {
      const { view } = context
      await view.delete('@server/channel', { channelId: data.channelId })
      await view.insert('@server/channel', {
        ...data,
        updatedAt: data.timestamp
      })
      await view.flush()
    })

    this.router.add('@server/delete-channel', async (data, context) => {
      const { view } = context
      await view.delete('@server/channel', { channelId: data.channelId })
      await view.flush()
    })

    // Message Operations
    this.router.add('@server/send-message', async (data, context) => {
      const { view } = context
      // const channel = await this.syncBase.channels.getChannel(data.channelId)
      // if (!channel) {
      //   console.log(channel, 'NO CHANNEL')
      //   return false
      // }
      await view.insert('@server/message', {
        id: data.id,
        channelId: data.channelId,
        content: data.content,
        author: data.author,
        timestamp: data.timestamp,
        attachments: data.attachments || []
      })
      await view.flush()

    })

    this.router.add('@server/edit-message', async (data, context) => {
      const { view } = context
      await view.delete({ id: data.id, channelId: data.channelId })
      await view.insert('@server/message', data)
      await view.flush()

    })

    this.router.add('@server/delete-message', async (data, context) => {
      const { view } = context
      await view.delete('@server/message', { id: data.id, channelId: data.channelId })
      await view.flush()

    })


    this.router.add('@server/create-user', async (data, context) => {
      const { view } = context
      const newUser = {
        id: data.publicKey,
        publicKey: data.publicKey,
        username: "User",
        joinedAt: Date.now(),
        inviteCode: data.inviteCode,
        avatar: "1",
        status: "Chilling"
      }
      await view.insert('@server/user', newUser)
      await view.flush()
    })

    // Role Operations
    this.router.add('@server/set-role', async (data, context) => {
      const { view } = context
      try {
        // First try to find and delete any existing record
        await view.delete('@server/role', {
          userId: data.userId,
        })
        await view.flush()
      } catch (err) {
        // Ignore errors if record doesn't exist
        console.log('No existing role record to delete, proceeding with insert')
      }
      // Insert new record
      await view.insert('@server/role', {
        userId: data.userId,
        serverId: data.serverId,
        role: data.role,
        updatedAt: data.timestamp || Date.now(),
        updatedBy: data.id || 'system'
      })
      await view.flush()
    })

    // Invite Operations
    this.router.add('@server/create-invite', async (data, context) => {
      const { view } = context
      await view.insert('@server/invite', data)
      await view.flush()
    })

    this.router.add('@server/claim-invite', async (data, context) => {
      const { view } = context
      await view.insert('@server/user', {
        id: data.userId,
        publicKey: data.publicKey,
        joinedAt: data.timestamp,
        inviteCode: data.inviteCode
      })
      console.log('Added user')
      await view.insert('@server/role', {
        userId: data.userId,
        role: 'MEMBER',
        serverId: data.id,
        updatedBy: data.userId, updatedAt: Date.now()
      })
      console.log('Added member role')
      await view.flush()
    })

    // Revoke invite operation
    this.router.add('@server/revoke-invite', async (data, context) => {
      const { view } = context

      // Find the invite to revoke
      const invite = await view.findOne('@server/invite', { code: data.code })

      if (invite) {
        // Mark invite as revoked or delete it
        // Option 1: Delete the invite
        await view.delete('@server/invite', { code: data.code })
        await view.flush()
      }
    })
  }
}

module.exports = SyncBaseRouter
