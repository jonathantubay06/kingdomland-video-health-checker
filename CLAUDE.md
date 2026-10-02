# Notes for Claude sessions

## Expected video count: 238 (admin shows 246), and that is correct

The admin (dashboard.kingdomlandkids.com → Videos, status "Published") lists
**246** videos, but the app (go.kingdomlandkids.com) and this checker see **238**.
The 8-video gap is intentional. Do not treat it as a discovery bug.

- The 8 missing videos are the **"Little Agent"** videos in the **Life Skills /
  Fun Zone** categories (e.g. The Letter Twins, Clothes Mountain, Itchy Monster,
  Hoverboard, Hippocampus, Candy Critters, Big Hair Blues, Three Amigas).
- They are published but have **no Product** attached, so the subscription
  catalog API (`/api/subscriptions/videos`) doesn't return them. That hides
  them from subscribers.
- This is on purpose: the client asked for them to stay hidden for now.
  Don't "fix" it by attaching products, and don't change discovery to
  include them.
- If they're later given a subscription product, the app will show 246 and
  the checker will pick them up automatically. No code change is needed.

## How discovery works

`discoverHomeVideos()` in `check-videos.js` pages through
`/api/subscriptions/videos?page=N&limit=100` using the logged-in session.
Scrolling the Home page is only a fallback: Home shows short per-category
carousels and only renders ~72 cards.
