/**
 * Authentication & User Management Routes
 * Handles registration, login, verification, faucet claims, and dashboard
 * Factory function accepts shared service instances
 */

const express = require('express');

module.exports = (services = {}) => {
  const router = express.Router();
  const { emailService, ledgerService, userStore } = services;

  // API: Register new user
  router.post('/register', async (req, res) => {
    try {
      const { email, password, name } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      const user = await userStore.createUser(email, password, name);

      const verifyUrl = `${process.env.BASE_URL || 'https://alphacoin.uk'}/api/users/verify?token=${user.verificationToken}`;
      await emailService.sendVerificationEmail(email, user.name, verifyUrl);

      res.json({
        success: true,
        message: 'Registration successful. Please check your email to verify your account.',
        userId: user.id
      });
    } catch (error) {
      console.error('Error registering user:', error);
      if (error.message === 'User already exists') {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // API: Verify user email
  router.get('/verify', async (req, res) => {
    try {
      const { token } = req.query;

      if (!token) {
        return res.status(400).send('Verification token is required');
      }

      const user = await userStore.verifyUser(token);
      await emailService.sendWelcomeEmail(user.email, user.name);

      res.send('<html><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h1>✅ Email Verified!</h1><p>Your account has been verified. <a href="/index.html">Login</a>?</p></body></html>');
    } catch (error) {
      console.error('Error verifying user:', error);
      res.status(400).send('Invalid or expired verification token');
    }
  });

  // API: Login
  router.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const user = await userStore.authenticateUser(email, password);

      if (!user.verified) {
        return res.status(403).json({ error: 'Please verify your email first' });
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          verified: user.verified,
          faucetClaimed: user.faucetClaimed
        }
      });
    } catch (error) {
      console.error('Error logging in:', error);
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  // API: Claim faucet
  router.post('/faucet/claim', async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      const result = await userStore.claimFaucet(email);

      const tx = await ledgerService.issueCoins(
        email,
        25,
        'Faucet Claim - Welcome to Alphacoin Protocol',
        'faucet'
      );

      res.json({
        success: true,
        message: 'Congratulations! You\'ve received 25 Alpha Coins.',
        transaction: tx
      });
    } catch (error) {
      console.error('Error claiming faucet:', error);
      if (error.message === 'User not found') {
        return res.status(404).json({ error: 'Please register first' });
      }
      if (error.message === 'User not verified') {
        return res.status(403).json({ error: 'Please verify your email first' });
      }
      if (error.message === 'Faucet already claimed') {
        return res.status(400).json({ error: 'You have already claimed your faucet allocation' });
      }
      res.status(500).json({ error: 'Faucet claim failed' });
    }
  });

  // API: Get user dashboard data
  router.get('/dashboard/:email', async (req, res) => {
    try {
      const { email } = req.params;
      const user = await userStore.getUser(email);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const balance = await ledgerService.getUserBalance(email);
      const faucetStats = userStore.getFaucetStats();
      const faucetRemaining = await ledgerService.getFaucetWalletBalance();

      res.json({
        user: {
          email: user.email,
          name: user.name,
          verified: user.verified,
          faucetClaimed: user.faucetClaimed,
          createdAt: user.createdAt
        },
        balance,
        faucet: {
          available: !user.faucetClaimed,
          amount: user.faucetAmount
        },
        protocolStats: {
          totalUsers: userStore.getUserCount(),
          faucetRemaining: faucetRemaining,
          totalSupply: await ledgerService.getTotalSupply()
        }
      });
    } catch (error) {
      console.error('Error fetching dashboard:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard' });
    }
  });

  return router;
};
