const { Router, dispatch } = require('./spec/hyperdispatch')
const b4a = require('b4a')
class SyncBaseRouter {
  constructor(syncBase, validator) {
    this.syncBase = syncBase
    this.validator = validator
    this.router = new Router()
    this.dispatch = dispatch

    // Server Operations
    this.router.add('@server/create-server', async (data, context) => {
      const { view } = context
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
      } catch (error) {
        console.error('Error creating init user:', error)
        return false
      }

      try {
        const role = {
          userId: stringifyPubKey, serverId: data.id, updatedBy: stringifyPubKey, updatedAt: Date.now(), role: "OWNER"
        }
        await view.insert('@server/role', role)
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
      try {
        await view.insert('@server/channel', newChannel)
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
    })

    this.router.add('@server/delete-channel', async (data, context) => {
      const { view } = context
      await view.delete('@server/channel', { channelId: data.channelId })
    })

    // Message Operations
    this.router.add('@server/send-message', async (data, context) => {
      const { view } = context
      await view.insert('@server/message', {
        id: data.id,
        channelId: data.channelId,
        content: data.content,
        author: data.author,
        timestamp: data.timestamp,
        attachments: data.attachments || []
      })
    })

    this.router.add('@server/edit-message', async (data, context) => {
      const { view } = context
      await view.delete({id: data.id})
      await view.insert('@server/message', data)
    })

    this.router.add('@server/delete-message', async (data, context) => {
      const { view } = context
      await view.delete('@server/message', {id: data.id})
    })

    // Role Operations
    this.router.add('@server/set-role', async (data, context) => {
      const { view } = context
      try {
        // First try to find and delete any existing record
        await view.delete('@server/role', {
          userId: data.userId,
          serverId: data.serverId,
          role: data.role
        })
      } catch (err) {
        // Ignore errors if record doesn't exist
        console.log('No existing role record to delete, proceeding with insert')
      }

      // Insert new record
      await view.insert('@server/role', {
        userId: data.userId,
        serverId: data.serverId,
        role: data.role,
        updatedAt: data.timestamp,
        updatedBy: data.updatedBy
      })
    })

    // Invite Operations
    this.router.add('@server/create-invite', async (data, context) => {
      const { view } = context
      await view.insert('@server/invite', {
        id: data.id,
        code: data.code,
        serverId: data.serverId,
        createdBy: data.createdBy,
        createdAt: data.createdAt,
        expiresAt: data.expiresAt
      })
    })

    this.router.add('@server/claim-invite', async (data, context) => {
      const { view } = context
      await view.insert('@server/user', {
        id: data.userId,
        publicKey: data.publicKey,
        joinedAt: data.timestamp,
        inviteCode: data.inviteCode
      })
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
      }
    })
  }
}

module.exports = SyncBaseRouter
