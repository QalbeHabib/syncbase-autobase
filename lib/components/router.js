const { Router, dispatch } = require('./spec/hyperdispatch')
const ActionValidator = require('./action-validator.js')

class SyncBaseRouter {
  constructor(syncBase, validator) {
    this.syncBase = syncBase
    this.validator = validator
    this.router = new Router()

    // Server Operations
    this.router.add('@server/create-server', async (data, context) => {
      const { view } = context
      await view.insert('@server/server', {
        id: data.id,
        name: data.name,
        owner: data.owner,
        createdAt: data.createdAt,
        description: data.description || ''
      })
    })

    this.router.add('@server/update-server', async (data, context) => {
      const { view } = context
      await view.update('@server/server', {
        id: data.id,
        name: data.name || "A chat server",
        description: data.description || "",
        updatedAt: data.timestamp
      })
    })

    // Channel Operations
    this.router.add('@server/create-channel', async (data, context) => {
      const { view } = context
      await view.insert('@server/channel', {
        id: data.id,
        serverId: data.serverId,
        name: data.name,
        type: data.type,
        createdAt: data.createdAt,
        createdBy: data.createdBy,
        description: data.description || ''
      })
    })

    this.router.add('@server/update-channel', async (data, context) => {
      const { view } = context
      await view.update('@server/channel', {
        id: data.id,
        name: data.name || undefined,
        topic: data.topic || undefined,
        updatedAt: data.timestamp
      })
    })

    this.router.add('@server/delete-channel', async (data, context) => {
      const { view } = context
      await view.delete('@server/channel', { id: data.id })
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
      await view.update('@server/message', {
        id: data.id,
        content: data.content,
        editedAt: data.timestamp
      })
    })

    this.router.add('@server/delete-message', async (data, context) => {
      const { view } = context
      await view.update('@server/message', {
        id: data.id,
        deletedAt: data.timestamp,
        deletedBy: data.deletedBy
      })
    })

    // Role Operations
    this.router.add('@server/set-role', async (data, context) => {
      const { view } = context
      await view.upsert('@server/role', {
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
      await view.upsert('@server/user', {
        id: data.userId,
        publicKey: data.publicKey,
        joinedAt: data.timestamp,
        inviteCode: data.inviteCode
      })
    })
  }

  async dispatch(payload, context) {
    const action = ActionValidator.ACTION_TYPE_MAP[payload.type]?.trim()
    console.log('DISPATCHING: ', action)
    try {
      return await this.router.dispatch(action, { data: payload.payload, context: this.syncBase })
    } catch (error) {
      console.error('Router dispatch error:', error)
      return false
    }
  }
}

module.exports = SyncBaseRouter
