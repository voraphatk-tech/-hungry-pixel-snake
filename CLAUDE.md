# Hungry Pixel Snakes (งูหิวพิกเซล)

A Pixel Flow–style puzzle game for my family to play on Android phones and iPad.
**No ads, no in-app purchases, no tracking, no login.**

## Working with the user
- Reply in Thai, in simple words. The user is not a professional programmer.
- Work in small steps. After each step, say exactly what to open or test.
- Before any big change, explain briefly what you are about to do.

## Game rules
- **Top:** a pixel-art picture fills a grid. Every cell has a color, including the background cells.
- **Bottom:** eggs are arranged in 5 columns. Only the front egg of each column can be tapped.
  - Each egg has a color and a number: how many cells the snake inside can eat.
- **Tap an egg:** it hatches into a snake of the same color, and the snake crawls **into the picture**.
  - At most 5 snakes can be on the board at once. Show a counter "x/5".
- **How snakes move (core rule):**
  - Treat the board as a grid. Snakes can only travel through **empty cells**: cells already eaten, plus a walkable margin just outside the bottom edge.
  - Snakes **enter only from the bottom edge**, at the spot closest to their target.
  - A snake path-finds (BFS) through empty cells to the nearest cell of its own color that touches an empty cell, crawls there, and eats it. It repeats this one cell at a time.
  - An eaten cell becomes empty, so snakes tunnel deeper into the picture from the outside in.
  - **A matching cell with no empty path to it cannot be eaten** until other snakes clear a way.
  - Each bite lowers the snake's number by 1 and makes the snake longer. The body follows the head cell by cell, moving smoothly.
  - Snakes can overlap each other; they do not collide.
- **Number reaches 0:** the snake crawls back out through the bottom edge and drops into the hole.
- **Number is not 0, but no reachable cell of its color is left:** the snake crawls back out and coils around a free pole. There are 5 poles.
  - Tapping a snake on a pole sends it back into the board.
- **Lose:** a snake needs a pole but all poles are full.
- **Win:** every cell of the picture has been eaten.
- **Egg numbers:** the eggs of each color must add up exactly to the number of cells of that color. Eggs are generated automatically from the picture, and outer colors tend to come first.

## Levels
Each level is written as text, one character per cell, with `pal` mapping characters to colors. Example:
```js
{ name:'Heart', pal:{'.':'#ffe3c2', r:'#e8425a'}, minC:8, maxC:18, art:[ '..rr..', '.rrrr.', ... ] }
```
`minC` and `maxC` set the range of numbers on the eggs. To add a level, add another object like this.

## Tech
- Plain HTML + JavaScript with Canvas. No framework, no build step.
- The starting file is `index.html`, a prototype.
  - Keep its drawing of pixels, eggs, poles, hole, sounds and levels.
  - **Its snake movement is wrong**: the snakes circle around the outside of the board. Rewrite it to follow "How snakes move" above.
- Make it a PWA that works offline and can be installed to the Android home screen from Chrome.
- Save progress (levels cleared) in localStorage.
- Use only original art, names and sounds. Never use images, names or sounds from the original Pixel Flow game.
- Test in portrait on Android phones (about 360–412px wide) and on iPad.

## Plan
0. **Fix snake movement:** switch to tunnelling into the board as described above, and change the eggs from 3 columns to 5. Let the user play it and confirm it feels right before moving on.
1. **Split files and make it a PWA:** split into `index.html`, `game.js` and `levels.js`, then add `manifest.json`, a service worker and icons.
2. **Deploy to Vercel (free):** the user opens the link in Chrome on Android and taps "Add to Home screen".
3. **Make it more fun:**
   - A level select screen with stars.
   - 15–20 levels that get gradually harder.
   - Egg-cracking effects, sounds, and a mute button.
   - Free, unlimited helpers: add a pole, hatch any egg (not only the front one), shuffle the eggs.
   - Mystery "?" eggs that show their color only once they reach the front.
   - Pairs of eggs tied together with a rope that must hatch together.
4. **Level editor:** a separate page where you paint cells to create a level (so the kids can draw levels too), then copy it out as level code.
5. **APK (optional):** wrap the game with Capacitor and build an .apk to install on our own phones, without the Play Store. Only do this when the user asks.
