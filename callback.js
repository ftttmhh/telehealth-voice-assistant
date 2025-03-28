const express = require('express');
const router = express.Router();
const { client } = require('./twilio-helper');

// Endpoint to request a callback
router.post('/request-callback', async (req, res) => {
  const { phone_number, language, health_concern } = req.body;
  
  try {
    // Log the callback request
    console.log(`Callback requested for ${phone_number} in ${language} regarding "${health_concern}"`);
    
    // Make the outbound call
    try {
      const call = await client.calls.create({
        url: `https://${req.headers.host}/handle-call`,
        to: phone_number,
        from: process.env.TWILIO_PHONE_NUMBER,
      });
      
      console.log(`Initiated callback to ${phone_number}, call SID: ${call.sid}`);
      
      // Optional: Send a confirmation SMS
      await client.messages.create({
        body: `We've received your request for a telehealth callback regarding your health concern. We will call you shortly.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone_number
      });
      
      res.status(200).json({
        message: 'Callback requested successfully',
        call_sid: call.sid
      });
    } catch (twilioError) {
      console.error('Twilio API error:', twilioError);
      res.status(500).json({ error: 'Failed to initiate call via Twilio' });
    }
  } catch (error) {
    console.error('Error processing callback request:', error);
    res.status(500).json({ error: 'Failed to process callback request' });
  }
});

module.exports = router;