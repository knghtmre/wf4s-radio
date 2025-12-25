async function get(newsItem, nextSong, url, hasNews) {
  const todaysDate = new Date();
  const time = todaysDate.getHours()+":"+todaysDate.getMinutes();

  try {
    let prompt;
    if (hasNews && newsItem) {
      prompt = `You are Ava, the AI DJ for WF4S Haulin' Radio, a Star Citizen-themed station. 
      Announce this Star Citizen news: "${newsItem.condensed}"
      Then announce you'll play this song next: ${nextSong}
      Keep it under 180 characters total. Be energetic and use space/hauling slang!`;
    } else {
      prompt = `You are Ava, the AI DJ for WF4S Haulin' Radio, a Star Citizen-themed station.
      Announce that you're playing this song next: ${nextSong}
      Keep it under 100 characters. Be brief, energetic, and use space/hauling slang!`;
    }

    const completion = await openai.createChatCompletion({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are Ava, a professional radio DJ for WF4S Haulin' Radio. Keep responses VERY SHORT - maximum 180 characters total. Be punchy and energetic."
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
