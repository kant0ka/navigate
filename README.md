# Navigate — what is in front of me?

One big button: tap → camera takes a photo → Gemini 2.5 Flash Lite describes the scene → the phone speaks it.

## Deploy (Netlify)

1. Put this folder in a Git repo and import it in Netlify (or run `netlify deploy --prod` with the Netlify CLI).
   Drag-and-drop may skip the serverless function; if the button says the server is not connected, use Git or the CLI.
2. In **Site settings → Environment variables** add:
   - `OPENROUTER_API_KEY` — your OpenRouter key (never put it in the code)
   - `ACCESS_CODE` — optional, any short secret; protects your key from strangers who find the URL
3. Redeploy so the variables take effect.

## First-time setup (by the assisting person, once per phone)

1. Open the site over HTTPS in Chrome (Android) or Safari (iPhone).
2. Open **«Для сопровождающего»**, tick the consent box, enter the access code if you set one.
3. Tap the big button and allow the camera. Settings are remembered on that phone.
4. If the blind user uses TalkBack/VoiceOver, untick the app voice option so only one voice speaks.

## Files

- `public/` — the web app (index.html, styles.css, app.js)
- `netlify/functions/describe.mjs` — server proxy to OpenRouter; model is set in `MODEL` at the top
