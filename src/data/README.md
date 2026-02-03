# Games Metadata

This folder contains game metadata (JSON) with HTTPS URLs for images and GIFs.

## Structure

```
data/
└── games-metadata.json          # Game metadata (descriptions, HTTPS URLs)
```

## Adding a New Game

Add game metadata to `games-metadata.json`:

```json
{
  "gameCode": "your-game-code",
  "thumbnail": "https://your-cdn.com/games/your-game-code/thumbnail.jpg",
  "description": "Your game description",
  "demoGif": "https://your-cdn.com/games/your-game-code/demo.gif",
  "images": [
    "https://your-cdn.com/games/your-game-code/image1.jpg",
    "https://your-cdn.com/games/your-game-code/image2.jpg",
    "https://your-cdn.com/games/your-game-code/image3.jpg"
  ]
}
```

## Fields

- **gameCode**: Must match the game code in the database
- **thumbnail**: HTTPS URL to the thumbnail image (shown on dashboard)
- **description**: Short description text (shown on dashboard card)
- **demoGif**: HTTPS URL to the demo GIF (shown on details page)
- **images**: Array of 2-3 HTTPS URLs to game images (shown as thumbnails on details page)

## Notes

- All URLs must be HTTPS
- Thumbnail is displayed on the dashboard game cards
- Demo GIF and images are displayed on the game details page
- Images should be optimized for web (JPEG/WebP format)
- GIFs should be optimized for web performance
