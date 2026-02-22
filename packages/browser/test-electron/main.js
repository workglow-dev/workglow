/**
 * Electron test runner
 * 
 * Run with: cd test-electron && npm install && npm test
 */

const { app } = require('electron');
const path = require('path');

// Disable GPU and sandbox for container environments
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

// Run tests when Electron is ready
app.whenReady().then(async () => {
  console.log('Electron app ready, running tests...\n');
  
  try {
    // Import the test using node's require since we're in Electron's main process
    const browserModule = require('../dist/electron.js');
    const { CookieStore, ElectronContext } = browserModule;
    
    // Helper to create context
    const createElectronContext = async (config, cookies) => {
      return new ElectronContext(config, cookies);
    };
    
    console.log('✓ Successfully imported ElectronContext');
    
    // Test 1: Create context
    const cookies = new CookieStore();
    const context = await createElectronContext(
      { headless: true, timeout: 30000 },
      cookies
    );
    console.log('✓ Created Electron context');
    
    // Test 2: Navigate
    await context.navigate('https://example.com');
    console.log('✓ Navigated to example.com');
    
    const url = await context.getUrl();
    console.log(`✓ Current URL: ${url}`);
    
    // Test 3: Get accessibility tree
    const tree = await context.getAccessibilityTree();
    console.log('✓ Got accessibility tree');
    console.log(`  Nodes in tree: ${tree.findAll({}).length}`);
    
    // Test 4: Find elements
    const heading = tree.find({ role: 'heading' });
    console.log(`✓ Found heading: "${heading?.name}"`);
    
    const link = tree.find({ role: 'link' });
    console.log(`✓ Found link: "${link?.name}"`);
    
    // Test 5: Execute JavaScript
    const title = await context.evaluate('document.title');
    console.log(`✓ Executed JavaScript, title: "${title}"`);
    
    // Test 6: Screenshot
    const screenshot = await context.screenshot({ type: 'png' });
    console.log(`✓ Captured screenshot: ${screenshot.length} bytes`);
    
    // Clean up
    await context.close();
    console.log('✓ Closed context');
    
    console.log('\n--- Testing Session Partitions ---\n');
    
    // Test 7: Persistent partition
    const persistCookies = new CookieStore();
    const persistContext = new ElectronContext(
      { partition: 'persist:test-session', headless: true },
      persistCookies
    );
    console.log(`✓ Created context with persistent partition: ${persistContext.config.partition}`);
    await persistContext.close();
    
    // Test 8: In-memory partition
    const tempCookies = new CookieStore();
    const tempContext = new ElectronContext(
      { partition: 'temp-session', headless: true },
      tempCookies
    );
    console.log(`✓ Created context with in-memory partition: ${tempContext.config.partition}`);
    await tempContext.close();
    
    console.log('\n✅ All Electron tests passed (including partitions)!\n');
    app.quit();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    app.quit();
    process.exit(1);
  }
});

// Handle app quit
app.on('window-all-closed', () => {
  app.quit();
});
