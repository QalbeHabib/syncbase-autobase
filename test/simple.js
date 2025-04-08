// Set environment to development for testing
process.env.NODE_ENV = 'development'

const { Router, dispatch } = require('../lib/components/spec/hyperdispatch');

// Create a simple router
const router = new Router();

// Add all required handlers
router.add('@server/create-server', (data, context) => {
  console.log('Create server handler called with data:', data);
  return true;
});

router.add('@server/update-server', (data, context) => {
  console.log('Update server handler called');
  return true;
});

router.add('@server/create-channel', (data, context) => {
  console.log('Create channel handler called');
  return true;
});

router.add('@server/update-channel', (data, context) => {
  console.log('Update channel handler called');
  return true;
});

router.add('@server/delete-channel', (data, context) => {
  console.log('Delete channel handler called');
  return true;
});

router.add('@server/send-message', (data, context) => {
  console.log('Send message handler called');
  return true;
});

router.add('@server/edit-message', (data, context) => {
  console.log('Edit message handler called');
  return true;
});

router.add('@server/delete-message', (data, context) => {
  console.log('Delete message handler called');
  return true;
});

router.add('@server/set-role', (data, context) => {
  console.log('Set role handler called');
  return true;
});

router.add('@server/create-invite', (data, context) => {
  console.log('Create invite handler called');
  return true;
});

router.add('@server/claim-invite', (data, context) => {
  console.log('Claim invite handler called');
  return true;
});

// Test dispatch
console.log('Testing dispatch...');
const message = {
  id: 'test-server-1',
  name: 'Test Server',
  createdAt: Date.now()
};

try {
  // Dispatch a message
  const encodedMessage = dispatch('@server/create-server', message);
  console.log('Encoded message:', encodedMessage);
  
  // Decode and handle the message
  const result = router.dispatch(encodedMessage, {});
  console.log('Dispatch result:', result);
  
  console.log('Test completed successfully!');
} catch (err) {
  console.error('Test failed:', err);
} 