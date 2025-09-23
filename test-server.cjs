#!/usr/bin/env node

// Simple test to verify the MCP server can start and list tools
// This doesn't require a GitHub token, just tests the basic structure

const { spawn } = require('child_process');
const path = require('path');

console.log('Testing GitHub Calendar MCP Server...\n');

// Set a dummy token to prevent the server from failing on startup
process.env.GITHUB_TOKEN = 'test-token';

const serverPath = path.join(__dirname, 'dist', 'index.js');
const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Send a list_tools request
const listToolsRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list'
};

server.stdin.write(JSON.stringify(listToolsRequest) + '\n');

let output = '';
server.stdout.on('data', (data) => {
  output += data.toString();
  
  try {
    const response = JSON.parse(output.trim());
    if (response.result && response.result.tools) {
      console.log('✅ MCP Server started successfully!');
      console.log(`✅ Found ${response.result.tools.length} tools:`);
      
      response.result.tools.forEach(tool => {
        console.log(`   - ${tool.name}: ${tool.description}`);
      });
      
      console.log('\n🎉 MCP Extension is ready to use!');
      server.kill();
      process.exit(0);
    }
  } catch (e) {
    // Still collecting data, continue...
  }
});

server.stderr.on('data', (data) => {
  const message = data.toString();
  if (message.includes('GitHub Calendar MCP server running')) {
    console.log('✅ Server started on stdio');
  } else if (!message.includes('ExperimentalWarning')) {
    console.log('Server message:', message);
  }
});

server.on('error', (error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

// Timeout after 5 seconds
setTimeout(() => {
  console.log('❌ Test timed out');
  server.kill();
  process.exit(1);
}, 5000);
