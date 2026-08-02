# Gradelytics

Gradelytics is a web application designed to help students track, analyze, and visualize their academic performance. The app allows users to input academic details, view statistics, and celebrate achievements, all in a modern and responsive interface.

## Key Features

- **Module Management** - Add, edit, and delete academic modules with course name, academic year, part, semester, mark, and classification
- **Screenshot Upload & AI Extraction** - Upload a screenshot of your results table and AI will automatically extract all module data using a vision model
- **Dynamic Statistics** - Bar chart showing average marks per part/semester, pie chart showing classification distribution, overall average, and total marks
- **AI Grade Prediction** - Predict your next semester average with AI-powered analysis, identify academic strengths, and get personalized study strategy recommendations
- **Achievement Tracking** - Earn Gold (90+), Silver (80-89), and Bronze (75-79) medals, plus improvement awards for 10+ mark jumps between semesters
- **Gradelytics AI Chat Assistant** - AI-powered chatbot with access to your academic data for personalized analysis, predictions, career recommendations, and study tips. Includes suggested prompts and persistent chat history
- **CSV Export** - Download your academic details as a CSV file
- **Responsive Design** - Mobile-friendly sidebar navigation with hamburger menu toggle
- **Cloud Data Persistence** - User accounts with email sign-up/login. Modules, AI chat history, and achievements sync to a Supabase backend with row-level security, so your data follows you across devices. Falls back to localStorage for offline / no-account use

## Technologies Used

- HTML, CSS (responsive design with CSS custom properties)
- JavaScript (Chart.js, chartjs-plugin-datalabels, jsPDF)
- Space Grotesk + Inter fonts (Google Fonts)
- Boxicons (icon library)
- Supabase (PostgreSQL backend, Auth, Row Level Security)
- NVIDIA API (AI chat and vision models via backend proxy)
- Vercel Serverless Functions (API proxy for secure key management)

## Purpose

The application empowers students to understand their academic progress and receive AI-driven insights for future improvement and career recommendations.

## Setup

### Supabase backend

1. Create a project at https://supabase.com.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. Copy the **Project URL** and **anon key** from Settings → API into `supabase-config.js`.
4. For server-side reference, the same values can be added to `.env` as `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

See [supabase/README.md](supabase/README.md) for the full walkthrough.

### AI keys

Set `NVIDIA_API_KEY` (and optionally `NVIDIA_VISION_API_KEY`, `AI_MODEL`, `VISION_MODEL`) in `.env` for local development, or as Vercel environment variables for deployment.

### Run locally

```sh
node server.js
# → http://localhost:3000
```

## Live Demo

https://genius-pa.vercel.app
