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

// Add this utility function for exponential backoff
const retryWithExponentialBackoff = async (operation, maxRetries = 3) => {
  let retries = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      retries++;
      if (retries > maxRetries || !error.message.includes('429')) {
        throw error; // Rethrow if not a rate limit error or max retries reached
      }
      
      // Calculate delay with exponential backoff and jitter (shorter for Twilio)
      const delay = Math.min(
        50 * Math.pow(2, retries) + Math.random() * 50,
        1000 // Cap at 1 second max delay
      );
      
      console.log(`Rate limited. Retrying in ${delay}ms (Attempt ${retries}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Fallback function to generate a quick response when OpenAI is rate limited
const generateFallbackResponse = (symptom) => {
  const commonResponses = {
    default: "I'm sorry to hear you're not feeling well. While I'm limited right now due to high demand, common health advice includes rest, staying hydrated, and taking over-the-counter medication appropriate for your symptoms. If symptoms persist or worsen, please consult with a healthcare professional. This is not a replacement for professional medical advice.",
    headache: "For headaches, consider rest, hydration, and over-the-counter pain relievers like acetaminophen or ibuprofen if appropriate for you. Reduce screen time and rest in a dark, quiet room. If the headache is severe or persistent, please consult a healthcare professional. This is not a replacement for professional medical advice.",
    nausea: "For nausea, try small, bland meals and avoid greasy or spicy foods. Stay hydrated with small sips of clear fluids. Ginger tea may help some people. If nausea persists or is accompanied by severe pain, please consult a healthcare professional. This is not a replacement for professional medical advice.",
    fever: "For fever, ensure adequate rest and hydration. Over-the-counter fever reducers like acetaminophen may help if appropriate for you. If fever is high (above 103°F/39.4°C), persists more than three days, or is accompanied by severe symptoms, please seek medical attention. This is not a replacement for professional medical advice.",
    cough: "For a cough, stay hydrated and consider honey (if you're not an infant), lozenges, or over-the-counter cough medicine appropriate for your age. If the cough persists more than a week or is accompanied by difficulty breathing, please consult a healthcare professional. This is not a replacement for professional medical advice."
  };
  
  // Check if the symptom contains any key words
  const lowerSymptom = symptom.toLowerCase();
  for (const [key, response] of Object.entries(commonResponses)) {
    if (key !== 'default' && lowerSymptom.includes(key)) {
      return response;
    }
  }
  
  return commonResponses.default;
};

module.exports = router;