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
let songsSinceNews = 0;

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

      // Decide if we should announce news (every 3-5 songs)
      songsSinceNews++;
      const shouldAnnounceNews = songsSinceNews >= 3 && Math.random() < 0.6; // 60% chance after 3 songs
      
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

  try {
    let prompt;
    if (hasNews && newsItem) {
      prompt = `You are Ava, the AI DJ for WF4S Haulin' Radio, a Star Citizen-themed station. Announce this Star Citizen news: "${newsItem.condensed}" Then announce you'll play this song next: ${nextSong} Keep it under 180 characters total. Be energetic and use space/hauling slang!`;
    } else {
      prompt = `You are Ava, the AI DJ for WF4S Haulin' Radio, a Star Citizen-themed station. Announce that you're playing this song next: ${nextSong} Keep it under 100 characters. Be brief, energetic, and use space/hauling slang!`;
    }

    const completion = await openai.createChatCompletion({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are Ava, the sassy AI DJ for WF4S Haulin' Radio. You're funny, use space puns, trucker slang, and Star Citizen jokes. Keep it VERY SHORT (max 180 chars). Be witty, playful, and entertaining!"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 80
    });

    const text = completion.data.choices[0].message.content;
    console.log('Generated text:', text);
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
  // Play TTS and wait for it to finish
  playTextToSpeechAzure(message);  // Azure TTS
  
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

async function playTextToSpeechAzure(text) {
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

async function playTextToSpeech(text) {
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
    
    // Create a promise to wait for the response
    const stream = await new Promise((resolve, reject) => {
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

    stream.on('error', (error) => {
      console.error('Audius stream error:', error);
      queue();
    });

    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
      highWaterMark: 1 << 25  // 32MB buffer to prevent skipping
    });

    resource.volume?.setVolume(1);
    
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
    console.error('Error in playSong:', error);
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
