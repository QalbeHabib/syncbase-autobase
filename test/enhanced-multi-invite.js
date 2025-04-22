const assert = require("assert");
const Corestore = require("corestore");
const path = require("path");
const fs = require("fs");
const rimraf = require("rimraf");
const b4a = require("b4a");
const SyncBase = require("../lib/syncbase");

// Test directory setup
const TEST_DIR = path.join("./cores", "enhanced-multi-invite-" + Date.now());
console.log(`Test directory: ${TEST_DIR}`);
fs.mkdirSync(TEST_DIR, { recursive: true });

// Number of users to test
const NUM_USERS = 6; // Host + 5 joiners

// Cleanup function to run after tests
function cleanup() {
  console.log(`Cleaning up test directory: ${TEST_DIR}`);
  try {
    rimraf.sync(TEST_DIR);
    console.log("Cleanup complete");
  } catch (err) {
    console.error("Error during cleanup:", err);
  }
}

// Helper sleep function
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wrap the main test logic in a function
async function runTest(isOptimistic) {
  console.log(`\n=== RUNNING TEST WITH OPTIMISTIC = ${isOptimistic} ===\n`);

  // Test directory setup specific to this run
  const TEST_DIR_RUN = path.join(TEST_DIR, `optimistic-${isOptimistic}`);
  console.log(`Test directory for this run: ${TEST_DIR_RUN}`);
  fs.mkdirSync(TEST_DIR_RUN, { recursive: true });

  const servers = [];
  let inviteCode;
  let testChannelId;

  try {
    // Create and setup the host server (user 1)
    console.log("\n--- Setting up host server (User 1) ---");
    const hostStorePath = path.join(TEST_DIR_RUN, "host-server");
    const hostStore = new Corestore(hostStorePath);
    await hostStore.ready();

    const hostServer = new SyncBase(hostStore, {
      seedPhrase: "test seed phrase for host server",
      replicate: true,
      optimistic: isOptimistic, // Pass the optimistic setting
    });

    await hostServer.ready();
    console.log("✓ Host server ready");

    // Initialize server
    await hostServer.initialize({
      name: "Enhanced Multi-User Invite Test Server",
      description: "Server for testing multiple users joining with one invite",
    });
    console.log("✓ Host server initialized");

    // Create a test channel
    console.log("Creating test channel...");
    const channel = await hostServer.channels.createChannel({
      name: "multi-invite-test-channel",
      type: "TEXT",
      topic: "Testing multi-user invite joining",
    });
    testChannelId = channel.channelId;
    console.log(`✓ Created channel with ID: ${testChannelId}`);

    // Send an initial message from the host
    const initialMessage = await hostServer.messages.sendMessage({
      channelId: testChannelId,
      content: "Welcome to the enhanced multi-user invite test!",
    });
    console.log(`✓ Host sent initial message with ID: ${initialMessage.id}`);

    // Store the host server
    servers.push({
      server: hostServer,
      userNum: 1,
      role: "host",
      messages: [], // Track messages sent by this user
      messagesSeen: {}, // Track which messages this user can see
    });

    // Force update to ensure initial data is ready
    await hostServer.base.update();
    await sleep(2000);

    // Create a single invite that will be used by all other users
    console.log("\n--- Creating shared invite code ---");
    inviteCode = await hostServer.invites.createInvite({
      expireInDays: 1,
      maxUses: 0, // 0 means unlimited uses
    });
    console.log(`✓ Created shared invite: ${inviteCode.substring(0, 30)}...`);

    // Force update again
    await hostServer.base.update();
    await sleep(2000);

    // Join process for users 2 through NUM_USERS
    for (let i = 2; i <= NUM_USERS; i++) {
      console.log(
        `\n--- Setting up User ${i} (Joining with shared invite) ---`
      );

      const userStorePath = path.join(TEST_DIR_RUN, `user${i}-server`);
      const userStore = new Corestore(userStorePath);
      await userStore.ready();

      let joinSuccess = false;
      let joinAttempts = 0;
      const maxAttempts = 3;
      let userServer = null;

      while (!joinSuccess && joinAttempts < maxAttempts) {
        joinAttempts++;
        console.log(
          `Join attempt ${joinAttempts}/${maxAttempts} for User ${i}`
        );

        try {
          console.log(`User ${i} joining with shared invite...`);
          const userPairer = SyncBase.pair(userStore, inviteCode, {
            seedPhrase: `test seed phrase for user ${i}`,
            timeout: 30000, // 30 second timeout
            optimistic: isOptimistic, // Pass the optimistic setting
          });

          console.log(`Waiting for User ${i} pairing to complete...`);
          userServer = await userPairer.finished();
          console.log(`✓ User ${i} pairing completed`);
          joinSuccess = true;
        } catch (pairErr) {
          console.error(
            `× Error: User ${i} pairing attempt ${joinAttempts} failed:`,
            pairErr.message
          );

          if (joinAttempts < maxAttempts) {
            // Wait longer between each retry
            const waitTime = joinAttempts * 2000;
            console.log(`Waiting ${waitTime / 1000} seconds before retry...`);
            await sleep(waitTime);
          }
        }
      }

      if (!joinSuccess) {
        console.error(
          `× Failed to join User ${i} after ${maxAttempts} attempts.`
        );
        continue; // Skip to next user
      }

      // Store the successfully joined server
      servers.push({
        server: userServer,
        userNum: i,
        role: "joiner",
        messages: [], // Track messages sent by this user
        messagesSeen: {}, // Track which messages this user can see
      });

      // Wait for sync
      await sleep(2000);

      // Check if user can see the channel
      try {
        console.log(`Checking if User ${i} can see the channel...`);
        const userChannels = await userServer.channels.getChannels();

        if (userChannels && userChannels.length > 0) {
          console.log(`✓ User ${i} can see ${userChannels.length} channel(s)`);

          const testChannel = userChannels.find(
            (c) => c.channelId === testChannelId
          );

          if (testChannel) {
            console.log(`✓ User ${i} can see the test channel`);

            // Try to send a message from this user
            try {
              const userMessage = await userServer.messages.sendMessage({
                channelId: testChannelId,
                content: `Hello from User ${i}! I joined with the shared invite code.`,
              });

              console.log(
                `✓ User ${i} sent message with ID: ${userMessage.id}`
              );

              // Track this message
              servers[i - 1].messages.push({
                id: userMessage.id,
                content: userMessage.content,
                author: userMessage.author,
              });
            } catch (sendErr) {
              console.error(
                `× Error: User ${i} failed to send message:`,
                sendErr.message
              );
            }
          } else {
            console.log(`× User ${i} cannot see the test channel`);
          }
        } else {
          console.log(`× User ${i} cannot see any channels`);
        }
      } catch (checkErr) {
        console.error(
          `× Error checking channels for User ${i}:`,
          checkErr.message
        );
      }

      // Wait before adding the next user to avoid network congestion
      await sleep(3000);
    }

    // Now have all users send a second message
    console.log("\n--- Having all users send a second message ---");
    for (let i = 0; i < servers.length; i++) {
      const { server, userNum } = servers[i];

      try {
        const secondMessage = await server.messages.sendMessage({
          channelId: testChannelId,
          content: `This is a second message from User ${userNum}!`,
        });

        console.log(
          `✓ User ${userNum} sent second message with ID: ${secondMessage.id}`
        );

        // Track this message
        servers[i].messages.push({
          id: secondMessage.id,
          content: secondMessage.content,
          author: secondMessage.author,
        });

        // Wait a bit before next message to avoid conflicts
        await sleep(500);
      } catch (err) {
        console.error(
          `× User ${userNum} failed to send second message: ${err.message}`
        );
      }
    }

    // Wait for all messages to sync
    console.log("\n--- Waiting for messages to sync across all users ---");
    await sleep(10000);

    // Final verification - check if all users can see all messages
    console.log("\n--- Final Message Verification ---");

    // Count total messages sent
    let totalMessagesSent = 0;
    servers.forEach((user) => {
      totalMessagesSent += user.messages.length;
    });

    console.log(`Total messages sent across all users: ${totalMessagesSent}`);

    // Check message visibility for all users
    let successCount = 0;
    const messageVisibilityMatrix = {};

    for (const { server, userNum } of servers) {
      try {
        const userChannels = await server.channels.getChannels();
        const testChannel = userChannels.find(
          (c) => c.channelId === testChannelId
        );

        if (testChannel) {
          const messages = await server.messages.getMessages({
            channelId: testChannelId,
          });

          console.log(`User ${userNum} can see ${messages.length} messages`);

          // Detailed message visibility tracking
          messageVisibilityMatrix[userNum] = messages.length;

          // Check which authors' messages this user can see
          const messageAuthors = new Set();
          const authorMessageCounts = {};

          for (const msg of messages) {
            messageAuthors.add(msg.author);

            // Count messages per author
            if (!authorMessageCounts[msg.author]) {
              authorMessageCounts[msg.author] = 1;
            } else {
              authorMessageCounts[msg.author]++;
            }
          }

          // Log message counts by author
          for (const [author, count] of Object.entries(authorMessageCounts)) {
            const authorUserNum =
              servers.findIndex((s) => {
                const authorId = b4a.toString(s.server.crypto.publicKey, "hex");
                return authorId === author;
              }) + 1;

            if (authorUserNum > 0) {
              console.log(
                `  - User ${userNum} sees ${count} messages from User ${authorUserNum}`
              );
            } else {
              console.log(
                `  - User ${userNum} sees ${count} messages from unknown author ${author.substring(
                  0,
                  8
                )}...`
              );
            }
          }

          console.log(
            `User ${userNum} can see messages from ${messageAuthors.size} different authors`
          );

          if (messages.length > 0) {
            successCount++;
          }
        }
      } catch (checkErr) {
        console.error(
          `× Error checking messages for User ${userNum}:`,
          checkErr.message
        );
      }
    }

    console.log("\n--- Message Visibility Summary ---");
    for (const [userNum, messageCount] of Object.entries(
      messageVisibilityMatrix
    )) {
      const percentSeen = ((messageCount / totalMessagesSent) * 100).toFixed(1);
      console.log(
        `User ${userNum} sees ${messageCount}/${totalMessagesSent} messages (${percentSeen}%)`
      );
    }

    console.log(
      `\n${successCount} out of ${servers.length} users can see messages.`
    );

    // Close all servers
    console.log("\n--- Closing all servers ---");

    for (const { server, userNum } of servers) {
      try {
        await server.close();
        console.log(`✓ Closed server for User ${userNum}`);
      } catch (closeErr) {
        console.error(
          `× Error closing server for User ${userNum}:`,
          closeErr.message
        );
      }
    }

    console.log(
      `\n✅ Multi-user invite test complete for optimistic=${isOptimistic} with ${servers.length} users!`
    );
    return servers.length >= 2; // Success if at least 2 users joined
  } catch (error) {
    console.error(`\n❌ Test failed for optimistic=${isOptimistic}:`, error);
    throw error; // Re-throw to indicate failure
  } finally {
    // Cleanup specific to this run (optional, could cleanup at the end)
    // cleanup(TEST_DIR_RUN);
  }
}

// Main execution block
async function main() {
  let successOptimistic = false;
  let successNonOptimistic = false;

  try {
    successOptimistic = await runTest(true);
  } catch (err) {
    console.error("Error during optimistic=true run");
  }

  console.log("\n".repeat(3)); // Add spacing between runs

  try {
    successNonOptimistic = await runTest(false);
  } catch (err) {
    console.error("Error during optimistic=false run");
  }

  // Final Cleanup
  cleanup();

  console.log("\n--- OVERALL TEST SUMMARY ---");
  console.log(`Optimistic=true run ${successOptimistic ? "PASSED" : "FAILED"}`);
  console.log(
    `Optimistic=false run ${successNonOptimistic ? "PASSED" : "FAILED"}`
  );

  if (successOptimistic && successNonOptimistic) {
    console.log("\nBoth test runs completed successfully!");
    process.exit(0);
  } else {
    console.error("\nOne or more test runs failed.");
    process.exit(1);
  }
}

// Run the main function
main();
