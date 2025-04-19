# Autobase Synchronization Fix

## Overview

This update fixes critical synchronization issues in our distributed chat application that uses Autobase in optimistic mode. The primary issues addressed were:

- Messages not syncing between clients after initial connection
- "Channel already exists" errors during replication
- Operations failing during database synchronization due to out-of-order processing

## Technical Background

Our application uses Autobase with optimistic mode enabled (`optimistic: true`). Autobase creates a distributed append-only log with causal relationships between operations. When operating in optimistic mode, Autobase may reorder operations as new causal information becomes available, which requires defensive programming techniques.

From the Autobase documentation:

> "As new causal information comes in, existing nodes may be reordered when causal forks occur. Any changes to the view will be undone and reapplied on top of the new ordering."

## Changes Made

### 1. Defensive Apply Function

The `_apply` function in `lib/syncbase.js` has been modified to:

- Categorize operations by type (server, channel, message, other)
- Process operations in order of dependencies
- Wrap each operation in try/catch blocks to prevent cascading failures
- Skip operations that would cause errors rather than failing
- Continue processing even if individual operations fail
- Provide better error logging

```javascript
async _apply(nodes, view, host) {
  // More defensive approach to be tolerant of reordering during sync
  const serverOps = [];
  const channelOps = [];
  const messageOps = [];
  const otherOps = [];

  // Categorize operations
  for await (const node of nodes) {
    const type = node.value.type;
    if (type === "@server/create-server" || type === "@server/update-server") {
      serverOps.push(node);
    } else if (type.includes("channel")) {
      channelOps.push(node);
    } else if (type.includes("message")) {
      messageOps.push(node);
    } else {
      otherOps.push(node);
    }
  }

  // Process server operations first (defensive)
  for (const node of serverOps) {
    // Process with try/catch
    // ...
  }

  // Process channel operations next
  // ...

  // Process message operations last
  // ...
}
```

### 2. Channel Creation Improvements

For channel creation operations, we now check if the channel already exists before attempting to create it:

```javascript
// Special handling for channel creation - check if channel already exists
if (node.value.type === "@server/create-channel") {
  const existingChannel = await view.get("@server/channel", {
    channelId: node.value.payload.channelId
  });

  if (existingChannel) {
    console.log(`Channel ${node.value.payload.channelId} already exists - skipping create operation`);
    this.processedActions.add(actionId);
    continue; // Skip this operation
  }
}
```

### 3. Router Handler Enhancements

The router handlers in `lib/components/router.js` have been improved to:

- Treat duplicate channel creation as a success case rather than an error
- Check for existing channels by both ID and name
- Verify channel existence before inserting messages
- Handle errors gracefully with proper logging
- Return appropriate success/failure values

```javascript
// Channel creation handler now more tolerant of duplicates
this.router.add("@server/create-channel", async (data, context) => {
  const { view } = context;

  // First check if channel already exists by channelId
  const existingChannelById = await view.get("@server/channel", {
    channelId: data.channelId,
  });

  if (existingChannelById?.channelId === data.channelId) {
    console.log(
      `Channel with id ${data.channelId} already exists - skipping creation`
    );
    return true; // Not an error, just skip
  }

  // Rest of handler
  // ...
});

// Message sending now verifies channel exists
this.router.add("@server/send-message", async (data, context) => {
  const { view } = context;

  try {
    // Check if channel exists before inserting message
    const channel = await view.get("@server/channel", {
      channelId: data.channelId,
    });

    if (!channel) {
      console.log(
        `Cannot send message: Channel ${data.channelId} does not exist`
      );
      return false;
    }

    // Insert message
    // ...
  } catch (error) {
    console.error("Error sending message:", error.message);
    return false;
  }
});
```

## Updates to Previous Fixes

This update introduces additional improvements to address two specific issues:

1. **Bi-directional sync issue**: Fixed a problem where messages would only synchronize in one direction (User 1 → User 2, but not User 2 → User 1).

2. **High-volume message handling**: Improved performance and reliability when handling many messages at once, preventing desynchronization during high-volume operations.

### Improved Changes

#### 1. Proper Writer Authorization

The underlying issue with one-way syncing was related to writer permissions not being correctly propagated between peers. The fix:

- Implemented automatic writer acknowledgment in the `_apply` function
- Enhanced the message handler to ensure senders are added as writers
- Improved the invite handling process to verify writer permissions

```javascript
// Automatic writer acknowledgment in _apply
if (node.from?.key && !b4a.equals(node.from.key, this.base.local.key)) {
  try {
    // Check if this writer is already acknowledged
    const isWriter = this.base.writers.some(
      (w) => w.key && b4a.equals(w.key, node.from.key)
    );

    if (!isWriter) {
      console.log(
        `Auto-acknowledging writer: ${b4a.toString(node.from.key, "hex")}`
      );
      await host.addWriter(node.from.key, { indexer: true });
      await host.ackWriter(node.from.key);
    }
  } catch (err) {
    console.warn(`Error acknowledging writer: ${err.message}`);
  }
}
```

#### 2. Batch Processing and Linearization

For high-volume message handling:

- Added operation batching to prevent overwhelming the system
- Implemented intermediate flush operations between batches
- Added forced linearization after high-volume operations
- Improved error handling to continue processing despite individual failures

```javascript
// Batch processing with intermediate flushes
currentBatch++;
if (currentBatch >= MAX_BATCH_SIZE) {
  await view.flush();
  await sleep(10); // Small pause between batches
  currentBatch = 0;
}

// Force update after high-volume operations
if (processedInThisRun.size > 5) {
  await this.base.update();
}
```

#### 3. Enhanced Pairing Process

Improved the pairing process to be more reliable:

- Added configurable timeouts and retries
- Improved error handling during the pairing process
- Implemented fallback resolution for problematic connections

## Developer Guidelines

When working with Autobase in optimistic mode, follow these guidelines:

1. **Make operations idempotent**: Operations should be safely repeatable without side effects.

2. **Use defensive checks**: Always check database state before performing operations.

3. **Handle errors gracefully**: Catch and log errors but allow processing to continue.

4. **Follow causality**: Process operations in causal order when possible.

5. **Tolerate reordering**: Expect operations to be reordered and be prepared to handle it.

6. **Implement proper duplicate detection**: Avoid processing the same operation multiple times.

## Testing

The fixes have been verified with expanded tests that specifically check bidirectional message flow and high-volume scenarios.

To run the tests:

```
node test/2.js
```

These tests ensure that:

- Messages sent from User 2 arrive at User 1 (previously failing)
- Rapid message sending does not cause desynchronization
- The system properly recovers from connection issues

## Conclusion

These improvements make the system significantly more reliable in real-world usage patterns, ensuring consistent bidirectional synchronization even during high message volumes or network issues.

## Multi-User Synchronization

The system now supports robust synchronization between multiple users (three or more) using two distinct connection methods:

### 1. Invite-Based Pairing

The primary method for users to join a server is through the invite system:

- Server owner creates an invite code with `createInvite()`
- The invite code is shared with the user who wants to join
- New user connects using `SyncBase.pair(store, inviteCode, options)`
- Pairing process uses BlindPairing to securely share encryption keys
- New user is automatically granted MEMBER role in the server

```javascript
// Server owner creates an invite
const inviteCode = await server.createInvite({ expireInMinutes: 30 });

// New user joins using the invite
const pairer = SyncBase.pair(store, inviteCode, { seedPhrase: "user-seed" });
const joinedServer = await pairer.finished();
```

### 2. Direct Connection Method

For advanced use cases, users can join directly if they already have the server keys:

```javascript
// Direct connection using known server keys
const directServer = new SyncBase(store, {
  seedPhrase: "user-seed",
  replicate: true,
  key: existingServerKey, // The server's public key
  encryptionKey: serverEncryptionKey, // The server's encryption key
});
```

This method bypasses the invite process but requires secure off-band sharing of the server keys. It's useful for:

- System administration and maintenance
- Recovering access to existing servers
- Specialized deployment scenarios

### Implementation Details

The connection reliability improvements include:

1. **Enhanced Pairing Process**:

   - Configurable timeouts and automatic retries
   - Improved error handling with detailed logging
   - Fallback mechanisms to ensure successful connections

2. **Writer Authorization**:

   - Automatic writer acknowledgment during message handling
   - Proper permission propagation across the network
   - Ensures all users can contribute to the server

3. **Multi-Directional Synchronization**:
   - Messages flow correctly between all connected users
   - Operations are processed in appropriate dependency order
   - Robust handling of concurrent operations

All users in the network, regardless of how they joined, benefit from the same synchronization improvements and can participate equally in the server activities according to their assigned roles.

### Testing Multi-User Scenarios

The `test/3.js` file provides a comprehensive test of multi-user synchronization:

```
node test/3.js
```

This test demonstrates:

- Server creation and initialization by the first user
- Second user joining via invite code
- Third user joining via direct connection
- Message synchronization between all three users
- Verification that all messages are visible to all users

## References

- [Autobase documentation](https://docs.pears.com/building-blocks/autobase)
- [Autobase NPM package](https://www.npmjs.com/package/autobase)
- [Reordering in Autobase](https://docs.pears.com/building-blocks/autobase#reordering)
