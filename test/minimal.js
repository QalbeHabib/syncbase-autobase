// Set environment to development for testing
process.env.NODE_ENV = 'development';

// Import only what we need
const { Router, dispatch } = require('../lib/components/spec/hyperdispatch');

// Create a minimal database view mock
const view = {
  insert: (collection, data) => {
    console.log(`Inserted into ${collection}:`, data);
    return Promise.resolve(true);
  },
  update: (collection, data) => {
    console.log(`Updated in ${collection}:`, data);
    return Promise.resolve(true);
  },
  upsert: (collection, data) => {
    console.log(`Upserted in ${collection}:`, data);
    return Promise.resolve(true);
  },
  delete: (collection, query) => {
    console.log(`Deleted from ${collection}:`, query);
    return Promise.resolve(true);
  },
  findOne: (collection, query) => {
    console.log(`Finding one in ${collection}:`, query);
    return Promise.resolve(null);
  }
};

// Create context
const context = { view };

// Create minimal router with just one handler
const router = new Router();

// Register all handlers (required by hyperdispatch)
router.add('@server/create-server', async (data, ctx) => {
  console.log('Create server handler called with data:', data);
  await ctx.view.insert('@server/server', data);
  return true;
});

router.add('@server/update-server', async (data, ctx) => {
  console.log('Update server handler called');
  return true;
});

router.add('@server/create-channel', async (data, ctx) => {
  console.log('Create channel handler called');
  return true;
});

router.add('@server/update-channel', async (data, ctx) => {
  console.log('Update channel handler called');
  return true;
});

router.add('@server/delete-channel', async (data, ctx) => {
  console.log('Delete channel handler called');
  return true;
});

router.add('@server/send-message', async (data, ctx) => {
  console.log('Send message handler called');
  return true;
});

router.add('@server/edit-message', async (data, ctx) => {
  console.log('Edit message handler called');
  return true;
});

router.add('@server/delete-message', async (data, ctx) => {
  console.log('Delete message handler called');
  return true;
});

router.add('@server/set-role', async (data, ctx) => {
  console.log('Set role handler called');
  return true;
});

router.add('@server/create-invite', async (data, ctx) => {
  console.log('Create invite handler called');
  return true;
});

router.add('@server/claim-invite', async (data, ctx) => {
  console.log('Claim invite handler called');
  return true;
});

async function runMinimalTest() {
  console.log('Running minimal hyperdispatch test...');
  
  try {
    // Create a test message
    const serverData = {
      id: 'test-server-id',
      name: 'Test Server',
      description: 'A test server',
      createdAt: Date.now()
    };
    
    console.log('Server data:', serverData);
    
    // Use hyperdispatch to encode the message
    console.log('Encoding message...');
    const encodedMessage = dispatch('@server/create-server', serverData);
    console.log('Encoded message:', encodedMessage);
    
    // Decode and process the message
    console.log('Dispatching message...');
    const result = await router.dispatch(encodedMessage, context);
    console.log('Dispatch result:', result);
    
    console.log('Test completed successfully!');
  } catch (err) {
    console.error('Test failed:', err);
  }
}

// Run the test
runMinimalTest(); 