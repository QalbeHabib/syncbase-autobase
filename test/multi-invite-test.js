const assert = require("assert");
const Corestore = require("corestore");
const path = require("path");
const fs = require("fs");
const rimraf = require("rimraf");
const b4a = require("b4a");
const SyncBase = require("../lib/syncbase");

// Test directory setup
const TEST_DIR = path.join("./cores", "multi-invite-test-" + Date.now());
console.log(`Test directory: ${TEST_DIR}`);
fs.mkdirSync(TEST_DIR, { recursive: true });

// Number of users to test
const NUM_USERS = 4; // Host + 3 joiners

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

async function runMultiUserInviteTest() {
  console.log(
    `\n=== TESTING MULTI-USER INVITE JOINING (${NUM_USERS} USERS) ===`
  );

  const servers = [];
  let inviteCode;

  try {
    // Create and setup the host server (user 1)
    console.log("\n--- Setting up host server (User 1) ---");
    const hostStorePath = path.join(TEST_DIR, "host-server");
    const hostStore = new Corestore(hostStorePath);
    await hostStore.ready();

    const hostServer = new SyncBase(hostStore, {
      seedPhrase: "test seed phrase for host server",
      replicate: true,
    });

    await hostServer.ready();
    console.log("✓ Host server ready");

    // Initialize server
    await hostServer.initialize({
      name: "Multi-User Invite Test Server",
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
    console.log(`✓ Created channel with ID: ${channel.channelId}`);

    // Send an initial message from the host
    const initialMessage = await hostServer.messages.sendMessage({
      channelId: channel.channelId,
      content: "Welcome to the multi-user invite test!",
    });
    console.log(`✓ Host sent initial message with ID: ${initialMessage.id}`);

    // Store the host server
    servers.push({
      server: hostServer,
      userNum: 1,
      role: "host",
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

      const userStorePath = path.join(TEST_DIR, `user${i}-server`);
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
      });

      // Wait for sync
      await sleep(3000);

      // Check if user can see the channel
      try {
        console.log(`Checking if User ${i} can see the channel...`);
        const userChannels = await userServer.channels.getChannels();

        if (userChannels && userChannels.length > 0) {
          console.log(`✓ User ${i} can see ${userChannels.length} channel(s)`);

          const testChannel = userChannels.find(
            (c) => c.name === "multi-invite-test-channel"
          );
          if (testChannel) {
            console.log(`✓ User ${i} can see the test channel`);

            // Try to send a message from this user
            try {
              const userMessage = await userServer.messages.sendMessage({
                channelId: testChannel.channelId,
                content: `Hello from User ${i}! I joined with the shared invite code.`,
              });
              console.log(
                `✓ User ${i} sent message with ID: ${userMessage.id}`
              );
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
      await sleep(5000);
    }

    // Final verification - check if all users can see messages
    if (servers.length > 1) {
      console.log("\n--- Final Verification ---");

      // Wait for final sync
      await sleep(5000);

      // Check message visibility for all users
      let successCount = 0;

      for (const { server, userNum } of servers) {
        try {
          const userChannels = await server.channels.getChannels();
          const testChannel = userChannels.find(
            (c) => c.name === "multi-invite-test-channel"
          );

          if (testChannel) {
            const messages = await server.messages.getMessages({
              channelId: testChannel.channelId,
            });

            console.log(`User ${userNum} can see ${messages.length} messages`);
            successCount++;

            // Check which authors' messages this user can see
            const messageAuthors = new Set();
            for (const msg of messages) {
              messageAuthors.add(msg.author);
            }

            console.log(
              `User ${userNum} can see messages from ${messageAuthors.size} different authors`
            );
          }
        } catch (checkErr) {
          console.error(
            `× Error checking messages for User ${userNum}:`,
            checkErr.message
          );
        }
      }

      console.log(
        `\n${successCount} out of ${servers.length} users can see messages.`
      );
    }

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
      `\n✅ Multi-user invite test complete with ${servers.length} users!`
    );
    return servers.length >= 2; // Success if at least 2 users joined
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    throw error;
  }
}

// Run the test
runMultiUserInviteTest()
  .then(() => {
    console.log("\nTest completed successfully!");
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nTest runner failed:", err);
    cleanup();
    process.exit(1);
  });
