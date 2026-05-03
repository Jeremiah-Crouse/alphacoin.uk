/**
 * QuantumService
 * Handles QRNG (Quantum Random Number Generator) integration
 * and quantum broadcast to frontend via Socket.io
 */

const axios = require('axios');

class QuantumService {
  constructor() {
    this.qrngBuffer = '';
    this.WAKE_PATTERN = '011';
  }

  /**
   * Fetches high-entropy randomness from the Quantum RNG API
   * Used to seed the Admin's autonomous stream of consciousness
   */
  async getQuantumSeed() {
    // If buffer is low, fetch a fresh batch (64 bits) to ensure smooth "frame rate"
    if (this.qrngBuffer.length < 8) {
      try {
        console.log('[Quantum] Buffer low. Fetching fresh entropy from Germany...');
        const response = await axios.get('https://lfdr.de/qrng_api/qrng?length=64&format=BINARY', { timeout: 5000 });
        this.qrngBuffer += String(response.data.qrn).replace(/[^01]/g, '');
      } catch (error) {
        console.warn('[Quantum] API unavailable, injecting pseudorandom entropy.');
        this.qrngBuffer += Math.random().toString(2).split('.')[1].slice(0, 8);
      }
    }

    // Extract the next 8-bit "Frame"
    const frame = this.qrngBuffer.slice(0, 8);
    this.qrngBuffer = this.qrngBuffer.slice(8);
    return frame;
  }

  /**
   * Quantum Heartbeat: Broadcasts raw entropy to the frontend
   * Replaces the autonomous internal monologue
   */
  startQuantumBroadcast(io) {
    setInterval(async () => {
      try {
        const bits = await this.getQuantumSeed();
        io.emit('quantum_stream', { bits });
      } catch (e) {
        // Silence in the void
      }
    }, 2000); // Send a new 8-bit frame every 2 seconds
  }
}

module.exports = QuantumService;
