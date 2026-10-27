# Spandan films

Marketing videos for Spandan, made with [OpenFilm](https://github.com/openfilm/openfilm): every shot is a web page
drawn from code, so any line of copy, colour or timing can be changed and the film re-rendered.

Rendered MP4s are in `renders/`. `showcase/` is an interactive page that plays them and pauses at each film's
question so viewers can tap an answer and see how everyone else voted.

## The films

| # | Film | Format | Length | Interaction built in |
|---|---|---|---|---|
| 01 | **Your campaign can answer for itself** (brand hook) | 9:16 | 40s | Poll: "Who answers your customers? A/B/C" · CTA "Comment AGENT" |
| 02 | **Spot the bot that lied** (quiz) | 9:16 | 41s | 5-second countdown quiz "Bot A or B?" · reveal · "Drop a 🔥" |
| 03 | **This or That: WhatsApp edition** | 9:16 | 37s | 5 rapid pick-a-side rounds · "Comment your score" |
| 04 | **The midnight inbox** (pain: slow replies) | 9:16 | 35s | "What time did you answer your last customer?" |
| 05 | **The surprise bill** (pain: hidden charges) | 9:16 | 36s | "Ever been surprised by a messaging bill? YES/NO" |
| 06 | **Did the automation fire?** (pain: brittle keyword bots) | 9:16 | 32s | "Tag the teammate who says it should've worked" |
| 07 | **The offer changed. The bot lied.** (pain: stale bot answers) | 9:16 | 34s | "Would your bot pass this test? ✅/❌" |
| 08 | **The call nobody picked up** (pain: missed calls at clinics) | 9:16 | 33s | "How many calls did you miss today? Comment a number" |
| 09 | **Product tour** (full demo, every feature + USPs + pricing) | 16:9 | 3:24 | Chapter rail on screen · "Pause & guess" quiz in chapter 06 |

### Series 2: complete stories, new colour schemes

Each one runs start to finish, from hook to product to payoff, and ends on a branded end card with a short hold.
There are no on-screen polls or pauses, and each uses its own palette, display face and animated background
(`_shared/themes.css`, `_shared/themes.js`).

| # | Film | Look | Length |
|---|---|---|---|
| 10 | **Diwali sale on autopilot**: one founder, AI-written festive campaign, AI answers every question | Saffron & gold, rising sparkles, rotating mandala | 42s |
| 11 | **Your first campaign, start to finish**: connect → template → audience → AI on → go live | Bright daylight, light WhatsApp UI, confetti launch | 43s |
| 12 | **Follow one message**: the six stops from broadcast to analytics | Synthwave violet, neon horizon grid and sun | 49s |
| 13 | **Every language, same true answer**: English, Hindi, Hinglish, Tamil | Ocean teal, flowing wave lines | 38s |
| 14 | **One platform, every business**: e-commerce, education, clinics, real estate, agencies, travel | Sunrise peach & coral, bokeh | 45s |

The product tour covers: connecting a number (embedded signup / pool), the AI template studio and Meta approval,
contacts and segments with STOP handling, the 11-step campaign builder, the Campaign AI agent (grounded answers,
Hinglish, human handoff), intent matching, workflows with run history, WhatsApp forms, the shared inbox and agency
workspaces, analytics, the auditable wallet ledger (reserve → settle → refund, Meta's rate with no markup), Voice
AI, Instagram quickflows, API keys, webhooks and integrations, a comparison against generic bots, and pricing.

All product claims come from `backend/src/data/siteContent.js`, the copy the landing page and website assistant
already use. Customer names, phone numbers and rupee amounts inside the scenes are illustrative.

## Posting copy

Captions to paste with each reel. Before posting 01, make sure someone will reply to the "AGENT" comments with a
demo link, since the video promises one.

- **01** · Sent 10,000 WhatsApp messages. 2,000 people replied. Who's answering? Comment A, B or C 👇 then comment AGENT for a live demo. #WhatsAppMarketing #WhatsAppBusiness #D2C
- **02** · One of these bots just lied to a customer. Can you spot it before the timer ends? 🕵️ Comment A or B. #AIChatbot #CustomerExperience
- **03** · This or That, WhatsApp marketing edition ⚡ Keep score and comment it below. #WhatsAppAPI #SmallBusiness
- **04** · 11:48 PM and still replying to sale messages? 😮‍💨 What time did you answer your last customer? #Ecommerce #CustomerSupport
- **05** · Budgeted ₹31,000. Billed ₹48,200. Where did it go? 😳 Ever been surprised by a messaging bill? YES or NO 👇 #WhatsAppBusiness #StartupIndia
- **06** · "It should've worked…" 😅 Tag the teammate who owns your automations. #Automation #WhatsAppBot
- **07** · Monday 50% off. Wednesday 30%. Thursday, an angry screenshot. Would your bot pass this test? ✅ or ❌ #AIChatbot #D2CBrands
- **08** · Clinic owners: how many calls did your front desk miss today? 📞 Comment a number. #ClinicManagement #HealthcareMarketing
- **10** · Diwali sale, 10,000 customers, one founder 🪔 Watch the campaign run itself. Happy Diwali from Spandan ✨ #DiwaliSale #WhatsAppMarketing #D2CIndia
- **11** · Your first WhatsApp campaign in 5 steps, no code ✅ Save this for later. #WhatsAppBusiness #SmallBusinessIndia
- **12** · Follow one WhatsApp message through all six stops, from broadcast to booked sale 💬 #MarketingAutomation #WhatsAppAPI
- **13** · English, हिन्दी, Hinglish, தமிழ் — one offer, the same honest answer in every language 🌏 #AIChatbot #Vernacular
- **14** · Shops, schools, clinics, realtors, agencies, travel: one WhatsApp platform for all of them. Which one are you? #WhatsAppBusiness #CustomerEngagement

## Editing and re-rendering

Each film is a folder: `spec.json` holds the scene order, lengths, voice-over lines and sound effects; each
`s*.html` page draws one shot as a function of time. `_shared/` holds the brand kit (fonts, `brand.css`,
`kit.js`), copied into each film's `lib/` by the build.

```sh
pip install kokoro-onnx soundfile numpy        # voice-over (Kokoro TTS, runs locally)
# model files kokoro-v1.0.int8.onnx and voices-v1.0.bin from
# https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0 into $FILM_SCRATCH/voices
python3 _tools/make_audio.py $FILM_SCRATCH/audio     # music beds and sound effects, synthesised in code
python3 _tools/build.py 0*/                          # voice lines, assets and film.html for each film
npx -y openfilm@latest open 01-answer-for-itself     # edit a film in OpenFilm Studio
./_tools/render-all.sh                               # render every film into renders/
```

The OpenFilm agent skill is installed at `.agents/skills/openfilm` (tracked in `skills-lock.json`), so a coding
agent in this repo can open and edit these films directly. `.claude/` is gitignored, so on a fresh clone run
`npx skills add openfilm/openfilm` once to link it for Claude Code.

Music and sound effects are generated by `_tools/make_audio.py`; voice-over is Kokoro TTS (Apache-2.0). No
third-party footage, stock audio or images are used.
