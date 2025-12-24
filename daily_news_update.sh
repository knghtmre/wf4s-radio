#!/bin/bash
# Daily Star Citizen news update for WF4S Haulin' Radio
# Runs once per day to fetch fresh news

cd /home/ubuntu/ASAR
source /home/ubuntu/.user_env
node fetch_sc_news.js >> /home/ubuntu/ASAR/news_update.log 2>&1
echo "News updated at $(date)" >> /home/ubuntu/ASAR/news_update.log
