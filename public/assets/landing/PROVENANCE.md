# Landing photography — provenance

Every file in this folder is third-party stock photography from **Pexels**, used
under the **Pexels License** (free for commercial use, no attribution required,
not sold unmodified as a stock library, not redistributed as a standalone
asset). Attribution is recorded here anyway, because knowing who made an image
is part of shipping responsibly.

No image is generated. No image depicts a real Suggest Key mentor or seeker, and
no image is presented as a platform member — they are editorial scenes of
conversation used to carry the brand's tone. Mentor portrait photography on the
landing page comes exclusively from `mentor_profiles.avatar_url` at runtime.

| File | Pexels id | Photographer | Scene |
| --- | --- | --- | --- |
| `hero-conversation.jpg` | [9050600](https://www.pexels.com/photo/man-and-woman-talking-while-having-coffee-9050600) | Mike Jones | Two colleagues in conversation over coffee by a window. 85mm, f/2.2, so the background falls away and the image reads cinematic rather than stock. |
| `connection-conversation.jpg` | [10029695](https://www.pexels.com/photo/two-women-talking-in-living-room-10029695) | RDNE Stock project | Two people talking in a bright living room, mid-gesture. Used for the human-connection spread. |
| `area-1.jpg` | [1181719](https://www.pexels.com/photo/two-women-sitting-on-chairs-beside-window-1181719/) | Christina Morillo | Two people at a table by a window. |
| `area-2.jpg` | [22046264](https://www.pexels.com/photo/office-workers-sitting-at-a-table-and-discussing-strategy-22046264) | Vitaly Gariev | Two professionals discussing at a desk. |
| `area-3.jpg` | [7212926](https://www.pexels.com/photo/people-creative-laptop-office-7212926) | Ivan S | Two colleagues in conversation at a shared workspace. |
| `area-4.jpg` | [3182765](https://www.pexels.com/photo/photo-of-people-talking-to-each-other-3182765) | fauxels | A group around a table, sharing notes. |
| `area-5.jpg` | [8554325](https://www.pexels.com/photo/two-people-talking-at-a-cafe-table-8554325) | Liliana Drew | Two people in conversation at a cafe table. |

## Processing

Downloaded at 2x the rendered width, downscaled with ffmpeg (`scale`, libjpeg
`-q:v 6`, `yuv420p`, progressive) so every file carries a moiré-safe 4:2:0
chroma profile that renders identically across browsers, and stored with
`faststart` so the first byte of the scan arrives before the whole file.

## Replacing an image

Drop a replacement at the same filename and update the row above. The component
layer reads dimensions from a single manifest
(`src/components/landing/landingImages.ts`); nothing else hard-codes a width or
height, so a differently proportioned replacement only needs its dimensions
updated there.