# Interview Practice Partner

A conversational AI agent that conducts mock interviews for specific roles, asks follow-up questions, and gives end-of-interview feedback.

## Tech Stack

Frontend

React 19 – Latest version used for building interactive UI components.

TypeScript – Ensures type-safety and structured component development.

Styling

Tailwind CSS – Used for all styling, responsive layouts, utility classes, animations (pulse, wave), and dark-mode color palette (loaded via CDN).

Google Fonts (Inter) – Primary font family for clean UI typography.

Audio Processing

Web Audio API – Captures microphone input, processes audio streams, and plays back AI-generated audio.

PCM Conversion Utilities – Custom audio helpers (utils/audio.ts) to:

Convert Float32Array → Int16 PCM (for Gemini API)

Decode PCM back to playable audio

Data Handling & State Management

React Hooks – useState, useRef, useEffect to manage:

Interview flow state

Microphone and audio streams

UI navigation and active screens

HTML5 FileReader API – Converts PDF/Text resumes into Base64 for AI analysis.

Architecture

Client-Side SPA – Entire application runs in the browser as a Single-Page App.

Direct API Communication – Connects directly to Google Gemini APIs with no custom backend server.

## Setup (Conda + VS Code)

```bash
conda create -n interview_bot python=3.11 -y
conda activate interview_bot
pip install -r requirements.txt
```

Create `.env` from `.env.example` and set `OPENAI_API_KEY`.

Run backend:

```bash
uvicorn main:app --reload
```

Then open `index.html` in your browser.

## Features

- Role selection (Software Engineer, Sales, Retail, Data Analyst)
- Multi-phase interview:
  - Introduction
  - Experience
  - Behavioural (STAR)
  - Technical
  - Closing
- Follow-up questions based on your answers
- Structured feedback (summary, strengths, areas to improve, scores, tips)
- Optional voice input (mic) and spoken questions
