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

## Alerts when the video list is incomplete

If discovery can't see the whole catalog, the run is flagged as a partial
discovery (`discoveryWarning` in `video-report.json`). That happens when the
catalog API fails and Home scrolling is used, when fewer videos than the API's
total are collected, or when the count drops >5% below recent runs without the
API confirming the smaller total. The checker sends a Slack alert
(`sendSlackDiscoveryAlert`), and the workflow's last step fails the run so GitHub
emails the owner. A smaller count that the API itself confirms is logged as
"Catalog shrank" and does not alert.
