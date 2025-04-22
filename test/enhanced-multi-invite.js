const assert = require("assert");
const Corestore = require("corestore");
const path = require("path");
const fs = require("fs");
const rimraf = require("rimraf");
const b4a = require("b4a");
const SyncBase = require("../lib/syncbase");
const colors = require("./utils/colors");

// Test directory setup
const TEST_DIR = path.join("./cores", "enhanced-multi-invite-" + Date.now());
console.log(colors.debug(`Test directory: ${TEST_DIR}`));
fs.mkdirSync(TEST_DIR, { recursive: true });

// Number of users to test
const NUM_USERS = 6; // Host + 5 joiners

// Cleanup function to run after tests
function cleanup() {
  console.log(colors.debug(`Cleaning up test directory: ${TEST_DIR}`));
  try {
    rimraf.sync(TEST_DIR);
    console.log(colors.debug("Cleanup complete"));
  } catch (err) {
    console.error(colors.error("Error during cleanup:"), err);
  }
}

// Helper sleep function
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wrap the main test logic in a function
async function runTest(isOptimistic) {
  console.log(
    colors.header(`\n=== RUNNING TEST WITH OPTIMISTIC = ${isOptimistic} ===\n`)
  );

  // Test directory setup specific to this run
  const TEST_DIR_RUN = path.join(TEST_DIR, `optimistic-${isOptimistic}`);
  console.log(colors.debug(`Test directory for this run: ${TEST_DIR_RUN}`));
  fs.mkdirSync(TEST_DIR_RUN, { recursive: true });

  const servers = [];
  let inviteCode;
  let testChannelId;

  try {
    // Create and setup the host server (user 1)
    console.log(colors.header("\n--- Setting up host server (User 1) ---"));
    const hostStorePath = path.join(TEST_DIR_RUN, "host-server");
    const hostStore = new Corestore(hostStorePath);
    await hostStore.ready();

    const hostServer = new SyncBase(hostStore, {
      seedPhrase: "test seed phrase for host server",
      replicate: true,
      optimistic: isOptimistic, // Pass the optimistic setting
    });

    await hostServer.ready();
    console.log(colors.success("✓ Host server ready"));

    // Initialize server
    await hostServer.initialize({
      name: "Enhanced Multi-User Invite Test Server",
      description: "Server for testing multiple users joining with one invite",
    });
    console.log(colors.success("✓ Host server initialized"));

    // Create a test channel
    console.log(colors.info("Creating test channel..."));
    const channel = await hostServer.channels.createChannel({
      name: "multi-invite-test-channel",
      type: "TEXT",
      topic: "Testing multi-user invite joining",
    });
    testChannelId = channel.channelId;
    console.log(colors.success(`✓ Created channel with ID: ${testChannelId}`));

    // Send an initial message from the host
    const initialMessage = await hostServer.messages.sendMessage({
      channelId: testChannelId,
      content: "Welcome to the enhanced multi-user invite test!",
    });
    console.log(
      colors.success(`✓ Host sent initial message with ID: ${initialMessage.id}`)
    );

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
    console.log(colors.header("\n--- Creating shared invite code ---"));
    inviteCode = await hostServer.invites.createInvite({
      expireInDays: 1,
      maxUses: 0, // 0 means unlimited uses
    });
    console.log(
      colors.success(
        `✓ Created shared invite: ${colors.invite(
          inviteCode.substring(0, 30)
        )}...`
      )
    );

    // Force update again
    await hostServer.base.update();
    await sleep(2000);

    // Join process for users 2 through NUM_USERS
    for (let i = 2; i <= NUM_USERS; i++) {
      console.log(
        colors.header(
          `\n--- Setting up ${colors.user(i)} (Joining with shared invite) ---`
        )
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
          colors.info(
            `Join attempt ${joinAttempts}/${maxAttempts} for ${colors.user(i)}`
          )
        );

        try {
          console.log(colors.info(`${colors.user(i)} joining with shared invite...`));
          const userPairer = SyncBase.pair(userStore, inviteCode, {
            seedPhrase: `test seed phrase for user ${i}`,
            timeout: 30000, // 30 second timeout
            optimistic: isOptimistic, // Pass the optimistic setting
          });

          console.log(
            colors.info(`Waiting for ${colors.user(i)} pairing to complete...`)
          );
          userServer = await userPairer.finished();
          console.log(colors.success(`✓ ${colors.user(i)} pairing completed`));
          joinSuccess = true;
        } catch (pairErr) {
          console.error(
            colors.error(`× Error: ${colors.user(i)} pairing attempt ${joinAttempts} failed:`),
            pairErr.message
          );

          if (joinAttempts < maxAttempts) {
            // Wait longer between each retry
            const waitTime = joinAttempts * 2000;
            console.log(
              colors.warning(`Waiting ${waitTime / 1000} seconds before retry...`)
            );
            await sleep(waitTime);
          }
        }
      }

      if (!joinSuccess) {
        console.error(
          colors.error(`× Failed to join ${colors.user(i)} after ${maxAttempts} attempts.`)
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
        console.log(colors.info(`Checking if ${colors.user(i)} can see the channel...`));
        const userChannels = await userServer.channels.getChannels();

        if (userChannels && userChannels.length > 0) {
          console.log(
            colors.success(`✓ ${colors.user(i)} can see ${userChannels.length} channel(s)`)
          );

          const testChannel = userChannels.find(
            (c) => c.channelId === testChannelId
          );

          if (testChannel) {
            console.log(colors.success(`✓ ${colors.user(i)} can see the test channel`));

            // Try to send a message from this user
            try {
              const messageContent = `Hello from ${colors.user(i)}! I joined with the shared invite code.`;
              const userMessage = await userServer.messages.sendMessage({
                channelId: testChannelId,
                content: messageContent,
              });

              console.log(
                colors.success(
                  `✓ ${colors.user(i)} sent message with ID: ${colors.details(userMessage.id)}`
                )
              );

              // Track this message
              servers[i - 1].messages.push({
                id: userMessage.id,
                content: userMessage.content,
                author: userMessage.author,
              });
            } catch (sendErr) {
              console.error(
                colors.error(`× Error: ${colors.user(i)} failed to send message:`),
                sendErr.message
              );
            }
          } else {
            console.log(colors.warning(`× ${colors.user(i)} cannot see the test channel`));
          }
        } else {
          console.log(colors.warning(`× ${colors.user(i)} cannot see any channels`));
        }
      } catch (checkErr) {
        console.error(
          colors.error(`× Error checking channels for ${colors.user(i)}:`),
          checkErr.message
        );
      }

      // Wait before adding the next user to avoid network congestion
      await sleep(3000);
    }

    // Now have all users send a second message
    console.log(colors.header("\n--- Having all users send a second message ---"));
    for (let i = 0; i < servers.length; i++) {
      const { server, userNum } = servers[i];

      try {
        const messageContent = `This is a second message from ${colors.user(userNum)}!`;
        const secondMessage = await server.messages.sendMessage({
          channelId: testChannelId,
          content: messageContent,
        });

        console.log(
          colors.success(
            `✓ ${colors.user(userNum)} sent second message with ID: ${colors.details(
              secondMessage.id
            )}`
          )
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
          colors.error(`× ${colors.user(userNum)} failed to send second message: ${err.message}`)
        );
      }
    }

    // Wait for all messages to sync
    console.log(colors.header("\n--- Waiting for messages to sync across all users ---"));
    await sleep(10000);

    // Final verification - check if all users can see all messages
    console.log(colors.header("\n--- Final Message Verification ---"));

    // Count total messages sent
    let totalMessagesSent = 0;
    servers.forEach((user) => {
      totalMessagesSent += user.messages.length;
    });

    console.log(colors.info(`Total messages sent across all users: ${totalMessagesSent}`));

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

          console.log(colors.info(`${colors.user(userNum)} can see ${messages.length} messages`));

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
                colors.details(
                  `  - ${colors.user(userNum)} sees ${count} messages from ${colors.user(
                    authorUserNum
                  )}`
                )
              );
            } else {
              console.log(
                colors.details(
                  `  - ${colors.user(userNum)} sees ${count} messages from unknown author ${author.substring(
                    0,
                    8
                  )}...`
                )
              );
            }
          }

          console.log(
            colors.info(
              `${colors.user(userNum)} can see messages from ${messageAuthors.size} different authors`
            )
          );

          if (messages.length > 0) {
            successCount++;
          }
        }
      } catch (checkErr) {
        console.error(
          colors.error(`× Error checking messages for ${colors.user(userNum)}:`),
          checkErr.message
        );
      }
    }

    console.log(colors.header("\n--- Message Visibility Summary ---"));
    for (const [userNum, messageCount] of Object.entries(
      messageVisibilityMatrix
    )) {
      const percentSeen = ((messageCount / totalMessagesSent) * 100).toFixed(1);
      console.log(
        `${colors.user(userNum)} sees ${messageCount}/${totalMessagesSent} messages (${colors.info(
          percentSeen
        )}%)`
      );
    }

    console.log(
      colors.info(`\n${successCount} out of ${servers.length} users can see messages.`)
    );

    // Close all servers
    console.log(colors.header("\n--- Closing all servers ---"));

    for (const { server, userNum } of servers) {
      try {
        await server.close();
        console.log(colors.success(`✓ Closed server for ${colors.user(userNum)}`));
      } catch (closeErr) {
        console.error(
          colors.error(`× Error closing server for ${colors.user(userNum)}:`),
          closeErr.message
        );
      }
    }

    console.log(
      colors.success(
        `\n✅ Multi-user invite test complete for optimistic=${isOptimistic} with ${servers.length} users!`
      )
    );
    return servers.length >= 2; // Success if at least 2 users joined
  } catch (error) {
    console.error(
      colors.error(`\n❌ Test failed for optimistic=${isOptimistic}:`), error // Apply color only to the string
    );
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
    console.error(colors.error("Error during optimistic=true run"));
  }

  console.log("\n".repeat(3)); // Add spacing between runs

  try {
    successNonOptimistic = await runTest(false);
  } catch (err) {
    console.error(colors.error("Error during optimistic=false run"));
  }

  // Final Cleanup
  cleanup();

  console.log(colors.header("\n--- OVERALL TEST SUMMARY ---"));
  console.log(
    `Optimistic=true run ${successOptimistic ? colors.pass("PASSED") : colors.fail("FAILED")}`
  );
  console.log(
    `Optimistic=false run ${successNonOptimistic ? colors.pass("PASSED") : colors.fail("FAILED")}`
  );

  if (successOptimistic && successNonOptimistic) {
    console.log(colors.success("\nBoth test runs completed successfully!"));
    process.exit(0);
  } else {
    console.error(colors.fail("\nOne or more test runs failed."));
    process.exit(1);
  }
}

// Run the main function
main();
