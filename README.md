# Telehealth Voice Assistant - OpenAI Realtime API with Twilio

This implementation uses:
- OpenAI's Realtime API for direct audio processing
- Twilio for voice calls
- Node.js with Express for the backend

## Features
- Direct audio input/output (no separate STT/TTS steps)
- Real-time conversation with AI
- Callback request system

## Setup
1. Install dependencies: `npm install`
2. Create a `.env` file with your API keys
3. Start the server: `npm start`

## Environment Variables
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_PHONE_NUMBER
- OPENAI_API_KEY
- PORT (optional, defaults to 3000)

## Deployment
For production, you'll need a publicly accessible HTTPS endpoint. Consider using:
- Ngrok for local testing
- Heroku, Vercel, or similar for production deployment