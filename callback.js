const express = require('express');
const router = express.Router();
const { client } = require('./twilio-helper');

// Endpoint to request a callback
router.post('/request-callback', async (req, res) => {
  const { phoneNumber, name, concern } = req.body;
  
  try {
    // You can store this information in a database
    console.log(`Callback requested for ${name} at ${phoneNumber} regarding ${concern}`);
    
    // Optional: Send a confirmation SMS
    await client.messages.create({
      body: `Hello ${name}, we've received your request for a telehealth callback regarding "${concern}". A healthcare professional will call you soon.`,
      from: process.env.TWILIO_PHONE_NUMBER, // Add this to your .env file
      to: phoneNumber
    });
    
    res.status(200).json({ message: 'Callback request received' });
  } catch (error) {
    console.error('Error processing callback request:', error);
    res.status(500).json({ error: 'Failed to process callback request' });
  }
});

module.exports = router;