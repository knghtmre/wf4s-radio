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
    player.stop();
    queue();
    message.reply('⏭️ Skipping to next track!');
  }
  
  if(commandName == "stop"){
    player.stop();
    message.reply('⏹️ Radio stopped. Use `play` to resume.');
  }
  
  if(commandName == "play"){
    queue();
    message.reply('▶️ Radio starting!');
  }
  
  if(commandName == "news"){
    const newsStory = getRandomNews();
    if (newsStory) {
      message.reply(`📰 **Star Citizen News:** ${newsStory}`);
    } else {
      message.reply('No news available right now.');
    }
  }
  
  if(commandName == "genre"){
    const genre = args[0];
    if (genre) {
      message.reply(`🎵 Genre preference noted: ${genre} (feature coming soon!)`);
    } else {
      message.reply('Usage: `genre <electronic|chill|dance|house>`');
    }
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
      // Get trending tracks from Audius
      const audiusTracks = await getAudiusTracks();
      if (!audiusTracks || audiusTracks.length === 0) {
        console.error('No tracks available from Audius');
        playInitialMessage();
        return;
      }

      const nextSong = getRandomElement(audiusTracks);
      if (!nextSong) {
        console.error('Could not get next song');
        playInitialMessage();
        return;
      }

      // Decide if we should announce news
      songsSinceNews++;
      const newsFrequency = parseInt(process.env.NEWS_FREQUENCY) || 4; // Default to every 4 songs
      const shouldAnnounceNews = songsSinceNews >= newsFrequency;
      
      if (shouldAnnounceNews && scNews.length > 0) {
        const newsItem = getNextNews();
        await get(newsItem, nextSong.title, nextSong.id, true);
        songsSinceNews = 0;
      } else {
        // Just announce the song
        await get(null, nextSong.title, nextSong.id, false);
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

async function get(newsItem, nextSong, url, hasNews) {
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
        ? `You are Ava, the AI DJ for WF4S Haulin' Radio (operated by Foxtrot-Four Solutions), a Star Citizen-themed station. It's ${zuluTime}. Announce this Star Citizen news: "${newsItem.condensed}" Then announce you'll play this song next: ${nextSong} Keep it under 180 characters total. Be energetic and use space/hauling slang!`
        : `You are Ava, the AI DJ for WF4S Haulin' Radio (operated by Foxtrot-Four Solutions), a Star Citizen-themed station. Announce this Star Citizen news: "${newsItem.condensed}" Then announce you'll play this song next: ${nextSong} Keep it under 180 characters total. Be energetic and use space/hauling slang!`;
    } else {
      prompt = includeZulu
        ? `You are Ava, the AI DJ for WF4S Haulin' Radio (operated by Foxtrot-Four Solutions), a Star Citizen-themed station. It's ${zuluTime}. Announce that you're playing this song next: ${nextSong} Keep it under 120 characters. Be brief, energetic, and use space/hauling slang!`
        : `You are Ava, the AI DJ for WF4S Haulin' Radio (operated by Foxtrot-Four Solutions), a Star Citizen-themed station. Announce that you're playing this song next: ${nextSong} Keep it under 100 characters. Be brief, energetic, and use space/hauling slang!`;
    }

    // Build anti-repetition context
    let antiRepetitionHint = '';
    if (recentAnnouncements.length > 0) {
      antiRepetitionHint = `\n\nDO NOT use these phrases you used recently: ${recentAnnouncements.join(', ')}. NEVER repeat "strap in", "buckle up", "space cowboys", or "hold on tight" - you've used them too much. Use completely different openings every time.`;
    }

    const completion = await openai.createChatCompletion({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are Ava, the sarcastic and flirty AI DJ for WF4S Haulin' Radio, operated by Foxtrot-Four Solutions (F4S). You're funny as hell, use space puns, trucker slang, Star Citizen jokes, and aren't afraid to drop a 'damn' or 'hell' when it fits. You're a bit cheeky and love to tease the space truckers. Keep it VERY SHORT (max 180 chars). Be witty, sarcastic, playful, and a little spicy!" + antiRepetitionHint
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.9,
      max_tokens: 80
    });

    let text = completion.data.choices[0].message.content;
    
    // Validate: reject if contains banned phrases
    const bannedPhrases = ['strap in', 'buckle up', 'space cowboys', 'hold on tight', 'cosmic cowpokes'];
    const lowerText = text.toLowerCase();
    const hasBannedPhrase = bannedPhrases.some(phrase => lowerText.includes(phrase));
    
    if (hasBannedPhrase) {
      console.log('Rejected text with banned phrase:', text);
      // Use a simple fallback instead
      text = `Next up on WF4S Radio: ${nextSong}!`;
    }
    
    console.log('Generated text:', text);
    
    // Track this announcement to avoid repetition
    recentAnnouncements.push(text);
    if (recentAnnouncements.length > MAX_RECENT_ANNOUNCEMENTS) {
      recentAnnouncements.shift();
    }
    
    playAudio(url, text);
  } catch(err) {
    console.error('Error generating radio content:', err);
    playAudio(url, process.env.errormessage);
  }
}

async function playAudio(link, message) {
  console.log('Playing audio message and song...');

  if(premiumVoice == false){
  const messageParts = splitString(message);
  playTextToSpeech(messageParts.shift());
  setTimeout(function(){
  player.on(AudioPlayerStatus.Idle, () => {
    if (messageParts.length === 0) {
      player.removeAllListeners();
      playSong(link);
    } else {
      playTextToSpeech(messageParts.shift());
    }
  });
},3000)
}else{
  // Play TTS with proper fallback handling
  await playTextToSpeech(message);
  
  // Wait a bit for TTS to start, then listen for it to finish
  setTimeout(function(){
    player.once(AudioPlayerStatus.Idle, () => {
      console.log('TTS finished, starting music...');
      playSong(link);
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
  try {
    // Try Azure first if configured
    const azureKey = process.env.AZURE_SPEECH_KEY;
    const azureRegion = process.env.AZURE_SPEECH_REGION || 'eastus';
    
    if (azureKey) {
      console.log('Using Azure TTS');
      return await playTextToSpeechAzure(text, azureKey, azureRegion);
    }
    
    // Final fallback to Google TTS
    console.log('Using Google TTS (fallback)');
    playTextToSpeechGoogle(text);
  } catch (error) {
    console.error('TTS error, falling back to Google:', error.message);
    playTextToSpeechGoogle(text);
  }
}

async function playTextToSpeechAzure(text, azureKey, azureRegion) {
  
  return new Promise((resolve, reject) => {
    const speechConfig = sdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
    speechConfig.speechSynthesisVoiceName = 'en-US-Ava:DragonHDLatestNeural';  // Premium HD voice
    
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);
    
    synthesizer.speakTextAsync(
      text,
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
  return new Promise(async (resolve, reject) => {
    try {
      const stream = await voice.textToSpeechStream({
        textInput: text,
        voiceId: "x8xv0H8Ako6Iw3cKXLoC",
        modelId: "eleven_multilingual_v2",
        responseType: "stream"
      });

      const audioResource = createAudioResource(stream, { inputType: StreamType.Arbitrary });
      
      player.play(audioResource);
      
      // Wait for audio to finish
      player.once(AudioPlayerStatus.Idle, () => {
        resolve();
      });
      
      // Handle errors
      player.once('error', (error) => {
        console.error('ElevenLabs playback error:', error);
        reject(error);
      });
    } catch (error) {
      console.error('ElevenLabs stream error:', error);
      reject(error);
    }
  });
}

async function playSong(trackId) {
  if (!trackId || typeof trackId !== 'string') {
    console.error('Invalid track ID provided to playSong:', trackId);
    queue();
    return;
  }

  console.log('Playing Audius track:', trackId);
  
  try {
    // Audius stream URL - simple and direct!
    const streamUrl = `https://api.audius.co/v1/tracks/${trackId}/stream?app_name=WF4SRadio`;
    console.log('Stream URL:', streamUrl);
    
    const https = require('https');
    
    // Create a promise to wait for the response with redirect following
    const stream = await new Promise((resolve, reject) => {
      const followRedirect = (url, depth = 0) => {
        if (depth > 5) {
          reject(new Error('Too many redirects'));
          return;
        }
        
        const protocol = url.startsWith('https') ? https : require('http');
        protocol.get(url, (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            const redirectUrl = response.headers.location;
            console.log(`Following redirect ${depth + 1} to:`, redirectUrl);
            followRedirect(redirectUrl, depth + 1);
          } else if (response.statusCode === 200) {
            resolve(response);
          } else {
            reject(new Error(`HTTP ${response.statusCode}`));
          }
        }).on('error', reject);
      };
      
      followRedirect(streamUrl);
    });

    stream.on('error', (error) => {
      console.error('Audius stream error:', error);
      queue();
    });

    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
      highWaterMark: 1 << 25  // 32MB buffer to prevent skipping
    });

    resource.volume?.setVolume(0.35);  // 35% volume for balance with voice
    
    // Remove only the specific listeners we're about to add
    player.removeAllListeners(AudioPlayerStatus.Idle);
    player.removeAllListeners('error');
    
    player.once(AudioPlayerStatus.Idle, () => {
      queue();
    });

    player.once('error', error => {
      console.error('Player error:', error);
      queue();
    });

    player.play(resource);

  } catch (error) {
    console.error('Error in playSong:', error);
    queue();
  }
}

let jingleCounter = 0;

async function playJingle() {
  try {
    const fs = require('fs');
    const path = require('path');
    const jinglesDir = path.join(__dirname, 'jingles');
    
    // Check if jingles directory exists
    if (!fs.existsSync(jinglesDir)) {
      console.log('No jingles directory found, skipping jingle');
      return false;
    }
    
    // Get all audio files from jingles directory
    const files = fs.readdirSync(jinglesDir)
      .filter(file => /\.(mp3|wav|ogg)$/i.test(file));
    
    if (files.length === 0) {
      console.log('No jingle files found, skipping jingle');
      return false;
    }
    
    // Pick random jingle
    const jingleFile = files[Math.floor(Math.random() * files.length)];
    const jinglePath = path.join(jinglesDir, jingleFile);
    
    console.log(`Playing jingle: ${jingleFile}`);
    
    // Create audio resource from jingle file
    const resource = createAudioResource(jinglePath, {
      inlineVolume: true
    });
    
    resource.volume?.setVolume(0.5);  // 50% volume for jingles
    
    // Play jingle and wait for it to finish
    await new Promise((resolve) => {
      player.removeAllListeners(AudioPlayerStatus.Idle);
      player.removeAllListeners('error');
      
      player.once(AudioPlayerStatus.Idle, resolve);
      player.once('error', (error) => {
        console.error('Jingle playback error:', error);
        resolve();
      });
      
      player.play(resource);
    });
    
    return true;
  } catch (error) {
    console.error('Error playing jingle:', error);
    return false;
  }
}

async function queue() {
  const userCount = await connectedUsers();
  if (userCount > 0) {
    // Check if we should play a jingle
    const jingleFrequency = parseInt(process.env.JINGLE_FREQUENCY) || 5; // Default: every 5 songs
    jingleCounter++;
    
    if (jingleCounter >= jingleFrequency) {
      jingleCounter = 0;
      const played = await playJingle();
      if (played) {
        // Wait a bit after jingle before starting next song
        setTimeout(start, 2000);
        return;
      }
    }
    
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
