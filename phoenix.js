const { spawn } = require('child_process');
const fs = require('fs');

// Give the parent process time to exit gracefully
setTimeout(() => {
  console.log('[Phoenix] Initiating rebirth...');
  
  const child = spawn('npm', ['start'], {
    cwd: '/var/www/alphacoin.uk/',
    detached: true,
    stdio: 'inherit' // Attempt to keep it in the same tmux pane
  });

  child.unref();
  process.exit();
}, 2000);
