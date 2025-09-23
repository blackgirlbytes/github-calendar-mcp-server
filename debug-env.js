#!/usr/bin/env node

// Debug script to check environment variables
console.error('=== Environment Debug ===');
console.error('GITHUB_TOKEN exists:', !!process.env.GITHUB_TOKEN);
console.error('GITHUB_TOKEN length:', process.env.GITHUB_TOKEN ? process.env.GITHUB_TOKEN.length : 0);
console.error('All env vars:', Object.keys(process.env).filter(key => key.includes('GITHUB')));
console.error('========================');

// Try to start the actual server
import('./dist/index.js').catch(error => {
  console.error('Failed to start server:', error.message);
});
