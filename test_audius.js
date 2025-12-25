// Simple test to get Audius track stream URL
const https = require('https');

// Test with a trending track
const trackId = 'D7KyD'; // Example track ID

const url = `https://api.audius.co/v1/tracks/${trackId}/stream?app_name=WF4SRadio`;

console.log('Testing Audius stream URL:', url);
console.log('This URL should stream audio directly');
console.log('\nTrying to get track info first...');

// Get track info
https.get(`https://api.audius.co/v1/tracks/trending?app_name=WF4SRadio&limit=5`, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const tracks = JSON.parse(data);
    console.log('\nTop 5 trending tracks:');
    tracks.data.forEach((track, i) => {
      console.log(`${i+1}. ${track.title} by ${track.user.name}`);
      console.log(`   ID: ${track.id}`);
      console.log(`   Stream: https://api.audius.co/v1/tracks/${track.id}/stream`);
    });
  });
});
