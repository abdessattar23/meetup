# WebRTC Meetup App

A real-time video chat application with synchronized YouTube video watching.

## Features
- WebRTC video calls
- Synchronized YouTube video playback
- Real-time reactions with floating emojis
- Room-based communication

## Deployment to Render

1. Fork or push this repository to GitHub

2. Create a new account on [Render](https://render.com) if you haven't already

3. In Render Dashboard:
   - Click "New +"
   - Select "Web Service"
   - Connect your GitHub repository
   - Choose the repository

4. Configure the Web Service:
   - Name: `webrtc-meetup` (or your preferred name)
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `node server.js`

5. Add Environment Variables:
   - `NODE_ENV`: production
   - `PORT`: 3000
   - `HOST`: 0.0.0.0
   - `SERVER_URL`: Your Render URL (after deployment)

6. Click "Create Web Service"

Your app will be deployed and available at the URL provided by Render.

## Development

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file:
```env
PORT=3000
HOST=0.0.0.0
SERVER_URL=http://localhost:3000
NODE_ENV=development
```

3. Start the server:
```bash
npm start
```

## License
MIT
