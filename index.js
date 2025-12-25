require('dotenv').config(); // npm i dotenv

const { Client, GatewayIntentBits, ActivityType, ChannelType } = require('discord.js');
const { AudioPlayer, createAudioResource, StreamType, joinVoiceChannel, createAudioPlayer, AudioPlayerStatus, getVoiceConnection } = require("@discordjs/voice");
const ytdl = require("@distube/ytdl-core");
const ytpl = require('ytpl');
const discordTTS = require("discord-tts");
// NewsAPI removed - using Star Citizen news from Reddit instead
const { Configuration, OpenAIApi } = require('openai');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const { PassThrough } = require('stream');
const SoundCloud = require('soundcloud-scraper');
// Use API key from environment, or it will auto-generate one
const soundcloudClient = new SoundCloud.Client(process.env.SOUNDCLOUD_API_KEY || 'dH1Xed1fpITYonugor6sw39jvdq58M3h');
const play = require('play-dl');

// NewsAPI initialization removed

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

let premiumVoice = true;
let dataradio = process.env.dataradio;

// Star Citizen news tracking
let scNews = [];
let newsIndex = 0;
let announceZuluTime = true; // Toggle for every other announcement
let songsSinceNews = 0;

// SoundCloud track caching
let soundcloudTracks = [];
let soundcloudTrackIndex = 0;
let soundcloudLastFetch = 0;
const SOUNDCLOUD_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Track recent announcements to avoid repetition
let recentAnnouncements = [];
const MAX_RECENT_ANNOUNCEMENTS = 5;

const ElevenLabs = require('elevenlabs-node');
let voice = undefined;
if(process.env.ELEVEN_LABS_API_KEY){
  voice = new ElevenLabs({
    apiKey: process.env.ELEVEN_LABS_API_KEY,
  });
}else{
  premiumVoice = false;
}

// Event listener for commands


let player = createAudioPlayer();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] });

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.user.setPresence({
    activities: [{ name: `Powered by Neo`, type: ActivityType.Listening }],
    status: 'online',
  });

  client.guilds.cache.forEach(async (guild) => {
    guild.channels.cache.forEach(async (channel) => {
      if (channel.name.toLowerCase().includes("radio")) {
        await connectToChannel(channel);
      }
    });
  });

  queue();
});

// Monitor voice channel for empty state
client.on('voiceStateUpdate', (oldState, newState) => {
  // Check if someone left the radio channel
  if (oldState.channelId && oldState.channel?.name.toLowerCase().includes('radio')) {
    const channel = oldState.channel;
    // Count non-bot members in the channel
    const memberCount = channel.members.filter(member => !member.user.bot).size;
    
    if (memberCount === 0) {
      console.log('Voice channel empty, disconnecting...');
      const connection = getVoiceConnection(channel.guild.id);
      if (connection) {
        connection.destroy();
        player.stop();
        console.log('Disconnected from empty channel');
      }
    }
  }
  
  // Check if someone joined the radio channel and bot is not connected
  if (newState.channelId && newState.channel?.name.toLowerCase().includes('radio')) {
    const channel = newState.channel;
    const connection = getVoiceConnection(channel.guild.id);
    const memberCount = channel.members.filter(member => !member.user.bot).size;
    
    if (!connection && memberCount > 0) {
      console.log('User joined radio channel, reconnecting...');
      connectToChannel(channel);
      if (player.state.status !== AudioPlayerStatus.Playing) {
        queue();
      }
    }
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  if(commandName == "skip"){
    connection.player.stop();
    start()
  }
});

async function connectToChannel(channel) {
  console.log(`Connecting to channel: ${channel.name}`);
  try {
    const connection = await joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });

    const networkStateChangeHandler = (oldNetworkState, newNetworkState) => {
      const newUdp = Reflect.get(newNetworkState, 'udp');
      clearInterval(newUdp?.keepAliveInterval);
    };

    connection.on('stateChange', (oldState, newState) => {
      Reflect.get(oldState, 'networking')?.off('stateChange', networkStateChangeHandler);
      Reflect.get(newState, 'networking')?.on('stateChange', networkStateChangeHandler);
    });

    connection.subscribe(player);
    console.log('Successfully connected and subscribed to the channel');
  } catch (error) {
    console.error('Error connecting to channel:', error);
  }
}

async function start() {
  console.log('Starting radio...');
  player = createAudioPlayer();
  client.guilds.cache.forEach(async (guild) => {
    guild.channels.cache.forEach(async (channel) => {
      if (channel.name.toLowerCase().includes("radio")) {
        const connection = getVoiceConnection(guild.id);
        if (connection) {
          connection.subscribe(player);
        }
      }
    });
  });

  // Load Star Citizen news on first run
  if (scNews.length === 0) {
    loadStarCitizenNews();
  }

  try {

    try {
      // Try SoundCloud first, fallback to Audius
      let tracks = [];
      let source = 'soundcloud';
      
      try {
        // Try YouTube first with play-dl
        console.log('Attempting to fetch tracks from YouTube (play-dl)...');
        const { getTracksWithPlayDl } = require('./get_tracks_playdl');
        tracks = await getTracksWithPlayDl();
        source = 'youtube';
        console.log(`Loaded ${tracks.length} tracks from YouTube`);
      } catch (ytError) {
        console.warn('YouTube failed, falling back to Audius:', ytError.message);
        source = 'audius';
        tracks = await getAudiusTracks();
        console.log(`Loaded ${tracks.length} tracks from Audius (fallback)`);
      }
      
      if (!tracks || tracks.length === 0) {
        console.error('No tracks available from any source');
        playInitialMessage();
        return;
      }

      const nextSong = getRandomElement(tracks);
      if (!nextSong) {
        console.error('Could not get next song');
        playInitialMessage();
        return;
      }
      
      nextSong.source = source; // Track which source we're using

      // Decide if we should announce news (every 3-5 songs)
      songsSinceNews++;
      const shouldAnnounceNews = songsSinceNews >= 3 && Math.random() < 0.6; // 60% chance after 3 songs
      
      if (shouldAnnounceNews && scNews.length > 0) {
        const newsItem = getNextNews();
        await get(newsItem, nextSong, true);
        songsSinceNews = 0;
      } else {
        // Just announce the song
        await get(null, nextSong, false);
      }
    } catch (error) {
      console.error('Error in playlist handling:', error);
      playInitialMessage();
    }
  } catch (error) {
    console.error('Error in start function:', error);
    playInitialMessage();
  }
}

function playInitialMessage() {
  let resource = createAudioResource("./warte.mp3")
  player.play(resource)
}

async function getAudiusTracks() {
  return new Promise((resolve, reject) => {
    const https = require('https');
    https.get('https://api.audius.co/v1/tracks/trending?app_name=WF4SRadio&limit=50', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.data && response.data.length > 0) {
            const tracks = response.data.map(track => ({
              id: track.id,
              title: `${track.user.name} - ${track.title}`,
              artist: track.user.name
            }));
            console.log(`Loaded ${tracks.length} tracks from Audius`);
            resolve(tracks);
          } else {
            reject(new Error('No tracks found'));
          }
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

async function getSoundCloudTracks() {
  try {
    // Check if we have cached tracks that are still fresh
    const now = Date.now();
    if (soundcloudTracks.length > 0 && (now - soundcloudLastFetch) < SOUNDCLOUD_CACHE_DURATION) {
      console.log(`Using cached SoundCloud tracks (${soundcloudTracks.length} available)`);
      return soundcloudTracks;
    }
    
    console.log('Fetching fresh SoundCloud tracks...');
    
    // Search for popular electronic/dance music on SoundCloud
    const searchQueries = [
      'electronic music',
      'dance music',
      'EDM',
      'house music',
      'chill music',
      'synthwave',
      'space music'
    ];
    
    const randomQuery = searchQueries[Math.floor(Math.random() * searchQueries.length)];
    console.log(`Searching SoundCloud for: ${randomQuery}`);
    
    // Add timeout to prevent hanging
    const searchPromise = soundcloudClient.search(randomQuery, 'track', 50);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('SoundCloud search timeout')), 15000)
    );
    
    const results = await Promise.race([searchPromise, timeoutPromise]);
    
    console.log('SoundCloud search results type:', typeof results);
    console.log('SoundCloud search results:', JSON.stringify(results).substring(0, 200));
    
    // Handle different response formats
    let tracksArray = [];
    if (Array.isArray(results)) {
      tracksArray = results;
    } else if (results && results.collection && Array.isArray(results.collection)) {
      tracksArray = results.collection;
    } else if (results && results.tracks && Array.isArray(results.tracks)) {
      tracksArray = results.tracks;
    } else {
      console.error('Unexpected SoundCloud response format:', results);
      throw new Error('Invalid SoundCloud response format');
    }
    
    if (!tracksArray || tracksArray.length === 0) {
      throw new Error('No SoundCloud tracks found in response');
    }
    
    console.log(`Processing ${tracksArray.length} SoundCloud tracks`);
    console.log('Testing tracks for streamability...');
    
    const validTracks = [];
    const testLimit = Math.min(30, tracksArray.length);
    
    for (let i = 0; i < testLimit && validTracks.length < 15; i++) {
      const track = tracksArray[i];
      if (!track || !track.url || !(track.name || track.title)) continue;
      
      try {
        const info = await Promise.race([
          soundcloudClient.getSongInfo(track.url),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
        ]);
        
        if (info && info.trackURL) {
          validTracks.push({
            id: track.url,
            title: `${track.artist || 'Unknown'} - ${track.name || track.title || 'Unknown'}`,
            artist: track.artist || 'Unknown',
            source: 'soundcloud'
          });
        }
      } catch (e) {
        continue;
      }
    }
    
    if (validTracks.length === 0) {
      throw new Error('No streamable SoundCloud tracks found');
    }
    
    console.log(`Found ${validTracks.length} streamable tracks`);
    const tracks = validTracks;
    
    // Cache the tracks
    soundcloudTracks = tracks;
    soundcloudLastFetch = now;
    soundcloudTrackIndex = 0;
    
    console.log(`Found and cached ${tracks.length} SoundCloud tracks`);
    return tracks;
  } catch (error) {
    console.error('Error fetching SoundCloud tracks:', error);
    throw error;
  }
}

async function getNextSong(items) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    console.error('Invalid items array provided to getNextSong');
    return null;
  }

  try {
    // Try multiple items in case some are unavailable
    for (let i = 0; i < Math.min(5, items.length); i++) {
      const randomItem = getRandomElement(items);
      if (!randomItem || !randomItem.shortUrl) {
        console.warn('Invalid item found in playlist, skipping...');
        continue;
      }

      try {
        // Verify the video is available
        const videoInfo = await ytdl.getBasicInfo(randomItem.shortUrl);
        if (!videoInfo || videoInfo.videoDetails.isPrivate) {
          console.warn(`Video ${randomItem.shortUrl} is not available, skipping...`);
          continue;
        }

        return {
          title: randomItem.title ? randomItem.title.replace(/\[.*?\]|\(.*?\)/g, '').replace('-', 'with').trim() : 'Unknown Title',
          shortUrl: randomItem.shortUrl
        };
      } catch (error) {
        console.warn(`Skipping unavailable video: ${randomItem.title}`, error.message);
        continue;
      }
    }
    throw new Error('No available songs found after multiple attempts');
  } catch (error) {
    console.error('Error in getNextSong:', error);
    // Return a safe fallback
    return items[0] && items[0].shortUrl ? {
      title: "the next song",
      shortUrl: items[0].shortUrl
    } : null;
  }
}

function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function loadStarCitizenNews() {
  try {
    const fs = require('fs');
    const newsPath = fs.existsSync('/home/ubuntu/ASAR/sc_news.json') ? '/home/ubuntu/ASAR/sc_news.json' : __dirname + '/sc_news_default.json';
    const newsData = JSON.parse(fs.readFileSync(newsPath, 'utf8'));
    scNews = newsData.stories || [];
    newsIndex = 0;
    console.log(`Loaded ${scNews.length} Star Citizen news stories`);
  } catch (error) {
    console.error('Error loading Star Citizen news:', error.message);
    scNews = [];
  }
}

function getNextNews() {
  if (scNews.length === 0) return null;
  const news = scNews[newsIndex];
  newsIndex = (newsIndex + 1) % scNews.length;
  return news;
}

async function get(newsItem, songObj, hasNews) {
  const nextSong = songObj.title;
  const url = songObj.id;
  const source = songObj.source || 'audius';
  const todaysDate = new Date();
  const time = todaysDate.getHours()+":"+todaysDate.getMinutes();
  
  // Get Zulu time in HHMM format
  const zuluHours = String(todaysDate.getUTCHours()).padStart(2, '0');
  const zuluMins = String(todaysDate.getUTCMinutes()).padStart(2, '0');
  const zuluTime = `${zuluHours}${zuluMins} Zulu`;
  
  // Toggle Zulu time announcement
  const includeZulu = announceZuluTime;
  announceZuluTime = !announceZuluTime;

  try {
    let prompt;
    if (hasNews && newsItem) {
      prompt = includeZulu 
        ? `You are Ava, the AI DJ for WF4S Haulin' Radio, a Star Citizen-themed station. It's ${zuluTime}. Announce this Star Citizen news: "${newsItem.condensed}" Then announce you'll play this song next: ${nextSong} Keep it under 180 characters total. Be energetic and use space/hauling slang!`
        : `You are Ava, the AI DJ for WF4S Haulin' Radio, a Star Citizen-themed station. Announce this Star Citizen news: "${newsItem.condensed}" Then announce you'll play this song next: ${nextSong} Keep it under 180 characters total. Be energetic and use space/hauling slang!`;
    } else {
      prompt = includeZulu
        ? `You are Ava, the AI DJ for WF4S Haulin' Radio, a Star Citizen-themed station. It's ${zuluTime}. Announce that you're playing this song next: ${nextSong} Keep it under 120 characters. Be brief, energetic, and use space/hauling slang!`
        : `You are Ava, the AI DJ for WF4S Haulin' Radio, a Star Citizen-themed station. Announce that you're playing this song next: ${nextSong} Keep it under 100 characters. Be brief, energetic, and use space/hauling slang!`;
    }

    // Build messages with recent announcements for context
    const messages = [
      {
        role: "system",
        content: "You are Ava, the sarcastic and flirty AI DJ for WF4S Haulin' Radio. You're funny as hell, use space puns, trucker slang, Star Citizen jokes, and aren't afraid to drop a 'damn' or 'hell' when it fits. You're a bit cheeky and love to tease the space truckers. Keep it VERY SHORT (max 180 chars). Be witty, sarcastic, playful, and a little spicy! IMPORTANT: Vary your opening phrases - don't repeat the same greeting or intro multiple times in a row. Mix it up! Avoid overusing phrases like 'buckle up', 'strap in', 'hold on tight' - use diverse vocabulary."
      }
    ];
    
    // Add recent announcements as context to avoid repetition
    if (recentAnnouncements.length > 0) {
      messages.push({
        role: "system",
        content: `Your last ${recentAnnouncements.length} announcements were: ${recentAnnouncements.join(' | ')} - Make sure this one is DIFFERENT. Use a fresh opening and vary your style. DO NOT use phrases like 'buckle up', 'strap in', 'hold on' if you've used them recently. Vary your vocabulary completely.`
      });
    }
    
    messages.push({
      role: "user",
      content: prompt
    });

    const completion = await openai.createChatCompletion({
      model: "gpt-4o",
      messages: messages,
      temperature: 0.9,
      max_tokens: 80
    });

    const text = completion.data.choices[0].message.content;
    console.log('Generated text:', text);
    
    // Track this announcement to avoid repetition
    recentAnnouncements.push(text);
    if (recentAnnouncements.length > MAX_RECENT_ANNOUNCEMENTS) {
      recentAnnouncements.shift();
    }
    
    playAudio(songObj, text);
  } catch(err) {
    console.error('Error generating radio content:', err);
    playAudio(songObj, process.env.errormessage);
  }
}

async function playAudio(songObj, message) {
  console.log('Playing audio message and song...');
  const link = songObj.id;
  const source = songObj.source || 'audius';

  if(premiumVoice == false){
  const messageParts = splitString(message);
  playTextToSpeech(messageParts.shift());
  setTimeout(function(){
  player.on(AudioPlayerStatus.Idle, () => {
    if (messageParts.length === 0) {
      player.removeAllListeners();
      playSong(songObj);
    } else {
      playTextToSpeech(messageParts.shift());
    }
  });
},3000)
}else{
  // Play TTS and wait for it to finish
  playTextToSpeechAzure(message);  // Azure TTS
  
  // Wait a bit for TTS to start, then listen for it to finish
  setTimeout(function(){
    player.once(AudioPlayerStatus.Idle, () => {
      console.log('TTS finished, starting music...');
      playSong(songObj);
    });
  }, 1000)  // Short delay to let TTS start

}
}

function playTextToSpeechGoogle(text) {
  const stream = discordTTS.getVoiceStream(text);
  const audioResource = createAudioResource(stream, { inputType: StreamType.Arbitrary, inlineVolume: true });
  player.play(audioResource);
}

async function playTextToSpeech(text) {
  const azureKey = process.env.AZURE_SPEECH_KEY;
  const azureRegion = process.env.AZURE_SPEECH_REGION || 'eastus';
  
  if (!azureKey) {
    console.error('Azure Speech key not configured, falling back to Google TTS');
    playTextToSpeechGoogle(text);
    return;
  }
  
  return new Promise((resolve, reject) => {
    const speechConfig = sdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
    speechConfig.speechSynthesisVoiceName = 'en-US-Ava:DragonHDLatestNeural';  // Premium HD voice
    
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);
    
    // Create SSML for better speech quality with natural pauses
    const ssml = `
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
  <voice name="en-US-AvaMultilingualNeural">
    <prosody rate="1.0" pitch="0%">
      ${text}
    </prosody>
  </voice>
</speak>`;
    
    synthesizer.speakSsmlAsync(
      ssml,
      result => {
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          console.log('Azure TTS: Audio synthesized successfully');
          
          // Get audio data as buffer
          const audioData = result.audioData;
          const buffer = Buffer.from(audioData);
          
          // Create a readable stream from buffer
          const { Readable } = require('stream');
          const stream = Readable.from(buffer);
          
          const audioResource = createAudioResource(stream, { 
            inputType: StreamType.Arbitrary,
            inlineVolume: true 
          });
          player.play(audioResource);
          resolve();
        } else {
          console.error('Azure TTS error:', result.errorDetails);
          reject(new Error(result.errorDetails));
        }
        synthesizer.close();
      },
      error => {
        console.error('Azure TTS error:', error);
        synthesizer.close();
        reject(error);
      }
    );
  });
}

async function playTextToSpeechElevenLabs(text) {
  const stream = await voice.textToSpeechStream({
    textInput: text,
    responseType: 'stream', // Stream the audio directly
    voiceId:         "x8xv0H8Ako6Iw3cKXLoC",         // User's custom voice
    modelId:         "eleven_multilingual_v2",       // The ElevenLabs Model ID
    responseType:    "stream",                       // The streaming type (arraybuffer, stream, json)    
  });

  const audioResource = createAudioResource(stream, { inputType: StreamType.Arbitrary });

  player.play(audioResource);
}

async function playSong(songObj) {
  const trackId = songObj.id;
  const source = songObj.source || 'audius';
  
  if (!trackId) {
    console.error('Invalid track ID provided to playSong:', trackId);
    queue();
    return;
  }

  console.log(`Playing ${source} track:`, trackId);
  
  try {
    let stream;
    
    if (source === 'youtube') {
      // YouTube streaming with play-dl
      console.log('Fetching YouTube stream...');
      const { streamTrackWithPlayDl } = require('./get_tracks_playdl');
      stream = await streamTrackWithPlayDl(trackId);
      console.log('YouTube stream ready');
    } else {
      // Audius stream URL - simple and direct!
      const streamUrl = `https://api.audius.co/v1/tracks/${trackId}/stream?app_name=WF4SRadio`;
      console.log('Stream URL:', streamUrl);
      
      const https = require('https');
      
      // Create a promise to wait for the response
      stream = await new Promise((resolve, reject) => {
      https.get(streamUrl, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          const redirectUrl = response.headers.location;
          console.log('Following redirect to:', redirectUrl);
          https.get(redirectUrl, (redirectResponse) => {
            if (redirectResponse.statusCode === 200) {
              resolve(redirectResponse);
            } else {
              reject(new Error(`HTTP ${redirectResponse.statusCode}`));
            }
          }).on('error', reject);
        } else if (response.statusCode === 200) {
          resolve(response);
        } else {
          reject(new Error(`HTTP ${response.statusCode}`));
        }
      }).on('error', reject);
      });
    }
    
    // Common error handling for both sources
    stream.on('error', (error) => {
      console.error(`${source} stream error:`, error);
      queue();
    });

    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
      highWaterMark: 1 << 25  // 32MB buffer to prevent skipping
    });

    resource.volume?.setVolume(0.35);  // 35% volume to balance with voice
    
    // Remove existing listeners before adding new ones
    player.removeAllListeners();
    
    player.on(AudioPlayerStatus.Idle, () => {
      queue();
    });

    player.on('error', error => {
      console.error('Player error:', error);
      queue();
    });

    player.play(resource);

  } catch (error) {
    console.error(`Error in playSong (${source}):`, error.message);
    
    // If YouTube fails, try Audius as fallback
    if (source === 'youtube') {
      console.log('YouTube failed, attempting Audius fallback...');
      try {
        const audiusTracks = await getAudiusTracks();
        if (audiusTracks && audiusTracks.length > 0) {
          const fallbackSong = getRandomElement(audiusTracks);
          fallbackSong.source = 'audius';
          console.log('Playing Audius fallback track:', fallbackSong.title);
          return playSong(fallbackSong);
        }
      } catch (fallbackError) {
        console.error('Audius fallback also failed:', fallbackError.message);
      }
    }
    
    queue();
  }
}

async function queue() {
  const userCount = await connectedUsers();
  if (userCount > 0) {
    setTimeout(start, 1000);
  } else {
    setTimeout(queue, 1000);
  }
}

async function connectedUsers() {
  let userCount = 0;
  let guilds = new Set();

  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (channel.name.toLowerCase().includes("radio")) {
        if (!guilds.has(guild.id)) {
          guilds.add(guild.id);
          userCount += channel.members.size;
        }
      }
    }
  }

  return userCount - guilds.size;
}

client.on("guildCreate", async (guild) => {
  let defaultChannel = guild.channels.cache.find(channel => channel.type === ChannelType.GuildText);
  if (defaultChannel) {
    defaultChannel.send("Thank you for adding the AI-Powered Radio. I have created a channel for you, **if you already have one, delete it. You can never have duplicates with the name 'radio' in it!**");
  }

  const channel = await guild.channels.create({
    name: "radio",
    type: ChannelType.GuildVoice,
    parent: null,
  });

  await connectToChannel(channel);
});

function splitString(str) {
  const arr = [];
  while (str.length > 0) {
    let substr = str.substring(0, 200);
    if (substr.length === 200) {
      substr = substr.substring(0, Math.min(substr.length, substr.lastIndexOf(" ")));
    }
    arr.push(substr);
    str = str.substring(substr.length).trim(); // Corrected line
  }
  return arr;
}


client.login(process.env.discordtoken);
