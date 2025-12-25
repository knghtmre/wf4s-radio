// New function using play-dl for YouTube and SoundCloud
const play = require('play-dl');

async function getTracksWithPlayDl() {
  try {
    const searchQueries = [
      'electronic music mix',
      'space ambient music',
      'synthwave mix',
      'chill electronic',
      'EDM mix 2024',
      'house music mix'
    ];
    
    const randomQuery = searchQueries[Math.floor(Math.random() * searchQueries.length)];
    console.log(`Searching YouTube for: ${randomQuery}`);
    
    // Search YouTube
    const searchResults = await play.search(randomQuery, {
      limit: 20,
      source: { youtube: 'video' }
    });
    
    if (!searchResults || searchResults.length === 0) {
      throw new Error('No YouTube results found');
    }
    
    const tracks = searchResults.map(video => ({
      id: video.url,
      title: video.title,
      artist: video.channel.name,
      source: 'youtube',
      duration: video.durationInSec
    }));
    
    console.log(`Found ${tracks.length} YouTube tracks`);
    return tracks;
  } catch (error) {
    console.error('Error fetching tracks with play-dl:', error);
    throw error;
  }
}

async function streamTrackWithPlayDl(trackUrl) {
  try {
    console.log(`Streaming from: ${trackUrl}`);
    const stream = await play.stream(trackUrl);
    return stream.stream; // Return the audio stream
  } catch (error) {
    console.error('Error streaming with play-dl:', error);
    throw error;
  }
}

module.exports = { getTracksWithPlayDl, streamTrackWithPlayDl };
