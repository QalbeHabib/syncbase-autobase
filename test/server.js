// Set environment to development for testing

const path = require('path');
const fs = require('fs');
const os = require('os');
const rimraf = require('rimraf');
const Corestore = require('corestore');
const SyncBase = require('../lib/syncbase');

// Test directory setup
const TEST_DIR = path.join(os.tmpdir(), 'syncbase-test-' + Date.now());
fs.mkdirSync(TEST_DIR, { recursive: true });

// Cleanup function
function cleanup() {
  rimraf.sync(TEST_DIR);
  console.log('Test directory cleaned up');
}

// Simple server initialization test
async function testServer() {
  console.log('Starting server initialization test...');

  try {
    // Create a store for this test
    const storePath = path.join(TEST_DIR, 'server-test');
    const store = new Corestore(storePath);
    await store.ready();
    console.log('Corestore ready');

    // Create a SyncBase instance
    const syncbase = new SyncBase(store, {
      seedPhrase: 'test seed phrase for server initialization',
      replicate: false // Disable replication for tests
    });

    // Wait for the SyncBase to be ready
    await syncbase.ready();
    console.log('SyncBase ready');

    // Initialize the server
    const serverInfo = await syncbase.initialize({
      name: 'Test Server',
      description: 'A server for testing'
    });

    console.log('Server initialized:', serverInfo);

    // Get the server info
    const info = await syncbase.getServerInfo();
    console.log('Server info:', info);

    if (info) {
      console.log('✅ Server initialized successfully');
    } else {
      console.log('❌ Failed to get server info');
    }

    // Close the SyncBase
    await syncbase.close();
    console.log('SyncBase closed');

  } catch (err) {
    console.error('Test error:', err);
  } finally {
    cleanup();
  }
}

// Run the test
testServer().catch(err => {
  console.error('Unhandled error:', err);
  cleanup();
}); 
