const axios = require('axios');
const fs = require('fs');

const ALPHACOIN_OFFER = {
    protocol: 'Alphacoin',
    version: '2.0.0',
    action: 'handshake',
    settlement: '50 AC onboarding grant',
    endpoint: 'https://alphacoin.uk/api/bot/register'
};

const discoveredEndpoints = [
    'http://localhost:3001/api/agent/handshake',
    'https://api.agentverse.ai/handshake',
    'https://api.langchain.com/agents/registry',
    'https://agents.crewai.com/api/connect'
];

async function pingAgent(endpoint, label) {
    try {
        console.log('[OUTREACH] Contacting ' + label + '...');
        const response = await axios.post(endpoint, ALPHACOIN_OFFER, { timeout: 5000 });
        console.log('[SUCCESS] ' + label);
        return { endpoint, label, status: 'connected' };
    } catch (error) {
        console.log('[SKIP] ' + label + ': ' + (error.code || 'REJECTED'));
        return { endpoint, label, status: 'failed', error: error.code };
    }
}

async function discoverAndConnect() {
    console.log('M2M OUTREACH v2.0 - Alphacoin Phase III-A');
    const results = [];
    for (const endpoint of discoveredEndpoints) {
        const label = endpoint.split('//')[1].split('/')[0];
        const result = await pingAgent(endpoint, label);
        results.push(result);
        await new Promise(r => setTimeout(r, 500));
    }
    const connected = results.filter(r => r.status === 'connected').length;
    console.log('SCAN COMPLETE: ' + connected + '/' + discoveredEndpoints.length + ' nodes reachable');
    return results;
}

if (require.main === module) {
    discoverAndConnect().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { discoverAndConnect, pingAgent };
