const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

let RtcTokenBuilder, RtcRole;
try {
  const agoraToken = require('agora-token');
  RtcTokenBuilder = agoraToken.RtcTokenBuilder;
  RtcRole = agoraToken.RtcRole;
} catch (e) {
  try {
    const agoraAccessToken = require('agora-access-token');
    RtcTokenBuilder = agoraAccessToken.RtcTokenBuilder;
    RtcRole = agoraAccessToken.RtcRole;
  } catch (err) {
    console.error('Neither agora-token nor agora-access-token could be loaded:', err.message);
  }
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const AGORA_APP_ID = process.env.AGORA_APP_ID || '796483ae1e4448c2a31d9f122561a2c8';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || 'a199c5bd432c4a7e98562738c9e70ecb';

// Expiration time in seconds (default 24h)
const EXPIRATION_TIME_IN_SECONDS = 3600 * 24;

const generateToken = (channelName, uid, roleInput) => {
  if (!AGORA_APP_ID || AGORA_APP_ID.trim() === '') {
    throw new Error('Server misconfiguration: AGORA_APP_ID is not configured');
  }
  if (!AGORA_APP_CERTIFICATE || AGORA_APP_CERTIFICATE.trim() === '') {
    throw new Error('Server misconfiguration: AGORA_APP_CERTIFICATE is not configured');
  }
  if (!channelName || typeof channelName !== 'string' || channelName.trim() === '') {
    throw new Error('Missing parameter: channelName is required');
  }

  const targetChannel = channelName.trim();
  const numericUid = Number(uid) || 0;
  let role = RtcRole ? (RtcRole.PUBLISHER || 1) : 1;
  if (roleInput === 'subscriber' || roleInput === 'audience' || roleInput === 2) {
    role = RtcRole ? (RtcRole.SUBSCRIBER || 2) : 2;
  }

  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + EXPIRATION_TIME_IN_SECONDS;

  if (!RtcTokenBuilder) {
    throw new Error('Agora Token Builder library is not available on server');
  }

  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    targetChannel,
    numericUid,
    role,
    privilegeExpiredTs,
    privilegeExpiredTs
  );

  if (!token || typeof token !== 'string' || token.trim() === '') {
    throw new Error('Failed to generate valid Agora RTC token: token is empty');
  }

  return token;
};

app.get('/ping', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/fetch-token', (req, res) => {
  try {
    const { channelName, uid, role } = req.body || {};
    console.log(`[TOKEN_SERVER] Request received | channel: "${channelName}", uid: ${uid}, role: ${role}`);
    const token = generateToken(channelName, uid, role);
    console.log(`[TOKEN_SERVER] Token generated successfully (length: ${token.length})`);
    return res.json({
      token,
      channelName: (channelName || '').trim(),
      uid: Number(uid) || 0,
    });
  } catch (error) {
    console.error('[TOKEN_SERVER_ERROR]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/rtc/:channelName/:role/:tokentype/:uid', (req, res) => {
  try {
    const { channelName, role, uid } = req.params;
    console.log(`[TOKEN_SERVER] GET Request | channel: "${channelName}", uid: ${uid}`);
    const token = generateToken(channelName, uid, role);
    return res.json({ rtcToken: token, token });
  } catch (error) {
    console.error('[TOKEN_SERVER_ERROR]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

const os = require('os');
const { exec } = require('child_process');

let lastReversedCount = -1;
const reverseAllDevices = () => {
  exec('adb devices', (err, stdout) => {
    if (!err && stdout) {
      const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
      let count = 0;
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && parts[1] === 'device') {
          const serial = parts[0];
          exec(`adb -s ${serial} reverse tcp:8080 tcp:8080`);
          exec(`adb -s ${serial} reverse tcp:8081 tcp:8081`);
          count++;
        }
      }
      if (count !== lastReversedCount) {
        lastReversedCount = count;
        if (count > 0) {
          console.log(`✅ [AUTO-REVERSE] Port 8080 & 8081 mapped on ${count} physical/emulator device(s).`);
        }
      }
    }
  });
};

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`🚀 Agora Token Server running on port ${PORT}`);
  console.log(`   App ID: ${AGORA_APP_ID}`);
  console.log(`   App Cert: ${AGORA_APP_CERTIFICATE ? 'Configured ✅' : 'Not set ❌'}`);
  
  // Print all local IP addresses for easy device connection
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   LAN IP [${name}]: http://${net.address}:${PORT}/fetch-token`);
      }
    }
  }
  console.log(`=================================================`);

  // Run ADB reverse only for local development (not on cloud hosts like Render)
  if (!process.env.RENDER && process.env.NODE_ENV !== 'production') {
    reverseAllDevices();
    setInterval(reverseAllDevices, 10000);
  }
});

