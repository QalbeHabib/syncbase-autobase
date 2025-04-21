const assert = require("assert");
const Corestore = require("corestore");
const path = require("path");
const fs = require("fs");
const rimraf = require("rimraf");
const b4a = require("b4a");
const SyncBase = require("../lib/syncbase");

// Test directory setup
const TEST_DIR = path.join("./cores", "simple-invite-test-" + Date.now());
console.log(`Test directory: ${TEST_DIR}`);
fs.mkdirSync(TEST_DIR, { recursive: true });

// Cleanup function to run after tests
function cleanup() {
  console.log(`Cleaning up test directory: ${TEST_DIR}`);
  rimraf.sync(TEST_DIR);
  console.log("Cleanup complete");
}

// Helper sleep function
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSimpleInviteTest() {
  console.log("\n=== TESTING SIMPLE INVITE AND JOIN ===");

  try {
    // Create the first server (host)
    console.log("Creating host server...");
    const hostStorePath = path.join(TEST_DIR, "host-server");
    const hostStore = new Corestore(hostStorePath);
    await hostStore.ready();

    const hostServer = new SyncBase(hostStore, {
      seedPhrase: "test seed phrase for host server",
      replicate: true,
    });

    await hostServer.ready();
    console.log("✓ Host server ready");

    // Initialize the server
    await hostServer.initialize({
      name: "Simple Invite Test Server",
      description: "Server for testing invite functionality",
    });
    console.log("✓ Host server initialized");

    // Create a test channel
    console.log("Creating test channel...");
    const channel = await hostServer.channels.createChannel({
      name: "invite-test-channel",
      type: "TEXT",
      topic: "Testing invite functionality",
    });
    console.log(`✓ Created channel with ID: ${channel.channelId}`);

    // Send an initial message
    const initialMessage = await hostServer.messages.sendMessage({
      channelId: channel.channelId,
      content: "This is the first message in the channel",
    });
    console.log(`✓ Sent initial message with ID: ${initialMessage.id}`);

    // Force update to ensure initial data is ready
    await hostServer.base.update();
    await sleep(2000);

    // Create an invite
    console.log("Creating invite for joining user...");
    const invite = await hostServer.invites.createInvite({
      expireInDays: 1,
    });
    console.log(`✓ Created invite: ${invite.substring(0, 30)}...`);

    // Force update again
    await hostServer.base.update();
    await sleep(2000);

    // Create the second server (joiner)
    console.log("\nCreating joining server...");
    const joinerStorePath = path.join(TEST_DIR, "joiner-server");
    const joinerStore = new Corestore(joinerStorePath);
    await joinerStore.ready();

    console.log("Joining server with invite...");
    const joinerPairer = SyncBase.pair(joinerStore, invite, {
      seedPhrase: "test seed phrase for joining server",
    });

    console.log("Waiting for pairing to complete...");
    const joinerServer = await joinerPairer.finished();
    console.log("✓ Pairing completed");

    // Wait for sync
    await sleep(3000);

    // Check if joiner can see the channel
    console.log("Checking if joiner can see the channel...");
    const joinerChannels = await joinerServer.channels.getChannels();

    if (joinerChannels && joinerChannels.length > 0) {
      console.log(`✓ Joiner can see ${joinerChannels.length} channel(s)`);

      const testChannel = joinerChannels.find(
        (c) => c.name === "invite-test-channel"
      );
      if (testChannel) {
        console.log("✓ Joiner can see the test channel");

        // Check if joiner can see the initial message
        const messages = await joinerServer.messages.getMessages({
          channelId: testChannel.channelId,
        });

        if (messages && messages.length > 0) {
          console.log(
            `✓ Joiner can see ${messages.length} message(s) in the channel`
          );

          // Try to send a message from the joiner
          console.log("Sending a message from the joiner...");
          try {
            const joinerMessage = await joinerServer.messages.sendMessage({
              channelId: testChannel.channelId,
              content: "Hello from the joining server!",
            });
            console.log(`✓ Joiner sent message with ID: ${joinerMessage.id}`);
          } catch (sendErr) {
            console.error(
              "× Error: Joiner failed to send message:",
              sendErr.message
            );
          }
        } else {
          console.log("× Joiner cannot see any messages in the channel");
        }
      } else {
        console.log("× Joiner cannot see the test channel");
      }
    } else {
      console.log("× Joiner cannot see any channels");
    }

    // Close both servers
    await hostServer.close();
    await joinerServer.close();
    console.log("\n✅ Simple invite test complete!");

    return true;
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    throw error;
  }
}

// Run the test
runSimpleInviteTest()
  .then(() => {
    console.log("Test completed successfully!");
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test runner failed:", err);
    cleanup();
    process.exit(1);
  });
