// Discord slash commands for WF4S Haulin' Radio
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  commands: [
    new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Skip the current song'),
    
    new SlashCommandBuilder()
      .setName('nowplaying')
      .setDescription('Show what\'s currently playing'),
    
    new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Adjust the radio volume')
      .addIntegerOption(option =>
        option.setName('level')
          .setDescription('Volume level (1-100)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100)),
    
    new SlashCommandBuilder()
      .setName('genre')
      .setDescription('Switch to a specific music genre')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Genre name (rock, electronic, hip-hop, etc.)')
          .setRequired(true)),
    
    new SlashCommandBuilder()
      .setName('search')
      .setDescription('Search for specific songs or artists')
      .addStringOption(option =>
        option.setName('query')
          .setDescription('Song name or artist')
          .setRequired(true))
  ]
};
