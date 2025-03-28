const express = require('express');
const twilio = require('twilio');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// TwiML response for Twilio
app.post('/voice', async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Start streaming with WebSockets
  twiml.connect().stream({
    url: `wss://${req.headers.host}/stream`,
    track: 'both_tracks',
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// Set up WebSocket server for streaming audio
const http = require('http');
const server = http.createServer(app);
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server, path: '/stream' });

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log('WebSocket connection established');
  
  let transcription = '';
  let openaiStream;
  
  // Set up OpenAI Audio Transcription
  const setupOpenAI = async () => {
    // Create an OpenAI streaming connection for real-time audio processing
    openaiStream = await openai.audio.streamingTranscriptions.create({
      model: 'whisper-1',
      language: 'en',
      onMessage: (message) => {
        const transcriptionResult = JSON.parse(message);
        if (transcriptionResult.text) {
          transcription += transcriptionResult.text + ' ';
          console.log('Transcription:', transcriptionResult.text);
          
          // If we have enough text, send to OpenAI for processing
          if (transcription.split(' ').length > 5) {
            processTranscription(transcription);
            transcription = ''; // Reset for next chunk
          }
        }
      },
    });
  };
  
  // Process transcription with OpenAI for medical advice
  const processTranscription = async (text) => {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful telehealth assistant. Provide brief, accurate medical guidance based on symptoms described. Always include a disclaimer that this is not a replacement for professional medical advice.'
          },
          { role: 'user', content: text }
        ],
        max_tokens: 150,
      });
      
      // Send the AI response back to the user
      const aiResponse = completion.choices[0].message.content;
      
      // Convert text to speech and send back to user
      const audioResponse = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'alloy',
        input: aiResponse,
      });
      
      // Convert audio buffer to base64 and send to client
      const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
      ws.send(JSON.stringify({
        type: 'audio',
        audio: audioBuffer.toString('base64'),
      }));
      
    } catch (error) {
      console.error('Error processing transcription:', error);
    }
  };
  
  setupOpenAI();
  
  // Handle incoming audio data
  ws.on('message', (data) => {
    if (openaiStream) {
      openaiStream.write(data);
    }
  });
  
  // Handle connection close
  ws.on('close', () => {
    console.log('WebSocket connection closed');
    if (openaiStream) {
      openaiStream.end();
    }
  });
});

// Import and use the callback router
const callbackRouter = require('./callback');
app.use('/api', callbackRouter);

// Start the server
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});