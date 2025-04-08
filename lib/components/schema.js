const Hyperschema = require('hyperschema')
const HyperdbBuilder = require('hyperdb/builder')
const Hyperdispatch = require('hyperdispatch')

// SCHEMA CREATION
const serverSchema = Hyperschema.from('./spec/schema')
const template = serverSchema.namespace('server')

// Register schemas for different entity types
template.register({
  name: 'server',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'name',
    type: 'string',
    required: true
  }, {
    name: 'createdAt',
    type: 'int',
    required: true
  }, {
    name: 'avatar',
    type: 'string',
    required: false
  }, {
    name: 'description',
    type: 'string',
    required: false
  }]
})

template.register({
  name: 'channel',
  compact: false,
  fields: [
    {
      name: 'id',
      type: 'string',
      required: true
    },
    {
      name: 'channelId',
      type: 'string',
      required: true
    }, {
      name: 'name',
      type: 'string',
      required: true
    }, {
      name: 'type',
      type: 'string',
      required: true
    }, {
      name: 'topic',
      type: 'string',
      required: false
    }, {
      name: 'createdBy',
      type: 'string',
      required: true
    }, {
      name: 'createdAt',
      type: 'int',
      required: true
    }, {
      name: 'position',
      type: 'int',
      required: false
    }]
})

template.register({
  name: 'message',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'channelId',
    type: 'string',
    required: true
  }, {
    name: 'author',
    type: 'string',
    required: true
  }, {
    name: 'content',
    type: 'string',
    required: true
  }, {
    name: 'timestamp',
    type: 'int',
    required: true
  }, {
    name: 'editedAt',
    type: 'int',
    required: false
  }, {
    name: 'deletedAt',
    type: 'int',
    required: false
  }, {
    name: 'deletedBy',
    type: 'string',
    required: false
  }, {
    name: 'attachments',
    type: 'string',
    required: false
  }]
})

template.register({
  name: 'user',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'publicKey',
    type: 'string',
    required: true
  }, {
    name: 'username',
    type: 'string',
    required: false
  }, {
    name: 'joinedAt',
    type: 'int',
    required: true
  }, {
    name: 'inviteCode',
    type: 'string',
    required: false
  }, {
    name: 'avatar',
    type: 'string',
    required: false
  }, {
    name: 'status',
    type: 'string',
    required: false
  }]
})

template.register({
  name: 'role',
  compact: false,
  fields: [{
    name: 'userId',
    type: 'string',
    required: true
  }, {
    name: 'serverId',
    type: 'string',
    required: true
  }, {
    name: 'role',
    type: 'string',
    required: true
  }, {
    name: 'updatedAt',
    type: 'int',
    required: false
  }, {
    name: 'updatedBy',
    type: 'string',
    required: false
  }]
})

template.register({
  name: 'invite',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'code',
    type: 'string',
    required: true
  }, {
    name: 'serverId',
    type: 'string',
    required: true
  }, {
    name: 'createdBy',
    type: 'string',
    required: true
  }, {
    name: 'createdAt',
    type: 'int',
    required: true
  }, {
    name: 'expiresAt',
    type: 'int',
    required: false
  }, {
    name: 'uses',
    type: 'int',
    required: false
  }, {
    name: 'maxUses',
    type: 'int',
    required: false
  }]
})

// Write schema definitions to disk
Hyperschema.toDisk(serverSchema)

// DATABASE BUILDER
const dbTemplate = HyperdbBuilder.from('./spec/schema', './spec/db')
const serverDB = dbTemplate.namespace('server')

// Register collections for the database
serverDB.collections.register({
  name: 'server',
  schema: '@server/server',
  key: ['id']
})

serverDB.collections.register({
  name: 'channel',
  schema: '@server/channel',
  key: ['id']
})

serverDB.collections.register({
  name: 'message',
  schema: '@server/message',
  key: ['id']
})

serverDB.collections.register({
  name: 'user',
  schema: '@server/user',
  key: ['id']
})

serverDB.collections.register({
  name: 'role',
  schema: '@server/role',
  key: ['userId', 'serverId']
})

serverDB.collections.register({
  name: 'invite',
  schema: '@server/invite',
  key: ['id']
})

// Write database structure to disk
HyperdbBuilder.toDisk(dbTemplate)

// DISPATCH BUILDER
const hyperdispatch = Hyperdispatch.from('./spec/schema', './spec/hyperdispatch')
const namespace = hyperdispatch.namespace('server')

// Register dispatch actions
namespace.register({
  name: 'create-server',
  requestType: '@server/server'
})

namespace.register({
  name: 'update-server',
  requestType: '@server/server'
})

namespace.register({
  name: 'create-channel',
  requestType: '@server/channel'
})

namespace.register({
  name: 'update-channel',
  requestType: '@server/channel'
})

namespace.register({
  name: 'delete-channel',
  requestType: '@server/channel'
})

namespace.register({
  name: 'send-message',
  requestType: '@server/message'
})

namespace.register({
  name: 'edit-message',
  requestType: '@server/message'
})

namespace.register({
  name: 'delete-message',
  requestType: '@server/message'
})

namespace.register({
  name: 'set-role',
  requestType: '@server/role'
})

namespace.register({
  name: 'create-invite',
  requestType: '@server/invite'
})

namespace.register({
  name: 'claim-invite',
  requestType: '@server/invite'
})


namespace.register({
  name: 'revoke-invite',
  requestType: '@server/invite'
})

// Write dispatch structure to disk
Hyperdispatch.toDisk(hyperdispatch)

console.log('Schema generation completed successfully!')
