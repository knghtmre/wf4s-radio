const axios = require('axios');
const fs = require('fs');

require('dotenv').config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function condenseWithGPT(title) {
  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a radio DJ for WF4S Haulin Radio, a Star Citizen-themed station. Condense news into ONE short, punchy sentence (max 25 words) suitable for radio. Be enthusiastic and use space/hauling terminology when relevant.'
        },
        {
          role: 'user',
          content: `Condense this Star Citizen news: "${title}"`
        }
      ],
      max_tokens: 60,
      temperature: 0.8
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error condensing story:', error.response?.data || error.message);
    return null;
  }
}

async function fetchStarCitizenNews() {
  console.log('Fetching Star Citizen news...');
  
  const newsStories = [];
  
  try {
    // Fetch from Reddit /r/starcitizen
    console.log('Fetching from Reddit...');
    const redditResponse = await axios.get('https://www.reddit.com/r/starcitizen/top.json?t=day&limit=15', {
      headers: { 'User-Agent': 'WF4S-Radio-Bot/1.0' }
    });
    
    const redditPosts = redditResponse.data.data.children;
    for (const post of redditPosts) {
      const data = post.data;
      if (data.stickied) continue; // Skip pinned posts
      
      newsStories.push({
        title: data.title,
        source: 'Reddit',
        url: `https://reddit.com${data.permalink}`,
        upvotes: data.ups
      });
    }
    
    console.log(`Fetched ${newsStories.length} stories from Reddit`);
    
  } catch (error) {
    console.error('Error fetching Reddit news:', error.message);
  }
  
  // Condense news stories using GPT
  console.log('Condensing news stories with GPT...');
  const condensedNews = [];
  
  for (const story of newsStories.slice(0, 20)) { // Process top 20
    const condensed = await condenseWithGPT(story.title);
    
    if (condensed) {
      condensedNews.push({
        original: story.title,
        condensed: condensed,
        source: story.source,
        timestamp: new Date().toISOString()
      });
      console.log(`✓ Condensed: ${story.title.substring(0, 50)}...`);
    }
    
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Save to file
  const newsData = {
    fetchedAt: new Date().toISOString(),
    stories: condensedNews
  };
  
  fs.writeFileSync('/home/ubuntu/ASAR/sc_news.json', JSON.stringify(newsData, null, 2));
  console.log(`\n✅ Saved ${condensedNews.length} condensed news stories to sc_news.json`);
}

// Run immediately
fetchStarCitizenNews().catch(console.error);
