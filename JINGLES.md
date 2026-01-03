# Station ID Jingles

## How It Works

The bot can play station ID jingles (audio clips) between songs at configurable intervals.

## Setup

1. **Add jingle files** to the `jingles/` directory
   - Supported formats: MP3, WAV, OGG
   - Name them anything you want (e.g., `station_id_1.mp3`, `wf4s_jingle.wav`)

2. **Configure frequency** in Railway environment variables:
   - Variable: `JINGLE_FREQUENCY`
   - Value: Number of songs between jingles (default: 5)
   - Example: `JINGLE_FREQUENCY=3` plays a jingle every 3 songs

3. **Deploy** - Push changes to GitHub, Railway will auto-deploy

## How Jingles Play

- Bot randomly selects one jingle from the `jingles/` directory
- Plays at 50% volume (balanced with music and voice)
- Plays between songs (after one song ends, before the next starts)
- If no jingles found, skips jingle and continues with music

## Example

```
Song 1 → Song 2 → Song 3 → [JINGLE] → Song 4 → Song 5 → Song 6 → [JINGLE] → ...
```

## Adding Your First Jingle

1. Create your jingle audio file (keep it short, 5-15 seconds recommended)
2. Upload it to the `jingles/` directory in the repo
3. Commit and push:
   ```bash
   git add jingles/your_jingle.mp3
   git commit -m "Add station ID jingle"
   git push
   ```
4. Railway will redeploy and start using it

## Tips

- Keep jingles short (5-15 seconds)
- Use consistent audio levels
- Create multiple variations for variety
- Test locally before deploying
