# Walking Companion: One-Line Walker, release polish

## What stayed
This is still the logo the owner chose. It has been refined, not redrawn:
- One champagne pointed-pen line with the same parts in the same order: the ground line from the left, a hairline trailing leg, the pointed turn at the shoulder, a shaded downstroke for the torso and front leg, the foot, and the path ahead.
- The same dot head and the same pace point.
- The same basalt watch-dial icon with faint contour rings.

In the overlay on `before-after.png`, the ground line, the back toe, the front heel and the line order sit where they were.

## What changed, measured in the 1000-unit box (ground line y = 812)
| | Before polish | After |
|---|---|---|
| Torso (hip to shoulder tip) | 7.5° forward | 12° (13° in the inline and small cuts) |
| Landing leg (hip to ankle) | 11° | 13° |
| Bend at the hip | 18.5° | 25° (26° inline and small) |
| Neck line (shoulder tip to head centre) | 22° | 12° |
| Head gap: symbol / icon / inline / small | 42 / 41 / 40 / 37 units (0.67 / 0.52 / 0.49 / 0.34 of its diameter) | 19 / 27 / 25 / 42 units (0.30 / 0.35 / 0.31 / 0.36) |
| Head ahead of the hip | 55 units | 55 to 70 units (about 1.5 head radii in the icon and inline cuts) |
| Pace point centre above the ground | 0.9 dot diameters (y 780), on the baseline | 2.0 diameters in the symbol (y 741), 1.7 in the icon and inline cuts |

## The critics' fixes, one by one
1. **Pace point lifted (applied).** After the foot, the path stays down for a step, then climbs the way round 1's tail did. The pace point sits at the end of that climb, one small gap beyond the tail, with its centre two dot diameters above the ground. It can no longer sit on a text baseline as a full stop, or at the toe as a ball. The horizontal and compact lockups drop it (see 8). Checked at 29, 40 and 60 px for the icon, in the 34 px landing tile, and in header lockups 20 to 34 px tall (`work/check/truesize.png`).
2. **Head gap closed, neck upright (applied).** The gap is now about 0.3 of the head's diameter. The icon keeps 27 units, which is just over 1 px at 40 px. The neck line is 12°, down from 22°. The head is placed by solving for the gap along that neck line (`place_head` in `work/walker.py`). Because the torso now leans further, the head ends near its old x (631, not the suggested 615). It is no longer pushed forward of the shoulders, though: the carriage is upright, not chin-forward.
3. **Hip angle (applied, with a different split).** The downstroke now bends 25° at the hip. I tried the suggested split first (torso 10°, landing leg 17°) and re-ran the overlay against a serif λ (`work/lambda_overlay.py`, Liberation Serif, best-fitted width and position, overlap of inked pixels at 16, 24 and 34 px). A 17° landing leg lines up with λ's long diagonal, so the overlap rose from 0.31 to 0.39 at 24 px. So the bend is taken mostly in the torso: 12° forward, 13° in the leg.
   - **Result:** overlap of 0.34 for the small cut and 0.30 for the inline cut, against 0.31 and 0.27 before. Any stride's legs overlap λ. What changes the reading is the top: λ's stroke runs straight through the junction and hooks back. The walker's stroke now bends at the hip and leans forward to the head.
   - **Pose:** it is a walk now, not a lunge.
4. **Rationale corrected (applied).** The earlier claim that the stem leans the other way was wrong. Over the whole stroke, the shoulder tip sat 31 units behind the front heel, which is the λ direction. After polish it is 19 to 23 units behind, and the stroke is bent rather than straight. The "i." reading is fixed by 1, 2, 3, 8 and 12. It is not shipped as a known limit.
5. **Favicon tile (applied).** `favicon.svg` is now the app icon in miniature: a basalt rounded square (64 box, r 14) with the champagne small cut inside. The walker no longer depends on the tab colour.
   - **Before:** median stroke contrast at true 16 px was 1.2 to 2.0:1 on light tabs, mismatched strips and incognito.
   - **After:** the walker measures 5.2:1 on the tile in every strip: light, dark, incognito, light OS with dark tabs, and dark OS with light tabs. That is the median over antialiased stroke pixels; fully covered pixels are 13:1.
   - **What the scheme query still does:** it only lifts the tile to #173130 and adds a faint champagne rim on dark systems. Nothing depends on it.
6. **Raster fallbacks (applied).**
   - `favicon.ico`: 16 px and 32 px, each rendered at its own size.
   - `favicon-32.png`.
   - `favicon-180.png`: an RGB apple-touch-icon, downsampled with Lanczos from `AppIcon-1024.png`.
7. **i. at 24 to 60 px (applied in substance; one number rejected).**
   - **Pace point:** it is lifted onto the rising tail in the icon and inline cuts. The tail holds icon weight right up to the dot (20 → 11 units in the icon), so it reads as the end of the path.
   - **Rejected: "head 1.5 radii ahead of the stem top."** With the gap closed to 0.3 of the diameter, the head centre is only about 1.6 radii from the shoulder tip. Placing it 1.5 radii ahead would need a neck line of about 70°, which is chin-forward and contradicts item 2 and the brief.
   - **What I did instead:** the head moves ahead by leaning the torso. It sits 1.5 radii ahead of the hip, the stem's base, in the icon and inline cuts, on a 12° neck.
8. **Lockup baseline (applied).** The horizontal lockups use a cut with no pace point, at every size. The path rises and tapers out as in round 1, and there is one full cap height between it and the W. Below about 40 px tall, use the compact lockup, which also has no pace point.
9. **Light-tab ink (not needed).** No light-tab ink is kept, because the favicon is a self-contained tile. The small cut was thickened anyway so every stroke is at least 1 px at true 16 px inside the tile: hairline 56 units, where 1 px is about 55. On light grounds elsewhere, the inline mark deepens to #6B4E1F at the ground, where the hairlines are (6.8:1 on #EEF1EF).
10. **Minimum sizes (applied).** Each symbol file carries a `<desc>` that says this. The board has a size table.

    | Asset | Use from |
    |---|---|
    | `symbol.svg`, `symbol-on-*.svg`, `symbol-mono.svg`, `splash-mark.svg` | 120 px and up |
    | `mark-inline(-light).svg` | 28 to 96 px |
    | `symbol-small.svg` | 16 to 32 px |
    | Favicon tile | browser tabs |
    | App icon | everything else |
11. **Head ahead in the small cuts (applied as in 7).**
    - The torso leans 13° in the inline and small cuts.
    - The head sits 1.5 radii (inline) and 1.2 radii (small) ahead of the hip.
    - The gap is closed to about 0.3 of the head's diameter.

    The "one head diameter ahead of the stem top" part is rejected for the geometric reason given in 7.
12. **Pace point in the inline mark and lockups (applied).** The inline mark keeps the pace point, lifted onto the rising line. The lockups drop it and restore round 1's rising, tapering tail.
13. **Compact in-app lockup (applied).** `lockup-compact-on-dark.svg` (champagne and #EDE6D6) and `lockup-compact-on-light.svg` (gold ink and #0F1E21):
    - The figure is 2.75 cap heights tall, with 0.6 cap between the mark and the word.
    - It uses the small wordmark cut: wght 470, tracked +190.
    - At 34 px tall the cap height is 12 px; at 30 px it is 10.6 px.
    - No ground rect, and the ids are `wcm-`.

    Every file in the family now uses `wcm-` ids. No ground rect is left in any lockup. The light grounds on the board are the app's #EEF1EF.
14. **Light inline mark (applied).** `mark-inline-light.svg` has the same geometry and viewBox as `mark-inline.svg`.
    - **Colour:** one gradient, #8E6A2E at the head deepening to #6B4E1F at the ground.
    - **Contrast:** 4.3:1 at the head and 6.8:1 at the ground hairlines, on #EEF1EF.
    - **Size:** 1.3 KB, id `wcm-gl`.
15. **Setup screen (applied in the repo).**
    - **Mark:** `hillMark()` in `src/screens/onboarding.js` is replaced by `walkerMark()`, which is the inline mark. Its gradient id is `wcm-onb-g`, so it can never resolve to a copy inside a hidden screen.
    - **CSS:** `.onb-mark svg` is set to 34 px in `src/screens/onboarding.css`.
    - **Checks:** a render showed it on the hero card in both themes, and `npm test` passes.
16. **Icon presence (applied).**
    - **Strokes:** the hairline is up from 25 to 30 units, the ground from 17 to 21, and the path from 17 to 20. Gold now covers 4.2% of the tile, up from 3.8%.
    - **Field:** it runs #1B3634 → #14292A → #0A1416, with a 15% champagne glow and rings at 5 to 8.5%. It now stands apart from black system icons; see the "Aa" control in the true-size check.
    - **Back toe:** the lumpy kink is gone. The trailing leg is now one cubic from the toe to the hip, with no second corner at the ankle.
    - **New exports:**
      - `AppIcon-1024-dark.png`: transparent field, champagne mark. This is the iOS 18 dark appearance, and it also works as a foreground layer.
      - `AppIcon-1024-tinted.png`: grayscale, mark on black, for the tinted appearance.

## Optical cuts (`work/walker.py`, `CUTS`)
| Cut | Used in | Notes |
|---|---|---|
| `symbol` | symbol files, splash | Hairline master. Pace point lifted. |
| `icon` | app icon, stacked lockup | Heavier hairline and ground. The tail keeps its weight up to the pace point. |
| `lockup` | horizontal lockups | Icon weights, no pace point. The path rises and tapers out. |
| `inline` | `mark-inline(-light).svg`, setup hero | Drawn for 34 px. 13° torso. |
| `inline-nopace` | compact lockups | Same as `inline`, without the pace point. |
| `small` | `symbol-small.svg`, favicon | Strokes at least 1 px at 16 px in the tile. No pace point. |

## Colour
- **On dark:** a champagne gradient, #F3E2B6 → #E2C78D → #C9A25A. The pace point is solid #F3E2B6.
- **On light:** gold ink #8E6A2E, deepening to #6B4E1F in the inline and lockup marks. Type is #0F1E21.
- **Grounds:** basalt #10211F → #070B0C, and the icon field around #14292A.
- **Mode colours:** Valley Teal, Ridge Amber and Summit Coral never appear in the mark.

## Regenerate
From `work/`:
```
python3 fonts.py && python3 build.py && node shots.cjs pre && python3 rasters.py && python3 board.py && node shots.cjs board
```
Checks:
- `python3 measure.py` prints the pose numbers above. Add `prepolish` for the old ones.
- `python3 truesize.py && node shots.cjs check` writes the true-pixel page.
- `python3 lambda_overlay.py` prints the λ overlap scores.
- `python3 preview.py` shows every cut over the pre-polish drawing.

`work/prepolish/` keeps the files as they were before this round.
