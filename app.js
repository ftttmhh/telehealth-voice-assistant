const express = require('express');
const twilio = require('twilio');
const { OpenAI } = require('openai');
require('dotenv').config();

// Add this utility function for exponential backoff
const retryWithExponentialBackoff = async (operation, maxRetries = 5) => {
  let retries = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      retries++;
      if (retries > maxRetries || !error.message.includes('429')) {
        throw error; // Rethrow if not a rate limit error or max retries reached
      }
      
      // Calculate delay with exponential backoff and jitter
      const delay = Math.min(
        100 * Math.pow(2, retries) + Math.random() * 100,
        2000 // Cap at 2 seconds max delay
      );
      
      console.log(`Rate limited. Retrying in ${delay}ms (Attempt ${retries}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

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

// Handle callback calls
app.post('/handle-call', async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Welcome message
  twiml.say({
    voice: 'alice'
  }, 'Welcome to the telehealth AI assistant. I will analyze your symptoms and provide preliminary medical guidance. Please describe your health concern after the beep.');
  
  // Record the user's health concern
  twiml.record({
    action: '/process-recording',
    transcribe: false,
    maxLength: 30,
    playBeep: true,
    timeout: 2
  });
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Process the recording
app.post('/process-recording', async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  
  try {
    // Get the recording URL
    const recordingUrl = req.body.RecordingUrl;
    
    if (!recordingUrl) {
      twiml.say('I did not receive a recording. Please try again later.');
      res.type('text/xml');
      return res.send(twiml.toString());
    }
    
    console.log('Recording URL:', recordingUrl);
    
    // Fetch the audio file with retry
    let response, arrayBuffer;
    try {
      // Use function to fetch with retry
      const fetchData = async () => {
        const { default: nodeFetch } = await import('node-fetch');
        const resp = await nodeFetch(recordingUrl);
        const buffer = await resp.arrayBuffer();
        return { response: resp, arrayBuffer: buffer };
      };
      
      const result = await retryWithExponentialBackoff(fetchData);
      response = result.response;
      arrayBuffer = result.arrayBuffer;
    } catch (fetchError) {
      console.error("Error fetching audio:", fetchError);
      throw fetchError;
    }
    
    // Convert to a readable stream for OpenAI
    const { Readable } = await import('stream');
    const audioStream = new Readable();
    audioStream.push(Buffer.from(arrayBuffer));
    audioStream.push(null);
    
    // Import form-data
    const FormData = await import('form-data');
    const form = new FormData.default();
    form.append('file', audioStream, {
      filename: 'recording.wav',
      contentType: 'audio/wav',
    });
    form.append('model', 'whisper-1');
    
    // Call OpenAI API directly with retry
    const transcriptionResult = await retryWithExponentialBackoff(async () => {
      const { default: nodeFetch } = await import('node-fetch');
      const openaiResponse = await nodeFetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          ...form.getHeaders(),
        },
        body: form,
      });
      
      if (!openaiResponse.ok) {
        throw new Error(`OpenAI API error: ${openaiResponse.status} ${openaiResponse.statusText}`);
      }
      
      return openaiResponse.json();
    });
    
    const text = transcriptionResult.text;
    
    console.log('Transcription:', text);
    
    // Generate medical advice with retry
    const completion = await retryWithExponentialBackoff(async () => {
      return openai.chat.completions.create({
        model: 'gpt-3.5-turbo', // Using a smaller model to reduce likelihood of rate limits
        messages: [
          {
            role: 'system',
            content: 'You are a helpful telehealth assistant. Provide brief, accurate medical guidance based on symptoms described. Always include a disclaimer that this is not a replacement for professional medical advice.'
          },
          { role: 'user', content: text }
        ],
        max_tokens: 150, // Reducing tokens to stay within limits
      });
    });
    
    // Read the response to the user
    const aiResponse = completion.choices[0].message.content;
    twiml.say({
      voice: 'alice'
    }, aiResponse);
    
  } catch (error) {
    console.error('Error processing recording:', error);
    twiml.say('I apologize, but I encountered an error. Please try again later.');
  }
  
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
      const completion = await retryWithExponentialBackoff(async () => {
        return openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful telehealth assistant. Provide brief, accurate medical guidance based on symptoms described. Always include a disclaimer that this is not a replacement for professional medical advice.'
            },
            { role: 'user', content: text }
          ],
          max_tokens: 150,
        });
      });
      
      // Send the AI response back to the user
      const aiResponse = completion.choices[0].message.content;
      
      // Convert text to speech and send back to user
      const audioResponse = await retryWithExponentialBackoff(async () => {
        return openai.audio.speech.create({
          model: 'tts-1',
          voice: 'alloy',
          input: aiResponse,
        });
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